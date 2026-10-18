// extra-vfx-ui.js — Labs › More › Extra VFX
// Painel central (mesmo estilo das Configurações) para configurar uma
// partícula extra que aparece em cima de um objeto quando a partícula
// selecionada (a "mãe") encosta nele. A detecção vive em particle-engine.js
// (ParticleLab._extraVfxTick); aqui fica só a interface.
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let mother = null;

function show(menuId, on) {
  $(menuId)?.classList.toggle('hidden', !on);
  const anyOpen = !$('labsMoreMenu')?.classList.contains('hidden') || !$('extraVfxMenu')?.classList.contains('hidden');
  $('labsMoreBackdrop')?.classList.toggle('hidden', !anyOpen);
}
function closeAll() { show('labsMoreMenu', false); show('extraVfxMenu', false); }

function sceneObjects() {
  const scene = window._app?.scene, lab = window._nexusParticleLab, out = [];
  scene?.traverse((o) => {
    if (!o.isObject3D || o === scene) return;
    if (o.userData?.isBoneMarker || o.userData?.isHelper || o.userData?.isGizmo || o.isLight || o.isCamera) return;
    if (lab?.getSystems?.().some((s) => s._marker === o || s._points === o || s._beamMesh === o || s._meshInstance === o || s._oqMesh === o)) return;
    if (window._nexusAuraLab?.getSystems?.().some((s) => s._marker === o || s._shellMesh === o || s._billboards?.includes(o))) return;
    if (!o.name) return;
    out.push(o);
  });
  return out;
}

function numRow(label, key, x, opts, apply) {
  const row = document.createElement('label');
  row.className = 'evRow';
  row.innerHTML = `<span>${label}</span>`;
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = opts.min; inp.max = opts.max; inp.step = opts.step; inp.value = x[key];
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) apply({ [key]: Math.min(opts.max, Math.max(opts.min, v)) }); });
  row.appendChild(inp);
  return row;
}

function render() {
  const body = $('extraVfxBody'); if (!body) return;
  const lab = window._nexusParticleLab;
  mother = window._labsGetActiveSystem?.() || null;
  body.innerHTML = '';
  if (!mother || !lab || !mother.getExtraVfx) {
    body.innerHTML = '<div class="setSection"><div class="evHint">Selecione antes um sistema de partículas (a partícula “mãe”) na aba Sistema e abra de novo.</div></div>';
    return;
  }
  const x = mother.getExtraVfx();
  const set = (patch) => { mother.setExtraVfx(patch); };
  const sec = (title) => { const d = document.createElement('div'); d.className = 'setSection evSection'; d.innerHTML = `<div class="setSectionTitle">${title}</div>`; body.appendChild(d); return d; };

  const s0 = sec(`Partícula mãe: ${esc(mother.name || 'Sistema')}`);
  const tg = document.createElement('label'); tg.className = 'evRow';
  tg.innerHTML = '<span>Ativar Extra VFX</span>';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!x.enabled;
  cb.addEventListener('change', () => set({ enabled: cb.checked }));
  tg.appendChild(cb); s0.appendChild(tg);
  const hint = document.createElement('div'); hint.className = 'evHint';
  hint.textContent = 'Quando uma partícula desta mãe encostar no objeto escolhido, a partícula extra aparece em cima dele.';
  s0.appendChild(hint);

  // ── Objeto alvo ──
  const s1 = sec('Objeto que dispara');
  const selTarget = document.createElement('select'); selTarget.className = 'evSelect';
  const objs = sceneObjects();
  selTarget.innerHTML = '<option value="">— nenhum —</option>' + objs.map((o) => `<option value="${o.uuid}" ${o.uuid === x.targetUuid ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  if (x.targetUuid && !objs.some((o) => o.uuid === x.targetUuid)) selTarget.insertAdjacentHTML('beforeend', `<option value="${x.targetUuid}" selected>${esc(x.targetName || 'Objeto')}</option>`);
  selTarget.addEventListener('change', () => {
    const o = objs.find((q) => q.uuid === selTarget.value);
    set({ targetUuid: o ? o.uuid : null, targetName: o ? o.name : null });
  });
  s1.appendChild(selTarget);
  const useSel = document.createElement('button'); useSel.type = 'button'; useSel.className = 'labs-action-btn'; useSel.textContent = 'Usar objeto selecionado na cena';
  useSel.addEventListener('click', () => {
    const o = window._app?.selected;
    if (!o) { alert('Nenhum objeto selecionado na cena.'); return; }
    set({ targetUuid: o.uuid, targetName: o.name || 'Objeto', enabled: true });
    render();
  });
  s1.appendChild(useSel);

  // ── Partícula extra ──
  const s2 = sec('Partícula extra');
  const selExtra = document.createElement('select'); selExtra.className = 'evSelect';
  const others = (lab.getSystems?.() || []).filter((s) => s !== mother);
  selExtra.innerHTML = '<option value="">— escolha um sistema —</option>' + others.map((s) => `<option value="${s.id}" ${s.id === x.extraId ? 'selected' : ''}>${esc(s.name || 'Sistema')}</option>`).join('');
  selExtra.addEventListener('change', () => { set({ extraId: selExtra.value || null }); render(); });
  s2.appendChild(selExtra);
  const btns = document.createElement('div'); btns.className = 'evBtns';
  const mk = document.createElement('button'); mk.type = 'button'; mk.className = 'labs-action-btn'; mk.textContent = '+ Criar nova partícula extra';
  mk.addEventListener('click', () => {
    const pos = mother.getWorldPosition(new (mother.position.constructor)());
    const ex = lab.createBlank(`Extra de ${mother.name || 'Sistema'}`, pos);
    ex.play?.();
    lab._active = mother;
    set({ extraId: ex.id, enabled: true });
    window.dispatchEvent(new Event('labs-systems-changed'));
    window._labsSelectSystem?.(mother);
    render();
  });
  const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'labs-action-btn'; ed.textContent = 'Editar extra';
  ed.disabled = !x.extraId;
  ed.addEventListener('click', () => {
    const ex = lab.getSystems().find((s) => s.id === x.extraId); if (!ex) return;
    lab._active = ex; closeAll();
    window._labsSelectSystem?.(ex, { cat: 'stack' });
  });
  btns.append(mk, ed); s2.appendChild(btns);
  const h2 = document.createElement('div'); h2.className = 'evHint';
  h2.textContent = 'A extra tem todas as opções de um sistema normal (Emissão, Aparência, Comportamento, Shader…). Use “Editar extra” para configurá-la. Ela só emite quando disparada.';
  s2.appendChild(h2);

  // ── Disparo ──
  const s3 = sec('Disparo');
  const pr = document.createElement('label'); pr.className = 'evRow'; pr.innerHTML = '<span>Aparece</span>';
  const sp = document.createElement('select'); sp.className = 'evSelect';
  sp.innerHTML = `<option value="top" ${x.position !== 'contact' ? 'selected' : ''}>Em cima do objeto</option><option value="contact" ${x.position === 'contact' ? 'selected' : ''}>No ponto do contato</option>`;
  sp.addEventListener('change', () => set({ position: sp.value }));
  pr.appendChild(sp); s3.appendChild(pr);
  s3.appendChild(numRow('Altura acima do topo', 'offsetY', x, { min: -5, max: 20, step: 0.05 }, set));
  s3.appendChild(numRow('Folga de contato', 'margin', x, { min: 0, max: 5, step: 0.01 }, set));
  s3.appendChild(numRow('Partículas por disparo (0 = do extra)', 'burstCount', x, { min: 0, max: 2000, step: 1 }, set));
  s3.appendChild(numRow('Emitir por (s) após o toque', 'duration', x, { min: 0, max: 30, step: 0.1 }, set));
  s3.appendChild(numRow('Intervalo mínimo (s)', 'cooldown', x, { min: 0, max: 10, step: 0.01 }, set));
  s3.appendChild(numRow('Máx. disparos por segundo', 'maxPerSecond', x, { min: 1, max: 120, step: 1 }, set));
  const test = document.createElement('button'); test.type = 'button'; test.className = 'labs-action-btn labs-action-preview'; test.textContent = 'Testar disparo';
  test.addEventListener('click', () => { if (!lab.testExtraVfx(mother)) alert('Escolha uma partícula extra primeiro.'); });
  s3.appendChild(test);
}

function init() {
  $('lab-more-btn')?.addEventListener('click', () => show('labsMoreMenu', true));
  $('labsMoreClose')?.addEventListener('click', closeAll);
  $('extraVfxClose')?.addEventListener('click', closeAll);
  $('labsMoreBackdrop')?.addEventListener('click', closeAll);
  $('labsMoreExtraVfx')?.addEventListener('click', () => { show('labsMoreMenu', false); render(); show('extraVfxMenu', true); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
