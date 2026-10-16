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
import { app, helperRegistry } from './scene.js';

const MAX_SAMPLES = 128;

export const GOD_RAYS_DEFAULTS = Object.freeze({
  enabled:   false,
  intensity: 1.0,
  density:   0.85,
  decay:     0.96,
  weight:    0.35,
  exposure:  0.32,
  samples:   72,
  range:     35,
  threshold: 0.02,
  color:     '#ffffff',
  noise:     0.4,
  anisotropy: 0.35,  // Henyey-Greenstein g
  softness:  1.0,    // raio do PCF no mapa de sombra (texels)
  cone:      true,   // Spot/Rim: respeita cone + penumbra
  falloff:   0.35,   // queda com a distância até a luz
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
  uniform float uPacked;   // 1 = shadow map guarda profundidade empacotada em RGBA (three r17x)
  uniform vec3  uLightPos;     // posição mundial da luz
  uniform vec3  uLightDir;     // direção PARA a luz (Sun) / eixo do cone (Spot, apontando para fora da luz)
  uniform float uIsDir;        // 1 = Directional
  uniform float uAniso;        // Henyey-Greenstein g
  uniform float uSoft;         // raio PCF em texels
  uniform float uTexel;        // 1 / tamanho do shadow map
  uniform float uUseCone;      // 1 = aplica cone do spot
  uniform float uCosOuter;
  uniform float uCosInner;
  uniform float uFalloff;

  varying vec2 vUv;

  #include <packing>

  // Ruído de gradiente intercalado (Jimenez): distribuição bem melhor que
  // hash(sin) para dither — o padrão vira grão fino em vez de faixas.
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  float shadowDepthAt(vec2 uv) {
    vec4 t = texture2D(shadowMap, uv);
    return (uPacked > 0.5) ? unpackRGBAToDepth(t) : t.x;
  }

  // Visibilidade com PCF de 4 pontos (suaviza a serrilha do mapa de sombra).
  float lightVisibility(vec3 sc) {
    float bias = 0.0025;
    if (uSoft < 0.01) return (sc.z - bias <= shadowDepthAt(sc.xy)) ? 1.0 : 0.0;
    vec2 o = vec2(uTexel * uSoft);
    float v = 0.0;
    v += (sc.z - bias <= shadowDepthAt(sc.xy + vec2( o.x,  o.y))) ? 1.0 : 0.0;
    v += (sc.z - bias <= shadowDepthAt(sc.xy + vec2(-o.x,  o.y))) ? 1.0 : 0.0;
    v += (sc.z - bias <= shadowDepthAt(sc.xy + vec2( o.x, -o.y))) ? 1.0 : 0.0;
    v += (sc.z - bias <= shadowDepthAt(sc.xy + vec2(-o.x, -o.y))) ? 1.0 : 0.0;
    return v * 0.25;
  }

  // Fase de Henyey-Greenstein normalizada (1.0 quando g = 0).
  float hgPhase(float cosT, float g) {
    float g2 = g * g;
    float hg = (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosT, 1e-3), 1.5);
    return mix(1.0, hg, 0.55); // mistura suave: mantém o brilho médio parecido com o anterior
  }

  void main() {
    vec4 baseColor = texture2D(tDiffuse, vUv);

    // Nothing to do: god rays off for this light, or shadow map not ready yet.
    if (uReady < 0.5) { gl_FragColor = baseColor; return; }

    float depth = texture2D(tDepth, vUv).x;
    // Fundo/céu: não há superfície, mas o ar à frente da câmera ainda é
    // iluminado — marcha até o alcance máximo usando a direção do pixel.
    // (Antes esses pixels eram pulados: num cenário vazio, ou no modo Render
    // sem grade, só sobravam os pixels do objeto e os raios "sumiam".)
    bool isSky = depth >= 0.9999;

    // Reconstruct world-space position of this pixel from depth.
    vec4 ndc = vec4(vUv * 2.0 - 1.0, (isSky ? 1.0 : depth) * 2.0 - 1.0, 1.0);
    vec4 viewPos = cameraProjectionMatrixInverse * ndc;
    viewPos /= viewPos.w;
    vec3 worldPos = (cameraMatrixWorld * viewPos).xyz;

    vec3 rayVec    = worldPos - cameraPos;
    float rayLen   = length(rayVec);
    float marchLen = isSky ? uRange : min(rayLen, uRange);
    vec3 rayDir    = rayVec / max(rayLen, 0.0001);

    int samples = int(min(float(uSamples), float(MAX_SAMPLES)));
    float stepSize = marchLen / max(float(samples), 1.0);

    // Dither the march start so fixed step-count banding turns into fine
    // noise instead of visible bands — cheap, no extra samples needed.
    float jitter = ign(gl_FragCoord.xy) * uNoise;
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
        // Ponto iluminado (à frente do que está no mapa de sombra) → a luz
        // se espalha no ar aqui.
        float vis = lightVisibility(shadowCoord.xyz);
        if (vis > 0.0) {
          vec3 toLight = (uIsDir > 0.5) ? uLightDir : normalize(uLightPos - currentPos);
          float cone = 1.0;
          if (uIsDir < 0.5 && uUseCone > 0.5) {
            // uLightDir (spot) = eixo do cone; ângulo entre o ponto e o eixo.
            float c = dot(-toLight, uLightDir);
            cone = smoothstep(uCosOuter, uCosInner, c);
          }
          float dist = (uIsDir > 0.5) ? 0.0 : length(uLightPos - currentPos);
          float atten = (uIsDir > 0.5) ? 1.0 : 1.0 / (1.0 + uFalloff * dist * 0.1);
          float phase = hgPhase(dot(rayDir, toLight), uAniso);
          accum += uDensity * currentDecay * uWeight * vis * cone * atten * phase;
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
    // Nenhuma luz com God Rays ligado → não gasta um render de profundidade.
    if (!anyGodRaysActive()) return;
    this._ensureSize(renderer);

    // A profundidade deve refletir só a CENA: helpers, grade, eixos, gizmo e
    // esferas de seleção (invisíveis, mas o override as tornaria sólidas)
    // ficam de fora. Assim os raios são iguais no Editor e no Render.
    const hidden = [];
    const hide = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
    hide(app.gridRoot);
    hide(app.axesHelper);
    hide(app._tcHelper);
    helperRegistry.objects.forEach(hide);
    app.scene.traverse((o) => { if (o.isMesh && o.material && o.material.visible === false) hide(o); });

    const prevTarget   = renderer.getRenderTarget();
    const prevOverride = app.scene.overrideMaterial;
    try {
      app.scene.overrideMaterial = this._depthMaterial;
      renderer.setRenderTarget(this.renderTarget);
      renderer.clear();
      renderer.render(app.scene, app.camera);
    } finally {
      app.scene.overrideMaterial = prevOverride;
      renderer.setRenderTarget(prevTarget);
      hidden.forEach((o) => { o.visible = true; });
    }
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
      uPacked:    { value: 1 },
      uLightPos:  { value: new THREE.Vector3() },
      uLightDir:  { value: new THREE.Vector3(0, -1, 0) },
      uIsDir:     { value: 0 },
      uAniso:     { value: 0.35 },
      uSoft:      { value: 1 },
      uTexel:     { value: 1 / 1024 },
      uUseCone:   { value: 1 },
      uCosOuter:  { value: 0 },
      uCosInner:  { value: 0.5 },
      uFalloff:   { value: 0.35 },
    };
    this._v0 = new THREE.Vector3();
    this._v1 = new THREE.Vector3();

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
      const map = light.shadow.map;
      // r17x: profundidade empacotada em RGBA no texture; versões novas usam
      // depthTexture. Detecta qual existe para não depender da versão do three.
      const useDepthTex = !!map.depthTexture;
      this.uniforms.tDepth.value    = this.depthPrePass.depthTexture;
      this.uniforms.shadowMap.value = useDepthTex ? map.depthTexture : map.texture;
      this.uniforms.uPacked.value   = useDepthTex ? 0 : 1;
      this.uniforms.shadowMatrix.value.copy(light.shadow.matrix);
      this.uniforms.lightColor.value.copy(light.color);
      this.uniforms.rayColorTint.value.set(cfg.color ?? '#ffffff');
      this.uniforms.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      this.uniforms.cameraMatrixWorld.value.copy(camera.matrixWorld);
      // Posição MUNDIAL (a câmera pode estar dentro de um grupo/rig).
      this.uniforms.cameraPos.value.setFromMatrixPosition(camera.matrixWorld);
      this.uniforms.uIntensity.value = +cfg.intensity || 0;
      this.uniforms.uDensity.value   = +cfg.density   || 0;
      this.uniforms.uDecay.value     = THREE.MathUtils.clamp(+cfg.decay || 0, 0, 0.999);
      this.uniforms.uWeight.value    = +cfg.weight    || 0;
      this.uniforms.uExposure.value  = +cfg.exposure  || 0;
      this.uniforms.uSamples.value   = Math.max(1, Math.min(MAX_SAMPLES, Math.round(+cfg.samples || 1)));
      this.uniforms.uRange.value     = Math.max(0.01, +cfg.range || 0.01);
      this.uniforms.uThreshold.value = +cfg.threshold || 0;
      this.uniforms.uNoise.value     = THREE.MathUtils.clamp(+cfg.noise || 0, 0, 1);
      // ── Geometria da luz (fase, cone, queda) ──
      light.getWorldPosition(this._v0);
      this.uniforms.uLightPos.value.copy(this._v0);
      const isDir = !!light.isDirectionalLight;
      this.uniforms.uIsDir.value = isDir ? 1 : 0;
      if (light.target) light.target.getWorldPosition(this._v1); else this._v1.set(0, 0, 0);
      // Sun: direção PARA a luz. Spot: eixo do cone (da luz para o alvo).
      if (isDir) this.uniforms.uLightDir.value.copy(this._v0).sub(this._v1).normalize();
      else       this.uniforms.uLightDir.value.copy(this._v1).sub(this._v0).normalize();
      this.uniforms.uAniso.value  = THREE.MathUtils.clamp(+(cfg.anisotropy ?? 0.35), -0.95, 0.95);
      this.uniforms.uSoft.value   = THREE.MathUtils.clamp(+(cfg.softness ?? 1), 0, 4);
      const ms = light.shadow.mapSize?.x || light.shadow.map?.width || 1024;
      this.uniforms.uTexel.value  = 1 / Math.max(1, ms);
      this.uniforms.uFalloff.value = Math.max(0, +(cfg.falloff ?? 0.35));
      const useCone = !isDir && cfg.cone !== false && light.isSpotLight;
      this.uniforms.uUseCone.value = useCone ? 1 : 0;
      if (light.isSpotLight) {
        const outer = Math.cos(light.angle);
        const inner = Math.cos(light.angle * (1 - THREE.MathUtils.clamp(light.penumbra ?? 0, 0, 1)));
        this.uniforms.uCosOuter.value = outer;
        this.uniforms.uCosInner.value = Math.max(inner, outer + 1e-4);
      }
    }

    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (!this.uniforms.tDepth.value) this.uniforms.uReady.value = 0;

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

function anyGodRaysActive() {
  for (const pass of _passCache.values()) {
    const l = pass.light;
    if (l?.userData?.godRays?.enabled && l.visible !== false) return true;
  }
  return false;
}

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
