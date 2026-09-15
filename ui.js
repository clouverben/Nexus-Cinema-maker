// ui.js
// Procedural Shader (multi-select por objeto) + Domínio — antes vivia como
// "Page 2" do painel Render; agora é uma seção dentro do painel Material
// (ver initShaderDomainPanel(), chamado de material.js).

import { getSelected } from './scene.js';
import { pushState } from './undo-redo.js';
import { EFFECT_KEYS, DOMAIN_EFFECT_KEYS, getEffect } from './EffectLibrary.js';
import {
  setOwnEffectEnabled,
  updateOwnParam,
  getOwnEffectState,
  resolveEffectTarget
} from './ShaderEffectManager.js';
import {
  beginDomainDraw, clearDomain, onDomainNotify, getDomainSettings,
  setDomainHeight, setDomainElevation, setDomainOpacity, toggleDomainEffect,
  updateDomainEffectParam, getDomainEffectsState
} from './DomainManager.js';

const refs = {};

function paramRow(def, value) {
  if (def.type === 'color') {
    return `
      <div class="controlRow">
        <div class="controlLabel">${def.label}</div>
        <input type="color" class="ncmColor" data-param="${def.key}" value="${value}">
      </div>`;
  }

  return `
    <div class="controlRow ncmParamRow">
      <div class="controlLabel">${def.label}</div>
      <div class="ncmNumberWrap">
        <input type="number" class="ncmNumber" data-param="${def.key}"
               min="${def.min}" max="${def.max}" step="${def.step}" value="${value}">
      </div>
    </div>`;
}

function paramsHtml(effectDef, params) {
  if (!effectDef.params.length) {
    return `<p class="ncmEmptyNote">Este efeito não possui parâmetros ajustáveis.</p>`;
  }
  return effectDef.params
    .map((def) => paramRow(def, params?.[def.key] ?? def.default))
    .join('');
}

function wireToggles(root) {
  root.querySelectorAll('[data-toggle]').forEach((btn) => {
    if (btn.dataset.ncmWired) return;
    btn.dataset.ncmWired = '1';
    btn.addEventListener('click', () => {
      root.querySelector(`#${btn.dataset.toggle}`)?.classList.toggle('hidden');
    });
  });
}

// ─── Procedural Shader ──────────────────────────────────────────────────────

function buildProceduralTab() {
  return `
    <div class="materialTarget" id="ncmProcTarget">Nenhum objeto selecionado</div>

    <div class="modeSectionLabel">Shaders</div>
    <div class="tabBar ncmShaderTabBar" id="ncmShaderTabBar">
      ${EFFECT_KEYS.map((key, index) => `
        <button class="tabBtn ncmShaderTabBtn ${index === 0 ? 'active' : ''}"
                type="button" data-shader-tab="${key}">
          ${getEffect(key).label}
        </button>`).join('')}
    </div>

    <div id="ncmShaderTabPanels" class="ncmShaderTabPanels">
      ${EFFECT_KEYS.map((key, index) => {
        const def = getEffect(key);
        const defaults = def.defaults();
        return `
          <div class="ncmShaderTabPanel ${index === 0 ? '' : 'hidden'}" data-shader-panel="${key}">
            <label class="checkField ncmShaderEnableRow">
              <span>Ativar ${def.label}</span>
              <input type="checkbox" data-proc-enable="${key}">
            </label>
            <div class="panelSection ncmSection ncmShaderConfigSection">
              <div class="sectionHeader ncmStaticSectionHeader">
                <span>Configurações — ${def.label}</span>
              </div>
              <div class="sectionBody">
                ${paramsHtml(def, defaults)}
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>

    <p class="ncmHint">
      Cada objeto guarda sua própria combinação de shaders. Você pode ativar vários ao mesmo tempo.
    </p>
  `;
}

function refreshProceduralTab() {
  const obj = getSelected();
  const mesh = resolveEffectTarget(obj);
  refs.procTarget.textContent = obj ? (obj.name || mesh?.name || 'Objeto selecionado') : 'Nenhum objeto selecionado';

  const enabled = mesh ? new Set(getOwnEffectState(mesh).keys || []) : new Set();
  refs.procTabRoot.querySelectorAll('[data-proc-enable]').forEach((input) => {
    const key = input.dataset.procEnable;
    input.checked = enabled.has(key);
    input.disabled = !mesh;
  });

  refs.procTabRoot.querySelectorAll('[data-shader-panel]').forEach((panel) => {
    const key = panel.dataset.shaderPanel;
    const def = getEffect(key);
    const st = mesh ? getOwnEffectState(mesh) : { paramsByKey: {} };
    const params = mesh
      ? (st.paramsByKey?.[key] || def.defaults())
      : def.defaults();

    panel.querySelectorAll('.ncmNumber').forEach((input) => {
      const p = def.params.find(x => x.key === input.dataset.param);
      input.value = params?.[input.dataset.param] ?? p?.default ?? 0;
      input.disabled = !mesh;
    });
    panel.querySelectorAll('.ncmColor').forEach((input) => {
      input.value = params?.[input.dataset.param] ?? '#ffffff';
      input.disabled = !mesh;
    });
  });
}

function wireProceduralTab(root) {
  refs.procTabRoot = root;
  refs.procTarget = root.querySelector('#ncmProcTarget');

  root.querySelectorAll('[data-shader-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('[data-shader-tab]').forEach((b) => b.classList.remove('active'));
      root.querySelectorAll('[data-shader-panel]').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      root.querySelector(`[data-shader-panel="${btn.dataset.shaderTab}"]`)?.classList.remove('hidden');
    });
  });

  root.querySelectorAll('[data-proc-enable]').forEach((cb) => {
    cb.addEventListener('pointerdown', () => pushState(), { once: true });
    cb.addEventListener('change', () => {
      const mesh = resolveEffectTarget(getSelected());
      if (!mesh) return;
      setOwnEffectEnabled(mesh, cb.dataset.procEnable, cb.checked);
      pushState();
      refreshProceduralTab();
    });
  });

  root.querySelectorAll('[data-shader-panel]').forEach((panel) => {
    const key = panel.dataset.shaderPanel;

    panel.querySelectorAll('.ncmNumber').forEach((input) => {
      input.addEventListener('focus', () => pushState(), { once: false });
      input.addEventListener('input', () => {
        const mesh = resolveEffectTarget(getSelected());
        const val = Number(input.value);
        if (mesh && Number.isFinite(val)) updateOwnParam(mesh, key, input.dataset.param, val);
      });
      input.addEventListener('change', () => pushState());
    });

    panel.querySelectorAll('.ncmColor').forEach((input) => {
      input.addEventListener('focus', () => pushState(), { once: false });
      input.addEventListener('input', () => {
        const mesh = resolveEffectTarget(getSelected());
        if (mesh) updateOwnParam(mesh, key, input.dataset.param, input.value);
      });
      input.addEventListener('change', () => pushState());
    });
  });

  window.addEventListener('scene-selection-changed', refreshProceduralTab);
  refreshProceduralTab();
}

// ─── Aba Domínio ────────────────────────────────────────────────────────────

function buildDomainTab() {
  const settings = getDomainSettings();
  return `
    <button id="ncmDomainStartBtn" class="rsRenderBtn ncmDomainStartBtn" type="button">Começar domínio</button>
    <div id="ncmDomainNotify" class="brBanner hidden"></div>

    <div class="controlRow ncmParamRow">
      <div class="controlLabel">Altura</div>
      <div class="ncmNumberWrap">
        <input type="number" class="ncmNumber" id="ncmDomainHeight" min="0.2" max="15" step="0.1" value="${settings.height}">
      </div>
    </div>
    <div class="controlRow ncmParamRow">
      <div class="controlLabel">Elevação</div>
      <div class="ncmNumberWrap">
        <input type="number" class="ncmNumber" id="ncmDomainElevation" min="-5" max="10" step="0.1" value="${settings.elevation}">
      </div>
    </div>
    <div class="controlRow ncmParamRow">
      <div class="controlLabel">Transparência da cúpula</div>
      <div class="ncmNumberWrap">
        <input type="number" class="ncmNumber" id="ncmDomainOpacity" min="0" max="1" step="0.01" value="${settings.opacity ?? 0.2}">
      </div>
    </div>
    <button id="ncmDomainClearBtn" class="uiBtn ncmDomainClearBtn" type="button">Limpar domínio</button>

    <div class="modeSectionLabel" style="margin-top:10px">Efeitos</div>
    <div id="ncmDomainEffectsList"></div>
  `;
}

function buildDomainEffectsList() {
  const wrap = refs.domainEffectsList;
  if (!wrap) return;
  const state = getDomainEffectsState();
  wrap.innerHTML = DOMAIN_EFFECT_KEYS.map((key) => {
    const def = getEffect(key);
    const e = state[key];
    const bodyId = `ncmDomEffBody_${key}`;
    return `
      <div class="ncmDomainEffectRow">
        <label class="checkField ncmDomainCheck">
          <span>${def.label}</span>
          <input type="checkbox" data-domain-key="${key}" ${e.enabled ? 'checked' : ''}>
        </label>
        <div class="sectionBody ${e.enabled ? '' : 'hidden'}" id="${bodyId}">
          ${paramsHtml(def, e.params)}
        </div>
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('input[type="checkbox"][data-domain-key]').forEach((cb) => {
    cb.addEventListener('pointerdown', () => pushState(), { once: true });
    cb.addEventListener('change', () => {
      const key = cb.dataset.domainKey;
      toggleDomainEffect(key, cb.checked);
      wrap.querySelector(`#ncmDomEffBody_${key}`)?.classList.toggle('hidden', !cb.checked);
      pushState();
    });
  });

  wrap.querySelectorAll('.ncmNumber').forEach((input) => {
    input.addEventListener('focus', () => pushState(), { once: false });
    input.addEventListener('input', () => {
      const row = input.closest('.ncmDomainEffectRow');
      const key = row?.querySelector('[data-domain-key]')?.dataset.domainKey;
      if (!key) return;
      const val = Number(input.value);
      if (Number.isFinite(val)) updateDomainEffectParam(key, input.dataset.param, val);
    });
    input.addEventListener('change', () => pushState());
  });

  wrap.querySelectorAll('.ncmColor').forEach((input) => {
    input.addEventListener('input', () => {
      const row = input.closest('.ncmDomainEffectRow');
      const key = row?.querySelector('[data-domain-key]')?.dataset.domainKey;
      if (!key) return;
      updateDomainEffectParam(key, input.dataset.param, input.value);
    });
  });
}

function wireDomainTab(root) {
  refs.domainStartBtn = root.querySelector('#ncmDomainStartBtn');
  refs.domainNotify = root.querySelector('#ncmDomainNotify');
  refs.domainClearBtn = root.querySelector('#ncmDomainClearBtn');
  refs.domainHeight = root.querySelector('#ncmDomainHeight');
  refs.domainElevation = root.querySelector('#ncmDomainElevation');
  refs.domainOpacity = root.querySelector('#ncmDomainOpacity');
  refs.domainEffectsList = root.querySelector('#ncmDomainEffectsList');

  refs.domainStartBtn.addEventListener('click', () => {
    pushState();
    beginDomainDraw();
    refs.domainStartBtn.disabled = true;
    refs.domainStartBtn.textContent = 'Desenhando…';
  });

  refs.domainClearBtn.addEventListener('click', () => {
    pushState();
    clearDomain();
    pushState();
  });

  [refs.domainHeight, refs.domainElevation, refs.domainOpacity]
    .forEach((el) => el?.addEventListener('focus', () => pushState(), { once: false }));

  refs.domainHeight.addEventListener('input', () => setDomainHeight(refs.domainHeight.value));
  refs.domainHeight.addEventListener('change', () => pushState());
  refs.domainElevation.addEventListener('input', () => setDomainElevation(refs.domainElevation.value));
  refs.domainElevation.addEventListener('change', () => pushState());
  refs.domainOpacity.addEventListener('input', () => setDomainOpacity(refs.domainOpacity.value));
  refs.domainOpacity.addEventListener('change', () => pushState());

  onDomainNotify((msg) => {
    if (msg) {
      refs.domainNotify.textContent = msg;
      refs.domainNotify.classList.remove('hidden');
    } else {
      refs.domainNotify.classList.add('hidden');
      refs.domainStartBtn.disabled = false;
      refs.domainStartBtn.textContent = 'Começar domínio';
    }
  });

  buildDomainEffectsList();
}

// ─── Shaders & Domínio panel (lives inside the Material panel now) ─────────

export function initShaderDomainPanel(container) {
  if (!container || container.dataset.ncmShaderUiInit) return;
  container.dataset.ncmShaderUiInit = '1';

  container.innerHTML = `
    <div class="tabBar">
      <button class="tabBtn active" type="button" data-ncm-tab="ncmProcTab">Procedural Shader</button>
      <button class="tabBtn" type="button" data-ncm-tab="ncmDomTab">Domínio</button>
    </div>

    <div id="ncmProcTab" class="tabPanel"></div>
    <div id="ncmDomTab" class="tabPanel hidden"></div>
  `;

  container.querySelector('#ncmProcTab').innerHTML = buildProceduralTab();
  container.querySelector('#ncmDomTab').innerHTML = buildDomainTab();

  container.querySelectorAll('.tabBtn[data-ncm-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tabBtn[data-ncm-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      container.querySelectorAll('.tabPanel').forEach((p) => p.classList.add('hidden'));
      container.querySelector(`#${btn.dataset.ncmTab}`).classList.remove('hidden');
    });
  });

  wireProceduralTab(container.querySelector('#ncmProcTab'));
  wireDomainTab(container.querySelector('#ncmDomTab'));
  wireToggles(container);
}
