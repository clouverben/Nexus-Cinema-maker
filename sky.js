// sky.js — Painel Sky: fundo da cena, skybox e iluminação do céu.
//
// Substitui a "Cor de Fundo" e o "Skybox" que ficavam no menu Configurações
// (e o SkyboxManager interno do config.js). Tudo que mexe em scene.background
// / scene.environment passa por aqui.
//
// Modos de fundo
//   color    — cor sólida
//   gradient — gradiente vertical de 3 cores (topo / horizonte / base)
//   image    — HDR, EXR ou imagem equiretangular carregada pelo usuário
//
// Ajustes (valem para gradiente e imagem; a exposição vale também para cor)
//   exposure  — EV (stops). O fundo é multiplicado por 2^EV.
//   rotation  — giro horizontal do céu e da iluminação, em graus.
//   blur      — desfoque do fundo (scene.backgroundBlurriness).
//   lighting  — usa o céu como luz ambiente (IBL via PMREM).
//   envIntensity — força dessa iluminação.
import * as THREE from 'three';
import { app, markSceneDirty } from './scene.js';

const STORAGE_KEY = 'ncm.sky';

export const SKY_DEFAULTS = Object.freeze({
  mode: 'color',
  color: '#3f4145',
  gradTop: '#0a0a2a',
  gradMid: '#122243',        // média de topo/base → reproduz o gradiente antigo
  gradBottom: '#1a3a5c',
  gradHorizon: 0.5,
  exposure: 0,
  rotation: 0,
  blur: 0,
  lighting: false,
  envIntensity: 1,
});

export const SKY_PRESETS = Object.freeze([
  { id: 'studio', label: 'Estúdio',    mode: 'color',    color: '#3f4145' },
  { id: 'day',    label: 'Dia',        mode: 'gradient', gradTop: '#3f86d6', gradMid: '#a6cdee', gradBottom: '#d9d4c7', gradHorizon: 0.5 },
  { id: 'sunset', label: 'Entardecer', mode: 'gradient', gradTop: '#1b2a57', gradMid: '#e8825a', gradBottom: '#2a2230', gradHorizon: 0.52 },
  { id: 'night',  label: 'Noite',      mode: 'gradient', gradTop: '#02030a', gradMid: '#0c1636', gradBottom: '#05060d', gradHorizon: 0.5 },
  { id: 'cloudy', label: 'Nublado',    mode: 'gradient', gradTop: '#7d838c', gradMid: '#b9bec4', gradBottom: '#6f7277', gradHorizon: 0.5 },
]);

let state = { ...SKY_DEFAULTS };
let _lastProcedural = 'color';   // modo para onde voltar ao remover a imagem
let _gradTex = null;             // CanvasTexture do gradiente
let _imageTex = null;            // textura carregada pelo usuário
let _imageName = '';
let _pmrem = null;
let _envRT = null;               // render target do PMREM atual
let _envKey = '';                // textura + modo que geraram _envRT
let _envTimer = 0;
let _inited = false;

// ── Utilidades ──────────────────────────────────────────────────────────

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);
const ev2mul = (ev) => Math.pow(2, ev);

function sanitize(raw = {}) {
  const s = { ...SKY_DEFAULTS };
  const isHex = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  if (raw.mode === 'color' || raw.mode === 'gradient' || raw.mode === 'image') s.mode = raw.mode;
  for (const k of ['color', 'gradTop', 'gradMid', 'gradBottom']) if (isHex(raw[k])) s[k] = raw[k];
  s.gradHorizon  = clamp(num(raw.gradHorizon, s.gradHorizon), 0.1, 0.9);
  s.exposure     = clamp(num(raw.exposure, s.exposure), -6, 6);
  s.rotation     = ((num(raw.rotation, s.rotation) % 360) + 360) % 360;
  s.blur         = clamp(num(raw.blur, s.blur), 0, 1);
  s.lighting     = !!raw.lighting;
  s.envIntensity = clamp(num(raw.envIntensity, s.envIntensity), 0, 5);
  return s;
}

function _pmremGen() {
  if (!_pmrem && app.renderer) {
    _pmrem = new THREE.PMREMGenerator(app.renderer);
    _pmrem.compileEquirectangularShader();
  }
  return _pmrem;
}

function _buildGradientTexture() {
  const c = document.createElement('canvas');
  c.width = 1; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, state.gradTop);
  g.addColorStop(state.gradHorizon, state.gradMid);
  g.addColorStop(1, state.gradBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function _disposeEnv() {
  if (_envRT) { _envRT.dispose(); _envRT = null; }
  _envKey = '';
}

// ── Aplicação ao three.js ───────────────────────────────────────────────

/** Textura que está de fundo agora (null no modo cor). */
function _activeTexture() {
  if (state.mode === 'gradient') return _gradTex;
  if (state.mode === 'image') return _imageTex;
  return null;
}

function _applyBackground() {
  const scene = app.scene;
  if (!scene) return;
  const mul = ev2mul(state.exposure);

  if (state.mode === 'color') {
    scene.background = new THREE.Color(state.color).multiplyScalar(mul);
  } else {
    const tex = _activeTexture();
    scene.background = tex || new THREE.Color(state.color).multiplyScalar(mul);
    scene.backgroundIntensity = mul;
  }
  // Rotação / desfoque só têm efeito em fundos de textura, mas é inofensivo
  // deixar os valores configurados no modo cor.
  scene.backgroundBlurriness = state.blur;
  const rad = THREE.MathUtils.degToRad(state.rotation);
  scene.backgroundRotation?.set(0, rad, 0);
  scene.environmentRotation?.set(0, rad, 0);
}

function _applyEnvironment() {
  const scene = app.scene;
  if (!scene) return;
  scene.environmentIntensity = state.envIntensity;

  const tex = _activeTexture();
  if (state.lighting && tex) {
    const key = `${tex.uuid}:${tex.version}`;
    if (!_envRT || _envKey !== key) {
      const gen = _pmremGen();
      if (gen) {
        _disposeEnv();
        _envRT = gen.fromEquirectangular(tex);
        _envKey = key;
      }
    }
    scene.environment = _envRT ? _envRT.texture : (app.defaultEnvironment ?? null);
  } else {
    _disposeEnv();
    scene.environment = app.defaultEnvironment ?? null;
  }
}

/** Reaplica tudo. `soon` adia a parte cara (PMREM) enquanto o usuário arrasta. */
function applyAll({ soon = false } = {}) {
  if (state.mode === 'gradient') {
    _gradTex?.dispose();
    _gradTex = _buildGradientTexture();
  }
  _applyBackground();
  // A intensidade é só um número no three.js (barata): aplica na hora, mesmo
  // enquanto a regeneração do PMREM (cara) espera o usuário parar de arrastar.
  if (app.scene) app.scene.environmentIntensity = state.envIntensity;
  if (soon) {
    clearTimeout(_envTimer);
    _envTimer = setTimeout(() => { _applyEnvironment(); markSceneDirty(); }, 180);
  } else {
    clearTimeout(_envTimer);
    _applyEnvironment();
  }
  markSceneDirty();
  syncUI();
}

// ── API pública ─────────────────────────────────────────────────────────

export function getSkyState() { return { ...state }; }

/** Mescla alterações e reaplica. */
export function setSky(patch, opts) {
  const next = sanitize({ ...state, ...patch });
  // "image" sem textura carregada não pode ser aplicado.
  if (next.mode === 'image' && !_imageTex) next.mode = state.mode === 'image' ? _lastProcedural : state.mode;
  if (next.mode !== 'image') _lastProcedural = next.mode;
  state = next;
  applyAll(opts);
  _persist();
}

export function applySkyPreset(id) {
  const p = SKY_PRESETS.find((x) => x.id === id);
  if (!p) return;
  const { id: _i, label: _l, ...vals } = p;
  // Preset é um look completo: mantém exposição/rotação, troca o céu.
  _imageTex = null; _imageName = '';
  setSky({ ...vals, lighting: false });
}

export function resetSky() {
  _imageTex?.dispose(); _imageTex = null; _imageName = '';
  _lastProcedural = 'color';
  state = { ...SKY_DEFAULTS };
  applyAll();
  _persist();
}

export async function loadSkyImage(file) {
  const url = URL.createObjectURL(file);
  const name = file.name.toLowerCase();
  try {
    let tex;
    if (name.endsWith('.hdr')) {
      const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
      tex = await new Promise((res, rej) => new RGBELoader().load(url, res, undefined, rej));
    } else if (name.endsWith('.exr')) {
      const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
      tex = await new Promise((res, rej) => new EXRLoader().load(url, res, undefined, rej));
    } else {
      tex = await new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
      tex.colorSpace = THREE.SRGBColorSpace;   // imagens LDR vêm em sRGB
    }
    tex.mapping = THREE.EquirectangularReflectionMapping;
    _imageTex?.dispose();
    _imageTex = tex;
    _imageName = file.name;
    _disposeEnv();
    // Um HDRI normalmente é pra iluminar também (comportamento anterior).
    setSky({ mode: 'image', lighting: true });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function removeSkyImage() {
  _imageTex?.dispose(); _imageTex = null; _imageName = '';
  _disposeEnv();
  setSky({ mode: _lastProcedural === 'image' ? 'color' : _lastProcedural, lighting: false });
}

// Projeto: HDRI/imagem não vão para o arquivo (pesados); o resto sim.
export function serializeSky() {
  const out = { ...state };
  if (out.mode === 'image') { out.mode = _lastProcedural; out.lighting = false; }
  return out;
}

export function restoreSky(data) {
  if (!data || typeof data !== 'object') return;
  _imageTex?.dispose(); _imageTex = null; _imageName = '';
  state = sanitize(data);
  if (state.mode === 'image') state.mode = 'color';
  _lastProcedural = state.mode;
  applyAll();
  _persist();
}

/** Projetos antigos só guardavam a cor de fundo. */
export function restoreLegacySkyColor(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
  setSky({ mode: 'color', color: hex });
}

function _persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSky())); } catch { /* sem storage */ }
}

function _loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
    // Migra a cor de fundo que o menu Configurações guardava antes.
    const legacy = JSON.parse(localStorage.getItem('ncm-settings') || '{}');
    if (/^#[0-9a-fA-F]{6}$/.test(legacy.bgColor || '')) return sanitize({ color: legacy.bgColor });
  } catch { /* ignora */ }
  return null;
}

// ── UI ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function syncUI() {
  if (!$('skyPanel')) return;
  const uiMode = $('skyPanel').dataset.uiMode || state.mode;
  document.querySelectorAll('#skyModeSeg .rhSeg').forEach((b) =>
    b.classList.toggle('active', b.dataset.skyMode === uiMode));
  $('skyColorGroup')?.classList.toggle('hidden', uiMode !== 'color');
  $('skyGradGroup')?.classList.toggle('hidden', uiMode !== 'gradient');
  $('skyImageGroup')?.classList.toggle('hidden', uiMode !== 'image');

  const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  set('skyColor', state.color);
  set('skyGradTop', state.gradTop); set('skyGradMid', state.gradMid); set('skyGradBottom', state.gradBottom);
  set('skyGradHorizon', state.gradHorizon); set('skyGradHorizonN', state.gradHorizon);
  set('skyExposure', state.exposure);  set('skyExposureN', state.exposure.toFixed(1));
  set('skyRotation', state.rotation);  set('skyRotationN', Math.round(state.rotation));
  set('skyBlur', state.blur);          set('skyBlurN', state.blur.toFixed(2));
  set('skyEnvIntensity', state.envIntensity); set('skyEnvIntensityN', state.envIntensity.toFixed(2));
  if ($('skyLighting')) $('skyLighting').checked = state.lighting;

  const textured = state.mode !== 'color';
  const imgName = $('skyImageName');
  if (imgName) imgName.textContent = _imageTex ? _imageName : 'Nenhuma imagem carregada';
  $('skyImageRemove')?.toggleAttribute('disabled', !_imageTex);

  // Desfoque/rotação/luz precisam de uma textura de céu.
  ['skyBlur', 'skyBlurN', 'skyRotation', 'skyRotationN', 'skyLighting'].forEach((id) => {
    const el = $(id); if (el) el.disabled = !textured;
  });
  ['skyEnvIntensity', 'skyEnvIntensityN'].forEach((id) => {
    const el = $(id); if (el) el.disabled = !(textured && state.lighting);
  });
  $('skyTexturedHint')?.classList.toggle('hidden', textured);

  document.querySelectorAll('.skyPreset').forEach((b) => {
    const p = SKY_PRESETS.find((x) => x.id === b.dataset.preset);
    const on = p && !_imageTex && p.mode === state.mode &&
      (p.mode === 'color' ? p.color === state.color
        : p.gradTop === state.gradTop && p.gradMid === state.gradMid && p.gradBottom === state.gradBottom);
    b.classList.toggle('active', !!on);
  });
}

function _bindPair(rangeId, numId, key, { soon = true, parse = parseFloat } = {}) {
  const r = $(rangeId), n = $(numId);
  const handler = (e) => {
    const v = parse(e.target.value);
    if (!Number.isFinite(v)) return;
    setSky({ [key]: v }, { soon });
  };
  r?.addEventListener('input', handler);
  n?.addEventListener('input', handler);
}

function _bindUI() {
  document.querySelectorAll('#skyModeSeg .rhSeg').forEach((b) =>
    b.addEventListener('click', () => {
      const m = b.dataset.skyMode;
      $('skyPanel').dataset.uiMode = m;
      if (m === 'image' && !_imageTex) { syncUI(); return; }   // só mostra o grupo; aplica ao carregar
      setSky({ mode: m });
    }));

  // Presets (miniaturas com o próprio gradiente)
  const presetBox = $('skyPresets');
  if (presetBox && !presetBox.children.length) {
    SKY_PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'skyPreset'; b.dataset.preset = p.id; b.title = p.label;
      b.style.background = p.mode === 'color'
        ? p.color
        : `linear-gradient(180deg, ${p.gradTop} 0%, ${p.gradMid} ${Math.round(p.gradHorizon * 100)}%, ${p.gradBottom} 100%)`;
      b.innerHTML = `<span>${p.label}</span>`;
      b.addEventListener('click', () => { $('skyPanel').dataset.uiMode = p.mode; applySkyPreset(p.id); });
      presetBox.appendChild(b);
    });
  }

  for (const [id, key] of [['skyColor', 'color'], ['skyGradTop', 'gradTop'], ['skyGradMid', 'gradMid'], ['skyGradBottom', 'gradBottom']]) {
    $(id)?.addEventListener('input', (e) => setSky({ [key]: e.target.value }, { soon: true }));
  }
  _bindPair('skyGradHorizon', 'skyGradHorizonN', 'gradHorizon');
  _bindPair('skyExposure', 'skyExposureN', 'exposure');
  _bindPair('skyRotation', 'skyRotationN', 'rotation');
  _bindPair('skyBlur', 'skyBlurN', 'blur');
  _bindPair('skyEnvIntensity', 'skyEnvIntensityN', 'envIntensity');
  $('skyLighting')?.addEventListener('change', (e) => setSky({ lighting: e.target.checked }));

  const file = $('skyFile'), up = $('skyImageUpload');
  up?.addEventListener('click', () => file?.click());
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const label = up.textContent;
    up.textContent = 'Carregando…'; up.disabled = true;
    try {
      $('skyPanel').dataset.uiMode = 'image';
      await loadSkyImage(f);
    } catch (err) {
      console.error('[Sky] falha ao carregar:', err);
      const hint = $('skyImageName');
      if (hint) hint.textContent = `Erro: ${err?.message || err}`;
    } finally {
      up.disabled = false; up.textContent = label; file.value = '';
    }
  });
  $('skyImageRemove')?.addEventListener('click', () => {
    $('skyPanel').dataset.uiMode = _lastProcedural;
    removeSkyImage();
  });
  $('skyReset')?.addEventListener('click', () => { $('skyPanel').dataset.uiMode = 'color'; resetSky(); });
}

export function initSky() {
  if (_inited || !app.scene) return;
  _inited = true;

  // Ponto de partida: o que o usuário deixou salvo; senão, a cor atual da cena.
  const saved = _loadPersisted();
  if (saved) state = saved;
  else if (app.scene.background instanceof THREE.Color) {
    state = sanitize({ color: '#' + app.scene.background.getHexString() });
  }
  _lastProcedural = state.mode === 'image' ? 'color' : state.mode;
  if (state.mode === 'image') state.mode = 'color';

  _bindUI();
  if ($('skyPanel')) $('skyPanel').dataset.uiMode = state.mode;
  applyAll();
}
