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
import { createRenderProgress, showRenderResult, formatResultInfo } from './render-result.js';

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
    await renderFrame({forceFinal:true});
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

    // Resolução: width/height explícitos (painel Saída) têm prioridade; sem
    // eles, cai no índice antigo (0 = tamanho atual do viewport). H.264 exige
    // dimensões pares, então arredonda para baixo.
    let rW, rH;
    if (opts.width > 0 && opts.height > 0) {
        rW = Math.floor(opts.width);  rW -= rW % 2;
        rH = Math.floor(opts.height); rH -= rH % 2;
    } else {
        [, rW, rH] = RESOLUTIONS[resIdx] ?? RESOLUTIONS[0];
    }
    const bitrate    = opts.bitrate > 0 ? opts.bitrate : (QUALITIES[qIdx]?.[1] ?? 12);
    const app        = getApp();

    _rendering = true; _cancelled = false;
    window._exportPaused = true;

    const ui = createRenderProgress({ onCancel: () => { _cancelled = true; } });

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

        if (_cancelled) { ui.cancelled(); return; }
        if (!result?.blob) throw new Error('Exportação não produziu dados.');

        ui.progress(1); ui.label('Vídeo pronto!');
        const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const fn = `render_${ts}_${endF - startF}f_${fps}fps.${result.ext}`;
        const outCanvas = app?.renderer?.domElement;
        ui.done();
        showRenderResult({
            kind: 'video',
            url: URL.createObjectURL(result.blob),
            filename: fn,
            info: formatResultInfo({
                width:  outCanvas ? outCanvas.width  : rW,
                height: outCanvas ? outCanvas.height : rH,
                ext: result.ext, fps, frames: endF - startF, bytes: result.blob.size,
            }),
        });
        return;

    } catch (err) {
        console.error('[VideoExport]', err);
        ui.fail(err.message || String(err));
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
        ui.done(); // idempotente: só age se o progresso ainda estiver aberto
    }
}
