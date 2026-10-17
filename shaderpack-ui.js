// shaderpack-ui.js — botão "Importar sistema" (Configurações) + painel de
// opções/diagnóstico do shaderpack Java importado.
import {
  importShaderPackFile, getShaderPackState, setShaderPackEnabled, setShaderPackOption,
  resetShaderPackOptions, removeShaderPack, onShaderPackChange, restoreShaderPack, buildShaderPackNow,
} from './shaderpack.js';
import { refreshShaderPackPipeline, setLightPreviewActive, isLightPreviewActive } from './posprocess.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initShaderPackUI() {
  const btn = $('cfgImportSystem'), file = $('cfgImportSystemFile'), status = $('cfgSystemStatus');
  const controls = $('cfgSystemControls'), toggle = $('cfgSystemEnabled');
  const manage = $('cfgSystemManage'), remove = $('cfgSystemRemove');
  if (!btn || !file) return;

  let dialog = null, filter = '';

  function summary(st) {
    if (!st.loaded) return 'Nenhum sistema importado. Aceita shaderpacks de Minecraft Java (.zip).';
    if (st.report) {
      const ok = st.report.filter((r) => r.ok).length;
      return `${st.name} — ${ok}/${st.report.length} programas ativos${st.error ? ' · ' + st.error : ''}`;
    }
    return `${st.name} — ${st.programs.length} programas`;
  }

  function sync(st = getShaderPackState()) {
    status.textContent = summary(st);
    status.classList.toggle('sysErr', !!st.error);
    controls.classList.toggle('hidden', !st.loaded);
    toggle.checked = !!st.enabled;
    if (dialog && !dialog.classList.contains('hidden')) renderDialog(st);
  }

  async function doImport(f) {
    try {
      status.classList.remove('sysErr');
      status.textContent = 'Importando… (compilando shaders, pode levar alguns segundos)';
      await new Promise((r) => setTimeout(r, 40));
      await importShaderPackFile(f);
      if (!isLightPreviewActive()) setLightPreviewActive(true); // o sistema roda no pipeline de pós-processamento
      buildShaderPackNow();
      refreshShaderPackPipeline();
      sync();
      openDialog();
    } catch (e) {
      console.warn('[shaderpack]', e);
      status.textContent = 'Falha ao importar: ' + (e && e.message || e);
      status.classList.add('sysErr');
    }
  }

  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; if (f) doImport(f); });
  toggle.addEventListener('change', () => {
    setShaderPackEnabled(toggle.checked);
    if (toggle.checked && !isLightPreviewActive()) setLightPreviewActive(true);
    refreshShaderPackPipeline();
    sync();
  });
  manage.addEventListener('click', openDialog);
  remove.addEventListener('click', () => {
    if (!confirm('Remover o sistema de shader importado?')) return;
    removeShaderPack();
    refreshShaderPackPipeline();
    closeDialog();
    sync();
  });
  onShaderPackChange((st) => sync(st));

  // ── diálogo ──────────────────────────────────────────────────────────────
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.id = 'shaderPackDialog';
    dialog.className = 'spDialog hidden';
    dialog.innerHTML = `
      <div class="spCard">
        <div class="spHead"><span class="spTitle">SISTEMA DE SHADER</span><button class="spClose" type="button" aria-label="Fechar">✕</button></div>
        <div class="spBody"></div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) closeDialog(); });
    dialog.querySelector('.spClose').addEventListener('click', closeDialog);
    return dialog;
  }
  function openDialog() { ensureDialog().classList.remove('hidden'); renderDialog(getShaderPackState()); }
  function closeDialog() { dialog?.classList.add('hidden'); }

  let debounce = 0;
  function queueOption(name, value) {
    clearTimeout(debounce);
    debounce = setTimeout(() => { setShaderPackOption(name, value); refreshShaderPackPipeline(); }, 350);
  }

  function renderDialog(st) {
    const body = dialog.querySelector('.spBody');
    const keepScroll = body.querySelector('.spOpts')?.scrollTop || 0;
    if (!st.loaded) { body.innerHTML = '<div class="spNote">Nenhum sistema importado.</div>'; return; }
    const rep = st.report || [];
    const ok = rep.filter((r) => r.ok).length;
    let html = `<div class="spName">${esc(st.name)}</div>
      <div class="spNote">Roda os passes <b>composite / final</b> (bloom, tonemap, cor, DOF, névoa, raios…) sobre a cena 3D do Nexus.
      Os passes que desenham blocos do Minecraft (<code>gbuffers_*</code>, <code>shadow</code>) não existem aqui, então efeitos que dependem deles (sombras, água, nuvens do pack) podem ficar parciais.${st.hasGbuffers ? '' : ''}</div>
      <div class="spSub">PROGRAMAS <span class="spCount">${ok}/${rep.length || st.programs.length}</span></div><div class="spProgs">`;
    if (rep.length) {
      for (const r of rep) {
        const cls = r.ok ? 'ok' : (r.disabled ? 'off' : 'err');
        html += `<span class="spChip ${cls}" title="${esc(r.error || (r.ok ? 'compilado (' + r.fixes + ' ajustes automáticos)' : ''))}">${esc(r.name)}</span>`;
      }
    } else html += st.programs.map((p) => `<span class="spChip">${esc(p)}</span>`).join('');
    html += '</div>';
    const bad = rep.filter((r) => !r.ok && !r.disabled);
    if (bad.length) html += `<details class="spErrors"><summary>${bad.length} programa(s) não compilaram</summary>${bad.map((r) => `<div class="spErrItem"><b>${esc(r.name)}</b><pre>${esc(r.error)}</pre></div>`).join('')}</details>`;
    html += `<div class="spSub">OPÇÕES <span class="spCount">${st.options.length}</span>
      <button class="spMini" type="button" data-act="reset">Restaurar padrão</button></div>
      <input class="spSearch" type="search" placeholder="Filtrar opções…" value="${esc(filter)}">
      <div class="spOpts">`;
    let group = null;
    const q = filter.trim().toLowerCase();
    for (const o of st.options) {
      if (q && !(o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))) continue;
      if (o.group !== group) { group = o.group; html += `<div class="spGroup">${esc(group)}</div>`; }
      let ctl;
      if (o.kind === 'toggle') ctl = `<input type="checkbox" data-opt="${esc(o.name)}" ${o.value ? 'checked' : ''}>`;
      else if (o.list && o.list.length) {
        const vals = o.list.includes(String(o.value)) ? o.list : [String(o.value), ...o.list];
        ctl = `<select data-opt="${esc(o.name)}">${vals.map((v) => `<option ${String(o.value) === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
      } else ctl = `<input type="text" data-opt="${esc(o.name)}" value="${esc(o.value)}">`;
      html += `<label class="spOpt" title="${esc(o.name)}"><span>${esc(o.label)}</span>${ctl}</label>`;
    }
    html += '</div>';
    body.innerHTML = html;
    const opts = body.querySelector('.spOpts'); if (opts) opts.scrollTop = keepScroll;
    body.querySelector('.spSearch')?.addEventListener('input', (e) => { filter = e.target.value; renderDialog(getShaderPackState()); const s = body.querySelector('.spSearch'); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); });
    body.querySelector('[data-act="reset"]')?.addEventListener('click', () => { resetShaderPackOptions(); refreshShaderPackPipeline(); });
    body.querySelectorAll('[data-opt]').forEach((el) => {
      const name = el.dataset.opt;
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => queueOption(name, el.type === 'checkbox' ? el.checked : el.value));
    });
  }

  // Restaura o sistema salvo (IndexedDB)
  restoreShaderPack().then((st) => { if (st) { refreshShaderPackPipeline(); sync(st); } }).catch(() => {});
  sync();
}
