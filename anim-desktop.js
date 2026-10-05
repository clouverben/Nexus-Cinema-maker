// anim-desktop.js — Modo Animação com cara de desktop.
//
//  • body.anim-mode: o CSS acopla a timeline ENTRE os painéis laterais (como o
//    editor de timeline do Blender) e estende os painéis até o rodapé.
//  • Alça no topo da timeline: arrastar muda a altura (salva); duplo clique volta
//    ao padrão.
//  • Seções do painel de Animação recolhíveis (clicar no título), com o estado salvo.
//  • Avisa o animation.js para redesenhar o Graph Editor quando o espaço dele muda.

const HEIGHT_KEY = 'ncm.timelineHeight.v5';   // v5: padrão 65px
const SECTIONS_KEY = 'ncm.animSections';
const DEFAULT_H = 65;
const MIN_H = 56;

let _inited = false;

const clampHeight = (h) => Math.round(Math.min(Math.max(MIN_H, h), Math.max(MIN_H, window.innerHeight * 0.6)));

function readHeight() {
  try {
    const v = parseInt(localStorage.getItem(HEIGHT_KEY), 10);
    if (Number.isFinite(v)) return clampHeight(v);
  } catch { /* sem storage */ }
  return DEFAULT_H;
}

function applyHeight(container, h, persist) {
  const v = clampHeight(h);
  container.style.setProperty('--tl-h', `${v}px`);
  if (persist) { try { localStorage.setItem(HEIGHT_KEY, String(v)); } catch { /* ignora */ } }
  return v;
}

// ── Timeline: alça de redimensionar ─────────────────────────────────────

function ensureTimelineHandle() {
  const container = document.getElementById('timeline-container');
  if (!container) return null;
  if (!container.style.getPropertyValue('--tl-h')) applyHeight(container, readHeight(), false);
  if (container.querySelector('#tl-resize-handle')) return container;

  const handle = document.createElement('div');
  handle.id = 'tl-resize-handle';
  handle.title = 'Arraste para redimensionar · duplo clique para restaurar';
  container.prepend(handle);

  let startY = 0, startH = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = container.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
    container.classList.add('tl-resizing');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    applyHeight(container, startH + (startY - e.clientY), false);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    container.classList.remove('tl-resizing');
    try { handle.releasePointerCapture(e.pointerId); } catch { /* já liberado */ }
    applyHeight(container, container.getBoundingClientRect().height, true);
    window.dispatchEvent(new Event('_animGraphRefresh'));
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => applyHeight(container, DEFAULT_H, true));
  return container;
}

// ── Painel de Animação: seções recolhíveis ──────────────────────────────

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}') || {}; } catch { return {}; }
}

function setupCollapsibleSections() {
  const root = document.getElementById('animLeftContent');
  if (!root) return;
  const saved = loadCollapsed();

  root.querySelectorAll(':scope > .panelSection').forEach((section) => {
    const title = section.querySelector(':scope > .sectionTitle');
    if (!title || title.dataset.collapsible) return;
    const key = [...section.classList].find((c) => /^anim[A-Za-z]+Section$/.test(c)) || title.textContent.trim();
    title.dataset.collapsible = '1';
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    section.classList.add('animCollapsible');
    if (saved[key]) section.classList.add('collapsed');
    title.setAttribute('aria-expanded', String(!saved[key]));

    const toggle = () => {
      const collapsed = section.classList.toggle('collapsed');
      title.setAttribute('aria-expanded', String(!collapsed));
      const state = loadCollapsed();
      if (collapsed) state[key] = true; else delete state[key];
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(state)); } catch { /* ignora */ }
    };
    title.addEventListener('click', toggle);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });
}

// ── Graph Editor: redesenhar quando o espaço muda ───────────────────────

function watchGraphSize() {
  const body = document.getElementById('graph-body');
  if (!body || body.dataset.watched || typeof ResizeObserver === 'undefined') return;
  body.dataset.watched = '1';
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => window.dispatchEvent(new Event('_animGraphRefresh')));
  }).observe(body);
}

// O painel esquerdo normal (#leftPanel, com o trilho de 42px) tem `display:flex !important`
// no CSS e não escondia ao entrar no modo Animação: sobrava uma faixa vazia ao lado do
// painel de Animação. Um `display:none !important` inline vence qualquer regra de folha de estilo.
function hideNormalLeftPanel(on) {
  const lp = document.getElementById('leftPanel');
  if (!lp) return;
  if (on) lp.style.setProperty('display', 'none', 'important');
  else lp.style.removeProperty('display');
}

export function initAnimDesktop() {
  if (_inited) return;
  _inited = true;

  setupCollapsibleSections();
  ensureTimelineHandle();
  watchGraphSize();
  hideNormalLeftPanel(document.body.classList.contains('anim-mode'));

  window.addEventListener('_animModeChange', (e) => {
    const on = !!e.detail?.active;
    document.body.classList.toggle('anim-mode', on);
    hideNormalLeftPanel(on);
    if (on) {
      ensureTimelineHandle();
      setupCollapsibleSections();
      watchGraphSize();
    }
  });
  window.addEventListener('resize', () => {
    const c = document.getElementById('timeline-container');
    if (c) applyHeight(c, c.getBoundingClientRect().height || readHeight(), false);
  });
}
