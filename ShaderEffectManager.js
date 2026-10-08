// ShaderEffectManager.js
//
// Núcleo do sistema de shaders (Procedural Shader). Aplica os efeitos via
// `onBeforeCompile` diretamente sobre o material já existente do objeto
// (MeshStandardMaterial / MeshPhysicalMaterial), preservando toda a pipeline
// PBR (Base/Roughness/Metalness/Mapas). Nenhum overlay 2D, nenhum filtro de
// tela — o shader é literalmente parte do material do objeto selecionado.
//
// PRIORIDADE Domínio × Procedural (documentada conforme item 20 do spec):
//   - Se o objeto tem um Procedural Shader próprio (≠ "Nenhum"), ele SEMPRE
//     prevalece e o(s) efeito(s) de Domínio são ignorados nesse objeto.
//   - Se o objeto está em "Nenhum" (sem efeito próprio) e está dentro de um
//     Domínio ativo, os efeitos marcados no Domínio são aplicados a ele.
//   - Ao sair do Domínio (ou o Domínio ser desativado), o objeto volta a
//     "Nenhum" (material normal) automaticamente.
//
// PERFORMANCE (item 24):
//   - O material só é recompilado (`needsUpdate = true`) quando a COMBINAÇÃO
//     de efeitos ativos muda (ex.: none → hologram, ou hologram → hologram+
//     glitch). Enquanto a combinação não muda, apenas os valores dos uniforms
//     são atualizados a cada frame (sem recompilar).
//   - O three.js também cacheia programas WebGL por código-fonte de shader,
//     então combos repetidos entre objetos diferentes reaproveitam o mesmo
//     programa compilado.

import * as THREE from 'three';
import { getEffect, NCM_COMMON_GLSL } from './EffectLibrary.js';
import { ensureOutlineShell, removeOutlineShell } from './OutlineShell.js';
import { app, markSceneDirty, ensurePhysicalMaterial } from './scene.js';

// mesh -> state
const _state = new WeakMap();
// meshes que atualmente têm QUALQUER uniform vivo (para o tick ser barato)
const _activeMeshes = new Set();

const DOMAIN_MASK_FN = /* glsl */`
  uniform vec3 uDomainMin;
  uniform vec3 uDomainMax;
  uniform float uDomainEnabled;
  uniform float uDomainSoft;
  uniform float uDomainFullObject;
  float ncmDomainMask(vec3 wp) {
    if (uDomainEnabled < 0.5) return 0.0;
    if (uDomainFullObject > 0.5) return 1.0;
    vec3 d0 = wp - uDomainMin;
    vec3 d1 = uDomainMax - wp;
    float inside = min(min(d0.x, d0.y), min(d0.z, min(d1.x, min(d1.y, d1.z))));
    return clamp(smoothstep(-uDomainSoft, uDomainSoft, inside), 0.0, 1.0);
  }
`;

// Uniforms já declarados "manualmente" em NCM_COMMON_GLSL / DOMAIN_MASK_FN —
// não devem ganhar uma segunda declaração automática (isso seria um erro de
// compilação GLSL por redefinição).
const _PRE_DECLARED_UNIFORMS = new Set(['uNcmTime', 'uDomainMin', 'uDomainMax', 'uDomainEnabled', 'uDomainSoft', 'uDomainFullObject']);

function _glslTypeFor(value) {
  if (typeof value === 'number') return 'float';
  if (typeof value === 'boolean') return 'bool';
  if (value && value.isColor) return 'vec3';
  if (value && value.isVector4) return 'vec4';
  if (value && value.isVector3) return 'vec3';
  if (value && value.isVector2) return 'vec2';
  return 'float';
}

// Gera as declarações `uniform <tipo> <nome>;` para todo uniform que os
// efeitos ativos usam (uma vez só — reaproveitado em vertex E fragment).
function _buildUniformDeclarations(uniforms) {
  let decl = '';
  for (const name of Object.keys(uniforms)) {
    if (_PRE_DECLARED_UNIFORMS.has(name)) continue;
    decl += `uniform ${_glslTypeFor(uniforms[name].value)} ${name};\n`;
  }
  return decl;
}

function _resolveMesh(obj) {
  if (!obj) return null;
  if (obj.userData?.isLightObject) return null;
  if (obj.isMesh || obj.isSkinnedMesh) return obj;
  let found = null;
  obj.traverse?.((o) => {
    if (found) return;
    if ((o.isMesh || o.isSkinnedMesh) && !o.userData?.isBoneMarker && !o.userData?.isNcmShell) found = o;
  });
  return found;
}

function _getState(mesh) {
  let s = _state.get(mesh);
  if (!s) {
    s = {
      // Procedural Shader is now multi-select. Keep ownKey/ownParams as
      // compatibility aliases for projects saved by older versions.
      ownKeys: [],
      ownParamsByKey: {},
      ownKey: 'none',
      ownParams: {},
      domainKeys: [],
      domainParamsByKey: {},
      insideDomain: false,
      domainBox: null,
      lastCombo: null,
      uniforms: null,
      patchedKeys: new Set(),
      material: null
    };
    _state.set(mesh, s);
  }
  _normalizeOwnState(s);
  return s;
}

function _normalizeOwnState(s) {
  if (!Array.isArray(s.ownKeys)) s.ownKeys = [];
  if (!s.ownParamsByKey || typeof s.ownParamsByKey !== 'object') s.ownParamsByKey = {};

  // Legacy state: one key + one params object.
  if (s.ownKeys.length === 0 && s.ownKey && s.ownKey !== 'none') {
    s.ownKeys = [s.ownKey];
    s.ownParamsByKey[s.ownKey] = { ...(s.ownParams || {}) };
  }

  s.ownKeys = [...new Set(s.ownKeys.filter(k => k && k !== 'none'))];
  for (const key of s.ownKeys) {
    if (!s.ownParamsByKey[key]) s.ownParamsByKey[key] = getEffect(key).defaults();
  }

  s.ownKey = s.ownKeys[0] || 'none';
  s.ownParams = s.ownKeys.length ? s.ownParamsByKey[s.ownKey] : {};
}

function _effectiveSource(s) {
  _normalizeOwnState(s);
  const own = new Set(s.ownKeys);
  const entries = [];

  for (const key of s.ownKeys) entries.push({ key, source: 'own' });

  if (s.insideDomain && s.domainKeys.length) {
    for (const key of s.domainKeys) {
      // A same-name procedural effect wins for that effect only.
      if (own.has(key)) continue;
      entries.push({ key, source: 'domain' });
    }
  }

  entries.sort((a, b) => a.key.localeCompare(b.key));
  const source = !entries.length
    ? 'none'
    : entries.every(e => e.source === 'own')
      ? 'own'
      : entries.every(e => e.source === 'domain')
        ? 'domain'
        : 'combined';

  return { source, entries, keys: entries.map(e => e.key) };
}

function _comboSignature(eff) {
  if (!eff.entries.length) return 'none';
  return `${eff.source}:${eff.entries.map(e => `${e.source}:${e.key}`).join(',')}`;
}

function _paramsFor(s, entry) {
  if (entry.source === 'own') {
    return s.ownParamsByKey[entry.key] || getEffect(entry.key).defaults();
  }
  return s.domainParamsByKey[entry.key] || getEffect(entry.key).defaults();
}

// ─── Reconstrução do material (só quando o combo muda) ────────────────────
function _rebuild(mesh, s) {
  const eff = _effectiveSource(s);
  const sig = _comboSignature(eff);

  _syncShell(mesh, s, eff);
  if (sig === s.lastCombo) return;

  const wasActive = s.lastCombo && s.lastCombo !== 'none';
  s.lastCombo = sig;

  if (eff.entries.length > 0) {
    ensurePhysicalMaterial(mesh);
  }

  const mat = mesh.material;
  s.material = mat;

  const newKeySet = new Set(eff.entries.map(e => e.key));
  for (const oldKey of Array.from(s.patchedKeys)) {
    if (!newKeySet.has(oldKey)) {
      getEffect(oldKey).materialPatch?.(mat, false);
      s.patchedKeys.delete(oldKey);
    }
  }
  for (const entry of eff.entries) {
    const def = getEffect(entry.key);
    if (def.materialPatch) {
      def.materialPatch(mat, true);
      s.patchedKeys.add(entry.key);
    }
  }

  if (!eff.entries.length) {
    if (wasActive) {
      mat.onBeforeCompile = () => {};
      mat.customProgramCacheKey = () => 'ncm_none';
      mat.needsUpdate = true;
    }
    _activeMeshes.delete(mesh);
    s.uniforms = null;
    return;
  }

  const uniforms = { uNcmTime: { value: 0 } };
  const hasDomainEntries = eff.entries.some(e => e.source === 'domain');
  if (hasDomainEntries) {
    const box = s.domainBox || { min: new THREE.Vector3(), max: new THREE.Vector3(), soft: 0.05, fullObject: false };
    uniforms.uDomainMin = { value: box.min.clone() };
    uniforms.uDomainMax = { value: box.max.clone() };
    uniforms.uDomainEnabled = { value: 1.0 };
    uniforms.uDomainSoft = { value: box.soft ?? 0.05 };
    uniforms.uDomainFullObject = { value: box.fullObject ? 1.0 : 0.0 };
  }

  for (const entry of eff.entries) {
    const def = getEffect(entry.key);
    if (def.shellOnly) continue;
    Object.assign(uniforms, def.uniforms(_paramsFor(s, entry)));
  }
  s.uniforms = uniforms;
  _activeMeshes.add(mesh);

  const headerFns = new Set();
  if (hasDomainEntries) headerFns.add(DOMAIN_MASK_FN);
  for (const entry of eff.entries) {
    const def = getEffect(entry.key);
    if (def.fnHeader) headerFns.add(def.fnHeader);
  }

  let vertexBlocks = '';
  let fragmentBlocks = '';
  for (const entry of eff.entries) {
    const def = getEffect(entry.key);
    if (def.shellOnly) continue;
    const params = _paramsFor(s, entry);
    const vCode = def.vertex ? def.vertex(params) : '';
    const fCode = def.fragment ? def.fragment(params) : '';

    // Domain effects need to be masked BEFORE their code executes.
    // This is essential for effects such as Dissolve that may use `discard`:
    // a post-effect color mix cannot recover a fragment that was discarded.
    // For vertex effects, apply the domain mask in world space so the
    // deformation is limited to vertices that actually lie in the domain.
    if (vCode) {
      if (entry.source === 'domain') {
        // Para um domínio, o objeto é o alvo. O DomainManager marca o objeto
        // inteiro como pertencente ao domínio quando o bounding box entra
        // no volume; assim o efeito não fica preso a uma máscara de tela nem
        // deixa metade do objeto sem shader.
        vertexBlocks += `\n          {\n            float ncmDomainActive_${entry.key} = uDomainFullObject;\n            if (ncmDomainActive_${entry.key} > 0.5) {\n              ${vCode}\n            }\n          }\n        `;
      } else {
        vertexBlocks += vCode + '\n';
      }
    }

    if (fCode) {
      if (entry.source === 'domain') {
        // A máscara é avaliada como seleção de objeto. Importante: o código
        // do shader só é executado quando o domínio realmente ativou o objeto,
        // então efeitos que usam `discard` não podem apagar o objeto fora do
        // domínio nem interferir na renderização normal.
        const guardedCode = fCode.replace(/\bdiscard\s*;\s*/g, `if (uDomainFullObject > 0.5) discard;\n`);
        fragmentBlocks += `\n          {\n            if (uDomainFullObject > 0.5) {\n              ${guardedCode}\n            }\n          }\n        `;
      } else {
        fragmentBlocks += fCode + '\n';
      }
    }
  }

  const uniformDecl = _buildUniformDeclarations(uniforms);
  mat.onBeforeCompile = (shader) => {
    const commonDecl = NCM_COMMON_GLSL + uniformDecl + Array.from(headerFns).join('\n');

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${commonDecl}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n  vNcmNormalW = normalize(mat3(modelMatrix) * objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  ${vertexBlocks}\n  vNcmWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${commonDecl}`)
      .replace('#include <dithering_fragment>', `${fragmentBlocks}\n#include <dithering_fragment>`);

    Object.assign(shader.uniforms, s.uniforms);
    s.uniforms = shader.uniforms;
  };

  mat.customProgramCacheKey = () => `ncm_${sig}`;
  mat.needsUpdate = true;
}

function _syncShell(mesh, s, eff) {
  const animeEntry = eff.entries.find(e => e.key === 'anime');
  const outlineEntry = eff.entries.find(e => e.key === 'outline');
  const activeAnime = animeEntry ? _paramsFor(s, animeEntry) : null;
  const activeOutline = outlineEntry ? _paramsFor(s, outlineEntry) : null;

  if (activeOutline) {
    ensureOutlineShell(mesh, { color: activeOutline.color, width: activeOutline.width });
  } else if (activeAnime && activeAnime.outline > 0.001) {
    ensureOutlineShell(mesh, { color: activeAnime.outlineColor, width: activeAnime.outlineWidth });
  } else {
    removeOutlineShell(mesh);
  }
}

// ─── API pública ───────────────────────────────────────────────────────────

/** Define/toggle um Procedural Shader. Mantém múltiplos efeitos simultaneamente. */
export function setOwnEffect(target, key, params) {
  const mesh = _resolveMesh(target);
  if (!mesh) return;
  const s = _getState(mesh);
  if (key === 'none') {
    s.ownKeys = [];
    s.ownParamsByKey = {};
  } else {
    if (!s.ownKeys.includes(key)) s.ownKeys.push(key);
    s.ownParamsByKey[key] = { ...getEffect(key).defaults(), ...(params || {}) };
  }
  _normalizeOwnState(s);
  _rebuild(mesh, s);
  markSceneDirty();
}

/** Ativa/desativa um efeito sem apagar os demais. */
export function setOwnEffectEnabled(target, key, enabled) {
  const mesh = _resolveMesh(target);
  if (!mesh || !getEffect(key)) return;
  const s = _getState(mesh);
  if (enabled) {
    if (!s.ownKeys.includes(key)) s.ownKeys.push(key);
    if (!s.ownParamsByKey[key]) s.ownParamsByKey[key] = getEffect(key).defaults();
  } else {
    s.ownKeys = s.ownKeys.filter(k => k !== key);
    delete s.ownParamsByKey[key];
  }
  _normalizeOwnState(s);
  _rebuild(mesh, s);
  markSceneDirty();
}

/** Atualiza um parâmetro do efeito procedural identificado por `paramKey`. */
export function updateOwnParam(target, effectKey, paramKey, value) {
  const mesh = _resolveMesh(target);
  if (!mesh) return;
  const s = _getState(mesh);
  if (!s.ownKeys.includes(effectKey)) return;
  if (!s.ownParamsByKey[effectKey]) s.ownParamsByKey[effectKey] = getEffect(effectKey).defaults();
  s.ownParamsByKey[effectKey][paramKey] = value;
  _normalizeOwnState(s);

  const def = getEffect(effectKey);
  if (s.uniforms) def.updateUniforms(s.uniforms, s.ownParamsByKey[effectKey]);
  if (def.materialPatch) def.materialPatch(mesh.material, true);
  if (effectKey === 'outline' || (effectKey === 'anime' && ['outline', 'outlineWidth', 'outlineColor'].includes(paramKey))) {
    _syncShell(mesh, s, _effectiveSource(s));
  }
  markSceneDirty();
}

export function getOwnEffectState(target) {
  const mesh = _resolveMesh(target);
  if (!mesh) return { key: 'none', params: {}, keys: [], paramsByKey: {} };
  const s = _getState(mesh);
  return {
    key: s.ownKeys[0] || 'none',
    params: s.ownKeys.length ? s.ownParamsByKey[s.ownKeys[0]] : {},
    keys: [...s.ownKeys],
    paramsByKey: JSON.parse(JSON.stringify(s.ownParamsByKey))
  };
}

/** Retorna estado completo compatível com saves antigos e novos. */
export function serializeOwnEffect(target) {
  const st = getOwnEffectState(target);
  return {
    key: st.key || 'none',
    params: JSON.parse(JSON.stringify(st.params || {})),
    keys: [...(st.keys || [])],
    paramsByKey: JSON.parse(JSON.stringify(st.paramsByKey || {}))
  };
}

/** Restaura uma configuração nova/multi ou um save legado de um único efeito. */
export function restoreOwnEffects(target, state) {
  const mesh = _resolveMesh(target);
  if (!mesh || !state) return;
  const s = _getState(mesh);

  const keys = Array.isArray(state.keys)
    ? state.keys.filter(k => k && k !== 'none')
    : (state.key && state.key !== 'none' ? [state.key] : []);

  const paramsByKey = state.paramsByKey && typeof state.paramsByKey === 'object'
    ? state.paramsByKey
    : (state.key && state.key !== 'none' ? { [state.key]: state.params || {} } : {});

  s.ownKeys = [...new Set(keys)];
  s.ownParamsByKey = {};
  for (const key of s.ownKeys) {
    try {
      s.ownParamsByKey[key] = { ...getEffect(key).defaults(), ...(paramsByKey[key] || {}) };
    } catch {}
  }
  _normalizeOwnState(s);
  _rebuild(mesh, s);
  markSceneDirty();
}

/**
 * Chamado pelo DomainManager a cada frame.
 * Domínio e Procedural podem coexistir: um efeito procedural do mesmo nome
 * tem prioridade sobre o domínio; efeitos de nomes diferentes são combinados.
 */
export function setDomainForMesh(meshLike, inside, keys, paramsByKey, box) {
  const mesh = _resolveMesh(meshLike);
  if (!mesh) return;
  const s = _getState(mesh);
  s.insideDomain = !!inside && Array.isArray(keys) && keys.length > 0;
  s.domainKeys = Array.isArray(keys) ? [...keys] : [];
  s.domainParamsByKey = paramsByKey || {};
  s.domainBox = box;
  _rebuild(mesh, s);

  if (!s.uniforms) return;
  const eff = _effectiveSource(s);
  if (!eff.entries.some(e => e.source === 'domain')) return;

  const safeBox = box || { min: new THREE.Vector3(), max: new THREE.Vector3(), soft: 0.05 };
  if (s.uniforms.uDomainMin) s.uniforms.uDomainMin.value.copy(safeBox.min);
  if (s.uniforms.uDomainMax) s.uniforms.uDomainMax.value.copy(safeBox.max);
  if (s.uniforms.uDomainSoft) s.uniforms.uDomainSoft.value = safeBox.soft ?? 0.05;
  if (s.uniforms.uDomainFullObject) s.uniforms.uDomainFullObject.value = safeBox.fullObject ? 1.0 : 0.0;

  for (const entry of eff.entries) {
    if (entry.source !== 'domain') continue;
    const def = getEffect(entry.key);
    if (!def.shellOnly) def.updateUniforms(s.uniforms, _paramsFor(s, entry));
  }
}

/** Remove completamente o estado de shader de um objeto (ex.: objeto deletado). */
export function disposeEffects(target) {
  const mesh = _resolveMesh(target);
  if (!mesh) return;
  removeOutlineShell(mesh);
  _activeMeshes.delete(mesh);
  _state.delete(mesh);
}

let _clock = 0;
/** Chamado uma vez por frame pelo loop principal (render.js). */
export function tickShaderSystem(dtSeconds) {
  _clock += dtSeconds;
  for (const mesh of _activeMeshes) {
    // Objeto removido da cena (deletado, ou revertido por undo) — limpa o
    // estado em vez de deixar um uniform "fantasma" sendo atualizado à toa.
    if (!mesh.parent) {
      disposeEffects(mesh);
      continue;
    }
    const s = _state.get(mesh);
    if (s?.uniforms?.uNcmTime) s.uniforms.uNcmTime.value = _clock;
  }
}

export { _resolveMesh as resolveEffectTarget };
