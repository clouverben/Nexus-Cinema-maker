// render-result.js — Janela de resultado do render (estilo desktop).
//
// Uma única janela flutuante e NÃO modal (não bloqueia o viewport), com:
//   • abas Imagem | Vídeo (guarda o último resultado de cada tipo)
//   • barra de progresso embutida com Cancelar (usada pelo export de vídeo)
//   • arrastar pela barra de título, redimensionar pelo canto, minimizar
//   • botão Salvar
//
// Substitui os antigos modais de tela cheia (preview de PNG no index.html,
// preview e progresso de vídeo no videoexport.js).

let win = null;
const results = { image: null, video: null };   // { url, filename, info, revoke }
let activeKind = 'image';
let onCancel = null;
let progressT0 = 0;

const $ = (sel) => win?.querySelector(sel);

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ensureWindow() {
  if (win) return win;

  win = document.createElement('div');
  win.id = 'rrWin';
  win.className = 'rrWin hidden';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', 'Resultado do render');
  win.innerHTML = `
    <div class="rrTitle" id="rrTitle">
      <svg class="rrTitleIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>
      <span class="rrTitleText">Resultado do render</span>
      <div class="rrTabs" role="tablist">
        <button class="rrTab" type="button" role="tab" data-rr="image" disabled>Imagem</button>
        <button class="rrTab" type="button" role="tab" data-rr="video" disabled>Vídeo</button>
      </div>
      <button class="rrIconBtn" id="rrMin"   type="button" title="Minimizar">&#8211;</button>
      <button class="rrIconBtn" id="rrClose" type="button" title="Fechar">&#10005;</button>
    </div>

    <div class="rrProgress hidden" id="rrProgress">
      <div class="rrProgTop">
        <span class="rrPhase" id="rrPhase">Preparando…</span>
        <span class="rrPct"   id="rrPct">0%</span>
        <span class="rrEta"   id="rrEta"></span>
        <button class="rrBtn rrBtnDanger" id="rrCancel" type="button">Cancelar</button>
      </div>
      <div class="rrBar"><div class="rrBarFill" id="rrBarFill"></div></div>
      <div class="rrLabel" id="rrLabel"></div>
    </div>

    <div class="rrBody" id="rrBody">
      <div class="rrStage hidden" data-stage="image"><img id="rrImg" alt="Render"></div>
      <div class="rrStage hidden" data-stage="video"><video id="rrVid" controls loop playsinline preload="auto"></video></div>
      <div class="rrEmpty" id="rrEmpty">Nenhum render ainda.<br><span>Use “Renderizar” na aba Saída.</span></div>
    </div>

    <div class="rrFoot">
      <span class="rrInfo" id="rrInfo"></span>
      <button class="rrBtn rrBtnPrimary" id="rrSave" type="button" disabled>Salvar</button>
    </div>`;
  document.body.appendChild(win);

  win.querySelectorAll('.rrTab').forEach((b) =>
    b.addEventListener('click', () => { if (!b.disabled) setActive(b.dataset.rr); }));
  $('#rrClose').addEventListener('click', closeRenderResult);
  $('#rrMin').addEventListener('click', () => win.classList.toggle('rrMinimized'));
  $('#rrCancel').addEventListener('click', () => { onCancel?.(); });
  $('#rrSave').addEventListener('click', saveActive);
  $('#rrVid').addEventListener('loadedmetadata', () => { $('#rrVid').play().catch(() => {}); });

  enableDrag();
  window.addEventListener('resize', clampToViewport);
  return win;
}

function enableDrag() {
  const bar = $('#rrTitle');
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = win.getBoundingClientRect();
    dragging = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    bar.setPointerCapture(e.pointerId);
    win.classList.add('rrDragging');
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const x = Math.min(Math.max(0, ox + e.clientX - sx), window.innerWidth  - 80);
    const y = Math.min(Math.max(0, oy + e.clientY - sy), window.innerHeight - 40);
    win.style.left = `${x}px`;
    win.style.top  = `${y}px`;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    win.classList.remove('rrDragging');
    try { bar.releasePointerCapture(e.pointerId); } catch { /* já liberado */ }
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

function placeDefault() {
  const w = 520, h = 400;
  const rightPanel = document.getElementById('rightPanel');
  const rw = rightPanel ? rightPanel.getBoundingClientRect().width : 0;
  const left = Math.max(12, window.innerWidth - rw - w - 16);
  const top  = Math.max(48, window.innerHeight - h - 60);
  win.style.width  = `${w}px`;
  win.style.height = `${h}px`;
  win.style.left   = `${left}px`;
  win.style.top    = `${top}px`;
}

function clampToViewport() {
  if (!win || win.classList.contains('hidden')) return;
  const r = win.getBoundingClientRect();
  const x = Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth  - 80));
  const y = Math.min(Math.max(0, r.top),  Math.max(0, window.innerHeight - 40));
  win.style.left = `${x}px`;
  win.style.top  = `${y}px`;
}

function show() {
  ensureWindow();
  if (win.classList.contains('hidden')) {
    win.classList.remove('hidden');
    if (!win.style.left) placeDefault();
  }
  win.classList.remove('rrMinimized');
}

function setActive(kind) {
  activeKind = kind;
  const has = !!results[kind];
  win.querySelectorAll('.rrTab').forEach((b) => {
    b.classList.toggle('active', b.dataset.rr === kind);
    b.disabled = !results[b.dataset.rr];
  });
  win.querySelectorAll('.rrStage').forEach((s) => s.classList.toggle('hidden', s.dataset.stage !== kind || !has));
  $('#rrEmpty').classList.toggle('hidden', has);
  $('#rrSave').disabled = !has;
  $('#rrInfo').textContent = has ? results[kind].info : '';
  const vid = $('#rrVid');
  if (kind !== 'video') vid.pause();
  else if (has) vid.play().catch(() => {});
}

function saveActive() {
  const r = results[activeKind];
  if (!r) return;
  const a = Object.assign(document.createElement('a'), { href: r.url, download: r.filename });
  document.body.appendChild(a); a.click(); a.remove();
}

function release(kind) {
  const old = results[kind];
  if (old?.revoke) { try { URL.revokeObjectURL(old.url); } catch { /* ignora */ } }
  results[kind] = null;
}

// ── API pública ─────────────────────────────────────────────────────────

/**
 * Emite a miniatura (JPEG 480px) de uma render para a tela de Projetos
 * ("última render do projeto"). `src` é qualquer canvas/bitmap desenhável.
 */
export function emitRenderThumb(src, srcW, srcH) {
  try {
    const w = srcW || src.width, h = srcH || src.height;
    if (!w || !h) return;
    const tw = 480, th = Math.max(1, Math.round((h / w) * tw));
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d').drawImage(src, 0, 0, tw, th);
    window.dispatchEvent(new CustomEvent('ncm-render-captured', { detail: { dataURL: c.toDataURL('image/jpeg', 0.8) } }));
  } catch { /* miniatura é opcional */ }
}

/**
 * Mostra um resultado pronto.
 * @param {{kind:'image'|'video', url:string, filename:string, info?:string, revoke?:boolean}} r
 *   revoke=true → a janela chama URL.revokeObjectURL quando o resultado for trocado.
 */
export function showRenderResult(r) {
  if (!r || (r.kind !== 'image' && r.kind !== 'video') || !r.url) return;
  show();
  $('#rrProgress').classList.add('hidden');
  release(r.kind);
  results[r.kind] = { url: r.url, filename: r.filename, info: r.info || '', revoke: r.revoke !== false };
  if (r.kind === 'image') $('#rrImg').src = r.url;
  else { const v = $('#rrVid'); v.pause(); v.src = r.url; v.load(); }
  setActive(r.kind);
  document.dispatchEvent(new CustomEvent('render-result-changed'));
}

export function hasRenderResult() {
  return !!(results.image || results.video);
}

export function openRenderResult() {
  show();
  setActive(results[activeKind] ? activeKind : (results.image ? 'image' : results.video ? 'video' : activeKind));
}

export function closeRenderResult() {
  if (!win) return;
  win.classList.add('hidden');
  $('#rrVid')?.pause();
}

export function formatResultInfo({ width, height, ext, fps, frames, bytes }) {
  const parts = [];
  if (width && height) parts.push(`${width} × ${height}`);
  if (ext) parts.push(ext.toUpperCase());
  if (fps) parts.push(`${fps} fps`);
  if (frames) parts.push(`${frames} frames`);
  if (bytes) parts.push(fmtBytes(bytes));
  return parts.join(' · ');
}

/**
 * Barra de progresso embutida na janela. Devolve
 * { phase(s), label(s), progress(0..1), done(), fail(msg), cancelled() }.
 */
export function createRenderProgress({ onCancel: cancelFn } = {}) {
  show();
  onCancel = cancelFn || null;
  progressT0 = Date.now();
  const box = $('#rrProgress');
  box.classList.remove('hidden', 'rrFailed');
  $('#rrCancel').classList.remove('hidden');
  $('#rrPhase').textContent = 'Preparando…';
  $('#rrLabel').textContent = '';
  $('#rrPct').textContent = '0%';
  $('#rrEta').textContent = '';
  $('#rrBarFill').style.width = '0%';

  let closed = false;
  const finish = () => { closed = true; onCancel = null; };

  return {
    phase(s)  { if (!closed) $('#rrPhase').textContent = s; },
    label(s)  { if (!closed) $('#rrLabel').textContent = s; },
    progress(p) {
      if (closed) return;
      const v = Math.max(0, Math.min(100, Math.round(p * 100)));
      $('#rrBarFill').style.width = `${v}%`;
      $('#rrPct').textContent = `${v}%`;
      if (p > 0.06) {
        const el = (Date.now() - progressT0) / 1000;
        $('#rrEta').textContent = `~${Math.ceil(Math.max(0, (el / p) * (1 - p)))}s restantes`;
      }
    },
    done() {
      if (closed) return;
      finish();
      box.classList.add('hidden');
    },
    cancelled() {
      if (closed) return;
      finish();
      box.classList.add('hidden');
    },
    fail(msg) {
      if (closed) return;
      finish();
      box.classList.add('rrFailed');
      $('#rrPhase').textContent = 'Erro no render';
      $('#rrLabel').textContent = String(msg || 'Falha desconhecida');
      $('#rrCancel').classList.add('hidden');
    },
  };
}
