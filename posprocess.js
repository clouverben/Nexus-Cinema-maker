import * as THREE from 'three';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { HalftonePass } from 'three/addons/postprocessing/HalftonePass.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { app, markSceneDirty, setHelperVisibility, applyShadowQuality } from './scene.js';
import { renderState, PostProcessShader, syncPostShader, TONE_MAPPING_MAP } from './shader.js';

const PATH_TRACER_URL =
  'https://cdn.jsdelivr.net/npm/three-gpu-pathtracer@0.0.24/build/index.module.js';

// ─────────────────────────────────────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────────────────────────────────────

let composer = null;
let renderPass = null;
let bloomPass = null;
let gradePass = null;
let outputPass = null; // final pass: applies renderer.toneMapping/toneMappingExposure exactly once, on the fully composited HDR image — see ensureComposer() for why this replaced baking tone mapping into RenderPass's materials directly.

// Per-object selective bloom
let objBloomPass = null;
let objBloomComposer = null;  // second composer: renders only selected mesh + bloom
let selectiveMixPass = null;  // final pass in main composer: adds selective bloom texture

let ssaoPass = null;
let gtaoPass = null;
let taaPass = null;
let filmPass = null;
let halftonePass = null;
let pixelatedPass = null;
let bokehPass = null;
let outlinePass = null;

let initialized = false;

let lastW = 0;
let lastH = 0;

let pathTracer = null;
let pathTracerModule = null;
let pathTracerLoadPromise = null;

export let currentSampleCount = 0;

let lastCamPos = new THREE.Vector3();
let lastCamQuat = new THREE.Quaternion();

// Visualization override
let _visOverrideMat = null;

// Layers
export const activeLayers = new Set();

// Configs
export const layerConfig = {
  outline: { strength: 4, glow: 0.35, thickness: 0.2 },
  film: { noise: 0.35, scanlines: 0.5, grayscale: false },
  bokeh: { focus: 1.0, aperture: 0.0025, maxblur: 0.01 },
  pixelated: { pixelSize: 4 }
};

// Selection outline — the highlight drawn around whatever object is
// currently selected (distinct from the toggleable "Outline" layer effect
// above, which shares the same OutlinePass but is opt-in via the Efeitos
// tab). Controlled from Configurações → Viewport.
export const outlineConfig = {
  enabled: true,
  color: '#ffb14a'   // --accent-orange — same as GIZMO_COLOR_SELECTED in cameras.js
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function patchSceneForPT(scene) {
  if (!scene) return;

  if (!scene.backgroundRotation || !(scene.backgroundRotation instanceof THREE.Euler)) {
    Object.defineProperty(scene, 'backgroundRotation', {
      value: new THREE.Euler(),
      configurable: true,
      writable: true
    });
  }

  if (!scene.environmentRotation || !(scene.environmentRotation instanceof THREE.Euler)) {
    Object.defineProperty(scene, 'environmentRotation', {
      value: new THREE.Euler(),
      configurable: true,
      writable: true
    });
  }

  if (scene.background === undefined) scene.background = null;
  if (scene.environment === undefined) scene.environment = null;
}

function cameraMoved() {
  if (!app.camera) return false;

  const moved =
    !app.camera.position.equals(lastCamPos) ||
    !app.camera.quaternion.equals(lastCamQuat);

  if (moved) {
    lastCamPos.copy(app.camera.position);
    lastCamQuat.copy(app.camera.quaternion);
  }

  return moved;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTIVE BLOOM SHADER (additive mix of per-object bloom over main frame)
// ─────────────────────────────────────────────────────────────────────────────

const SelectiveBloomMixShader = {
  uniforms: {
    tDiffuse:     { value: null },
    bloomTexture: { value: null },
    bloomActive:  { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTexture;
    uniform float bloomActive;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (bloomActive > 0.5) {
        vec3 bloom = texture2D(bloomTexture, vUv).rgb;
        vec3 sum = base.rgb + bloom;
        // Soft highlight roll-off instead of a hard clip: a plain base+bloom
        // sum clips abruptly wherever it crosses 1.0, which reads as a harsh
        // ring around the glow instead of a smooth falloff. Blending toward
        // a mild Reinhard curve only in the region that would've clipped
        // keeps the core of a genuinely bright light punchy while letting
        // its edge fade out instead of hitting a wall.
        vec3 soft = sum / (1.0 + max(sum - 1.0, 0.0));
        gl_FragColor = vec4(soft, base.a);
      } else {
        gl_FragColor = base;
      }
    }
  `
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSER
// ─────────────────────────────────────────────────────────────────────────────

function ensureComposer() {
  if (!app.renderer || !app.scene || !app.camera) return false;
  if (composer) return true;

  const w = window.innerWidth;
  const h = window.innerHeight;

  // Half-float render targets instead of the default 8-bit ones: bloom's
  // bright-pass extraction and blur both clip/band hard on 8-bit color, which
  // is the main reason self-bloom on a small/bright emissive object tends to
  // look chunky or crushed at the edges instead of a smooth falloff. HDR
  // targets fix that at essentially no extra cost for a viewport-sized buffer.
  const makeHDRTarget = (rw, rh) => new THREE.WebGLRenderTarget(rw, rh, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });

  composer = new EffectComposer(app.renderer, makeHDRTarget(w, h));

  renderPass = new RenderPass(app.scene, app.camera);
  // Base bloom, per request — Roblox's own docs make the same point (their
  // "no bloom" comparison shot is just Threshold cranked to 4, and their
  // own tutorials warn that Threshold 0 = "everything glows, looks
  // terrible"): a high threshold + low strength keeps bloom reserved for
  // genuinely bright/emissive things instead of haloing every particle.
  bloomPass  = new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.4, 1.8);
  gradePass  = new ShaderPass(PostProcessShader);

  // Tone mapping lives HERE, at the very end of the chain, instead of being
  // baked into each material's shader during renderPass above. Doing it
  // early meant the curve was applied to the base image alone, then bloom's
  // own HDR light got added on TOP of that already-compressed result — so
  // switching curves barely changed anything, and bloom highlights could
  // blow straight past the curve's rolloff instead of being shaped by it.
  // OutputPass reads renderer.toneMapping/toneMappingExposure live, so the
  // exact same setToneMappingValue()/setToneMappingExposureValue() setters
  // keep working — only WHERE the curve gets applied has changed.
  outputPass = new OutputPass();

  // ── Per-object selective bloom ("self bloom") ────────────────────────────
  // objBloomComposer renders the scene with non-selected meshes hidden,
  // applies bloom, and stores the result in its read buffer.
  // selectiveMixPass in the main composer blends that result additively.
  // Also HDR — same banding/clipping reasoning, and it matters more here
  // since this is the pass that's actually doing each object's own glow.
  objBloomPass     = new UnrealBloomPass(new THREE.Vector2(w, h), 1.2, 0.55, 0.35);
  objBloomPass.enabled = false;

  objBloomComposer = new EffectComposer(app.renderer, makeHDRTarget(w, h));
  objBloomComposer.renderToScreen = false;
  objBloomComposer.addPass(new RenderPass(app.scene, app.camera));
  objBloomComposer.addPass(objBloomPass);

  selectiveMixPass = new ShaderPass(SelectiveBloomMixShader);
  selectiveMixPass.uniforms.bloomActive.value = 0;

  // Optional passes
  try {
    ssaoPass = new SSAOPass(app.scene, app.camera, w, h);
    ssaoPass.kernelRadius = 8;
    ssaoPass.minDistance = 0.001;
    ssaoPass.maxDistance = 0.12;
    ssaoPass.output = SSAOPass.OUTPUT.Default;
  } catch {
    ssaoPass = null;
  }

  try {
    gtaoPass = new GTAOPass(app.scene, app.camera, w, h);
    if (GTAOPass.OUTPUT?.Default !== undefined) gtaoPass.output = GTAOPass.OUTPUT.Default;
  } catch {
    gtaoPass = null;
  }

  try {
    taaPass = new TAARenderPass(app.scene, app.camera);
    taaPass.unbiased = false;
    taaPass.sampleLevel = 1;
  } catch {
    taaPass = null;
  }

  try {
    filmPass = new FilmPass();
    if (filmPass.uniforms?.nIntensity) filmPass.uniforms.nIntensity.value = layerConfig.film.noise;
    if (filmPass.uniforms?.sIntensity) filmPass.uniforms.sIntensity.value = layerConfig.film.scanlines;
    if (filmPass.uniforms?.grayscale) filmPass.uniforms.grayscale.value = 0;
  } catch {
    filmPass = null;
  }

  try {
    halftonePass = new HalftonePass(w, h, {
      shape: 1,
      radius: 4,
      rotateR: Math.PI / 12,
      rotateG: Math.PI / 6,
      rotateB: Math.PI / 4,
      scatter: 0,
      blending: 1,
      blendingMode: 1,
      greyscale: false,
      disable: false
    });
  } catch {
    halftonePass = null;
  }

  try {
    pixelatedPass = new RenderPixelatedPass(layerConfig.pixelated.pixelSize, app.scene, app.camera);
  } catch {
    pixelatedPass = null;
  }

  try {
    bokehPass = new BokehPass(app.scene, app.camera, {
      focus: layerConfig.bokeh.focus,
      aperture: layerConfig.bokeh.aperture,
      maxblur: layerConfig.bokeh.maxblur,
      width: w,
      height: h
    });
  } catch {
    bokehPass = null;
  }

  try {
    outlinePass = new OutlinePass(new THREE.Vector2(w, h), app.scene, app.camera);
    outlinePass.edgeStrength  = layerConfig.outline.strength;
    outlinePass.edgeGlow      = layerConfig.outline.glow;
    outlinePass.edgeThickness = layerConfig.outline.thickness;
    outlinePass.pulsePeriod   = 0;
    outlinePass.visibleEdgeColor.set(outlineConfig.color);
    outlinePass.hiddenEdgeColor.set('#000000');
    outlinePass.overlayMaterial.blending = THREE.AdditiveBlending;
    outlinePass.selectedObjects = [];
  } catch {
    outlinePass = null;
  }

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);
  composer.addPass(selectiveMixPass);  // additive selective bloom (disabled until obj selected)
  composer.addPass(outputPass);        // tone mapping, applied exactly once, always last

  return true;
}

function buildLayerPasses() {
  const passes = [];

  if (activeLayers.has('ao') && ssaoPass) passes.push(ssaoPass);
  if (activeLayers.has('gtao') && gtaoPass) passes.push(gtaoPass);
  if (activeLayers.has('outline') && outlinePass) passes.push(outlinePass);
  if (activeLayers.has('taa') && taaPass) passes.push(taaPass);
  if (activeLayers.has('bokeh') && bokehPass) passes.push(bokehPass);
  if (activeLayers.has('halftone') && halftonePass) passes.push(halftonePass);
  if (activeLayers.has('pixelated') && pixelatedPass) passes.push(pixelatedPass);
  if (activeLayers.has('film') && filmPass) passes.push(filmPass);

  return passes;
}

function setPipeline(mode) {
  if (!composer) return;

  if (renderPass) {
    renderPass.scene = app.scene;
    renderPass.camera = app.camera;
  }

  if (ssaoPass) {
    ssaoPass.scene = app.scene;
    ssaoPass.camera = app.camera;
  }

  if (taaPass) {
    taaPass.scene = app.scene;
    taaPass.camera = app.camera;
  }

  const layers = buildLayerPasses();
  // Advanced engine (SSAO+SSR+SSGI / Soft Shadows / Volumetric Fog) sits
  // right after the other screen-space layers and before bloom, so bright
  // fog/GI can still bloom. Its own `.enabled` flag (kept in sync by
  // _syncAdvPass) decides whether it actually does anything each frame —
  // EffectComposer skips disabled passes — so it's safe to always include
  // it here once it exists, in every mode that shows the lit scene.
  const adv = _advPass ? [_advPass] : [];

  // EffectComposer only writes to the screen on the LAST pass in this
  // array that's actually enabled that frame — if that happens to be a
  // pass whose `.enabled` can be toggled off (gradePass/bloomPass follow
  // user settings), a frame can render entirely into internal buffers and
  // never reach the canvas, which looks like a black/frozen viewport.
  // selectiveMixPass is never disabled anywhere and its shader is a plain
  // passthrough when bloomActive is 0; outputPass (tone mapping) is never
  // disabled either. Appending both as the true final passes in every
  // branch below guarantees something always reaches the screen AND that
  // tone mapping is applied exactly once, at the very end, everywhere.
  const tail = [selectiveMixPass, outputPass].filter(Boolean);

  if (mode === 'standard') {
    composer.passes = [renderPass, ...layers, ...adv, bloomPass, outlinePass, gradePass, ...tail];
    return;
  }

  if (mode === 'visualization') {
    composer.passes = [renderPass, ...layers, gradePass, ...tail];
    return;
  }

  if (mode === 'baseshot') {
    composer.passes = [renderPass, ...layers, ...tail];
    return;
  }

  composer.passes = [renderPass, ...layers, ...adv, bloomPass, gradePass, ...tail];
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUALIZATION OVERRIDE
// ─────────────────────────────────────────────────────────────────────────────

function buildVisMaterial(visMode) {
  switch (visMode) {
    case 'normals':
      return new THREE.MeshNormalMaterial({ side: THREE.FrontSide });

    case 'wireframe':
      return new THREE.MeshBasicMaterial({ color: 0x4fc3f7, wireframe: true });

    case 'clay':
      return new THREE.MeshStandardMaterial({ color: 0xccaa88, roughness: 0.85, metalness: 0 });

    case 'depth':
      return new THREE.ShaderMaterial({
        uniforms: { cameraNear: { value: 0.1 }, cameraFar: { value: 4000 } },
        vertexShader: `
          varying float vD;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vD = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform float cameraNear, cameraFar;
          varying float vD;
          void main() {
            float d = 1.0 - clamp((vD - cameraNear) / (cameraFar - cameraNear), 0.0, 1.0);
            gl_FragColor = vec4(vec3(d), 1.0);
          }
        `
      });

    default:
      return null;
  }
}

export function setVisualizationMode(visMode) {
  if (_visOverrideMat) {
    _visOverrideMat.dispose();
    _visOverrideMat = null;
  }
  if (visMode) _visOverrideMat = buildVisMaterial(visMode);
  markSceneDirty();
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOTER "LIGHT" BUTTON — a plain, guaranteed-cheap toggle. It does NOT touch
// materials (that broke the Material panel — editing color there was really
// editing a shared override, or losing track of the real material) and does
// NOT drive the GPU path tracer (that library's one-time BVH/shader build is
// synchronous and, on anything but a trivial scene, blocks the main thread
// long enough to look like the whole tab froze — no per-frame scheduling
// trick fixes that, only not calling it here). If you want the real GPU path
// tracer, it's still available on its own in the Avançado tab ("Render
// Físico (GPU)") — a slow first activation there is expected and isolated
// from this button.
// ─────────────────────────────────────────────────────────────────────────────
let lightPreviewActive = false;

export function isLightPreviewActive() {
  return lightPreviewActive;
}

export function setLightPreviewActive(active) {
  lightPreviewActive = !!active;
  document.getElementById('renderLightToggleBtn')?.classList.toggle('active', lightPreviewActive);
  markSceneDirty();
}

// Draws just the grid + axes on top of whatever's already on the canvas
// (the clay "off" preview, or the path-traced frame), without ever handing
// them to the path tracer or the clay override — grid shaders/infinite-plane
// tricks aren't things a BVH path tracer (or a flat clay material) can show
// correctly, so it stays a plain raster overlay instead.
function renderGridOverlay() {
  if (!app.renderer || !app.scene || !app.camera) return;
  const grid = app.gridRoot;
  const axes = app.axesHelper;
  const showGrid = (app._userGridVisible ?? true) && !!grid;
  const showAxes = (app._userAxesVisible ?? true) && !!axes;
  if (!showGrid && !showAxes) return;

  const restore = [];
  app.scene.children.forEach((child) => {
    if (child === grid || child === axes) return;
    if (child.visible) { restore.push(child); child.visible = false; }
  });
  if (grid) grid.visible = showGrid;
  if (axes) axes.visible = showAxes;

  const prevAutoClearColor = app.renderer.autoClearColor;
  const prevAutoClearDepth = app.renderer.autoClearDepth;
  app.renderer.autoClearColor = false; // keep whatever's already drawn
  app.renderer.autoClearDepth = true;  // no competing depth info to test against
  app.renderer.render(app.scene, app.camera);
  app.renderer.autoClearColor = prevAutoClearColor;
  app.renderer.autoClearDepth = prevAutoClearDepth;

  restore.forEach((c) => { c.visible = true; });
  if (grid) grid.visible = false;
  if (axes) axes.visible = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH TRACER
// ─────────────────────────────────────────────────────────────────────────────

async function loadPathTracerModule() {
  if (pathTracerModule) return pathTracerModule;

  if (!pathTracerLoadPromise) {
    pathTracerLoadPromise = import(PATH_TRACER_URL).then(m => {
      pathTracerModule = m;
      return m;
    });
  }

  return pathTracerLoadPromise;
}

async function ensurePathTracer() {
  if (pathTracer) return pathTracer;
  if (!app.renderer || !app.scene || !app.camera) return null;

  try {
    const mod = await loadPathTracerModule();
    const PTClass = mod.WebGLPathTracer ?? mod.default?.WebGLPathTracer ?? mod['WebGLPathTracer'];

    if (!PTClass) return null;

    patchSceneForPT(app.scene);

    pathTracer = new PTClass(app.renderer);

    // IMPORTANT: no black screen
    pathTracer.renderToCanvas = true;

    // Blender-like preview optimization
    pathTracer.dynamicLowRes = true;
    pathTracer.lowResScale = 0.2;

    pathTracer.renderDelay = 0;
    pathTracer.fadeDuration = 160;

    pathTracer.minSamples = 1;
    pathTracer.renderScale = 1.0;

    pathTracer.rasterizeScene = true;
    pathTracer.synchronizeRenderSize = true;

    pathTracer.setScene(app.scene, app.camera);
    _applyGpuPathTracerControls();
    pathTracer.reset();

    currentSampleCount = 0;
    lastCamPos.copy(app.camera.position);
    lastCamQuat.copy(app.camera.quaternion);

    return pathTracer;
  } catch (e) {
    console.warn('[PathTracer] Failed:', e);
    return null;
  }
}

// Exposes the live pathTracer instance to the UI layer without exporting the
// module-private variable itself.
function getPathTracerInstance() {
  return pathTracer;
}

// Push every "Render Físico (GPU)" panel control straight onto the live
// WebGLPathTracer instance (three-gpu-pathtracer), AND keep renderState.path
// in sync so the values survive a tracer being torn down/recreated (e.g.
// after a scene reload) instead of falling back to hardcoded defaults.
function _applyGpuPathTracerControls() {
  const num = (id, fallback) => {
    const el = document.getElementById(id);
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) ? v : fallback;
  };
  const p = renderState.path;
  p.filterGlossyFactor = clamp(num('gpt-filterGlossy', p.filterGlossyFactor), 0, 1);
  p.tilesX             = clamp(num('gpt-tilesX', p.tilesX), 1, 8);
  p.tilesY             = clamp(num('gpt-tilesY', p.tilesY), 1, 8);
  p.renderScale        = clamp(num('gpt-renderScale', p.renderScale), 0.1, 1);
  p.minSamples         = clamp(num('gpt-minSamples', p.minSamples), 1, 128);
  p.lowResScale        = clamp(num('gpt-lowResScale', p.lowResScale), 0.05, 1);
  p.dynamicLowRes       = !!document.getElementById('gpt-dynamicLowRes')?.checked;

  if (!pathTracer) return;
  pathTracer.filterGlossyFactor = p.filterGlossyFactor;
  pathTracer.tiles?.set(p.tilesX, p.tilesY);
  pathTracer.renderScale = p.renderScale;
  pathTracer.minSamples = p.minSamples;
  pathTracer.lowResScale = p.lowResScale;
  pathTracer.dynamicLowRes = p.dynamicLowRes;
  pathTracer.reset?.();
}

// Fills the panel's inputs from renderState.path so re-opening the tab (or
// loading a project that already had these values set) shows the truth
// instead of the hardcoded HTML defaults.
function _reflectGpuPathTracerControls() {
  const p = renderState.path;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('gpt-bounces',      p.bounces);
  set('gpt-filterGlossy', p.filterGlossyFactor);
  set('gpt-tilesX',       p.tilesX);
  set('gpt-tilesY',       p.tilesY);
  set('gpt-renderScale',  p.renderScale);
  set('gpt-minSamples',   p.minSamples);
  set('gpt-lowResScale',  p.lowResScale);
  const dlr = document.getElementById('gpt-dynamicLowRes');
  if (dlr) dlr.checked = !!p.dynamicLowRes;
}

function getSamplesTarget() {
  const s = renderState.samples || {};
  return clamp(int(s.samples ?? s.targetSamples ?? 64, 64), 1, 8192);
}

function getSubSamples() {
  const s = renderState.samples || {};
  return clamp(int(s.subSamples ?? 1, 1), 1, 32);
}

// Blender preset mapping
function applyTracerPreset(mode) {
  if (!pathTracer) return;

  const baseSamples = getSamplesTarget();

  // preview (raytracing)
  if (mode === 'raytracing') {
    pathTracer.bounces = 2;
    pathTracer.filterGlossyFactor = 0.12;
    pathTracer.tiles.set(1, 1);

    pathTracer.dynamicLowRes = true;
    pathTracer.lowResScale = 0.22;

    pathTracer.minSamples = 1;
    pathTracer.renderScale = 0.9;

    // preview doesn't need 500 samples
    renderState.samples.targetSamples = Math.min(baseSamples, 64);
    return;
  }

  // final (pathtracing) — reads from renderState.path, which the "Path
  // Tracer Real" panel keeps in sync with its own fields (see
  // _applyGpuPathTracerControls below), so re-creating the tracer never falls back
  // to stale hardcoded defaults.
  if (mode === 'pathtracing') {
    const p = renderState.path || {};
    pathTracer.bounces = clamp(int(p.bounces ?? 10, 10), 1, 64);
    pathTracer.filterGlossyFactor = clamp(num(p.filterGlossyFactor ?? 0.35, 0.35), 0, 1);
    pathTracer.tiles.set(
      clamp(int(p.tilesX ?? 2, 2), 1, 8),
      clamp(int(p.tilesY ?? 2, 2), 1, 8)
    );

    pathTracer.dynamicLowRes = p.dynamicLowRes ?? false;
    pathTracer.lowResScale = clamp(num(p.lowResScale ?? 0.15, 0.15), 0.05, 1);

    pathTracer.minSamples = clamp(int(p.minSamples ?? 2, 2), 1, 128);
    pathTracer.renderScale = clamp(num(p.renderScale ?? 1.0, 1.0), 0.1, 1.0);

    renderState.samples.targetSamples = baseSamples;
    return;
  }
}

function resetTracerIfNeeded() {
  if (!pathTracer) return;

  // Only a REAL topology change (object added/removed/imported, undo/redo)
  // rebuilds the BVH — that's the expensive, synchronous part. `app.sceneDirty`
  // is a generic "please redraw" flag set from ~60 places across the app
  // (every material tweak, every animation/particle tick, plain camera
  // orbiting via other UI, etc.), so treating IT as "rebuild the whole path
  // tracer scene" meant a full BVH rebuild was firing on nearly every frame
  // whenever anything was dirty — that's what was freezing the tab solid the
  // instant path tracing/raytracing turned on with an animation or particle
  // system running (they call markSceneDirty() every tick in render.js).
  if (app._ptTopologyDirty) {
    patchSceneForPT(app.scene);

    pathTracer.setScene(app.scene, app.camera);
    pathTracer.reset();
    app._ptTopologyDirty = false;
    app.sceneDirty = false;

    currentSampleCount = 0;
    lastCamPos.copy(app.camera.position);
    lastCamQuat.copy(app.camera.quaternion);
    return;
  }

  // Cheap path: materials/lights/environment changed (or anything else
  // marked the scene dirty) — just refresh those and restart accumulation,
  // no BVH rebuild. A still path-traced render is what this feature is for;
  // an animation/particle system ticking will simply keep resetting to
  // sample 1 while it plays, which is correct (there's nothing to
  // accumulate against a moving target) and, crucially, cheap enough to not
  // lock up the page doing it.
  if (app.sceneDirty) {
    pathTracer.updateMaterials?.();
    pathTracer.updateLights?.();
    pathTracer.updateEnvironment?.();
    pathTracer.reset();
    app.sceneDirty = false;

    currentSampleCount = 0;
    return;
  }

  if (renderState.samples?.resetOnMove && cameraMoved()) {
    pathTracer.updateCamera?.();
    pathTracer.reset();
    currentSampleCount = 0;
    return;
  }

  pathTracer.updateCamera?.();
}

// ─────────────────────────────────────────────────────────────────────────────
// SIZE + SHADER SYNC
// ─────────────────────────────────────────────────────────────────────────────

function syncPassSizes() {
  if (!app.renderer) return;

  const w = app.renderer.domElement.clientWidth || window.innerWidth;
  const h = app.renderer.domElement.clientHeight || window.innerHeight;

  if (w !== lastW || h !== lastH) {
    lastW = w;
    lastH = h;

    composer?.setSize(w, h);
    objBloomComposer?.setSize(w, h);
    bloomPass?.setSize?.(w, h);
    objBloomPass?.setSize?.(w, h);
    ssaoPass?.setSize?.(w, h);
    gtaoPass?.setSize?.(w, h);

    if (pathTracer?.setSize) pathTracer.setSize(w, h);

    if (bokehPass?.uniforms?.aspect) bokehPass.uniforms.aspect.value = w / h;

    if (halftonePass?.uniforms?.width && halftonePass?.uniforms?.height) {
      halftonePass.uniforms.width.value = w;
      halftonePass.uniforms.height.value = h;
    }
  }

  if (gradePass) syncPostShader(gradePass);
}

function updateComposerValues() {
  if (!bloomPass || !gradePass) return;

  bloomPass.enabled = !!renderState.bloom?.enabled;
  bloomPass.threshold = num(renderState.bloom?.threshold, bloomPass.threshold);
  bloomPass.strength = num(renderState.bloom?.strength, bloomPass.strength);
  bloomPass.radius = num(renderState.bloom?.radius, bloomPass.radius);

  gradePass.enabled = !!renderState.post?.enabled;
  syncPostShader(gradePass);

  // Tone mapping: apply whatever renderState.post already says (its default
  // is 'ACESFilmic', matching the UI's default selection) onto the live
  // renderer — needed because scene.js now boots the renderer at
  // NoToneMapping (OutputPass applies the real curve; see there for why),
  // so without this the very first frame would show flat/raw HDR until the
  // person touched the Tone Mapping control at least once.
  if (app.renderer) {
    app.renderer.toneMapping = TONE_MAPPING_MAP[renderState.post?.toneMapping] ?? THREE.ACESFilmicToneMapping;
    app.renderer.toneMappingExposure = num(renderState.post?.toneMappingExposure, 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI SAMPLE COUNTER
// ─────────────────────────────────────────────────────────────────────────────

function updateSampleCounter() {
  if (pathTracer && typeof pathTracer.samples === 'number') {
    currentSampleCount = pathTracer.samples;
  }

  const target = getSamplesTarget();
  const isTraced =
    renderState.mode === 'raytracing' ||
    renderState.mode === 'pathtracing';

  // Mirror the readout inline in the "Render Físico (GPU)" panel body only —
  // no floating HUD text over the viewport for this anymore.
  const progressEl = document.getElementById('gpt-progress');
  if (progressEl) progressEl.textContent = `${isTraced ? currentSampleCount : 0}/${target} amostras`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export function initPostProcess() {
  if (initialized) return;
  initialized = true;

  ensureComposer();
  updateComposerValues();
  syncPassSizes();
}

export function setRenderModeValue(mode) {
  renderState.mode = mode;

  if (mode !== 'visualization') {
    if (app.renderer) app.renderer.overrideMaterial = null;
    if (_visOverrideMat) {
      _visOverrideMat.dispose();
      _visOverrideMat = null;
    }
  }

  if (mode === 'raytracing' || mode === 'pathtracing') {
    ensurePathTracer().then(() => {
      if (pathTracer) {
        applyTracerPreset(mode);
        pathTracer.reset();
        currentSampleCount = 0;
      }
    });
  }

  ensureComposer();
  setPipeline(mode);
  updateSampleCounter();
}

export function setPostProcessValue(value) {
  renderState.post = renderState.post || {};
  renderState.post.enabled = !!value;
  updateComposerValues();
}

export function setBloomValue(value) {
  renderState.bloom = renderState.bloom || {};
  renderState.bloom.enabled = !!value;
  updateComposerValues();
}

// ─── Per-object bloom ────────────────────────────────────────────────────────
// ─── Per-object persistent bloom ─────────────────────────────────────────────
// Each object stores bloom in obj.userData.bloom = {enabled, threshold, strength, radius}.
// _renderSelectiveBloom() scans ALL scene objects every frame so bloom persists
// even after deselecting.

export function setObjBloomField(obj, key, value) {
  if (!obj) return;
  obj.userData.bloom = obj.userData.bloom || {};
  obj.userData.bloom[key] = value;
  markSceneDirty();
}

export function getObjBloom(obj) {
  const b = obj?.userData?.bloom || {};
  return {
    enabled:   !!b.enabled,
    threshold: b.threshold ?? 0.5,
    strength:  b.strength  ?? 1.2,
    radius:    b.radius    ?? 0.4,
  };
}

function _collectBloomedMeshes() {
  const bloomed = new Set();
  app.scene.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    let node = o;
    while (node) {
      if (node.userData?.bloom?.enabled) { bloomed.add(o); return; }
      node = node.parent;
    }
  });
  return bloomed;
}

function _renderSelectiveBloom() {
  if (!objBloomPass || !objBloomComposer || !selectiveMixPass) return;

  const bloomed = _collectBloomedMeshes();

  if (bloomed.size === 0) {
    selectiveMixPass.uniforms.bloomActive.value = 0;
    objBloomPass.enabled = false;
    return;
  }

  // Merge params for the ONE shared UnrealBloomPass run below: lowest
  // threshold (so nothing configured to glow gets cut) and the largest
  // radius/strength in the scene.
  let threshold = Infinity, maxStrength = 0, radius = 0;
  app.scene.traverse((o) => {
    if (!o.userData?.bloom?.enabled) return;
    const b = o.userData.bloom;
    threshold = Math.min(threshold, b.threshold ?? 0.5);
    maxStrength = Math.max(maxStrength, b.strength ?? 1.2);
    radius = Math.max(radius, b.radius ?? 0.4);
  });
  objBloomPass.threshold = threshold === Infinity ? 0.5 : threshold;
  objBloomPass.strength  = maxStrength;
  objBloomPass.radius    = radius;

  // Hide every mesh NOT in the bloomed set. Also — this is the actual
  // quality fix — scale each bloomed mesh's OWN emissive/color brightness
  // relative to its own configured Strength vs. the strongest one in the
  // scene before this shared pass runs. Previously every glowing object ran
  // through the pass at the single strongest Strength value, so a subtle
  // 0.3-strength glow and an intense 3.0-strength glow came out looking
  // identically bright — this restores each object's own setting relative
  // to the others instead of flattening them all to the loudest one.
  const hidden = [];
  const restore = [];
  app.scene.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh) || !o.visible) return;
    if (!bloomed.has(o)) { o.visible = false; hidden.push(o); return; }

    const rel = maxStrength > 0 ? (o.userData.bloom.strength ?? 1.2) / maxStrength : 1;
    if (rel < 0.999) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        if ('emissiveIntensity' in m) {
          restore.push([m, 'emissiveIntensity', m.emissiveIntensity]);
          m.emissiveIntensity *= rel;
        } else if (m.color) {
          restore.push([m, 'color', m.color.clone()]);
          m.color.multiplyScalar(rel);
        }
      });
    }
  });

  objBloomPass.enabled = true;
  objBloomComposer.render();
  objBloomPass.enabled = false;

  for (const o of hidden) o.visible = true;
  for (const [m, key, v] of restore) m[key] = v;

  selectiveMixPass.uniforms.bloomTexture.value = objBloomComposer.readBuffer.texture;
  selectiveMixPass.uniforms.bloomActive.value  = 1;
}

export function setSamplesValuePost(value) {
  const v = clamp(int(value, 64), 1, 8192);

  renderState.samples = renderState.samples || {};
  renderState.samples.samples = v;
  renderState.samples.targetSamples = v;

  currentSampleCount = 0;
  pathTracer?.reset();
  markSceneDirty();
  updateSampleCounter();
}

export function syncRenderTargets() {
  ensureComposer();
  syncPassSizes();
  updateComposerValues();
}

export async function renderFrame() {
  if (!app.renderer || !app.scene || !app.camera) return;

  syncRenderTargets();

  // While the advanced-engine "Samples & Denoising" accumulator is actively
  // running it drives its own jittered render + progressive blend + present
  // via its own rAF loop (_taa.step()). Letting the normal loop ALSO call
  // composer.render() here would race it and flicker between the two
  // results, so hand off entirely until it's done/paused.
  if (_taa.isActive()) {
    updateSampleCounter();
    return;
  }

  const mode = renderState.mode;

  // Visualization override
  if (activeLayers.has('visualization') && _visOverrideMat) {
    if (_visOverrideMat.uniforms?.cameraNear) {
      _visOverrideMat.uniforms.cameraNear.value = app.camera.near;
      _visOverrideMat.uniforms.cameraFar.value = app.camera.far;
    }
    app.renderer.overrideMaterial = _visOverrideMat;
  } else {
    app.renderer.overrideMaterial = null;
  }

  // STANDARD
  if (mode === 'standard') {
    setHelperVisibility(true);
    setPipeline('standard');
    if (_advPass?.enabled) renderAdvDepth();
    _renderSelectiveBloom();
    composer.render();
    updateSampleCounter();
    return;
  }

  // VISUALIZATION
  if (mode === 'visualization') {
    setHelperVisibility(true);
    setPipeline('visualization');
    composer.render();
    updateSampleCounter();
    return;
  }

  // RAYTRACING / PATHTRACING
  if (mode === 'raytracing' || mode === 'pathtracing') {
    setHelperVisibility(false);

    const tracer = await ensurePathTracer();

    // fallback safe
    if (!tracer) {
      setHelperVisibility(true);
      setPipeline('standard');
      composer.render();
      return;
    }

    applyTracerPreset(mode);
    resetTracerIfNeeded();

    const target = getSamplesTarget();
    const sub = getSubSamples();

    // Blender-like: render N samples per frame, but clamp to avoid freezing
    const maxPerFrame = (mode === 'raytracing') ? 1 : clamp(sub, 1, 8);

    if (currentSampleCount < target) {
      for (let i = 0; i < maxPerFrame; i++) {
        tracer.renderSample();
      }
    }

    currentSampleCount = tracer.samples ?? currentSampleCount;
    renderGridOverlay();
    updateSampleCounter();
    return;
  }

  // fallback
  setHelperVisibility(true);
  setPipeline('standard');
  composer.render();
  updateSampleCounter();
}

export function toggleLayer(layer, force) {
  const on = force !== undefined ? force : !activeLayers.has(layer);

  if (on) activeLayers.add(layer);
  else activeLayers.delete(layer);

  if (!on && layer === 'visualization') {
    if (_visOverrideMat) {
      _visOverrideMat.dispose();
      _visOverrideMat = null;
    }
    if (app.renderer) app.renderer.overrideMaterial = null;
  }

  ensureComposer();
  setPipeline(renderState.mode);
  markSceneDirty();
}

export function setLayerConfig(layer, key, value) {
  if (!layerConfig[layer]) return;
  layerConfig[layer][key] = value;

  if (layer === 'outline' && outlinePass) {
    if (key === 'strength') outlinePass.edgeStrength = value;
    if (key === 'glow') outlinePass.edgeGlow = value;
    if (key === 'thickness') outlinePass.edgeThickness = value;
  }

  if (layer === 'film' && filmPass?.uniforms) {
    if (key === 'noise' && filmPass.uniforms.nIntensity) filmPass.uniforms.nIntensity.value = value;
    if (key === 'scanlines' && filmPass.uniforms.sIntensity) filmPass.uniforms.sIntensity.value = value;
    if (key === 'grayscale' && filmPass.uniforms.grayscale) filmPass.uniforms.grayscale.value = value ? 1 : 0;
  }

  if (layer === 'bokeh' && bokehPass) {
    if (key === 'focus') bokehPass.uniforms.focus.value = value;
    if (key === 'aperture') bokehPass.uniforms.aperture.value = value;
    if (key === 'maxblur') bokehPass.uniforms.maxblur.value = value;
  }

  if (layer === 'pixelated' && pixelatedPass && key === 'pixelSize') {
    if (typeof pixelatedPass.setPixelSize === 'function') pixelatedPass.setPixelSize(value);
  }

  markSceneDirty();
}

export function updateOutlineSelected(object) {
  if (!outlinePass) return;
  if (!outlineConfig.enabled || !object) { outlinePass.selectedObjects = []; return; }
  const meshes = [];
  object.traverse(o => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); });
  outlinePass.selectedObjects = meshes.length ? meshes : [object];
  markSceneDirty();
}

/** Toggles the selection outline on/off — Configurações → Viewport. */
export function setOutlineEnabled(enabled) {
  outlineConfig.enabled = !!enabled;
  updateOutlineSelected(app.selected || null);
}

/** Changes the selection outline color — Configurações → Viewport. */
export function setOutlineColor(hex) {
  outlineConfig.color = hex;
  if (outlinePass) outlinePass.visibleEdgeColor.set(hex);
  markSceneDirty();
}

// ══════════════════════════════════════════════════════════════════════════════
// ── NEXUZ ADVANCED ENGINE — Importado do Nexuz Upgraded ──────────────────────
// Inclui: Path Tracing (SSAO+SSR+SSGI), Path Tracing Blender-like (Monte Carlo),
//         Soft Shadows (PCSS), Samples & Denoising (TAA acumulador), Volumetric Fog
// ══════════════════════════════════════════════════════════════════════════════

// ── Uniforms do engine avançado (expostos como window._advU) ──────────────────
export const _advU = {
    baseTexture:    { value: null },
    tDepth:         { value: null },
    resolution:     { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    cameraNear:     { value: 0.1 },
    cameraFar:      { value: 4000 },
    time:           { value: 0.0 },
    noiseFrame:     { value: 0.0 },
    noiseScale:     { value: 1.0 },
    ptNoiseEnabled: { value: 0.0 },
    // Path Tracing SSAO+SSR+SSGI
    rtEnabled:      { value: 0.0 },
    ssaoRadius:     { value: 0.15 },
    ssaoIntensity:  { value: 1.0 },
    ssaoSamples:    { value: 16.0 },
    ssaoBias:       { value: 0.015 },
    ssrIntensity:   { value: 0.3 },
    ssrSteps:       { value: 32.0 },
    ssrRoughness:   { value: 0.5 },
    giBias:         { value: 0.5 },
    giBounce:       { value: 0.3 },
    // Soft Shadows — real PCSS (Percentage-Closer Soft Shadows) against the
    // scene's actual shadow-casting light. ssLightSize/ssMaxPenumbra are in
    // WORLD units (scene units), not normalized UV fractions.
    ssEnabled:      { value: 0.0 },
    ssLightSize:    { value: 0.4 },
    ssSamples:      { value: 16.0 },
    ssMaxPenumbra:  { value: 2.5 },
    ssSoftness:     { value: 0.8 },
    ssHasLight:     { value: 0.0 },
    ssLightOrtho:   { value: 0.0 },
    ssShadowMap:    { value: null },
    ssShadowMatrix: { value: new THREE.Matrix4() },
    ssCamNear:      { value: 0.5 },
    ssCamFar:       { value: 500.0 },
    ssMapSize:      { value: 1024.0 },
    // Volumetric Fog — real 3D world-space raymarch (height fog + scattering)
    vfEnabled:      { value: 0.0 },
    vfDensity:      { value: 0.4 },
    vfScatter:      { value: 0.5 },
    vfMaxHeight:    { value: 3.0 },
    vfFalloff:      { value: 0.4 },
    vfNoiseScale:   { value: 0.2 },
    vfNoiseSpeed:   { value: 0.15 },
    vfSteps:        { value: 24.0 },
    vfAniso:        { value: 0.35 },
    vfColor:        { value: new THREE.Color(0xc8daf0) },
    vfLightDir:     { value: new THREE.Vector3(0, 1, 0) },
    vfLightColor:   { value: new THREE.Color(0xffffff) },
    vfHasLight:     { value: 0.0 },
    // Camera reconstruction — lets the fragment shader turn a screen pixel
    // back into a real world-space position (needed for world-space fog +
    // light-space shadow lookups).
    cameraWorldMatrix: { value: new THREE.Matrix4() },
    cameraProjInverse: { value: new THREE.Matrix4() },
    cameraPos:          { value: new THREE.Vector3() },
};
window._advU = _advU;

// ── Fragment shader avançado (nexuz engine) ───────────────────────────────────
const _advVertShader = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

const _advFragShader = `
  uniform sampler2D baseTexture;
  uniform sampler2D tDepth;
  uniform vec2  resolution;
  uniform float cameraNear, cameraFar, time;
  uniform float noiseFrame, noiseScale, ptNoiseEnabled;
  uniform float rtEnabled;
  uniform float ssaoRadius, ssaoIntensity, ssaoSamples, ssaoBias;
  uniform float ssrIntensity, ssrSteps, ssrRoughness;
  uniform float giBias, giBounce;

  // Soft Shadows — real PCSS against the scene's shadow-casting light
  uniform float ssEnabled, ssLightSize, ssSamples, ssMaxPenumbra, ssSoftness;
  uniform float ssHasLight, ssLightOrtho, ssCamNear, ssCamFar, ssMapSize;
  uniform sampler2D ssShadowMap;
  uniform mat4 ssShadowMatrix;

  // Volumetric Fog — real world-space raymarch
  uniform float vfEnabled, vfDensity, vfScatter, vfMaxHeight, vfFalloff;
  uniform float vfNoiseScale, vfNoiseSpeed, vfSteps, vfAniso, vfHasLight;
  uniform vec3  vfColor, vfLightDir, vfLightColor;

  // Camera reconstruction (screen UV + depth -> world position)
  uniform mat4 cameraWorldMatrix;
  uniform mat4 cameraProjInverse;
  uniform vec3 cameraPos;

  varying vec2  vUv;

  float linearizeDepth(float d){
    return (2.0*cameraNear)/(cameraFar+cameraNear - d*(cameraFar-cameraNear));
  }
  float readLinearDepth(vec2 uv){ return linearizeDepth(texture2D(tDepth,uv).x); }

  // Same nonlinear->linear remap as above, parameterised for a light's own
  // perspective shadow camera (used by SpotLight PCSS).
  float linearizeShadowDepth(float d, float near, float far){
    return (2.0*near)/(far+near - d*(far-near));
  }

  // Reconstructs the world-space position of the surface behind a screen
  // pixel from its raw depth sample. Standard inverse-projection technique:
  // UV+depth -> NDC -> view space (inverse projection) -> world space
  // (inverse view / camera.matrixWorld).
  vec3 worldPosFromDepth(vec2 uv, float depthRaw){
    vec4 ndc = vec4(uv*2.0-1.0, depthRaw*2.0-1.0, 1.0);
    vec4 viewPos = cameraProjInverse * ndc;
    viewPos /= viewPos.w;
    vec4 worldPos = cameraWorldMatrix * viewPos;
    return worldPos.xyz;
  }

  float hash21(vec2 p){
    p=fract(p*vec2(234.34,435.345)); p+=dot(p,p+34.23); return fract(p.x*p.y);
  }
  float hash21f(vec2 p, float seed){
    p=fract(p*vec2(234.34,435.345)+seed*vec2(17.31,5.17)); p+=dot(p,p+34.23); return fract(p.x*p.y);
  }
  float vnoise(vec2 p){
    vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    float a=hash21(i),b=hash21(i+vec2(1,0)),c=hash21(i+vec2(0,1)),d=hash21(i+vec2(1,1));
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
  }
  float hash31(vec3 p){
    p=fract(p*0.3183099+vec3(0.1,0.2,0.3));
    p*=17.0;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
  }
  /* Trilinear value noise in real 3D world space — used by the fog so it
     stays put in the world instead of swimming with the screen/camera. */
  float noise3D(vec3 p){
    vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float n000=hash31(i+vec3(0.0,0.0,0.0)), n100=hash31(i+vec3(1.0,0.0,0.0));
    float n010=hash31(i+vec3(0.0,1.0,0.0)), n110=hash31(i+vec3(1.0,1.0,0.0));
    float n001=hash31(i+vec3(0.0,0.0,1.0)), n101=hash31(i+vec3(1.0,0.0,1.0));
    float n011=hash31(i+vec3(0.0,1.0,1.0)), n111=hash31(i+vec3(1.0,1.0,1.0));
    return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),
               mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z);
  }

  /* SSAO estocástico — rotação de kernel por noiseFrame */
  float ssao(vec2 uv, float dRaw){
    if(dRaw>0.999) return 1.0;
    float dRef=readLinearDepth(uv);
    vec2 ts=1.0/resolution;
    float occ=0.0;
    float n=max(ssaoSamples,4.0);
    float frameRot=hash21f(uv,noiseFrame)*6.2832;
    for(float i=0.0;i<64.0;i++){
      if(i>=n) break;
      float ang=6.2832*(i/n)+frameRot;
      float r=mix(0.2,1.0,sqrt((i+0.5)/n))*ssaoRadius;
      float rJit=1.0+(hash21f(uv+vec2(i*0.07),noiseFrame)-0.5)*0.4;
      vec2 s=uv+vec2(cos(ang),sin(ang))*r*rJit*ts*72.0;
      s=clamp(s,vec2(0.001),vec2(0.999));
      float sd=readLinearDepth(s);
      float rng=smoothstep(0.0,1.0,ssaoRadius/abs(dRef-sd+0.0001));
      occ+=step(sd+ssaoBias,dRef)*rng;
    }
    return 1.0-(occ/n)*ssaoIntensity;
  }

  /* SSR */
  vec3 ssr(vec2 uv, vec3 base, float dLin){
    if(dLin>0.98) return base;
    vec2 ts=1.0/resolution;
    float dx=readLinearDepth(uv+vec2(ts.x,0.0))-readLinearDepth(uv-vec2(ts.x,0.0));
    float dy=readLinearDepth(uv+vec2(0.0,ts.y))-readLinearDepth(uv-vec2(0.0,ts.y));
    vec3 nrm=normalize(vec3(-dx*resolution.x*0.25,-dy*resolution.y*0.25,1.0));
    vec3 vd=normalize(vec3((uv-0.5)*2.0,-1.5));
    float ssrJit=(hash21f(uv,noiseFrame+7.3)-0.5)*0.008;
    vec3 rd=reflect(vd+vec3(ssrJit,ssrJit,0.0),nrm);
    vec2 step2=rd.xy*0.015;
    vec2 sUV=uv;
    vec3 rfC=vec3(0.0); float rfW=0.0;
    float maxS=max(ssrSteps,8.0);
    for(float i=1.0;i<=128.0;i++){
      if(i>=maxS) break;
      sUV+=step2*(1.0+i*0.05);
      if(sUV.x<0.0||sUV.x>1.0||sUV.y<0.0||sUV.y>1.0) break;
      float sd=readLinearDepth(sUV); float cd=dLin+i*0.0012;
      if(sd<cd&&abs(sd-cd)<0.04){
        float fe=1.0-smoothstep(0.7,1.0,max(abs(sUV.x*2.0-1.0),abs(sUV.y*2.0-1.0)));
        rfC=texture2D(baseTexture,sUV).rgb*fe;
        rfW=(1.0-i/maxS)*fe; break;
      }
    }
    return mix(base,rfC,rfW*ssrIntensity*0.5);
  }

  /* SSGI */
  vec3 ssgi(vec2 uv, vec3 base, float dLin){
    if(giBounce<0.01) return vec3(0.0);
    vec3 indirect=vec3(0.0); float w=0.0;
    float frameRot=hash21f(uv+vec2(3.7),noiseFrame+13.1)*6.2832;
    for(float i=0.0;i<12.0;i++){
      float ang=6.2832*(i/12.0)+frameRot;
      float r=mix(0.05,0.25,hash21f(vec2(i*0.17,0.53),noiseFrame));
      vec2 s=clamp(uv+vec2(cos(ang),sin(ang))*r,vec2(0.001),vec2(0.999));
      float sd=readLinearDepth(s);
      float depthSim=exp(-abs(sd-dLin)*30.0);
      indirect+=texture2D(baseTexture,s).rgb*depthSim; w+=depthSim;
    }
    if(w>0.0) indirect/=w;
    return indirect*giBounce*0.35;
  }

  /* PT Noise Blender-like */
  vec3 pathTracingNoise(vec2 uv, vec3 col){
    if(ptNoiseEnabled<0.5) return col;
    float nr=hash21f(uv+vec2(0.13,0.71),noiseFrame*3.1)-0.5;
    float ng=hash21f(uv+vec2(0.37,0.19),noiseFrame*3.1+17.0)-0.5;
    float nb=hash21f(uv+vec2(0.61,0.43),noiseFrame*3.1+31.0)-0.5;
    float lum=dot(col,vec3(0.2126,0.7152,0.0722));
    float noiseAmp=(0.18+lum*0.12)*noiseScale;
    return col+vec3(nr,ng,nb)*noiseAmp;
  }

  /* ── Real PCSS (Percentage-Closer Soft Shadows) ─────────────────────────
     Classic Fernando/NVIDIA algorithm sampled against the scene's actual
     shadow-casting light (its real shadow map + light-space matrix), not
     the camera depth buffer. Three steps: (1) blocker search around the
     receiver, (2) penumbra-size estimate from the receiver/blocker/light
     distances, (3) variable-radius PCF using that estimated size.
     Directional ("sun") lights use an orthographic shadow camera, so the
     classic perspective penumbra formula drops its 1/blockerDepth term. */
  float pcssShadow(vec3 worldPos){
    if(ssEnabled<0.5 || ssHasLight<0.5) return 1.0;

    vec4 sc=ssShadowMatrix*vec4(worldPos,1.0);
    sc.xyz/=sc.w;
    if(sc.x<0.0||sc.x>1.0||sc.y<0.0||sc.y>1.0||sc.z<0.0||sc.z>1.0) return 1.0;

    float lightSpan=max(ssCamFar-ssCamNear,0.001);
    float receiverDepth=ssLightOrtho>0.5
      ? mix(ssCamNear,ssCamFar,sc.z)
      : linearizeShadowDepth(sc.z,ssCamNear,ssCamFar);

    float texel=1.0/max(ssMapSize,64.0);
    float rot=hash21f(sc.xy,noiseFrame)*6.2832;

    // Step 1 — blocker search (rotated ring, radius ~ light size in shadow-UV space)
    float searchRadius=clamp(ssLightSize/lightSpan*6.0,texel,0.06);
    float blockerSum=0.0, blockerCount=0.0;
    for(float i=0.0;i<12.0;i++){
      float ang=6.2832*(i/12.0)+rot;
      float rr=mix(0.3,1.0,hash21f(sc.xy,noiseFrame+i*3.7))*searchRadius;
      vec2 s=sc.xy+vec2(cos(ang),sin(ang))*rr;
      float sdRaw=texture2D(ssShadowMap,s).x;
      float sd=ssLightOrtho>0.5 ? mix(ssCamNear,ssCamFar,sdRaw) : linearizeShadowDepth(sdRaw,ssCamNear,ssCamFar);
      if(sd<receiverDepth-0.0015){ blockerSum+=sd; blockerCount+=1.0; }
    }
    if(blockerCount<0.5) return 1.0; // nothing occluding this point -> fully lit

    // Step 2 — penumbra size estimate (parallel-plane approximation)
    float avgBlocker=blockerSum/blockerCount;
    float penumbraWorld=ssLightOrtho>0.5
      ? (receiverDepth-avgBlocker)*ssLightSize
      : (receiverDepth-avgBlocker)*ssLightSize/max(avgBlocker,0.001);
    penumbraWorld=min(penumbraWorld,max(ssMaxPenumbra,0.0));
    float filterRadius=clamp(penumbraWorld/lightSpan*ssSoftness*3.0,texel,0.15);

    // Step 3 — variable-radius PCF using the estimated penumbra size
    float n=clamp(ssSamples,4.0,48.0);
    float lit=0.0;
    for(float i=0.0;i<48.0;i++){
      if(i>=n) break;
      float ang=6.2832*(i/n)+rot*1.3;
      float rr=mix(0.25,1.0,hash21f(sc.xy+vec2(i*0.11,0.0),noiseFrame+91.0))*filterRadius;
      vec2 s=sc.xy+vec2(cos(ang),sin(ang))*rr;
      float sdRaw=texture2D(ssShadowMap,s).x;
      float sd=ssLightOrtho>0.5 ? mix(ssCamNear,ssCamFar,sdRaw) : linearizeShadowDepth(sdRaw,ssCamNear,ssCamFar);
      lit+=(sd<receiverDepth-0.0015)?0.0:1.0;
    }
    return lit/n;
  }

  /* ── Real volumetric fog (world-space raymarch) ─────────────────────────
     Standard height-fog: exponential density falloff above a world-space
     height, Worley+value 3D noise for wisps, Beer-Lambert transmittance,
     Henyey-Greenstein phase function for forward scattering toward the
     scene's key light (so the fog glows when you look toward the sun). */
  float fogNoise3D(vec3 p){
    vec3 q=p*max(vfNoiseScale,0.001)+vec3(time*vfNoiseSpeed,time*vfNoiseSpeed*0.4,time*vfNoiseSpeed*0.7);
    float n=noise3D(q)*0.65+noise3D(q*2.17+5.2)*0.35;
    return clamp(n*1.3,0.0,1.4);
  }
  float hgPhase(float cosTheta, float g){
    float g2=g*g; return (1.0-g2)/(4.0*3.14159*pow(1.0+g2-2.0*g*cosTheta,1.5));
  }
  vec3 heightFog(vec2 uv, vec3 col, vec3 worldPos){
    if(vfEnabled<0.5) return col;

    vec3 toSurf=worldPos-cameraPos;
    float travel=min(length(toSurf),cameraFar);
    vec3 dir=toSurf/max(travel,0.0001);

    float n=max(vfSteps,8.0);
    float dt=travel/n;
    float jitter=hash21f(uv,noiseFrame);

    float cosTheta=dot(dir,normalize(vfLightDir+vec3(0.0,0.0001,0.0)));
    float phase=hgPhase(cosTheta,clamp(vfAniso,-0.95,0.95));
    vec3 sunColor=mix(vec3(1.0),vfLightColor,clamp(vfHasLight,0.0,1.0));
    vec3 inscatterColor=vfColor*0.7+sunColor*phase*vfHasLight*0.6;

    vec3 accum=vec3(0.0);
    float transmit=1.0;
    for(float i=0.0;i<64.0;i++){
      if(i>=n) break;
      float t=(i+jitter)*dt;
      if(t>travel) break;
      vec3 p=cameraPos+dir*t;
      float heightAtten=exp(-max(p.y-vfMaxHeight,0.0)*max(vfFalloff,0.001));
      float variation=fogNoise3D(p);
      float sigma=max(vfDensity*heightAtten*variation,0.0);
      float stepT=exp(-sigma*dt);
      accum+=transmit*(1.0-stepT)*inscatterColor*(0.5+vfScatter*0.5);
      transmit*=stepT;
      if(transmit<0.01){ transmit=0.0; break; }
    }
    vec3 result=col*transmit+accum;
    return result;
  }

  void main(){
    vec2 uv=vUv;
    float dRaw=texture2D(tDepth,uv).x;
    float dLin=linearizeDepth(dRaw);
    vec3 col=texture2D(baseTexture,uv).rgb;

    // Path Tracing SSAO+SSR+SSGI
    if(rtEnabled>0.5){
      col*=ssao(uv,dRaw);
      col=ssr(uv,col,dLin);
      col+=ssgi(uv,col,dLin);
      float bounce=(1.0-dLin)*giBias*0.05;
      col+=vec3(bounce*0.1,bounce*0.07,bounce*0.03);
    }
    // Path Tracing Blender-like noise
    if(ptNoiseEnabled>0.5) col=pathTracingNoise(uv,col);

    // Soft Shadows + Volumetric Fog both need the real world-space position,
    // reconstructed once from depth and reused by both effects.
    if(ssEnabled>0.5||vfEnabled>0.5){
      vec3 worldPos=worldPosFromDepth(uv,dRaw);
      if(ssEnabled>0.5) col*=pcssShadow(worldPos);
      if(vfEnabled>0.5) col=heightFog(uv,col,worldPos);
    }

    gl_FragColor=vec4(max(col,vec3(0.0)),1.0);
  }
`;

// ── ShaderPass avançado — adicionado ao composer após os passes existentes ────
let _advPass = null;
let _advDepthRT = null;

export function initAdvancedPass() {
    if (_advPass || !composer) return;
    const w = window.innerWidth, h = window.innerHeight;

    // Depth render target para SSAO/SSR/PCSS
    _advDepthRT = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthTexture: new THREE.DepthTexture(w, h),
        depthBuffer: true,
    });
    _advU.tDepth.value = _advDepthRT.depthTexture;
    _advU.resolution.value.set(w, h);

    _advPass = new ShaderPass(new THREE.ShaderMaterial({
        uniforms: _advU,
        vertexShader:   _advVertShader,
        fragmentShader: _advFragShader,
    }), 'baseTexture');
    _advPass.enabled = false;  // só ativa quando alguma feature for ligada
    composer.addPass(_advPass);
}

function _syncAdvPass() {
    if (!_advPass) return;
    const any = _advU.rtEnabled.value > 0.5 || _advU.ptNoiseEnabled.value > 0.5
             || _advU.ssEnabled.value > 0.5  || _advU.vfEnabled.value > 0.5;
    _advPass.enabled = any;
}

// Finds the first scene object matching `test`, cheapest-first (bails as
// soon as a match is found). Used to pick the "primary" light for the fog's
// scattering direction and the PCSS shadow lookup.
function _findLight(scene, test) {
  let found = null;
  scene.traverse((o) => {
    if (!found && test(o)) found = o;
  });
  return found;
}

const _tmpLightPos = new THREE.Vector3();

// Populates the real-world uniforms the advanced shader needs: camera
// reconstruction matrices (always, cheap) and the scene's primary light(s)
// for Fog scattering / PCSS shadow lookups (scanned only while those
// specific effects are enabled, to avoid paying for an unused traversal).
function _syncAdvLighting() {
    if (!app.camera || !app.scene) return;

    _advU.cameraWorldMatrix.value.copy(app.camera.matrixWorld);
    _advU.cameraProjInverse.value.copy(app.camera.projectionMatrixInverse);
    app.camera.getWorldPosition(_advU.cameraPos.value);

    if (_advU.vfEnabled.value > 0.5) {
        const sun = _findLight(app.scene, (o) => o.isDirectionalLight);
        if (sun) {
            sun.getWorldPosition(_tmpLightPos);
            _advU.vfLightDir.value.copy(
                _tmpLightPos.lengthSq() > 1e-6 ? _tmpLightPos.normalize() : new THREE.Vector3(0, 1, 0)
            );
            _advU.vfLightColor.value.copy(sun.color);
            _advU.vfHasLight.value = 1.0;
        } else {
            _advU.vfHasLight.value = 0.0;
        }
    }

    if (_advU.ssEnabled.value > 0.5) {
        const light =
            _findLight(app.scene, (o) => o.isDirectionalLight && o.castShadow && o.shadow?.map) ||
            _findLight(app.scene, (o) => o.isSpotLight && o.castShadow && o.shadow?.map);

        if (light) {
            _advU.ssHasLight.value   = 1.0;
            _advU.ssLightOrtho.value = light.isDirectionalLight ? 1.0 : 0.0;
            _advU.ssShadowMap.value  = light.shadow.map.texture;
            _advU.ssShadowMatrix.value.copy(light.shadow.matrix);
            _advU.ssCamNear.value    = light.shadow.camera.near;
            _advU.ssCamFar.value     = light.shadow.camera.far;
            _advU.ssMapSize.value    = light.shadow.mapSize.width;
        } else {
            _advU.ssHasLight.value = 0.0;
        }
    }
}

export function renderAdvDepth() {
    if (!_advPass?.enabled || !app.renderer || !app.scene || !app.camera || !_advDepthRT) return;
    app.renderer.setRenderTarget(_advDepthRT);
    app.renderer.render(app.scene, app.camera);
    app.renderer.setRenderTarget(null);
    _advU.cameraNear.value = app.camera.near;
    _advU.cameraFar.value  = app.camera.far;
    _advU.time.value       = performance.now() / 1000;

    _syncAdvLighting();

    // Live temporal dithering for the normal (non-sampling) preview. While
    // the TAA accumulator (Samples & Denoising) is running it overwrites
    // this right after with the exact sample index, so this only affects
    // the regular real-time viewport.
    _advU.noiseFrame.value = (_advU.noiseFrame.value + 1.0) % 100000.0;
}

export function resizeAdvPass(w, h) {
    if (!_advDepthRT) return;
    _advDepthRT.setSize(w, h);
    _advU.resolution.value.set(w, h);
}

// ── TAA Accumulator (Nexuz) ───────────────────────────────────────────────────
export const _taa = (() => {
    let _running = false, _paused = false, _frame = 0, _maxFrames = 64;
    let _accumRT = null, _sampleRT = null, _origProj = null, _weight = 0;

    function halton(i, base) {
        let r = 0, f = 1;
        while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
        return r;
    }

    let _qScene = null, _qCam = null, _blendMat = null;
    function _ensureQuad() {
        if (_qScene) return;
        _qCam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        _qScene = new THREE.Scene();
        _blendMat = new THREE.ShaderMaterial({
            uniforms: { tAccum:{value:null}, tNew:{value:null}, uAlpha:{value:1.0} },
            vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
            fragmentShader: `uniform sampler2D tAccum,tNew; uniform float uAlpha; varying vec2 vUv;
                void main(){ gl_FragColor=mix(texture2D(tAccum,vUv),texture2D(tNew,vUv),uAlpha); }`,
            depthTest: false, depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), _blendMat);
        mesh.frustumCulled = false;
        _qScene.add(mesh);
    }

    function _ensureRTs(w, h) {
        if (_accumRT && _accumRT.width === w && _accumRT.height === h) return;
        _accumRT?.dispose(); _sampleRT?.dispose();
        const base = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
        _accumRT  = new THREE.WebGLRenderTarget(w, h, { ...base, type: THREE.HalfFloatType, depthBuffer: false });
        _sampleRT = new THREE.WebGLRenderTarget(w, h, { ...base, type: THREE.HalfFloatType, depthBuffer: false });
    }

    function _applyJitter(f) {
        if (!_origProj || !app.camera) return;
        const w = app.renderer.domElement.width || window.innerWidth;
        const h = app.renderer.domElement.height || window.innerHeight;
        app.camera.projectionMatrix.copy(_origProj);
        app.camera.projectionMatrix.elements[8] += (halton(f+1,2)-0.5)*2.0/w;
        app.camera.projectionMatrix.elements[9] += (halton(f+1,3)-0.5)*2.0/h;
        app.camera.projectionMatrixInverse.copy(app.camera.projectionMatrix).invert();
    }
    function _removeJitter() {
        if (!_origProj || !app.camera) return;
        app.camera.projectionMatrix.copy(_origProj);
        app.camera.projectionMatrixInverse.copy(_origProj).invert();
    }

    function start(maxSamples) {
        if (!app.renderer || !composer) return;
        _maxFrames = maxSamples || 64;
        _frame = 0; _weight = 0; _running = true; _paused = false;
        _origProj = app.camera.projectionMatrix.clone();
        const w = app.renderer.domElement.width || window.innerWidth;
        const h = app.renderer.domElement.height || window.innerHeight;
        _ensureRTs(w, h); _ensureQuad();
        app.renderer.setRenderTarget(_accumRT); app.renderer.clear(true, true, false);
        app.renderer.render(app.scene, app.camera); app.renderer.setRenderTarget(null);
        markSceneDirty(); _syncUI();
    }

    function stop() {
        if (!_running) return;
        _running = false; _paused = false;
        _removeJitter();
        _advU.noiseFrame.value = 0.0;
        _advU.ptNoiseEnabled.value = 0.0;
        _syncAdvPass();
        markSceneDirty(); _syncUI();
    }

    function togglePause() {
        if (!_running) return;
        _paused = !_paused;
        if (!_paused) markSceneDirty();
        _syncUI();
    }

    function step() {
        if (!_running || _paused || _frame >= _maxFrames || !app.renderer) return false;
        const w = app.renderer.domElement.width || window.innerWidth;
        const h = app.renderer.domElement.height || window.innerHeight;
        _ensureRTs(w, h); _ensureQuad();
        _applyJitter(_frame);
        _advU.ptNoiseEnabled.value = 1.0;
        _syncAdvPass();
        renderAdvDepth();
        _advU.noiseFrame.value     = _frame;
        composer.render();
        app.renderer.copyFramebufferToTexture(_sampleRT.texture, new THREE.Vector2(0, 0));
        _removeJitter();
        _weight++;
        _blendMat.uniforms.tAccum.value = _accumRT.texture;
        _blendMat.uniforms.tNew.value   = _sampleRT.texture;
        _blendMat.uniforms.uAlpha.value = 1.0 / _weight;
        app.renderer.autoClear = true;
        app.renderer.render(_qScene, _qCam);
        app.renderer.copyFramebufferToTexture(_accumRT.texture, new THREE.Vector2(0, 0));
        _frame++;
        _syncUI();
        if (_frame >= _maxFrames) {
            _running = false;
            _advU.ptNoiseEnabled.value = 0.0;
            _syncUI();
        }
        return true;
    }

    function _syncUI() {
        const fill = document.getElementById('adv-progress-fill');
        const text = document.getElementById('adv-progress-text');
        const pct  = Math.min(_frame / Math.max(_maxFrames, 1) * 100, 100);
        if (fill) fill.style.width = pct + '%';
        if (text) {
            if (!_running && _frame >= _maxFrames) text.textContent = `✅ ${_maxFrames} samples concluídos`;
            else if (_paused) text.textContent = `⏸ Pausado — ${_frame}/${_maxFrames}`;
            else if (_running) text.textContent = `${_frame}/${_maxFrames} samples — ${Math.round(pct)}%`;
            else text.textContent = 'Aguardando...';
        }
    }

    return {
        start, stop, togglePause, step,
        isRunning: () => _running && !_paused,
        isActive:  () => _running,
    };
})();
window._taa = _taa;

// ── Wiring do painel Avançado (Ray Tracing screen-space + Render Físico GPU) ──
export function initAdvancedUI() {
    _reflectGpuPathTracerControls();

    // ── Sombras (quality presets) ────────────────────────────────────────────
    document.querySelectorAll('#shadowQualityRow .menuBtn[data-shadow-quality]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#shadowQualityRow .menuBtn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            applyShadowQuality(btn.dataset.shadowQuality);
        });
    });

    // ── Ray Tracing (screen-space: SSAO+SSR+GI) ─────────────────────────────
    // Cheap, real-time shader effect — no BVH, no external library, can't
    // freeze. Reuses the _advU uniform pipeline + depth pre-pass that were
    // already sitting here (initAdvancedPass/_syncAdvPass/renderAdvDepth),
    // just wired to a fresh section instead of the removed old panel.
    (() => {
        const row = document.getElementById('rts-row');
        const body = document.getElementById('rts-body');
        if (!row || !body) return;
        row.addEventListener('click', () => {
            const on = !row.classList.contains('active');
            row.classList.toggle('active', on);
            body.classList.toggle('hidden', !on);
            _advU.rtEnabled.value = on ? 1.0 : 0.0;
            if (on) initAdvancedPass();
            _syncAdvPass();
            markSceneDirty();
        });
    })();

    // Quick preset button at the top of the Modo tab ("Render Físico") just
    // mirrors the panel's own toggle — it has its OWN [data-adv-mode]
    // attribute so it never collides with main.js's real [data-render-mode]
    // switch (which also listens on that attribute for the standard/
    // wireframe/etc. engine modes and must never see 'gpu-pt').
    const advModeButtons = Array.from(document.querySelectorAll('[data-adv-mode]'));

    function _reflectAdvModeButtons() {
        const on = document.getElementById('gpt-row')?.classList.contains('active');
        advModeButtons.forEach(b => b.classList.toggle('active', b.dataset.advMode === (on ? 'gpu-pt' : 'standard')));
    }

    advModeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.advMode;
            const row = document.getElementById('gpt-row');
            if (!row) return;
            const wantOn = mode === 'gpu-pt';
            if (row.classList.contains('active') !== wantOn) {
                row.click();
            } else {
                _reflectAdvModeButtons();
            }
        });
    });

    // ── Path Tracer (GPU real, three-gpu-pathtracer) ────────────────────────
    // Genuine unbiased Monte Carlo path tracing, reusing renderState.mode =
    // 'pathtracing' which is already fully wired into renderFrame(). Unlike a
    // screen-space approximation, this replaces rasterization entirely and
    // progressively accumulates — best suited to a still shot of a static
    // scene rather than playing back an animation.
    document.getElementById('gpt-row')?.addEventListener('click', (e) => {
        const on = !e.currentTarget.classList.contains('active');
        e.currentTarget.classList.toggle('active', on);
        document.getElementById('gpt-body')?.classList.toggle('hidden', !on);
        if (on) {
            const samples = parseInt(document.getElementById('gpt-samples')?.value ?? '64', 10);
            setSamplesValuePost(Number.isFinite(samples) ? samples : 64);
            const bounces = parseInt(document.getElementById('gpt-bounces')?.value ?? '10', 10);
            renderState.path.bounces = Number.isFinite(bounces) ? Math.max(1, Math.min(32, bounces)) : 10;
            setLightPreviewActive(true);
            _applyGpuPathTracerControls();
        } else {
            setLightPreviewActive(false);
        }
        _reflectAdvModeButtons();
        markSceneDirty();
    });
    document.getElementById('gpt-bounces')?.addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        renderState.path.bounces = Number.isFinite(v) ? Math.max(1, Math.min(32, v)) : 10;
        if (renderState.mode === 'pathtracing') setRenderModeValue('pathtracing');
    });
    document.getElementById('gpt-samples')?.addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        setSamplesValuePost(Number.isFinite(v) ? v : 64);
    });
    ['gpt-filterGlossy', 'gpt-tilesX', 'gpt-tilesY', 'gpt-renderScale',
     'gpt-minSamples', 'gpt-lowResScale', 'gpt-dynamicLowRes'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', () => _applyGpuPathTracerControls());
    });
    document.getElementById('gpt-reset')?.addEventListener('click', () => {
        getPathTracerInstance()?.reset();
        markSceneDirty();
    });

    // Precise numeric inputs replace the old touch-drag sliders throughout
    // this tab. Range sliders physically can't leave [min,max]; plain number
    // inputs can if someone types a stray value, so clamp on commit.
    document.querySelectorAll('#advTab input[type="number"]').forEach((el) => {
        const clampVal = () => {
            if (el.value === '') return;
            const min = el.min !== '' ? parseFloat(el.min) : -Infinity;
            const max = el.max !== '' ? parseFloat(el.max) : Infinity;
            let v = parseFloat(el.value);
            if (!Number.isFinite(v)) return;
            v = Math.min(max, Math.max(min, v));
            if (String(v) !== el.value) {
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        };
        el.addEventListener('change', clampVal);
        el.addEventListener('blur', clampVal);
    });
}


export function downloadCurrentFrame() {
  if (!app.renderer) return;
  const url = app.renderer.domElement.toDataURL('image/png');
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `render-${Date.now()}.png`
  });
  document.body.appendChild(link);
  link.click();
  link.remove();
}