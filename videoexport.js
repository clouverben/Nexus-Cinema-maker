// ==================== VIDEOEXPORT.JS v4 ====================
// Fixes:
//  1. Capture direto do canvas WebGL do renderer (não offscreen canvas)
//  2. requestFrame() no track correto (captureStream(0) = controle manual)
//  3. EBML patcher para inserir Duration no WebM (corrige "0 segundos")
//  4. WebCodecs MP4 como caminho primário (duração correta nativa)
//  5. Loop de render pausado durante captura (sem race condition)
//  6. Usa o pipeline real de pós-processamento (renderFrame de posprocess.js)
//     em vez de renderer.render() cru — antes o vídeo saía sem bloom/tone
//     mapping/exposição, ficando mais claro e "lavado" que o viewport.

import { renderFrame } from './posprocess.js';
import { getViewportSize } from './scene.js';
import { tickShaderSystem } from './ShaderEffectManager.js';
import { tickDomain } from './DomainManager.js';

window._exportPaused = false;
let _rendering = false, _cancelled = false;

const getApp = () => window._app;
// Await one rAF cycle — GPU flushes + browser gets a breath
function rafYield() { return new Promise(r => requestAnimationFrame(r)); }
function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

function triggerDownload(url, name) {
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 6000);
}

// ── Renderiza um frame na canvas do THREE.js ───────────────────────────────
// ★ Uses the SAME renderFrame() the live viewport calls every tick — this
// runs the full post-processing composer (bloom, tone mapping, exposure/
// contrast/saturation, vignette). The previous version called
// app.renderer.render(scene, camera) directly, skipping ALL of that —
// which is exactly why exported video looked flatter/grayer/washed-out
// compared to the viewport (no tone mapping curve, no bloom, no grading).
async function renderOneFrame(frameNum, fps) {
    const app = getApp(); if (!app?.renderer) return;
    if (window.AnimationSystem)   window.AnimationSystem.goToFrame(frameNum);
    if (window._nexusParticleLab) window._nexusParticleLab.update(1 / fps);
    if (window._nexusAuraLab)     window._nexusAuraLab.update(1 / fps);
    // Export is paused outside the normal render loop, so procedural shader
    // uniforms and domain containment must be advanced explicitly per frame.
    tickShaderSystem(1 / fps);
    tickDomain();
    await renderFrame();
}

// ── EBML Duration patcher ──────────────────────────────────────────────────
// Chrome MediaRecorder gera WebM com Duration = 0 ou sem Duration.
// Essa função encontra e corrige o elemento Duration no cabeçalho EBML.
async function fixWebMDuration(blob, durationMs) {
    try {
        const buf  = await blob.arrayBuffer();
        const u8   = new Uint8Array(buf);
        const view = new DataView(buf);
        const limit = Math.min(u8.length - 12, 32768);

        for (let i = 0; i < limit; i++) {
            // Duration EBML ID = 0x44 0x89
            if (u8[i] !== 0x44 || u8[i + 1] !== 0x89) continue;
            const sizeCode = u8[i + 2];
            let dataOff, byteLen;

            // VINT decoding (1 ou 2 bytes de tamanho)
            if ((sizeCode & 0x80) !== 0) {
                byteLen = sizeCode & 0x7F;
                dataOff = i + 3;
            } else if ((sizeCode & 0x40) !== 0) {
                byteLen = ((sizeCode & 0x3F) << 8) | u8[i + 3];
                dataOff = i + 4;
            } else {
                continue;
            }

            if (byteLen === 8 && dataOff + 8 <= u8.length) {
                view.setFloat64(dataOff, durationMs, false); // big-endian float64
                return new Blob([buf], { type: blob.type });
            }
            if (byteLen === 4 && dataOff + 4 <= u8.length) {
                view.setFloat32(dataOff, durationMs, false);
                return new Blob([buf], { type: blob.type });
            }
        }
        console.warn('[VideoExport] Elemento Duration não encontrado no WebM para patch.');
    } catch (e) {
        console.warn('[VideoExport] Falha no EBML patcher:', e);
    }
    return blob;
}

// ── PATH A: WebCodecs + mp4-muxer API → MP4 (Chrome 94+, Android WebView) ──────
// API usada: VideoEncoder (WebCodecs API) + mp4-muxer (muxer JS puro)
// Produz .mp4 nativo com timestamps corretos e H.264 hardware-encoded
async function exportMP4(startF, endF, fps, bitrateMbps, onProgress) {
    if (typeof VideoEncoder === 'undefined') throw new Error('VideoEncoder não disponível');

    // ── Carregar mp4-muxer via API CDN ────────────────────────────────────
    let Muxer, ArrayBufferTarget;
    const MP4_MUXER_URLS = [
        'https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.js',
        'https://unpkg.com/mp4-muxer@5/build/mp4-muxer.js',
        'https://cdn.jsdelivr.net/npm/mp4-muxer@4/build/mp4-muxer.js',
        'https://cdn.skypack.dev/mp4-muxer',
    ];
    for (const url of MP4_MUXER_URLS) {
        try {
            const m = await Promise.race([
                import(url),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
            ]);
            Muxer            = m.Muxer            ?? m.default?.Muxer;
            ArrayBufferTarget = m.ArrayBufferTarget ?? m.default?.ArrayBufferTarget;
            if (typeof Muxer === 'function') { console.log('[MP4] mp4-muxer carregado de', url); break; }
        } catch (e) { console.warn('[MP4] CDN falhou:', url, e.message); }
    }
    if (typeof Muxer !== 'function') throw new Error('mp4-muxer indisponível em todos os CDNs');

    const canvas = getApp().renderer.domElement;
    const w = canvas.width  - (canvas.width  % 2);
    const h = canvas.height - (canvas.height % 2);

    // ── Detectar melhor codec H.264 suportado pelo dispositivo ─────────────
    // Prioriza perfil Higher → Main → Baseline (melhor qualidade → mais compat.)
    let codec = 'avc1.42001f'; // Baseline — funciona em qualquer Android
    for (const c of ['avc1.640028', 'avc1.4d0028', 'avc1.4d001f', 'avc1.42001f']) {
        try {
            const support = await VideoEncoder.isConfigSupported({ codec: c, width: w, height: h });
            if (support.supported) { codec = c; break; }
        } catch {}
    }
    console.log('[MP4] Codec selecionado:', codec);

    const target = new ArrayBufferTarget();
    const muxer  = new Muxer({
        target,
        video: { codec: 'avc', width: w, height: h },
        fastStart: 'in-memory',   // duração correta sem pós-processamento
    });
    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error:  e => console.error('[MP4] Encode error:', e),
    });
    encoder.configure({
        codec,
        width: w, height: h,
        bitrate: bitrateMbps * 1_000_000,
        framerate: fps,
        latencyMode: 'quality',
    });

    // ── Correção de velocidade ────────────────────────────────────────────
    // O fps da timeline (AnimState.fps) define a velocidade real da animação
    // no viewport. O fps de exportação controla bitrate/codec, mas NÃO a
    // duração do vídeo. Mantemos 1 frame de vídeo por frame de animação
    // (frames inteiros — sem interpolação fracionada que causava frames
    // duplicados/congelados) e usamos animFps para o timestamp de cada frame.
    // Resultado: duração do vídeo = (endF−startF)/animFps s = viewport. ✓
    const rawAnimFps = window.AnimationSystem?.getState?.()?.fps;
    const animFps    = (typeof rawAnimFps === 'number' && rawAnimFps > 0 && isFinite(rawAnimFps))
                       ? rawAnimFps : fps;
    const total      = endF - startF;
    const usPerFrame = 1_000_000 / animFps;   // cada frame dura 1/animFps s

    for (let i = 0; i < total; i++) {
        if (_cancelled) break;

        // Backpressure: não deixa a fila de encode estourar na memória
        while (encoder.encodeQueueSize > 4) await rafYield();

        // Frame inteiro → sem arredondamentos, sem frames duplicados/congelados
        await renderOneFrame(startF + i, animFps);

        // Timestamp baseado em animFps: vídeo toca na mesma velocidade do viewport
        const vf = new VideoFrame(canvas, {
            timestamp: Math.round(i * usPerFrame),
            duration:  Math.round(usPerFrame),
        });
        encoder.encode(vf, { keyFrame: i % Math.max(1, animFps) === 0 });
        vf.close();

        onProgress?.(i / total, `MP4: frame ${startF + i} / ${endF - 1}`);
        if (i % 6 === 5) await rafYield();
    }

    await encoder.flush();
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
}

// ── PATH B: MediaRecorder → WebM (fallback universal) ─────────────────────
// KEY FIX: captura diretamente do canvas do renderer (não offscreen canvas)
// usando captureStream(0) + requestFrame() para controle manual de frame.
//
// SMOOTHNESS FIX: MediaRecorder derives each recorded frame's real timing
// from the wall-clock moment you call requestFrame() — unlike the MP4 path,
// there's no synthetic-timestamp escape hatch here, so pacing quality
// directly determines output smoothness. The previous version mixed
// setTimeout(ms) with rAF, and setTimeout drifts (browsers coalesce/clamp
// it, especially under load) — that drift is exactly what caused jerky
// motion. This version paces frames using ONLY requestAnimationFrame ticks
// (which fire at the display's true refresh rate) and accumulates target
// time without ever resetting the baseline, so timing errors never
// compound frame-to-frame.
// ── PATH B: MediaRecorder → WebM (fallback universal) ─────────────────────
// KEY FIX #1: captura diretamente do canvas do renderer (não offscreen canvas)
// usando captureStream(0) + requestFrame() para controle manual de frame.
//
// KEY FIX #2 (speed bug): MediaRecorder has no synthetic-timestamp escape
// hatch like WebCodecs does — it derives each frame's real timing from the
// actual wall-clock moment you call requestFrame(). Once renderOneFrame()
// started going through the FULL post-processing pipeline (bloom, tone
// mapping — needed to fix the "washed out" bug), each render could take
// longer than a frame's time budget (frameDurMs). That overrun stretched
// the REAL gap between requestFrame() calls, so MediaRecorder correctly
// recorded a LONGER video for the same content — which plays back as
// slow motion versus the live viewport. Fix: split into two phases.
// Phase 1 renders every frame as fast as it actually takes (no real-time
// constraint at all). Phase 2 replays the already-rendered bitmaps onto a
// plain 2D canvas — a near-instant operation regardless of scene
// complexity — paced with precise real-time waits that MediaRecorder
// captures. Render speed can no longer leak into output timing.
async function exportWebM(startF, endF, fps, bitrateMbps, onProgress) {
    const app = getApp();
    if (!app?.renderer?.domElement) throw new Error('Renderer não disponível');

    const glCanvas = app.renderer.domElement;
    // ── Correção de velocidade (mesma lógica do caminho MP4) ──────────────
    // Frames inteiros + frameDurMs baseado em animFps → vídeo toca na
    // mesma velocidade que o viewport, sem frames duplicados ou congelados.
    const rawAnimFps = window.AnimationSystem?.getState?.()?.fps;
    const animFps    = (typeof rawAnimFps === 'number' && rawAnimFps > 0 && isFinite(rawAnimFps))
                       ? rawAnimFps : fps;
    const total      = endF - startF;
    const frameDurMs = 1000 / animFps;   // Fase 2 reproduz na velocidade da animação

    // ── Phase 1: render every frame, as fast as it actually takes ─────────
    onProgress?.(0, 'Renderizando frames…');
    const bitmaps = [];
    for (let i = 0; i < total; i++) {
        if (_cancelled) break;
        await renderOneFrame(startF + i, animFps);   // frames inteiros
        bitmaps.push(await createImageBitmap(glCanvas));
        onProgress?.((i / total) * 0.55, `Renderizando: frame ${startF + i} / ${endF - 1}`);
        if (i % 6 === 5) await rafYield();
    }
    if (_cancelled) { bitmaps.forEach(b => b.close()); return null; }

    // ── Phase 2: replay onto a plain 2D canvas at precise real-time pace ──
    const w = glCanvas.width, h = glCanvas.height;
    const playCanvas = document.createElement('canvas');
    playCanvas.width = w; playCanvas.height = h;
    const ctx2d = playCanvas.getContext('2d', { alpha: false });

    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

    const stream = playCanvas.captureStream(0);   // 0 = manual frame control
    const track  = stream.getVideoTracks()[0];
    if (!track) { bitmaps.forEach(b => b.close()); throw new Error('captureStream não retornou track de vídeo'); }

    const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrateMbps * 1_000_000,
    });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };

    return new Promise((resolve, reject) => {
        let frameIdx = 0;
        let nextDue  = null;

        async function finish() {
            try {
                bitmaps.slice(frameIdx).forEach(b => b.close());
                recorder.requestData();
                await new Promise(r => { recorder.onstop = r; recorder.stop(); });
                stream.getTracks().forEach(t => t.stop());

                onProgress?.(0.97, 'Corrigindo metadados…');
                const durationMs = (total / animFps) * 1000;   // duração real: frames / animFps
                const raw   = new Blob(chunks, { type: mimeType });
                const fixed = await fixWebMDuration(raw, durationMs);
                resolve({ blob: fixed, ext: 'webm' });
            } catch (e) { reject(e); }
        }

        function rafLoop(now) {
            if (_cancelled) { finish(); return; }
            if (frameIdx >= bitmaps.length) { finish(); return; }

            if (nextDue === null) nextDue = now;

            if (now >= nextDue) {
                // Drawing a pre-rendered bitmap is near-instant — this is
                // the whole point: no post-processing recompute here, so
                // this loop can actually hit its real-time target.
                ctx2d.drawImage(bitmaps[frameIdx], 0, 0, w, h);
                bitmaps[frameIdx].close();
                if (track.readyState === 'live') track.requestFrame();
                onProgress?.(0.55 + (frameIdx / total) * 0.42, `Codificando: frame ${startF + frameIdx} / ${endF - 1}`);
                frameIdx++;
                nextDue += frameDurMs; // accumulate — never drifts from real elapsed time
            }
            requestAnimationFrame(rafLoop);
        }

        // Pre-warm: paint the first frame before recording so the very
        // first captured sample isn't a blank canvas.
        if (bitmaps.length) ctx2d.drawImage(bitmaps[0], 0, 0, w, h);
        requestAnimationFrame(() => {
            recorder.start(); // no timeslice — all data collected on stop()
            requestAnimationFrame(rafLoop);
        });
    });
}

// ── SFM-style video preview overlay ───────────────────────────────────────
// Aparece após o export concluir — o usuário vê o vídeo e pode baixar.
function showVideoPreview(blob, ext, filename) {
    const url = URL.createObjectURL(blob);

    const ov = document.createElement('div');
    ov.id = '_vp_ov';
    ov.style.cssText = [
        'position:fixed;inset:0;z-index:100000',
        'background:rgba(0,0,0,.88)',
        'display:flex;align-items:center;justify-content:center',
        'backdrop-filter:blur(10px)',
        'animation:_vpFadeIn .22s ease',
    ].join(';');

    ov.innerHTML = `
      <style>
        @keyframes _vpFadeIn { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:scale(1)} }
        #_vp_panel { width:min(94vw,640px); background:#06080f;
          border:1px solid rgba(100,140,255,.2); border-radius:16px;
          overflow:hidden; box-shadow:0 28px 80px rgba(0,0,0,.95);
          font-family:system-ui,-apple-system,sans-serif; }
        #_vp_header { display:flex;align-items:center;justify-content:space-between;
          padding:11px 16px; border-bottom:1px solid rgba(255,255,255,.06); }
        #_vp_title  { display:flex;align-items:center;gap:8px;
          font-size:13px;font-weight:700;color:#7edfff; }
        #_vp_badge  { font-size:9px;text-transform:uppercase;letter-spacing:.08em;
          color:#555;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);
          padding:2px 7px;border-radius:5px; }
        #_vp_close  { background:none;border:none;color:#555;cursor:pointer;
          font-size:18px;padding:2px 8px;line-height:1;transition:color .12s; }
        #_vp_close:hover { color:#bbb; }
        #_vp_vid    { width:100%;display:block;max-height:65vh;
          object-fit:contain;background:#000; }
        #_vp_footer { display:flex;gap:7px;padding:12px 16px;
          border-top:1px solid rgba(255,255,255,.06); }
        #_vp_dl     { flex:1;padding:9px;border-radius:8px;cursor:pointer;
          font-size:12px;font-weight:700;font-family:inherit;
          background:linear-gradient(135deg,rgba(30,64,175,.45),rgba(56,189,248,.28));
          border:1px solid rgba(100,180,255,.4);color:#7edfff;
          display:flex;align-items:center;justify-content:center;gap:6px;
          transition:opacity .15s; }
        #_vp_dl:hover { opacity:.82; }
        #_vp_cls2   { padding:9px 16px;border-radius:8px;cursor:pointer;
          font-size:12px;font-family:inherit;font-weight:600;
          border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);
          color:#999;transition:background .12s; }
        #_vp_cls2:hover { background:rgba(255,255,255,.09); }
        #_vp_prog   { display:flex;align-items:center;gap:8px;
          padding:6px 16px 0;font-size:10px;color:#555; }
        #_vp_timeLabel { min-width:60px;text-align:right;font-variant-numeric:tabular-nums; }
        #_vp_scrub  { flex:1;height:3px;appearance:none;background:rgba(255,255,255,.12);
          border-radius:3px;cursor:pointer;accent-color:#38bdf8; }
      </style>
      <div id="_vp_panel">
        <div id="_vp_header">
          <div id="_vp_title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7edfff" stroke-width="2">
              <rect x="2" y="2" width="20" height="20" rx="2"/>
              <polygon points="10 8 16 12 10 16 10 8" fill="#7edfff" stroke="none"/>
            </svg>
            Preview do Vídeo
            <span id="_vp_badge">${ext.toUpperCase()}</span>
          </div>
          <button id="_vp_close">✕</button>
        </div>

        <video id="_vp_vid" src="${url}" controls loop playsinline preload="auto"></video>

        <div id="_vp_prog">
          <span id="_vp_timeLabel">0:00 / 0:00</span>
          <input id="_vp_scrub" type="range" min="0" max="1000" value="0" step="1">
        </div>

        <div id="_vp_footer">
          <button id="_vp_dl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-6-6h4V4h4v6h4l-6 6zM4 20h16v2H4z"/></svg>
            Baixar ${ext.toUpperCase()}
          </button>
          <button id="_vp_cls2">Fechar</button>
        </div>
      </div>`;

    document.body.appendChild(ov);

    const vid   = document.getElementById('_vp_vid');
    const scrub = document.getElementById('_vp_scrub');
    const timeL = document.getElementById('_vp_timeLabel');

    function fmt(s) {
        const m = Math.floor(s / 60), ss = Math.floor(s % 60);
        return `${m}:${ss.toString().padStart(2,'0')}`;
    }

    vid.addEventListener('timeupdate', () => {
        const t = vid.duration || 1;
        scrub.value = Math.round((vid.currentTime / t) * 1000);
        timeL.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration || 0)}`;
    });
    scrub.addEventListener('input', () => {
        if (vid.duration) vid.currentTime = (scrub.value / 1000) * vid.duration;
    });

    const close = () => { URL.revokeObjectURL(url); ov.remove(); };
    document.getElementById('_vp_close')?.addEventListener('click', close);
    document.getElementById('_vp_cls2')?.addEventListener('click',  close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    document.getElementById('_vp_dl')?.addEventListener('click', () => {
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        document.body.appendChild(a); a.click(); a.remove();
    });

    // Auto-play after metadata is ready
    vid.addEventListener('loadedmetadata', () => vid.play().catch(() => {}));
}


function makeProgressUI() {
    const ov = document.createElement('div');
    ov.id    = '_vex_ov';
    ov.style.cssText = [
        'position:fixed;inset:0;z-index:99999',
        'background:rgba(0,0,0,.9)',
        'display:flex;align-items:center;justify-content:center',
        'backdrop-filter:blur(10px)',
    ].join(';');
    ov.innerHTML = `
      <div style="
        background:#06080f;border:1px solid rgba(100,180,255,.25);
        border-radius:18px;padding:32px;width:min(400px,90vw);
        box-shadow:0 24px 70px rgba(0,0,0,.95);
        font-family:system-ui,-apple-system,sans-serif;color:#ccc
      ">
        <div style="font-size:32px;text-align:center;margin-bottom:16px;filter:drop-shadow(0 0 12px #7edfff88)">🎬</div>
        <h3 style="margin:0 0 18px;font-size:16px;color:#7edfff;text-align:center;font-weight:700;letter-spacing:.02em">
          Exportando Vídeo
        </h3>
        <p id="_vex_phase" style="font-size:10px;color:#555;text-align:center;
           text-transform:uppercase;letter-spacing:.9px;margin:0 0 5px">Preparando…</p>
        <p id="_vex_label" style="text-align:center;margin:0 0 14px;color:#999;
           font-size:12px;min-height:18px"></p>
        <div style="background:rgba(255,255,255,.06);border-radius:100px;height:8px;
             overflow:hidden;margin-bottom:8px">
          <div id="_vex_bar" style="height:100%;border-radius:100px;width:0%;
               transition:width .15s ease;
               background:linear-gradient(90deg,#1d4ed8 0%,#38bdf8 60%,#7edfff 100%)"></div>
        </div>
        <div style="display:flex;justify-content:space-between;
             font-size:11px;color:#555;margin-bottom:20px">
          <span id="_vex_pct">0%</span>
          <span id="_vex_eta"></span>
        </div>
        <button id="_vex_cancel" style="
          width:100%;padding:10px;border-radius:9px;cursor:pointer;
          font-size:13px;font-weight:600;letter-spacing:.02em;
          background:rgba(255,60,60,.08);
          border:1px solid rgba(255,60,60,.28);color:#f88;
          transition:background .15s
        ">✕ Cancelar</button>
      </div>`;
    document.body.appendChild(ov);

    const t0 = Date.now();
    ov.querySelector('#_vex_cancel').addEventListener('click', () => { _cancelled = true; });

    const $  = id => document.getElementById(id);
    return {
        phase(s)    { $('_vex_phase').textContent = s; },
        label(s)    { $('_vex_label').textContent = s; },
        progress(p) {
            const v = Math.round(p * 100);
            $('_vex_bar').style.width = v + '%';
            $('_vex_pct').textContent  = v + '%';
            if (p > 0.06) {
                const el  = (Date.now() - t0) / 1000;
                const rem = Math.max(0, (el / p) * (1 - p));
                $('_vex_eta').textContent = `~${Math.ceil(rem)}s restantes`;
            }
        },
        done() { ov.remove(); },
    };
}

// ── Configurações disponíveis ──────────────────────────────────────────────
export const RESOLUTIONS = [
    ['Viewport (atual)',    0,    0   ],
    ['720p   (1280×720)',   1280, 720 ],
    ['1080p  (1920×1080)', 1920, 1080],
];
export const QUALITIES = [
    ['Rascunho —  4 Mbps',  4],
    ['Boa     — 12 Mbps',  12],
    ['Alta    — 24 Mbps',  24],
    ['Máxima  — 40 Mbps',  40],
];

// ── Entrada principal ──────────────────────────────────────────────────────
export async function startVideoExport(opts = {}) {
    if (_rendering) { alert('Já há uma exportação em andamento.'); return; }
    const { startF = 0, endF = 30, fps = 30, resIdx = 0, qIdx = 1 } = opts;

    if (startF >= endF) { alert('Frame início deve ser menor que Frame fim.'); return; }
    if ((endF - startF) > 1800) {
        if (!confirm(`${endF - startF} frames pode demorar muito. Continuar?`)) return;
    }

    const [, rW, rH] = RESOLUTIONS[resIdx] ?? RESOLUTIONS[0];
    const bitrate    = QUALITIES[qIdx]?.[1] ?? 12;
    const app        = getApp();

    _rendering = true; _cancelled = false;
    window._exportPaused = true;

    const ui = makeProgressUI();

    // Redimensionamento opcional
    let origW, origH, origAsp, origPixelRatio;
    if (rW && rH && app?.renderer && app?.camera) {
        // NOTE: origW/origH must be the renderer's *CSS-pixel* size (what
        // setSize() itself expects), not canvas.width/height — those are
        // the drawing-buffer size, already multiplied by the pixel ratio.
        // Capturing the buffer size here and feeding it back into
        // setSize() on restore re-multiplies it by the pixel ratio again,
        // silently doubling the live viewport's resolution on every
        // export until it eventually exceeds the GPU's texture/render-
        // buffer limit and the whole viewport goes black or corrupted.
        const origVp   = getViewportSize();
        origW          = origVp.width;
        origH          = origVp.height;
        origAsp        = app.camera.aspect;
        origPixelRatio = app.renderer.getPixelRatio();

        // Force 1:1 pixel ratio during capture so the output buffer is
        // EXACTLY rW×rH (otherwise renderer.setSize multiplies by the
        // current DPR again, silently doubling/tripling resolution on
        // high-DPI screens vs what the user picked in the dropdown).
        app.renderer.setPixelRatio(1);
        app.renderer.setSize(rW, rH, false);
        app.camera.aspect = rW / rH;
        app.camera.updateProjectionMatrix();

        // Particle sprites are sized in raw gl_PointSize pixels, calibrated
        // against the normal live viewport's buffer height (origH, which
        // already includes the live DPR). Exporting at a different pixel
        // height without compensating makes points a smaller/blurrier
        // fraction of the frame — this is what made particles look
        // "smaller and uglier" than the viewport. setRenderScale() feeds
        // a correction factor into the shader's uSizeScale uniform so
        // sprites occupy the same RELATIVE size regardless of output
        // resolution, matching what you see live.
        window._nexusParticleLab?.setRenderScale(rH / origH);
    }

    try {
        // Aguarda o loop de render pausar (3 rAF cycles)
        await rafYield(); await rafYield(); await rafYield();

        let result = null;

        // ── Tenta WebCodecs MP4 (melhor) ──────────────────────────────────
        if (typeof VideoEncoder !== 'undefined') {
            try {
                ui.phase('Exportando MP4 • WebCodecs');
                result = await exportMP4(startF, endF, fps, bitrate, (p, lbl) => {
                    ui.progress(p * 0.95); ui.label(lbl);
                });
            } catch (e) {
                console.warn('[VideoExport] WebCodecs/MP4 falhou, tentando WebM:', e.message);
                result = null;
            }
        }

        // ── Fallback: MediaRecorder WebM ──────────────────────────────────
        if (!result && !_cancelled) {
            ui.phase('Exportando WebM • MediaRecorder');
            result = await exportWebM(startF, endF, fps, bitrate, (p, lbl) => {
                ui.progress(p * 0.97); ui.label(lbl);
            });
        }

        if (_cancelled) { ui.label('Cancelado.'); await sleep(900); return; }
        if (!result?.blob) throw new Error('Exportação não produziu dados.');

        ui.progress(1); ui.label('Preview pronto!');
        const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const fn = `render_${ts}_${endF - startF}f_${fps}fps.${result.ext}`;
        // ── Fechar o overlay de progresso antes de mostrar o preview ──
        await sleep(400);
        ui.done();
        showVideoPreview(result.blob, result.ext, fn);
        return; // pula o ui.done() no finally (já foi chamado)

    } catch (err) {
        console.error('[VideoExport]', err);
        ui.label('❌ ' + (err.message || String(err)));
        ui.phase('Erro na exportação');
        await sleep(3500);
    } finally {
        if (rW && rH && app?.renderer && app?.camera) {
            app.renderer.setPixelRatio(origPixelRatio);
            app.renderer.setSize(origW, origH, false);
            app.camera.aspect = origAsp;
            app.camera.updateProjectionMatrix();
            window._nexusParticleLab?.setRenderScale(1.0);
        }
        window.AnimationSystem?.goToFrame?.(opts.startF ?? 0);
        window._exportPaused = false;
        _rendering = false;
        if (document.getElementById('_vex_ov')) ui.done(); // só se ainda visível
    }
}

// ── Injeção do painel no Render ────────────────────────────────────────────
export function injectVideoExportPanel(parentEl) {
    if (!parentEl || document.getElementById('_vex_panel_inner')) return;
    const wrap = document.createElement('div');
    wrap.id    = '_vex_panel_inner';
    wrap.style.cssText = 'padding:10px 8px;border-top:1px solid rgba(255,255,255,.07);margin-top:6px';
    wrap.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:#7edfff;margin-bottom:10px;
           display:flex;align-items:center;gap:6px">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="2"/>
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>
        </svg>
        Exportar Vídeo
      </div>
      <div style="display:flex;gap:5px;align-items:center;margin-bottom:7px;flex-wrap:wrap">
        <span class="_vl">Frames</span>
        <input id="_vx_s" type="number" min="0" value="0" class="_vi" style="width:50px">
        <span style="color:#444;font-size:11px">→</span>
        <input id="_vx_e" type="number" min="1" value="30" class="_vi" style="width:50px">
        <span class="_vl" style="margin-left:4px">FPS</span>
        <select id="_vx_fps" class="_vs" style="max-width:58px">
          <option>24</option><option selected>30</option><option>60</option>
        </select>
      </div>
      <div style="display:flex;gap:5px;align-items:center;margin-bottom:6px">
        <span class="_vl" style="min-width:62px">Resolução</span>
        <select id="_vx_res" class="_vs" style="flex:1">
          ${RESOLUTIONS.map((r,i)=>`<option value="${i}">${r[0]}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:5px;align-items:center;margin-bottom:10px">
        <span class="_vl" style="min-width:62px">Qualidade</span>
        <select id="_vx_q" class="_vs" style="flex:1">
          ${QUALITIES.map((q,i)=>`<option value="${i}"${i===1?' selected':''}>${q[0]}</option>`).join('')}
        </select>
      </div>
      <button id="_vx_go" style="
        width:100%;padding:9px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;
        background:linear-gradient(135deg,rgba(30,64,175,.35),rgba(56,189,248,.22));
        border:1px solid rgba(100,180,255,.35);color:#7edfff;
        display:flex;align-items:center;justify-content:center;gap:6px;transition:opacity .15s
      ">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Exportar Vídeo
      </button>
      <style>
        ._vl{font-size:10px;color:rgba(200,200,220,.45)}
        ._vi{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
             color:#ddd;border-radius:5px;padding:3px 6px;font-size:11px}
        ._vs{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
             color:#ddd;border-radius:5px;padding:3px 6px;font-size:11px}
        #_vx_go:hover{opacity:.82}
      </style>`;
    parentEl.appendChild(wrap);
    document.getElementById('_vx_go')?.addEventListener('click', () => {
        startVideoExport({
            startF: parseInt(document.getElementById('_vx_s')?.value   ?? '0'),
            endF:   parseInt(document.getElementById('_vx_e')?.value   ?? '30'),
            fps:    parseInt(document.getElementById('_vx_fps')?.value ?? '30'),
            resIdx: parseInt(document.getElementById('_vx_res')?.value ?? '0'),
            qIdx:   parseInt(document.getElementById('_vx_q')?.value   ?? '1'),
        });
    });
}
