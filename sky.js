// sky.js — Painel Sky: fundo da cena, skybox, HDRIs online e iluminação do céu.
//
// Substitui a "Cor de Fundo" e o "Skybox" do menu Configurações. Tudo que mexe
// em scene.background / scene.environment passa por aqui.
//
// Fundo
//   color    — cor sólida
//   gradient — gradiente vertical de 3 cores (topo / horizonte / base)
//   image    — HDRI baixado da internet (Poly Haven, CC0), URL própria ou
//              arquivo local (.hdr / .exr / imagem equiretangular)
//
// Ajustes
//   exposure     — EV (stops). O fundo é multiplicado por 2^EV.
//   rotation     — giro horizontal do céu e da iluminação, em graus.
//   blur         — desfoque do fundo (scene.backgroundBlurriness).
//   lighting     — usa o céu como luz ambiente (IBL via PMREM).
//   envIntensity — força dessa iluminação.
import * as THREE from 'three';
import { app, markSceneDirty } from './scene.js';

const STORAGE_KEY = 'ncm.sky';
const HDRI_BASE = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr';
const THUMB_BASE = 'https://cdn.polyhaven.com/asset_img/thumbs';

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

// HDRIs do Poly Haven (CC0). Os ids são os dos presets do @react-three/drei
// (+ aerodynamics_workshop). URL: HDRI_BASE/<res>/<id>_<res>.hdr
export const HDRI_PRESETS = Object.freeze([
  { id: 'studio_small_03',       label: 'Estúdio',     tint: '#9a968f' },
  { id: 'venice_sunset',         label: 'Pôr do sol',  tint: '#d98a55' },
  { id: 'kiara_1_dawn',          label: 'Amanhecer',   tint: '#c9a27e' },
  { id: 'dikhololo_night',       label: 'Noite',       tint: '#1d2740' },
  { id: 'potsdamer_platz',       label: 'Cidade',      tint: '#7f8a96' },
  { id: 'lebombo',               label: 'Apartamento', tint: '#a8957d' },
  { id: 'forest_slope',          label: 'Floresta',    tint: '#4c6b45' },
  { id: 'rooitou_park',          label: 'Parque',      tint: '#6f9a63' },
  { id: 'st_fagans_interior',    label: 'Interior',    tint: '#8c7a66' },
  { id: 'empty_warehouse_01',    label: 'Galpão',      tint: '#80848a' },
  { id: 'aerodynamics_workshop', label: 'Oficina',     tint: '#6c7684' },
]);
export const HDRI_RESOLUTIONS = Object.freeze(['1k', '2k', '4k']);

export const hdriUrl = (id, res = '1k') => `${HDRI_BASE}/${res}/${id}_${res}.hdr`;
export const hdriThumb = (id) => `${THUMB_BASE}/${id}.png?width=256&height=128`;

let state = { ...SKY_DEFAULTS };
let _lastProcedural = 'color';   // modo para onde voltar ao remover a imagem
let _gradTex = null;             // CanvasTexture do gradiente
let _imageTex = null;            // textura de céu atual (cache, upload ou URL)
let _imageOwned = false;         // true → upload local: este módulo descarta a textura
let _imageMeta = null;           // { name, thumb?, online?: {id,res,url} }
let _hdriRes = '1k';
let _pmrem = null;
let _envRT = null;               // render target do PMREM atual
let _envKey = '';                // textura que gerou _envRT
let _envTimer = 0;
let _envError = '';
let _loadToken = 0;
let _status = { busy: false, text: '', pct: 0, error: '' };
let _inited = false;
const _hdriCache = new Map();    // url -> texture (LRU, no máx. 3)

// ── Utilidades ──────────────────────────────────────────────────────────

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);
const ev2mul = (ev) => Math.pow(2, ev);
const isHex = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
const isHttpUrl = (u) => { try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; } catch { return false; } };

function sanitize(raw = {}) {
  const s = { ...SKY_DEFAULTS };
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

/**
 * Gradiente equiretangular. PRECISA ter largura de verdade: o PMREM calcula o
 * tamanho do cubo como largura/4 — com 1 px de largura ele gera tamanhos
 * inválidos, lança exceção no meio do processo e deixa o renderer apontado
 * para o alvo errado (a cena inteira "sumia" ao ligar a iluminação do céu).
 */
function _buildGradientTexture() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, state.gradTop);
  g.addColorStop(state.gradHorizon, state.gradMid);
  g.addColorStop(1, state.gradBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
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

/** PMREM que nunca deixa o renderer num estado quebrado, mesmo se falhar. */
function _makeEnvironment(tex) {
  const gen = _pmremGen();
  const r = app.renderer;
  if (!gen || !r) return null;
  const w = tex?.image?.width || 0;
  if (w < 16) { _envError = 'A imagem do céu é pequena demais para iluminar a cena.'; return null; }
  const prevRT = r.getRenderTarget();
  const prevAuto = r.autoClear;
  try {
    return gen.fromEquirectangular(tex);
  } catch (err) {
    console.error('[Sky] Falha ao gerar a iluminação do céu:', err);
    _envError = 'Não foi possível gerar a iluminação deste céu.';
    return null;
  } finally {
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
  }
}

// ── Aplicação ao three.js ───────────────────────────────────────────────

function _activeTexture() {
  if (state.mode === 'gradient') return _gradTex;
  if (state.mode === 'image') return _imageTex;
  return null;
}

function _applyBackground() {
  const scene = app.scene;
  if (!scene) return;
  const mul = ev2mul(state.exposure);
  const tex = _activeTexture();
  scene.background = tex || new THREE.Color(state.color).multiplyScalar(mul);
  scene.backgroundIntensity = mul;
  scene.backgroundBlurriness = state.blur;
  const rad = THREE.MathUtils.degToRad(state.rotation);
  scene.backgroundRotation?.set(0, rad, 0);
  scene.environmentRotation?.set(0, rad, 0);
}

function _applyEnvironment() {
  const scene = app.scene;
  if (!scene) return;
  scene.environmentIntensity = state.envIntensity;
  _envError = '';

  const tex = _activeTexture();
  if (state.lighting && tex) {
    const key = `${tex.uuid}:${tex.version}`;
    if (!_envRT || _envKey !== key) {
      const rt = _makeEnvironment(tex);
      if (rt) { _disposeEnv(); _envRT = rt; _envKey = key; }
      else if (!_envRT) {
        // Falhou e não há ambiente anterior: desliga a opção em vez de deixar
        // a cena num estado inconsistente.
        state.lighting = false;
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
  // A intensidade é só um número (barata): vale na hora, mesmo com o PMREM esperando.
  if (app.scene) app.scene.environmentIntensity = state.envIntensity;
  clearTimeout(_envTimer);
  if (soon && state.lighting) {
    _envTimer = setTimeout(() => { _applyEnvironment(); markSceneDirty(); syncUI(); }, 180);
  } else {
    _applyEnvironment();
  }
  markSceneDirty();
  syncUI();
}

// ── API pública: estado ─────────────────────────────────────────────────

export function getSkyState() { return { ...state }; }

export function setSky(patch, opts) {
  const next = sanitize({ ...state, ...patch });
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
  _loadToken++;                           // cancela um download em andamento
  _setStatus({ busy: false, text: '', pct: 0, error: '' });
  setSky({ ...vals, lighting: false });   // mantém exposição/rotação, troca o céu
}

export function resetSky() {
  _loadToken++;
  _clearImage();
  _lastProcedural = 'color';
  state = { ...SKY_DEFAULTS };
  _setStatus({ busy: false, text: '', pct: 0, error: '' });
  applyAll();
  _persist();
}

// ── Imagem / HDRI ───────────────────────────────────────────────────────

function _clearImage() {
  if (_imageOwned) _imageTex?.dispose();
  _imageTex = null; _imageOwned = false; _imageMeta = null;
  _disposeEnv();
}

function _useImage(tex, meta, { owned = false, lighting = true } = {}) {
  if (_imageOwned && _imageTex && _imageTex !== tex) _imageTex.dispose();
  tex.mapping = THREE.EquirectangularReflectionMapping;
  _imageTex = tex; _imageOwned = owned; _imageMeta = meta;
  _disposeEnv();
  setSky({ mode: 'image', lighting });
}

async function _textureFromUrl(url, onProgress) {
  const path = new URL(url, location.href).pathname.toLowerCase();
  const prog = (e) => { if (e?.lengthComputable && e.total) onProgress?.(e.loaded / e.total); };
  if (path.endsWith('.hdr')) {
    const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
    return new Promise((res, rej) => new RGBELoader().load(url, res, prog, rej));
  }
  if (path.endsWith('.exr')) {
    const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
    return new Promise((res, rej) => new EXRLoader().load(url, res, prog, rej));
  }
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const tex = await new Promise((res, rej) => loader.load(url, res, prog, rej));
  tex.colorSpace = THREE.SRGBColorSpace;      // imagens LDR vêm em sRGB
  return tex;
}

function _friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (/404|not found/i.test(msg)) return 'Arquivo não encontrado nesse endereço.';
  return 'Não foi possível baixar. Verifique a conexão ou use “Carregar arquivo”.';
}

function _cacheTexture(url, tex) {
  _hdriCache.set(url, tex);
  while (_hdriCache.size > 3) {
    const [oldKey, oldTex] = _hdriCache.entries().next().value;
    _hdriCache.delete(oldKey);
    if (oldTex !== _imageTex) oldTex.dispose();
  }
}

/** Baixa e aplica um céu a partir de uma URL (HDR, EXR ou imagem). */
export async function loadSkyFromUrl(url, meta = {}, opts = {}) {
  if (!isHttpUrl(url)) { _setStatus({ busy: false, text: '', pct: 0, error: 'Endereço inválido.' }); return false; }
  const token = ++_loadToken;
  const label = meta.name || 'céu';
  _setStatus({ busy: true, text: `Baixando ${label}…`, pct: 0, error: '' });
  try {
    let tex = _hdriCache.get(url);
    if (tex) { _hdriCache.delete(url); _hdriCache.set(url, tex); }   // marca como recente
    else {
      tex = await _textureFromUrl(url, (p) => {
        if (token === _loadToken) _setStatus({ busy: true, text: `Baixando ${label}…`, pct: p, error: '' });
      });
      _cacheTexture(url, tex);
    }
    if (token !== _loadToken) return false;          // o usuário já escolheu outra coisa
    _useImage(tex, { name: label, thumb: meta.thumb, online: meta.online || { url } }, { lighting: opts.lighting ?? true });
    _setStatus({ busy: false, text: '', pct: 0, error: '' });
    return true;
  } catch (err) {
    console.error('[Sky] Falha ao carregar o céu:', err);
    if (token === _loadToken) _setStatus({ busy: false, text: '', pct: 0, error: _friendlyError(err) });
    return false;
  }
}

export function loadHdriPreset(id, res = _hdriRes, opts) {
  const p = HDRI_PRESETS.find((x) => x.id === id);
  if (!p) return Promise.resolve(false);
  return loadSkyFromUrl(hdriUrl(id, res), {
    name: p.label, thumb: hdriThumb(id), online: { id, res, url: hdriUrl(id, res) },
  }, opts);
}

/** Arquivo local (.hdr / .exr / imagem). */
export async function loadSkyImage(file) {
  const url = URL.createObjectURL(file);
  _loadToken++;
  try {
    const name = file.name.toLowerCase();
    let tex;
    if (name.endsWith('.hdr')) {
      const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
      tex = await new Promise((res, rej) => new RGBELoader().load(url, res, undefined, rej));
    } else if (name.endsWith('.exr')) {
      const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
      tex = await new Promise((res, rej) => new EXRLoader().load(url, res, undefined, rej));
    } else {
      tex = await new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    // Miniatura só para imagens comuns (HDR/EXR não abrem num <img>).
    const thumb = /\.(png|jpe?g|webp)$/.test(name) ? URL.createObjectURL(file) : '';
    _useImage(tex, { name: file.name, thumb }, { owned: true });
    _setStatus({ busy: false, text: '', pct: 0, error: '' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function removeSkyImage() {
  _loadToken++;
  _clearImage();
  _setStatus({ busy: false, text: '', pct: 0, error: '' });
  setSky({ mode: _lastProcedural === 'image' ? 'color' : _lastProcedural, lighting: false });
}

// ── Projeto / persistência ──────────────────────────────────────────────

/** HDRI online vai para o arquivo (só o endereço); upload local não (pesado). */
export function serializeSky() {
  const out = { ...state };
  const online = _imageMeta?.online;
  if (state.mode === 'image' && online) {
    out.hdri = { ...online, name: _imageMeta.name };
  } else if (state.mode === 'image') {
    out.mode = _lastProcedural; out.lighting = false;
  }
  return out;
}

export function restoreSky(data) {
  if (!data || typeof data !== 'object') return;
  _loadToken++;
  _clearImage();
  const wantsImage = data.mode === 'image' && data.hdri && isHttpUrl(data.hdri.url);
  state = sanitize(data);
  if (state.mode === 'image') state.mode = 'color';
  _lastProcedural = state.mode;
  applyAll();
  _persist();
  if (wantsImage) {
    const h = data.hdri;
    if (HDRI_RESOLUTIONS.includes(h.res)) _hdriRes = h.res;
    loadSkyFromUrl(h.url, {
      name: h.name || 'céu', thumb: h.id ? hdriThumb(h.id) : '', online: { id: h.id, res: h.res, url: h.url },
    }, { lighting: !!data.lighting });
  }
}

/** Projetos antigos só guardavam a cor de fundo. */
export function restoreLegacySkyColor(hex) {
  if (!isHex(hex)) return;
  setSky({ mode: 'color', color: hex });
}

function _persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSky())); } catch { /* sem storage */ }
}

function _loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const o = JSON.parse(raw); return { state: sanitize(o), hdri: o.hdri || null, mode: o.mode }; }
    // Migra a cor de fundo que o menu Configurações guardava antes.
    const legacy = JSON.parse(localStorage.getItem('ncm-settings') || '{}');
    if (isHex(legacy.bgColor)) return { state: sanitize({ color: legacy.bgColor }), hdri: null, mode: 'color' };
  } catch { /* ignora */ }
  return null;
}

// ── UI ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function _setStatus(next) {
  _status = { ..._status, ...next };
  _syncStatus();
}

function _syncStatus() {
  const box = $('skyHdriStatus');
  if (!box) return;
  const { busy, text, pct, error } = _status;
  box.classList.toggle('hidden', !busy && !error);
  box.classList.toggle('error', !!error && !busy);
  const label = $('skyHdriStatusText');
  if (label) label.textContent = busy ? `${text} ${pct > 0 ? Math.round(pct * 100) + '%' : ''}`.trim() : error;
  const bar = $('skyHdriBar');
  if (bar) {
    bar.parentElement.classList.toggle('hidden', !busy);
    bar.style.width = busy ? `${Math.max(4, Math.round(pct * 100))}%` : '0%';
  }
  $('skyHdriGrid')?.classList.toggle('busy', busy);
}

function _previewInfo() {
  if (state.mode === 'image' && _imageMeta) return { name: _imageMeta.name, kind: _imageMeta.online ? 'HDRI online' : 'HDRI / imagem' };
  if (state.mode === 'gradient') {
    const p = SKY_PRESETS.find((x) => x.mode === 'gradient' && x.gradTop === state.gradTop && x.gradMid === state.gradMid && x.gradBottom === state.gradBottom);
    return { name: p ? p.label : 'Personalizado', kind: 'Gradiente' };
  }
  const p = SKY_PRESETS.find((x) => x.mode === 'color' && x.color === state.color);
  return { name: p ? p.label : state.color.toUpperCase(), kind: 'Cor sólida' };
}

function _syncPreview() {
  const el = $('skyPreview');
  if (!el) return;
  const info = _previewInfo();
  if ($('skyPreviewName')) $('skyPreviewName').textContent = info.name;
  if ($('skyPreviewMode')) $('skyPreviewMode').textContent = info.kind;

  el.style.backgroundRepeat = 'no-repeat';
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  if (state.mode === 'image') {
    const tint = HDRI_PRESETS.find((x) => x.id === _imageMeta?.online?.id)?.tint || '#59616c';
    if (_imageMeta?.thumb) {
      // Miniatura 2:1 repetida na horizontal: girar o céu "rola" a imagem.
      const h = el.clientHeight || 64;
      el.style.backgroundImage = `url("${_imageMeta.thumb}")`;
      el.style.backgroundColor = tint;
      el.style.backgroundRepeat = 'repeat-x';
      el.style.backgroundSize = 'auto 100%';
      el.style.backgroundPosition = `${-(state.rotation / 360) * h * 2}px center`;
    } else {
      el.style.backgroundImage = `linear-gradient(180deg, ${tint} 0%, #2a3038 100%)`;
    }
  } else if (state.mode === 'gradient') {
    el.style.backgroundImage = `linear-gradient(180deg, ${state.gradTop} 0%, ${state.gradMid} ${Math.round(state.gradHorizon * 100)}%, ${state.gradBottom} 100%)`;
  } else {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = state.color;
  }
  // Exposição e desfoque aparecem na miniatura em tempo real.
  const blur = state.mode === 'color' ? 0 : state.blur * 4;
  el.style.filter = `brightness(${clamp(ev2mul(state.exposure), 0.1, 4)})${blur ? ` blur(${blur}px)` : ''}`;
}

function syncUI() {
  if (!$('skyPanel')) return;
  _syncPreview();

  document.querySelectorAll('#skyModeSeg .rhSeg').forEach((b) =>
    b.classList.toggle('active', b.dataset.skyMode === state.mode));
  $('skyColorGroup')?.classList.toggle('hidden', state.mode === 'gradient');
  $('skyGradGroup')?.classList.toggle('hidden', state.mode !== 'gradient');
  $('skyImageActiveHint')?.classList.toggle('hidden', state.mode !== 'image');

  const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  set('skyColor', state.color);
  set('skyGradTop', state.gradTop); set('skyGradMid', state.gradMid); set('skyGradBottom', state.gradBottom);
  set('skyGradHorizon', state.gradHorizon); set('skyGradHorizonN', state.gradHorizon);
  set('skyExposure', state.exposure);  set('skyExposureN', state.exposure.toFixed(1));
  set('skyRotation', state.rotation);  set('skyRotationN', Math.round(state.rotation));
  set('skyBlur', state.blur);          set('skyBlurN', state.blur.toFixed(2));
  set('skyEnvIntensity', state.envIntensity); set('skyEnvIntensityN', state.envIntensity.toFixed(2));
  set('skyHdriQuality', _hdriRes);
  if ($('skyLighting')) $('skyLighting').checked = state.lighting;

  const textured = state.mode !== 'color';
  const imgName = $('skyImageName');
  if (imgName) imgName.textContent = _imageTex ? (_imageMeta?.name || 'Imagem carregada') : 'Nenhuma imagem carregada';
  $('skyImageRemove')?.toggleAttribute('disabled', !_imageTex);

  ['skyBlur', 'skyBlurN', 'skyRotation', 'skyRotationN', 'skyLighting'].forEach((id) => {
    const el = $(id); if (el) el.disabled = !textured;
  });
  ['skyEnvIntensity', 'skyEnvIntensityN'].forEach((id) => {
    const el = $(id); if (el) el.disabled = !(textured && state.lighting);
  });
  $('skyTexturedHint')?.classList.toggle('hidden', textured);
  const lh = $('skyLightHint');
  if (lh) { lh.textContent = _envError; lh.classList.toggle('hidden', !_envError); }

  document.querySelectorAll('.skyPreset').forEach((b) => {
    const p = SKY_PRESETS.find((x) => x.id === b.dataset.preset);
    const on = p && state.mode !== 'image' && p.mode === state.mode &&
      (p.mode === 'color' ? p.color === state.color
        : p.gradTop === state.gradTop && p.gradMid === state.gradMid && p.gradBottom === state.gradBottom);
    b.classList.toggle('active', !!on);
  });
  const activeId = state.mode === 'image' ? _imageMeta?.online?.id : null;
  document.querySelectorAll('.skyHdri').forEach((b) =>
    b.classList.toggle('active', !!activeId && b.dataset.hdri === activeId));
  _syncStatus();
}

function _selectTab(name) {
  document.querySelectorAll('#skyTabs .skyTabBtn').forEach((b) => b.classList.toggle('active', b.dataset.skyTab === name));
  document.querySelectorAll('#skyPanel .skyTabPanel').forEach((p) => p.classList.toggle('hidden', p.dataset.skyTab !== name));
}

function _bindPair(rangeId, numId, key, { soon = true } = {}) {
  const handler = (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    setSky({ [key]: v }, { soon });
  };
  $(rangeId)?.addEventListener('input', handler);
  $(numId)?.addEventListener('input', handler);
}

function _buildPresetButtons() {
  const sky = $('skyPresets');
  if (sky && !sky.children.length) {
    SKY_PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'skyPreset'; b.dataset.preset = p.id; b.title = p.label;
      b.style.background = p.mode === 'color'
        ? p.color
        : `linear-gradient(180deg, ${p.gradTop} 0%, ${p.gradMid} ${Math.round(p.gradHorizon * 100)}%, ${p.gradBottom} 100%)`;
      const span = document.createElement('span'); span.textContent = p.label;
      b.appendChild(span);
      b.addEventListener('click', () => applySkyPreset(p.id));
      sky.appendChild(b);
    });
  }
  const grid = $('skyHdriGrid');
  if (grid && !grid.children.length) {
    HDRI_PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'skyHdri'; b.dataset.hdri = p.id;
      b.title = `${p.label} — Poly Haven (CC0)`;
      b.style.backgroundColor = p.tint;
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = ''; img.src = hdriThumb(p.id);
      img.addEventListener('error', () => img.remove());      // sem rede: fica a cor + nome
      const span = document.createElement('span'); span.textContent = p.label;
      b.append(img, span);
      b.addEventListener('click', () => loadHdriPreset(p.id));
      grid.appendChild(b);
    });
  }
}

function _bindUI() {
  _buildPresetButtons();

  document.querySelectorAll('#skyTabs .skyTabBtn').forEach((b) =>
    b.addEventListener('click', () => _selectTab(b.dataset.skyTab)));
  _selectTab('bg');

  document.querySelectorAll('#skyModeSeg .rhSeg').forEach((b) =>
    b.addEventListener('click', () => { _loadToken++; _setStatus({ busy: false, text: '', pct: 0 }); setSky({ mode: b.dataset.skyMode }); }));

  for (const [id, key] of [['skyColor', 'color'], ['skyGradTop', 'gradTop'], ['skyGradMid', 'gradMid'], ['skyGradBottom', 'gradBottom']]) {
    $(id)?.addEventListener('input', (e) => setSky({ [key]: e.target.value }, { soon: true }));
  }
  _bindPair('skyGradHorizon', 'skyGradHorizonN', 'gradHorizon');
  _bindPair('skyExposure', 'skyExposureN', 'exposure');
  _bindPair('skyRotation', 'skyRotationN', 'rotation');
  _bindPair('skyBlur', 'skyBlurN', 'blur');
  _bindPair('skyEnvIntensity', 'skyEnvIntensityN', 'envIntensity');
  $('skyLighting')?.addEventListener('change', (e) => setSky({ lighting: e.target.checked }));

  $('skyHdriQuality')?.addEventListener('change', (e) => {
    if (!HDRI_RESOLUTIONS.includes(e.target.value)) return;
    _hdriRes = e.target.value;
    // Se um HDRI online está ativo, recarrega na nova resolução.
    const id = state.mode === 'image' ? _imageMeta?.online?.id : null;
    if (id) loadHdriPreset(id, _hdriRes, { lighting: state.lighting });
  });

  const urlInput = $('skyUrl');
  const loadUrl = () => {
    const u = (urlInput?.value || '').trim();
    if (!u) return;
    if (!isHttpUrl(u)) { _setStatus({ busy: false, text: '', pct: 0, error: 'Endereço inválido.' }); return; }
    const nm = decodeURIComponent(new URL(u).pathname.split('/').pop() || 'céu');
    loadSkyFromUrl(u, { name: nm, online: { url: u } });
  };
  $('skyUrlLoad')?.addEventListener('click', loadUrl);
  urlInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUrl(); });

  const file = $('skyFile'), up = $('skyImageUpload');
  up?.addEventListener('click', () => file?.click());
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const label = up.textContent;
    up.textContent = 'Carregando…'; up.disabled = true;
    try { await loadSkyImage(f); }
    catch (err) {
      console.error('[Sky] falha ao carregar arquivo:', err);
      _setStatus({ busy: false, text: '', pct: 0, error: `Erro ao abrir o arquivo: ${err?.message || err}` });
    } finally { up.disabled = false; up.textContent = label; file.value = ''; }
  });
  $('skyImageRemove')?.addEventListener('click', removeSkyImage);
  $('skyReset')?.addEventListener('click', resetSky);
}

export function initSky() {
  if (_inited || !app.scene) return;
  _inited = true;

  const saved = _loadPersisted();
  if (saved) state = saved.state;
  else if (app.scene.background instanceof THREE.Color) {
    state = sanitize({ color: '#' + app.scene.background.getHexString() });
  }
  const hdri = saved?.hdri && saved.mode === 'image' && isHttpUrl(saved.hdri.url) ? saved.hdri : null;
  if (state.mode === 'image') state.mode = 'color';
  _lastProcedural = state.mode;

  _bindUI();
  applyAll();
  if (hdri) {
    if (HDRI_RESOLUTIONS.includes(hdri.res)) _hdriRes = hdri.res;
    loadSkyFromUrl(hdri.url, {
      name: hdri.name || 'céu', thumb: hdri.id ? hdriThumb(hdri.id) : '', online: { id: hdri.id, res: hdri.res, url: hdri.url },
    }, { lighting: saved.state.lighting });
  }
}
