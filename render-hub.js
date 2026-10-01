// render-hub.js — Central de render do Nexus (fluxo estilo Prisma 3D).
//
// Um só lugar para configurar e disparar o render:
//   • Saída: tipo (Imagem | Vídeo), qualidade, formato, tamanho, frames/FPS
//   • Imagem e vídeo compartilham a MESMA resolução do painel
//   • Resultado (imagem e vídeo) aparece na janela flutuante de render-result.js
//   • Seletor Editor | Render liga/desliga a visualização final ao vivo
//     (sem grade/gizmos + pipeline completo), sincronizado com o olho e a lâmpada.
import { app, getViewportSize, markSceneDirty } from './scene.js';
import { renderFrame } from './posprocess.js';
import { startVideoExport } from './videoexport.js';
import { AnimState } from './animation.js';
import {
  showRenderResult, openRenderResult, hasRenderResult,
  createRenderProgress, formatResultInfo,
} from './render-result.js';

const $ = (id) => document.getElementById(id);
const rafYield = () => new Promise((r) => requestAnimationFrame(r));

let outType = 'image';        // 'image' | 'video'
let busy = false;
let inited = false;

// ── Utilidades ──────────────────────────────────────────────────────────

function maxDim() {
  const cap = app.renderer?.capabilities;
  const gpu = Math.min(cap?.maxTextureSize || 8192, cap?.maxRenderbufferSize || 8192);
  return Math.max(256, Math.min(7680, gpu));
}

function readDims() {
  const lim = maxDim();
  let w = parseInt($('renderWidth')?.value, 10);
  let h = parseInt($('renderHeight')?.value, 10);
  if (!Number.isFinite(w) || w < 64) w = 1920;
  if (!Number.isFinite(h) || h < 64) h = 1080;
  w = Math.min(w, lim); h = Math.min(h, lim);
  return { w, h };
}

/** Último frame com keyframe em qualquer objeto/clipe da timeline. */
function timelineLastFrame() {
  let max = 0;
  const kfs = AnimState?.keyframes || {};
  for (const perObj of Object.values(kfs)) {
    for (const perClip of Object.values(perObj || {})) {
      for (const f of Object.keys(perClip || {})) {
        const n = Number(f);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
  }
  return max;
}

function ensureFpsOption(value) {
  const sel = $('rhFps');
  if (!sel) return;
  const v = String(Math.round(value));
  if (![...sel.options].some((o) => o.value === v)) {
    const opt = new Option(`${v}`, v);
    let placed = false;
    for (const o of sel.options) {
      if (Number(o.value) > Number(v)) { sel.add(opt, o); placed = true; break; }
    }
    if (!placed) sel.add(opt);
  }
  sel.value = v;
}

function fillFromTimeline() {
  const last = timelineLastFrame();
  if ($('rhFrameStart')) $('rhFrameStart').value = '0';
  if ($('rhFrameEnd'))   $('rhFrameEnd').value = String(last > 0 ? last : 30);
  const fps = AnimState?.fps;
  if (Number.isFinite(fps) && fps > 0) ensureFpsOption(fps);
  updateSummary();
}

function updateSummary() {
  const el = $('rhSummary');
  const btn = $('rhRenderBtn');
  const { w, h } = readDims();
  if (outType === 'image') {
    if (el) el.textContent = `${w} × ${h} px\nPNG`;
    if (btn) btn.textContent = 'Renderizar imagem';
  } else {
    const s = parseInt($('rhFrameStart')?.value, 10) || 0;
    const e = parseInt($('rhFrameEnd')?.value, 10) || 0;
    const fps = parseInt($('rhFps')?.value, 10) || 30;
    const frames = Math.max(0, e - s);
    // A timeline reproduz na velocidade do FPS da animação; o tempo é
    // informativo (frames ÷ FPS do vídeo).
    const secs = frames / fps;
    if (el) el.textContent = `${w} × ${h} · ${fps} fps\n${frames} frames · ${secs.toFixed(1)} s`;
    if (btn) btn.textContent = 'Renderizar vídeo';
  }
  if (btn) btn.disabled = busy;
}

function setOutType(type) {
  outType = type === 'video' ? 'video' : 'image';
  document.querySelectorAll('#rhOutType .rhSeg').forEach((b) =>
    b.classList.toggle('active', b.dataset.out === outType));
  $('rhVideoGroup')?.classList.toggle('hidden', outType !== 'video');
  $('rhImageGroup')?.classList.toggle('hidden', outType !== 'image');
  // Primeira vez em Vídeo: se o usuário ainda não mexeu no intervalo, usa a timeline.
  if (outType === 'video' && $('rhFrameEnd') && $('rhFrameEnd').dataset.touched !== '1') fillFromTimeline();
  updateSummary();
}

// ── Formato / dimensões ─────────────────────────────────────────────────

function applyFormat(btn) {
  document.querySelectorAll('.rsFormatBtn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const q = parseInt($('renderQuality')?.value ?? '1080', 10);
  const ratio = btn.dataset.ratio;
  const wIn = $('renderWidth'), hIn = $('renderHeight');
  if (!wIn || !hIn) return;
  if (ratio === '16:9')      { hIn.value = q; wIn.value = Math.round(q * 16 / 9); }
  else if (ratio === '1:1')  { hIn.value = q; wIn.value = q; }
  else if (ratio === '9:16') { wIn.value = Math.round(q * 9 / 16); hIn.value = q; }
  updateSummary();
}

function bindOutputControls() {
  document.querySelectorAll('#rhOutType .rhSeg').forEach((b) =>
    b.addEventListener('click', () => setOutType(b.dataset.out)));

  document.querySelectorAll('.rsFormatBtn').forEach((b) =>
    b.addEventListener('click', () => applyFormat(b)));

  $('renderQuality')?.addEventListener('change', () => {
    const active = document.querySelector('.rsFormatBtn.active');
    if (active) applyFormat(active); else updateSummary();
  });

  ['renderWidth', 'renderHeight'].forEach((id) =>
    $(id)?.addEventListener('input', () => {
      document.querySelectorAll('.rsFormatBtn').forEach((b) => b.classList.remove('active'));
      updateSummary();
    }));

  $('rsDimDefault')?.addEventListener('click', () => {
    if (!app.renderer) return;
    // Tamanho em pixels CSS do viewport (o que o usuário vê), não o do
    // drawing buffer, que já vem multiplicado pelo pixel ratio.
    const vp = getViewportSize();
    $('renderWidth').value = Math.round(vp.width);
    $('renderHeight').value = Math.round(vp.height);
    document.querySelectorAll('.rsFormatBtn').forEach((b) => b.classList.remove('active'));
    updateSummary();
  });

  ['rhFrameStart', 'rhFrameEnd', 'rhFps', 'rhBitrate'].forEach((id) =>
    $(id)?.addEventListener('input', () => {
      if (id === 'rhFrameEnd' || id === 'rhFrameStart') $('rhFrameEnd').dataset.touched = '1';
      updateSummary();
    }));
  $('rhFps')?.addEventListener('change', updateSummary);
  $('rhFramesFromTimeline')?.addEventListener('click', () => {
    $('rhFrameEnd').dataset.touched = '';
    fillFromTimeline();
  });

  $('rhRenderBtn')?.addEventListener('click', () => {
    if (outType === 'image') renderImage(); else renderVideo();
  });
  $('rhOpenResult')?.addEventListener('click', openRenderResult);
  const syncOpen = () => { const b = $('rhOpenResult'); if (b) b.disabled = !hasRenderResult(); };
  document.addEventListener('render-result-changed', syncOpen);
  syncOpen();
}

// ── Render de IMAGEM ────────────────────────────────────────────────────

async function renderStill({ width, height, watermark }) {
  const { renderer, camera } = app;
  if (!renderer || !camera || !app.scene) throw new Error('A cena ainda não está pronta.');

  const vp = getViewportSize();           // pixels CSS (entrada do setSize)
  const origAsp = camera.aspect;
  const origPR = renderer.getPixelRatio();
  const lab = window._nexusParticleLab;

  // Pausa o loop ao vivo para ele não desenhar por cima no meio do render.
  window._exportPaused = true;
  window._ncmForceFinalRender = true;
  try {
    await rafYield(); await rafYield();

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Sprites de partícula são em pixels; compensa para manterem o mesmo
    // tamanho RELATIVO do viewport (mesma lógica do export de vídeo).
    lab?.setRenderScale?.(height / Math.max(1, vp.height));

    // Duas passadas: a primeira aloca/aquece os targets do pós-processamento
    // (SSR, bloom…) no novo tamanho; a segunda é a imagem final.
    await renderFrame({ forceFinal: true });
    await renderFrame({ forceFinal: true });

    // Copia o frame para um canvas 2D ainda no mesmo tick (o drawing buffer
    // é preservado) — evita esperar o carregamento assíncrono de <img>.
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const ctx = out.getContext('2d');
    ctx.drawImage(renderer.domElement, 0, 0, width, height);

    if (watermark) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, Math.round(height * 0.022))}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      const pad = Math.round(height * 0.02);
      ctx.fillText('Nexus Engine', width - pad, height - pad);
      ctx.restore();
    }

    const blob = await new Promise((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar o PNG.'))), 'image/png'));
    return blob;
  } finally {
    // Sempre restaura o viewport, aconteça o que acontecer acima.
    renderer.setPixelRatio(origPR);
    renderer.setSize(vp.width, vp.height, false);
    camera.aspect = origAsp;
    camera.updateProjectionMatrix();
    lab?.setRenderScale?.(1.0);
    window._ncmForceFinalRender = false;
    window._exportPaused = false;
    markSceneDirty();
  }
}

async function renderImage() {
  if (busy) return;
  busy = true; updateSummary();
  const { w, h } = readDims();
  const prog = createRenderProgress({});
  prog.phase('Renderizando imagem');
  prog.label(`${w} × ${h} px`);
  prog.progress(0.15);
  try {
    const blob = await renderStill({ width: w, height: h, watermark: !!$('renderWatermark')?.checked });
    prog.done();
    showRenderResult({
      kind: 'image',
      url: URL.createObjectURL(blob),
      filename: `render-${Date.now()}.png`,
      info: formatResultInfo({ width: w, height: h, ext: 'png', bytes: blob.size }),
    });
  } catch (err) {
    console.error('[RenderHub] imagem:', err);
    prog.fail(err?.message || err);
  } finally {
    busy = false; updateSummary();
  }
}

// ── Render de VÍDEO ─────────────────────────────────────────────────────

async function renderVideo() {
  if (busy) return;
  const { w, h } = readDims();
  const startF = Math.max(0, parseInt($('rhFrameStart')?.value, 10) || 0);
  const endF = parseInt($('rhFrameEnd')?.value, 10) || 0;
  const fps = parseInt($('rhFps')?.value, 10) || 30;
  const bitrate = parseFloat($('rhBitrate')?.value) || 12;
  busy = true; updateSummary();
  try {
    await startVideoExport({ startF, endF, fps, width: w, height: h, bitrate });
  } catch (err) {
    console.error('[RenderHub] vídeo:', err);
    createRenderProgress({}).fail(err?.message || err);
  } finally {
    busy = false; updateSummary();
  }
}

// ── Visualização: Editor | Render ───────────────────────────────────────

function bindViewSwitch() {
  const eye = $('renderPreviewToggle');
  const lamp = $('renderLightToggleBtn');
  const bEditor = $('rhViewEditor');
  const bRender = $('rhViewRender');
  if (!bEditor || !bRender) return;

  const eyeOn = () => !!eye?.classList.contains('active');
  const lampOn = () => !!lamp?.classList.contains('active');

  const sync = () => {
    const e = eyeOn(), l = lampOn();
    bRender.classList.toggle('active', e && l);
    bEditor.classList.toggle('active', !e && !l);
  };

  // Clica nos botões reais (em vez de chamar as funções direto) para o estado
  // interno do main.js continuar em sincronia com o que aparece na tela.
  const setView = (render) => {
    if (eye && eyeOn() !== render) eye.click();
    if (lamp && lampOn() !== render) lamp.click();
    sync();
  };
  bEditor.addEventListener('click', () => setView(false));
  bRender.addEventListener('click', () => setView(true));

  const mo = new MutationObserver(sync);
  [eye, lamp].forEach((el) => el && mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
  sync();
}

// ── Init ────────────────────────────────────────────────────────────────

export function initRenderHub() {
  if (inited) return;
  inited = true;
  bindOutputControls();
  bindViewSwitch();
  setOutType('image');
  fillFromTimeline();
  $('rhFrameEnd') && ($('rhFrameEnd').dataset.touched = '');
}
