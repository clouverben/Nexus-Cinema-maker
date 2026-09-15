// godrays.js — per-light volumetric "god rays" post-process.
//
// Raymarches the view ray for every pixel against each enabled light's own
// shadow map (already rendered every frame by three.js for any shadow-
// casting light — no extra shadow pass needed here, just a shared scene-
// depth pre-pass + a screen-space raymarch per enabled light).
//
// Only lights with a single, plain 2D shadow map qualify: Sun
// (DirectionalLight) and Spot/Rim (SpotLight, both built on SpotLight in
// lights.js). PointLight shadows are a depth CUBE map in three.js (six
// faces, no single shadow.matrix) — sampling that needs a different
// technique this raymarcher doesn't implement. RectAreaLight has no shadow
// support in three.js at all. Both are skipped here and hidden in the UI
// (see main.js's lightGodRays wiring).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { app } from './scene.js';

const MAX_SAMPLES = 128;

export const GOD_RAYS_DEFAULTS = Object.freeze({
  enabled:   false,
  intensity: 1.0,
  density:   0.85,
  decay:     0.96,
  weight:    0.35,
  exposure:  0.32,
  samples:   60,
  range:     35,
  threshold: 0.02,
  color:     '#ffffff',
  noise:     0.4,
});

export function ensureGodRaysConfig(light) {
  if (!light.userData.godRays) light.userData.godRays = { ...GOD_RAYS_DEFAULTS };
  return light.userData.godRays;
}

// Only DirectionalLight (Sun) and SpotLight (Spot/Rim) have a plain 2D
// shadow map + a single `.shadow.matrix` — the raymarch below relies on
// both existing.
export function lightSupportsGodRays(light) {
  return !!(light && (light.isDirectionalLight || light.isSpotLight));
}

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  #define MAX_SAMPLES ${MAX_SAMPLES}
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D shadowMap;

  uniform mat4  cameraProjectionMatrixInverse;
  uniform mat4  cameraMatrixWorld;
  uniform mat4  shadowMatrix;
  uniform vec3  cameraPos;

  uniform vec3  lightColor;
  uniform vec3  rayColorTint;

  uniform float uIntensity;
  uniform float uDensity;
  uniform float uDecay;
  uniform float uWeight;
  uniform float uExposure;
  uniform int   uSamples;
  uniform float uRange;
  uniform float uThreshold;
  uniform float uNoise;
  uniform float uReady;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec4 baseColor = texture2D(tDiffuse, vUv);

    // Nothing to do: god rays off for this light, or shadow map not ready yet.
    if (uReady < 0.5) { gl_FragColor = baseColor; return; }

    float depth = texture2D(tDepth, vUv).x;
    // Background / far plane — no surface to raymarch up to.
    if (depth >= 0.9999) { gl_FragColor = baseColor; return; }

    // Reconstruct world-space position of this pixel from depth.
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 viewPos = cameraProjectionMatrixInverse * ndc;
    viewPos /= viewPos.w;
    vec3 worldPos = (cameraMatrixWorld * viewPos).xyz;

    vec3 rayVec    = worldPos - cameraPos;
    float rayLen   = length(rayVec);
    float marchLen = min(rayLen, uRange);
    vec3 rayDir    = rayVec / max(rayLen, 0.0001);

    int samples = int(min(float(uSamples), float(MAX_SAMPLES)));
    float stepSize = marchLen / max(float(samples), 1.0);

    // Dither the march start so fixed step-count banding turns into fine
    // noise instead of visible bands — cheap, no extra samples needed.
    float jitter = hash(gl_FragCoord.xy) * uNoise;
    vec3 currentPos = cameraPos + rayDir * (stepSize * jitter);

    float accum = 0.0;
    float currentDecay = 1.0;

    for (int i = 0; i < MAX_SAMPLES; i++) {
      if (i >= samples) break;

      vec4 shadowCoord = shadowMatrix * vec4(currentPos, 1.0);
      shadowCoord.xyz /= shadowCoord.w; // no-op for the Sun's orthographic shadow cam, needed for Spot/Rim's perspective one

      if (shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 &&
          shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0 &&
          shadowCoord.z >= 0.0 && shadowCoord.z <= 1.0) {
        float shadowDepth = texture2D(shadowMap, shadowCoord.xy).x;
        // Point is lit (not behind whatever's in the shadow map) → the
        // light is scattering through the air at this point along the ray.
        if (shadowCoord.z - 0.0025 <= shadowDepth) {
          accum += uDensity * currentDecay * uWeight;
        }
      }

      currentDecay *= uDecay;
      currentPos += rayDir * stepSize;
    }

    accum *= uExposure * uIntensity;
    if (accum < uThreshold) accum = 0.0;

    vec3 rays = lightColor * rayColorTint * accum;
    gl_FragColor = vec4(baseColor.rgb + rays, baseColor.a);
  }
`;

// ── Shared scene-depth pre-pass ─────────────────────────────────────────────
// One depth render, shared by every GodRaysPass this frame. Uses a cheap
// override material — only the rasterized depth matters, not shading — and
// never touches the composer's color ping-pong buffers (needsSwap = false).
class GodRaysDepthPrePass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this._w = 0;
    this._h = 0;
    this.depthTexture = null;
    this.renderTarget = null;
    this._depthMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  }

  _ensureSize(renderer) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const w = Math.max(1, Math.round(size.x * pr));
    const h = Math.max(1, Math.round(size.y * pr));
    if (w === this._w && h === this._h && this.renderTarget) return;
    this._w = w; this._h = h;
    this.renderTarget?.dispose();
    this.depthTexture = new THREE.DepthTexture(w, h);
    this.renderTarget = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true,
      depthTexture: this.depthTexture,
    });
  }

  render(renderer) {
    if (!app.scene || !app.camera) return;
    this._ensureSize(renderer);

    const prevTarget   = renderer.getRenderTarget();
    const prevOverride = app.scene.overrideMaterial;
    app.scene.overrideMaterial = this._depthMaterial;
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(app.scene, app.camera);
    app.scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    this.renderTarget?.dispose();
    this._depthMaterial.dispose();
  }
}

// ── Per-light raymarch pass ─────────────────────────────────────────────────
class GodRaysPass extends Pass {
  constructor(light, depthPrePass) {
    super();
    this.light = light;
    this.depthPrePass = depthPrePass;
    this.needsSwap = true;

    this.uniforms = {
      tDiffuse: { value: null },
      tDepth:   { value: null },
      shadowMap: { value: null },
      shadowMatrix: { value: new THREE.Matrix4() },
      cameraProjectionMatrixInverse: { value: new THREE.Matrix4() },
      cameraMatrixWorld: { value: new THREE.Matrix4() },
      cameraPos: { value: new THREE.Vector3() },
      lightColor: { value: new THREE.Color(0xffffff) },
      rayColorTint: { value: new THREE.Color(0xffffff) },
      uIntensity: { value: 1 },
      uDensity:   { value: 0.85 },
      uDecay:     { value: 0.96 },
      uWeight:    { value: 0.35 },
      uExposure:  { value: 0.32 },
      uSamples:   { value: 60 },
      uRange:     { value: 35 },
      uThreshold: { value: 0.02 },
      uNoise:     { value: 0.4 },
      uReady:     { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });

    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    const light  = this.light;
    const camera = app.camera;
    const cfg    = light.userData.godRays || GOD_RAYS_DEFAULTS;
    const ready  = !!(cfg.enabled && camera && light.shadow && light.shadow.map && light.visible !== false);

    this.uniforms.uReady.value = ready ? 1 : 0;

    if (ready) {
      this.uniforms.tDepth.value    = this.depthPrePass.depthTexture;
      this.uniforms.shadowMap.value = light.shadow.map.texture;
      this.uniforms.shadowMatrix.value.copy(light.shadow.matrix);
      this.uniforms.lightColor.value.copy(light.color);
      this.uniforms.rayColorTint.value.set(cfg.color ?? '#ffffff');
      this.uniforms.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      this.uniforms.cameraMatrixWorld.value.copy(camera.matrixWorld);
      this.uniforms.cameraPos.value.copy(camera.position);
      this.uniforms.uIntensity.value = +cfg.intensity || 0;
      this.uniforms.uDensity.value   = +cfg.density   || 0;
      this.uniforms.uDecay.value     = THREE.MathUtils.clamp(+cfg.decay || 0, 0, 0.999);
      this.uniforms.uWeight.value    = +cfg.weight    || 0;
      this.uniforms.uExposure.value  = +cfg.exposure  || 0;
      this.uniforms.uSamples.value   = Math.max(1, Math.min(MAX_SAMPLES, Math.round(+cfg.samples || 1)));
      this.uniforms.uRange.value     = Math.max(0.01, +cfg.range || 0.01);
      this.uniforms.uThreshold.value = +cfg.threshold || 0;
      this.uniforms.uNoise.value     = THREE.MathUtils.clamp(+cfg.noise || 0, 0, 1);
    }

    this.uniforms.tDiffuse.value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

// ── Manager ──────────────────────────────────────────────────────────────────
// Passes are cached per-light (by uuid) so toggling "Emitir God Rays" on/off
// never needs to rebuild the composer's pass array — each pass just checks
// cfg.enabled itself every frame and is a cheap passthrough when off. The
// array only needs rebuilding (via refreshGodRaysPipeline() in posprocess.js)
// when a qualifying light is actually added to or removed from the scene.
let _depthPrePass = null;
const _passCache = new Map(); // light.uuid -> GodRaysPass

export function buildGodRaysPasses() {
  if (!app.scene) return [];

  const qualifyingLights = [];
  app.scene.traverse((obj) => {
    if (obj.userData?.isLightObject && obj.userData?.lightRef) {
      const light = obj.userData.lightRef;
      if (lightSupportsGodRays(light)) qualifyingLights.push(light);
    }
  });

  const presentUUIDs = new Set(qualifyingLights.map(l => l.uuid));
  for (const [uuid, pass] of _passCache) {
    if (!presentUUIDs.has(uuid)) {
      pass.dispose();
      _passCache.delete(uuid);
    }
  }

  if (!qualifyingLights.length) return [];
  if (!_depthPrePass) _depthPrePass = new GodRaysDepthPrePass();

  const passes = [_depthPrePass];
  for (const light of qualifyingLights) {
    let pass = _passCache.get(light.uuid);
    if (!pass) {
      pass = new GodRaysPass(light, _depthPrePass);
      _passCache.set(light.uuid, pass);
    }
    passes.push(pass);
  }
  return passes;
}

export function disposeGodRaysPasses() {
  for (const pass of _passCache.values()) pass.dispose();
  _passCache.clear();
  _depthPrePass?.dispose();
  _depthPrePass = null;
}
