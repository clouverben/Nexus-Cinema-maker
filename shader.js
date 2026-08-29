import * as THREE from 'three';

export const renderState = {
  // 'standard'|'visualization'|'prerender'|'baseshot'|'finalrender'|'raytracing'|'pathtracing'|'hybrid'
  mode: 'standard',

  samples: {
    samples:       4,
    subSamples:    1,
    accumulation:  true,
    resetOnMove:   true,
    /** Stop accumulating new samples after this count (0 = unlimited). */
    targetSamples: 0,
    /**
     * Noise mode: reset the tracer every frame so only `subSamples` fresh
     * Monte Carlo rays are drawn. Lets you see real per-sample noise and
     * observe convergence by increasing subSamples in real time.
     */
    noiseMode: false
  },

  post: {
    enabled:    true,
    exposure:   1,
    contrast:   1,
    saturation: 1,
    vignette:   0
  },

  bloom: {
    enabled:   true,
    threshold: 1,
    strength:  0.65,
    radius:    0.35
  },

  ray: {
    bounces:            4,
    filterGlossyFactor: 0.35,
    tilesX:             3,
    tilesY:             3,
    renderDelay:        100,
    fadeDuration:       250,
    minSamples:         5,
    dynamicLowRes:      true,
    lowResScale:        0.1,
    renderScale:        1
  },

  path: {
    bounces:            10,
    filterGlossyFactor: 0,
    tilesX:             3,
    tilesY:             3,
    renderDelay:        100,
    fadeDuration:       500,
    minSamples:         5,
    dynamicLowRes:      false,
    lowResScale:        0.1,
    renderScale:        1,
    focusDistance:      25,
    fStop:              1.4,
    apertureBlades:     0,
    apertureRotation:   0,
    anamorphicRatio:    1
  }
};

// ─── Setters ──────────────────────────────────────────────────────────────────
export function setRenderMode(mode) {
  renderState.mode = mode;
}

export function setSamplesValue(value) {
  renderState.samples.samples = clampInt(value, 1, 1024, 4);
}

export function setSubSamplesValue(value) {
  renderState.samples.subSamples = clampInt(value, 1, 64, 1);
}

export function setAccumulationValue(value) {
  renderState.samples.accumulation = !!value;
}

export function setResetOnMoveValue(value) {
  renderState.samples.resetOnMove = !!value;
}

export function setTargetSamplesValue(value) {
  renderState.samples.targetSamples = clampInt(value, 0, 99999, 0);
}

export function setNoiseModeValue(value) {
  renderState.samples.noiseMode = !!value;
}

export function setPostValue(key, value) {
  renderState.post[key] = value;
}

export function setBloomValue(key, value) {
  renderState.bloom[key] = value;
}

export function setRayValue(key, value) {
  renderState.ray[key] = value;
}

export function setPathValue(key, value) {
  renderState.path[key] = value;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ─── Post-process shader ──────────────────────────────────────────────────────
export const PostProcessShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uExposure:   { value: 1 },
    uContrast:   { value: 1 },
    uSaturation: { value: 1 },
    uVignette:   { value: 0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uVignette;
    varying vec2 vUv;

    vec3 applySaturation(vec3 color, float sat) {
      float l = dot(color, vec3(0.299, 0.587, 0.114));
      return mix(vec3(l), color, sat);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c *= uExposure;
      c = (c - 0.5) * uContrast + 0.5;
      c = applySaturation(c, uSaturation);
      float vig = smoothstep(1.1, 0.35, distance(vUv, vec2(0.5))) * uVignette;
      c *= mix(1.0, vig, clamp(uVignette, 0.0, 1.0));
      gl_FragColor = vec4(c, 1.0);
    }
  `
};

export function syncPostShader(pass) {
  if (!pass) return;
  const u = pass.uniforms || pass.material?.uniforms;
  if (!u) return;
  u.uExposure.value   = renderState.post.exposure;
  u.uContrast.value   = renderState.post.contrast;
  u.uSaturation.value = renderState.post.saturation;
  u.uVignette.value   = renderState.post.vignette;
}

// ── Particle Labs sprite textures ─────────────────────────────────────────────
const _glowCache = {};

export function makeGlowSprite(color = 0xffffff, size = 64) {
  const key = `${color}_${size}`;
  if (_glowCache[key]) return _glowCache[key];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx  = canvas.getContext('2d');
  const r    = (color >> 16) & 255;
  const g    = (color >> 8)  & 255;
  const b    = color & 255;
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0,   `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.3, `rgba(${r},${g},${b},0.7)`);
  grad.addColorStop(0.7, `rgba(${r},${g},${b},0.2)`);
  grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  _glowCache[key] = tex;
  return tex;
}

export function makeSparkleSprite(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.5);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(cx, cx);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -cx * 0.9);
    ctx.lineTo(0,  cx * 0.9);
    ctx.stroke();
  }
  ctx.restore();
  return new THREE.CanvasTexture(canvas);
}

export function makeRingSprite(inner = 0.3, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx  = size / 2;
  const oR  = cx;
  const iR  = cx * inner;
  const grad = ctx.createRadialGradient(cx, cx, iR, cx, cx, oR);
  grad.addColorStop(0,   'rgba(255,255,255,0)');
  grad.addColorStop(0.4, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
