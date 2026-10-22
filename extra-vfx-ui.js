// extra-vfx-ui.js — Labs › More › Extra VFX
// Painel central (estilo das Configurações) para configurar uma partícula extra
// que aparece em cima de um objeto quando a partícula selecionada (a "mãe")
// encosta nele. A detecção/disparo vive em particle-engine.js
// (ParticleLab._extraVfxTick); aqui fica só a interface.
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + (n >>> 0 & 0xffffff).toString(16).padStart(6, '0');
const unhex = (h) => parseInt(String(h).replace('#', ''), 16) || 0;
const CATS = [['all', 'Todos'], ['magic', 'Magia'], ['combat', 'Combate'], ['elemental', 'Elemental'], ['atmosphere', 'Ambiente']];

let mother = null;
let presetCat = 'all';
let testTimer = 0;

const lab = () => window._nexusParticleLab;
const PE = () => window._ParticleEngine;

function openMenu(id, on) {
  $(id)?.classList.toggle('hidden', !on);
  if (id === 'labsMoreMenu') $('labsMoreBackdrop')?.classList.toggle('hidden', !on);
}
function closeAll() { openMenu('labsMoreMenu', false); openMenu('extraVfxMenu', false); }

function sceneObjects() {
  const scene = window._app?.scene, L = lab(), out = [];
  scene?.traverse((o) => {
    if (!o.isObject3D || o === scene) return;
    if (o.userData?.isBoneMarker || o.userData?.isHelper || o.userData?.isGizmo || o.userData?.isLabMarker || o.isLight || o.isCamera) return;
    if (L?.getSystems?.().some((s) => s._marker === o || s._points === o || s._beamMesh === o || s._meshInstance === o || s._oqMesh === o)) return;
    if (window._nexusAuraLab?.getSystems?.().some((s) => s._marker === o || s._shellMesh === o || s._billboards?.includes(o))) return;
    if (!o.name) return;
    out.push(o);
  });
  return out;
}

// ── pequenos componentes ─────────────────────────────────────────────────
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

function card(body, title, icon) {
  const c = el('section', 'evCard');
  c.appendChild(el('div', 'evCardTitle', `${icon || ''}<span>${title}</span>`));
  body.appendChild(c);
  return c;
}

function segmented(options, value, onPick) {
  const wrap = el('div', 'evSeg');
  options.forEach(([val, label]) => {
    const b = el('button', 'evSegBtn' + (val === value ? ' on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => onPick(val));
    wrap.appendChild(b);
  });
  return wrap;
}

function slider(label, value, min, max, step, fmt, onInput, onCommit) {
  const row = el('div', 'evSlider');
  const lab_ = el('span', 'evSliderLabel', label);
  const rng = el('input'); rng.type = 'range'; rng.min = min; rng.max = max; rng.step = step; rng.value = value;
  const out = el('span', 'evSliderVal');
  const show = () => { out.textContent = fmt(parseFloat(rng.value)); const pct = ((rng.value - min) / (max - min)) * 100; rng.style.setProperty('--p', pct + '%'); };
  rng.addEventListener('input', () => { show(); onInput(parseFloat(rng.value)); });
  rng.addEventListener('change', () => onCommit && onCommit(parseFloat(rng.value)));
  show();
  row.append(lab_, rng, out);
  return row;
}

function colorField(label, value, onInput, onCommit) {
  const f = el('label', 'evColor');
  f.appendChild(el('span', '', label));
  const c = el('input'); c.type = 'color'; c.value = hex(value);
  c.addEventListener('input', () => onInput(unhex(c.value)));
  c.addEventListener('change', () => onCommit && onCommit(unhex(c.value)));
  f.appendChild(c);
  return f;
}

function toast(msg) { try { window._toast?.(msg); } catch { /* sem toast */ } }

// ── render ───────────────────────────────────────────────────────────────
function render() {
  const body = $('extraVfxBody'); if (!body) return;
  const scroll = body.scrollTop;
  const L = lab(), P = PE();
  mother = window._labsGetActiveSystem?.() || null;
  body.innerHTML = '';
  $('extraVfxMother').textContent = mother ? (mother.name || 'Sistema') : '';
  if (!mother || !L || !P || !mother.getExtraVfx) {
    body.appendChild(el('div', 'evEmpty',
      `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/></svg>
       <b>Nenhuma partícula selecionada</b>
       <span>Selecione na aba <i>Sistema</i> a partícula que vai tocar o objeto (a “mãe”). Esta janela acompanha a seleção.</span>`));
    return;
  }
  const x = mother.getExtraVfx();
  const fx = x.fx || {};
  const base = P.PARTICLE_PRESETS[x.preset] || P.PARTICLE_PRESETS.explosion;
  const set = (patch) => mother.setExtraVfx(patch);
  const setFx = (patch) => mother.setExtraVfx({ fx: patch });
  const rerender = () => render();
  const fire = () => { clearTimeout(testTimer); testTimer = setTimeout(() => L.testExtraVfx(mother), 120); };

  // ── Gatilho ──
  const c1 = card(body, 'Gatilho', '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>');
  const head = el('div', 'evSwitchRow');
  head.innerHTML = `<div><b>Ativar Extra VFX</b><small>Quando uma partícula de “${esc(mother.name || 'Sistema')}” encostar no objeto, a extra aparece.</small></div>`;
  const sw = el('label', 'evSwitch'); sw.innerHTML = '<input type="checkbox"><span></span>';
  const swIn = sw.querySelector('input'); swIn.checked = !!x.enabled;
  swIn.addEventListener('change', () => { set({ enabled: swIn.checked }); rerender(); });
  head.appendChild(sw); c1.appendChild(head);

  const objs = sceneObjects();
  const tRow = el('div', 'evField');
  tRow.appendChild(el('span', 'evFieldLabel', 'Objeto que dispara'));
  const sel = el('select', 'evSelect');
  sel.innerHTML = '<option value="">— escolher objeto —</option>' + objs.map((o) => `<option value="${o.uuid}" ${o.uuid === x.targetUuid ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  if (x.targetUuid && !objs.some((o) => o.uuid === x.targetUuid)) sel.insertAdjacentHTML('beforeend', `<option value="${x.targetUuid}" selected>${esc(x.targetName || 'Objeto')} (fora da lista)</option>`);
  sel.addEventListener('change', () => { const o = objs.find((q) => q.uuid === sel.value); set({ targetUuid: o ? o.uuid : null, targetName: o ? o.name : null }); });
  tRow.appendChild(sel);
  const useSel = el('button', 'evBtn', 'Usar objeto selecionado na cena'); useSel.type = 'button';
  useSel.addEventListener('click', () => {
    const o = window._app?.selected;
    if (!o) { toast('Selecione um objeto na cena primeiro.'); return; }
    set({ targetUuid: o.uuid, targetName: o.name || 'Objeto', enabled: true }); rerender();
  });
  tRow.appendChild(useSel);
  c1.appendChild(tRow);

  const pRow = el('div', 'evField');
  pRow.appendChild(el('span', 'evFieldLabel', 'Onde a extra aparece'));
  pRow.appendChild(segmented([['top', 'Em cima, onde tocou'], ['center', 'Topo (centro)'], ['contact', 'No contato']], x.place, (v) => { set({ place: v }); rerender(); }));
  c1.appendChild(pRow);
  c1.appendChild(slider('Altura extra', x.offsetY, -1, 3, 0.05, (v) => v.toFixed(2) + ' m', (v) => set({ offsetY: v })));

  // ── Partícula extra ──
  const c2 = card(body, 'Partícula extra', '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>');
  c2.appendChild(segmented([['preset', 'Efeito próprio'], ['scene', 'Sistema da cena']], x.source, (v) => { set({ source: v }); rerender(); }));

  if (x.source === 'scene') {
    const others = (L.getSystems?.() || []).filter((s) => s !== mother);
    const f = el('div', 'evField');
    const se = el('select', 'evSelect');
    se.innerHTML = '<option value="">— escolher sistema —</option>' + others.map((s) => `<option value="${s.id}" ${s.id === x.extraId ? 'selected' : ''}>${esc(s.name || 'Sistema')}</option>`).join('');
    se.addEventListener('change', () => { set({ extraId: se.value || null }); rerender(); });
    f.appendChild(se);
    const ed = el('button', 'evBtn', 'Editar esse sistema no Stack'); ed.type = 'button'; ed.disabled = !x.extraId;
    ed.addEventListener('click', () => { const ex = others.find((s) => s.id === x.extraId); if (!ex) return; L._active = ex; closeAll(); window._labsSelectSystem?.(ex, { cat: 'stack' }); });
    f.appendChild(ed);
    f.appendChild(el('div', 'evHint', 'Esse sistema deixa de emitir sozinho: ele só solta partículas quando é disparado pelo contato.'));
    c2.appendChild(f);
  } else {
    // abas de categoria + grade de presets
    const tabs = el('div', 'evTabs');
    CATS.forEach(([id, label]) => {
      const b = el('button', 'evTab' + (presetCat === id ? ' on' : ''), label); b.type = 'button';
      b.addEventListener('click', () => { presetCat = id; rerender(); });
      tabs.appendChild(b);
    });
    c2.appendChild(tabs);
    const grid = el('div', 'evPresets');
    Object.entries(P.PARTICLE_PRESETS).forEach(([id, p]) => {
      if (presetCat !== 'all' && p.category !== presetCat) return;
      const b = el('button', 'evPreset' + (id === x.preset ? ' on' : ''),
        `${window._labsIconSVG ? window._labsIconSVG(p.icon, 'pi-icon') : ''}<span>${esc(p.label || id)}</span>`);
      b.type = 'button'; b.title = p.label || id;
      b.addEventListener('click', () => { set({ preset: id, fx: null }); rerender(); fire(); });
      grid.appendChild(b);
    });
    c2.appendChild(grid);

    const adj = el('div', 'evAdj');
    adj.appendChild(el('div', 'evSubTitle', 'Ajustes'));
    adj.appendChild(slider('Quantidade', fx.count ?? (base.burstCount || 40), 1, 400, 1, (v) => String(Math.round(v)), (v) => setFx({ count: Math.round(v) }), fire));
    adj.appendChild(slider('Tamanho', fx.sizeMul ?? 1, 0.1, 6, 0.05, (v) => '×' + v.toFixed(2), (v) => setFx({ sizeMul: v }), fire));
    adj.appendChild(slider('Velocidade', fx.speedMul ?? 1, 0.1, 6, 0.05, (v) => '×' + v.toFixed(2), (v) => setFx({ speedMul: v }), fire));
    adj.appendChild(slider('Duração das partículas', fx.lifeMul ?? 1, 0.2, 5, 0.05, (v) => '×' + v.toFixed(2), (v) => setFx({ lifeMul: v }), fire));
    adj.appendChild(slider('Espalhamento', fx.spreadAngle ?? (base.spreadAngle ?? 180), 0, 360, 1, (v) => Math.round(v) + '°', (v) => setFx({ spreadAngle: Math.round(v) }), fire));
    adj.appendChild(slider('Gravidade', fx.gravity ?? (base.gravity ?? 0), -3, 3, 0.05, (v) => v.toFixed(2), (v) => setFx({ gravity: v }), fire));
    adj.appendChild(slider('Opacidade', fx.opacity ?? (base.opacity ?? 1), 0.05, 1, 0.05, (v) => Math.round(v * 100) + '%', (v) => setFx({ opacity: v }), fire));

    const colors = el('div', 'evColors');
    const cFrom = fx.colorFrom ?? (base.color?.from ?? 0xffffff);
    const cTo = fx.colorTo ?? (base.color?.to ?? cFrom);
    colors.appendChild(colorField('Cor inicial', cFrom, (v) => setFx({ colorFrom: v, colorTo: fx.colorTo ?? cTo }), fire));
    colors.appendChild(colorField('Cor final', cTo, (v) => setFx({ colorFrom: fx.colorFrom ?? cFrom, colorTo: v }), fire));
    const rc = el('button', 'evBtn evBtnGhost', 'Cores do preset'); rc.type = 'button';
    rc.addEventListener('click', () => { setFx({ colorFrom: undefined, colorTo: undefined }); rerender(); fire(); });
    colors.appendChild(rc);
    adj.appendChild(colors);

    const bl = el('div', 'evField evInline');
    bl.appendChild(el('span', 'evFieldLabel', 'Mistura'));
    bl.appendChild(segmented([['additive', 'Brilho (aditivo)'], ['normal', 'Normal']], fx.blending || base.blending || 'additive', (v) => { setFx({ blending: v }); rerender(); fire(); }));
    adj.appendChild(bl);
    c2.appendChild(adj);
  }

  // ── Disparo ──
  const c3 = card(body, 'Disparo', '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>');
  c3.appendChild(slider('Margem de contato', x.margin, 0, 1, 0.01, (v) => v.toFixed(2) + ' m', (v) => set({ margin: v })));
  c3.appendChild(slider('Intervalo mínimo', x.cooldown, 0, 3, 0.01, (v) => v.toFixed(2) + ' s', (v) => set({ cooldown: v })));
  c3.appendChild(slider('Máx. disparos por segundo', x.maxPerSecond, 1, 60, 1, (v) => String(Math.round(v)), (v) => set({ maxPerSecond: Math.round(v) })));
  if (x.source === 'preset') c3.appendChild(slider('Continuar emitindo após o toque', x.duration, 0, 10, 0.1, (v) => v <= 0 ? 'só estouro' : v.toFixed(1) + ' s', (v) => set({ duration: v }), fire));

  const foot = el('div', 'evFoot');
  const test = el('button', 'evBtn evBtnPrimary', '▶ Testar disparo'); test.type = 'button';
  test.addEventListener('click', () => { if (!L.testExtraVfx(mother)) toast('Escolha a partícula extra primeiro.'); });
  const reset = el('button', 'evBtn evBtnGhost', 'Restaurar padrão'); reset.type = 'button';
  reset.addEventListener('click', () => { mother._config.extraVfx = null; mother._extraDirty = true; rerender(); });
  foot.append(test, reset);
  body.appendChild(foot);
  body.scrollTop = scroll;
}

function makeDraggable(menu, handle) {
  if (!menu || !handle) return;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = menu.getBoundingClientRect();
    menu.style.transform = 'none'; menu.style.left = r.left + 'px'; menu.style.top = r.top + 'px';
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      menu.style.left = Math.min(innerWidth - 80, Math.max(-r.width + 120, ev.clientX - dx)) + 'px';
      menu.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px';
    };
    const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
  });
}

function init() {
  $('lab-more-btn')?.addEventListener('click', () => openMenu('labsMoreMenu', true));
  $('labsMoreClose')?.addEventListener('click', closeAll);
  $('labsMoreBackdrop')?.addEventListener('click', closeAll);
  $('extraVfxClose')?.addEventListener('click', () => openMenu('extraVfxMenu', false));
  $('labsMoreExtraVfx')?.addEventListener('click', () => { openMenu('labsMoreMenu', false); render(); openMenu('extraVfxMenu', true); });
  makeDraggable($('extraVfxMenu'), $('extraVfxHeader'));
  // acompanha a seleção de sistema enquanto o painel está aberto
  window.addEventListener('labs-active-system', () => { if (!$('extraVfxMenu')?.classList.contains('hidden')) render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
