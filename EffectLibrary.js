// shader-system/EffectLibrary.js
//
// Definição central de todos os efeitos de shader (Procedural + Domínio).
// Cada efeito é um objeto com:
//   - key            : identificador único (usado em uniforms/UI)
//   - label          : nome exibido na UI
//   - params         : schema de parâmetros (para gerar os controles da UI)
//   - defaults()     : valores padrão dos parâmetros
//   - uniforms(p)    : gera o dicionário de uniforms (THREE) a partir dos params
//   - updateUniforms(u, p) : atualiza um dicionário de uniforms já existente
//   - vertex(p)      : trecho GLSL injetado após `#include <begin_vertex>`
//                       (opera sobre a variável `transformed`)
//   - fragment(p)    : trecho GLSL injetado antes de `#include <dithering_fragment>`
//                       (opera sobre `gl_FragColor`)
//   - needsShell     : true para efeitos que também usam a técnica de "inverted hull"
//                       (casca invertida) para contorno real (Outline / Anime)
//
// Todos os trechos GLSL usam nomes de uniform prefixados com `u_<key>_<param>`
// para nunca colidirem quando múltiplos efeitos são combinados (Domínio).
//
// NOTA IMPORTANTE (RGB Split / Glitch em objetos, sem post-processing):
// Como os efeitos aqui são aplicados por objeto (forward shading, um único
// fragment por pixel do objeto), não é possível reamostrar pixels vizinhos
// da tela (isso exigiria post-processing global, proibido pela spec para
// estes efeitos). O "RGB split" é aproximado modulando cada canal de cor
// com ruído/deslocamento de fase independente — visualmente equivalente a
// uma aberração cromática, mas fisicamente calculado por canal, não por
// reamostragem de textura. Fica documentado aqui para transparência.

import * as THREE from 'three';

// ─── Funções GLSL comuns (injetadas uma única vez por shader) ────────────────
export const NCM_COMMON_GLSL = /* glsl */`
  varying vec3 vNcmWorldPos;
  varying vec3 vNcmNormalW;
  uniform float uNcmTime;

  float ncmHash11(float x) {
    return fract(sin(x * 127.1) * 43758.5453123);
  }
  float ncmHash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float ncmNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = ncmHash21(i.xy + i.z * 17.0);
    float n100 = ncmHash21(i.xy + vec2(1.0, 0.0) + i.z * 17.0);
    float n010 = ncmHash21(i.xy + vec2(0.0, 1.0) + i.z * 17.0);
    float n110 = ncmHash21(i.xy + vec2(1.0, 1.0) + i.z * 17.0);
    float n001 = ncmHash21(i.xy + (i.z + 1.0) * 17.0);
    float n101 = ncmHash21(i.xy + vec2(1.0, 0.0) + (i.z + 1.0) * 17.0);
    float n011 = ncmHash21(i.xy + vec2(0.0, 1.0) + (i.z + 1.0) * 17.0);
    float n111 = ncmHash21(i.xy + vec2(1.0, 1.0) + (i.z + 1.0) * 17.0);
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }
`;

function u(v) { return { value: v }; }

// Amostra de fresnel padrão usada por vários efeitos (Fresnel/Hologram/XRay)
const FRESNEL_FN = /* glsl */`
  float ncmFresnel(vec3 nrm, vec3 viewDir, float power) {
    return pow(1.0 - clamp(dot(normalize(nrm), normalize(viewDir)), 0.0, 1.0), max(power, 0.0001));
  }
`;

// ────────────────────────────────────────────────────────────────────────────
export const EFFECTS = {

  none: {
    key: 'none',
    label: 'Nenhum',
    params: [],
    defaults: () => ({}),
    uniforms: () => ({}),
    updateUniforms: () => {},
    vertex: () => '',
    fragment: () => ''
  },

  // ── ANIME / TOON SHADING (posterização real da luz + contorno via casca) ──
  anime: {
    key: 'anime',
    label: 'Anime',
    needsShell: true,
    params: [
      { key: 'intensity',  label: 'Intensidade',        type: 'range', min: 0, max: 1,  step: 0.01, default: 1.0 },
      { key: 'bands',      label: 'Quantidade de tons',  type: 'range', min: 2, max: 8,  step: 1,    default: 4 },
      { key: 'outline',    label: 'Contorno',            type: 'range', min: 0, max: 1,  step: 0.01, default: 1.0 },
      { key: 'outlineWidth', label: 'Espessura do contorno', type: 'range', min: 0.001, max: 0.08, step: 0.001, default: 0.02 },
      { key: 'outlineColor', label: 'Cor do contorno',   type: 'color', default: '#0a0a0a' }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms(p) {
      return {
        u_anime_intensity: u(p.intensity),
        u_anime_bands:     u(p.bands)
      };
    },
    updateUniforms(uni, p) {
      uni.u_anime_intensity.value = p.intensity;
      uni.u_anime_bands.value = p.bands;
    },
    vertex: () => '',
    fragment: (p) => /* glsl */`
      {
        // Quantiza a luminância já resolvida (iluminação PBR) em faixas —
        // toon shading real por posterização da luz, não apenas troca de cor.
        float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        float bands = max(u_anime_bands, 2.0);
        float qLum = floor(lum * bands + 0.5) / bands;
        float scale = (lum > 0.0001) ? (qLum / lum) : 1.0;
        vec3 toonColor = gl_FragColor.rgb * scale;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, toonColor, u_anime_intensity);
      }
    `
  },

  hologram: {
    key: 'hologram',
    label: 'Holograma',
    params: [
      { key: 'intensity',   label: 'Intensidade',   type: 'range', min: 0, max: 2, step: 0.01, default: 1.0 },
      { key: 'color',       label: 'Cor',            type: 'color', default: '#35e8ff' },
      { key: 'scanlines',   label: 'Scanlines',      type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'speed',       label: 'Velocidade',     type: 'range', min: 0, max: 5, step: 0.01, default: 1.2 },
      { key: 'noise',       label: 'Ruído',          type: 'range', min: 0, max: 1, step: 0.01, default: 0.2 },
      { key: 'transparency', label: 'Transparência', type: 'range', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'fresnel',     label: 'Fresnel',        type: 'range', min: 0, max: 4, step: 0.01, default: 1.6 },
      { key: 'glitch',      label: 'Glitch',         type: 'range', min: 0, max: 1, step: 0.01, default: 0.15 }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms(p) {
      return {
        u_holo_intensity: u(p.intensity),
        u_holo_color: u(new THREE.Color(p.color)),
        u_holo_scan: u(p.scanlines),
        u_holo_speed: u(p.speed),
        u_holo_noise: u(p.noise),
        u_holo_alpha: u(p.transparency),
        u_holo_fresnel: u(p.fresnel),
        u_holo_glitch: u(p.glitch)
      };
    },
    updateUniforms(uni, p) {
      uni.u_holo_intensity.value = p.intensity;
      uni.u_holo_color.value.set(p.color);
      uni.u_holo_scan.value = p.scanlines;
      uni.u_holo_speed.value = p.speed;
      uni.u_holo_noise.value = p.noise;
      uni.u_holo_alpha.value = p.transparency;
      uni.u_holo_fresnel.value = p.fresnel;
      uni.u_holo_glitch.value = p.glitch;
    },
    fnHeader: FRESNEL_FN,
    vertex: (p) => /* glsl */`
      {
        // Glitch leve preso ao objeto: desloca fatias horizontais no espaço do objeto.
        float band = floor((position.y + uNcmTime * 0.6) * 6.0);
        float jitter = (ncmHash11(band + floor(uNcmTime * 8.0)) - 0.5) * u_holo_glitch * 0.06;
        transformed.x += jitter;
      }
    `,
    fragment: (p) => /* glsl */`
      {
        vec3 viewDirW = normalize(cameraPosition - vNcmWorldPos);
        float fres = ncmFresnel(vNcmNormalW, viewDirW, u_holo_fresnel);
        float sl = 0.5 + 0.5 * sin(vNcmWorldPos.y * 40.0 - uNcmTime * u_holo_speed * 6.0);
        sl = pow(sl, 3.0) * u_holo_scan;
        float n = ncmNoise3(vNcmWorldPos * 8.0 + uNcmTime * 0.6) * u_holo_noise;
        vec3 holoColor = u_holo_color * (0.6 + fres * 1.4 + sl + n);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, holoColor, clamp(u_holo_intensity, 0.0, 1.0));
        gl_FragColor.rgb += u_holo_color * fres * u_holo_intensity * 0.6;
        gl_FragColor.a *= mix(1.0, (1.0 - u_holo_alpha) + fres * u_holo_alpha, 1.0);
      }
    `
  },

  glitch: {
    key: 'glitch',
    label: 'Glitch',
    params: [
      { key: 'intensity', label: 'Intensidade', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
      { key: 'speed',     label: 'Velocidade',   type: 'range', min: 0, max: 5, step: 0.01, default: 2.0 },
      { key: 'frequency', label: 'Frequência',   type: 'range', min: 1, max: 40, step: 1,   default: 10 },
      { key: 'rgbSplit',  label: 'RGB Split',    type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'displace',  label: 'Deslocamento', type: 'range', min: 0, max: 0.3, step: 0.001, default: 0.05 },
      { key: 'noise',     label: 'Ruído',        type: 'range', min: 0, max: 1, step: 0.01, default: 0.3 }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms(p) {
      return {
        u_glitch_intensity: u(p.intensity),
        u_glitch_speed: u(p.speed),
        u_glitch_freq: u(p.frequency),
        u_glitch_rgb: u(p.rgbSplit),
        u_glitch_disp: u(p.displace),
        u_glitch_noise: u(p.noise)
      };
    },
    updateUniforms(uni, p) {
      uni.u_glitch_intensity.value = p.intensity;
      uni.u_glitch_speed.value = p.speed;
      uni.u_glitch_freq.value = p.frequency;
      uni.u_glitch_rgb.value = p.rgbSplit;
      uni.u_glitch_disp.value = p.displace;
      uni.u_glitch_noise.value = p.noise;
    },
    vertex: (p) => /* glsl */`
      {
        // Distorção espacial real (vertex shader) em fatias — desloca a
        // geometria em blocos, não apenas a imagem final.
        float t = floor(uNcmTime * u_glitch_speed * 6.0);
        float band = floor(position.y * u_glitch_freq);
        float trigger = step(0.82, ncmHash11(band * 3.17 + t));
        float off = (ncmHash11(band * 9.31 + t) - 0.5) * u_glitch_disp * trigger;
        transformed.x += off * u_glitch_intensity;
        transformed.z += off * 0.4 * u_glitch_intensity;
      }
    `,
    fragment: (p) => /* glsl */`
      {
        // Corrupção visual por canal (fragment shader) — aproxima RGB split
        // sem post-processing global, ver nota no topo do arquivo.
        float t = floor(uNcmTime * u_glitch_speed * 10.0);
        float band = floor(gl_FragCoord.y / max(u_glitch_freq, 1.0));
        float active = step(1.0 - u_glitch_intensity * 0.9, ncmHash11(band + t));
        float rShift = ncmHash11(band * 1.7 + t) * u_glitch_rgb * active;
        float bShift = ncmHash11(band * 2.9 + t + 5.0) * u_glitch_rgb * active;
        vec3 c = gl_FragColor.rgb;
        c.r = mix(c.r, c.r * (1.0 + rShift), active);
        c.b = mix(c.b, c.b * (1.0 - bShift), active);
        float n = (ncmNoise3(vec3(gl_FragCoord.xy * 0.5, t)) - 0.5) * u_glitch_noise * active;
        c += n;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, c, u_glitch_intensity);
      }
    `
  },

  error: {
    key: 'error',
    label: 'Error',
    params: [
      { key: 'intensity',  label: 'Intensidade', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
      { key: 'rgbSplit',   label: 'RGB Split',    type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'scanlines',  label: 'Scanlines',    type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'flicker',    label: 'Flicker',      type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'noise',      label: 'Noise',        type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'distortion', label: 'Distortion',   type: 'range', min: 0, max: 0.2, step: 0.001, default: 0.03 },
      { key: 'color',      label: 'Cor',          type: 'color', default: '#ff1e4a' }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms(p) {
      return {
        u_error_intensity: u(p.intensity),
        u_error_rgb: u(p.rgbSplit),
        u_error_scan: u(p.scanlines),
        u_error_flicker: u(p.flicker),
        u_error_noise: u(p.noise),
        u_error_disp: u(p.distortion),
        u_error_color: u(new THREE.Color(p.color))
      };
    },
    updateUniforms(uni, p) {
      uni.u_error_intensity.value = p.intensity;
      uni.u_error_rgb.value = p.rgbSplit;
      uni.u_error_scan.value = p.scanlines;
      uni.u_error_flicker.value = p.flicker;
      uni.u_error_noise.value = p.noise;
      uni.u_error_disp.value = p.distortion;
      uni.u_error_color.value.set(p.color);
    },
    vertex: (p) => /* glsl */`
      {
        float t = floor(uNcmTime * 14.0);
        float band = floor(position.y * 20.0);
        float trigger = step(0.85, ncmHash11(band + t));
        transformed.x += (ncmHash11(band * 4.1 + t) - 0.5) * u_error_disp * trigger;
      }
    `,
    fragment: (p) => /* glsl */`
      {
        float flick = 1.0 - u_error_flicker * step(0.5, ncmHash11(floor(uNcmTime * 20.0)));
        float band = floor(gl_FragCoord.y / 3.0);
        float t = floor(uNcmTime * 12.0);
        float rShift = ncmHash11(band + t) * u_error_rgb;
        vec3 c = gl_FragColor.rgb;
        c.r = mix(c.r, 1.0, rShift * 0.5 * u_error_intensity);
        c.g = mix(c.g, c.g * 0.6, rShift * u_error_intensity);
        float sl = step(0.5, fract(gl_FragCoord.y * 0.5 + uNcmTime * 6.0)) * u_error_scan;
        c = mix(c, u_error_color, sl * 0.5 * u_error_intensity);
        float n = (ncmNoise3(vec3(gl_FragCoord.xy * 0.8, t)) - 0.5) * u_error_noise;
        c += n * u_error_intensity;
        c *= flick;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, c, u_error_intensity);
      }
    `
  },

  dissolve: {
    key: 'dissolve',
    label: 'Dissolve',
    params: [
      { key: 'intensity',  label: 'Intensidade',  type: 'range', min: 0, max: 1, step: 0.01, default: 1.0 },
      { key: 'threshold',  label: 'Threshold',    type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'edgeWidth',  label: 'Edge Width',   type: 'range', min: 0, max: 0.3, step: 0.001, default: 0.06 },
      { key: 'edgeColor',  label: 'Edge Color',   type: 'color', default: '#ff8a00' },
      { key: 'noiseScale', label: 'Noise Scale',  type: 'range', min: 0.1, max: 10, step: 0.1, default: 2.5 },
      { key: 'noiseSpeed', label: 'Noise Speed',  type: 'range', min: 0, max: 3, step: 0.01, default: 0.2 }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms(p) {
      return {
        u_dis_intensity: u(p.intensity),
        u_dis_threshold: u(p.threshold),
        u_dis_edgeW: u(p.edgeWidth),
        u_dis_edgeColor: u(new THREE.Color(p.edgeColor)),
        u_dis_scale: u(p.noiseScale),
        u_dis_speed: u(p.noiseSpeed)
      };
    },
    updateUniforms(uni, p) {
      uni.u_dis_intensity.value = p.intensity;
      uni.u_dis_threshold.value = p.threshold;
      uni.u_dis_edgeW.value = p.edgeWidth;
      uni.u_dis_edgeColor.value.set(p.edgeColor);
      uni.u_dis_scale.value = p.noiseScale;
      uni.u_dis_speed.value = p.noiseSpeed;
    },
    fragment: (p) => /* glsl */`
      {
        float nval = ncmNoise3(vNcmWorldPos * u_dis_scale + uNcmTime * u_dis_speed);
        float cutoff = u_dis_threshold;
        if (u_dis_intensity > 0.001 && nval < cutoff) discard;
        float edge = smoothstep(cutoff, cutoff + u_dis_edgeW, nval);
        float edgeMask = (1.0 - edge) * step(cutoff, nval);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_dis_edgeColor, edgeMask * u_dis_intensity);
        gl_FragColor.rgb += u_dis_edgeColor * edgeMask * u_dis_intensity * 1.5;
      }
    `
  },

  toon: {
    key: 'toon',
    label: 'Toon',
    params: [
      { key: 'intensity', label: 'Intensidade', type: 'range', min: 0, max: 1, step: 0.01, default: 1.0 },
      { key: 'bands',     label: 'Tons',         type: 'range', min: 2, max: 6, step: 1,    default: 3 },
      { key: 'rim',       label: 'Rim leve',     type: 'range', min: 0, max: 1, step: 0.01, default: 0.25 }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms(p) {
      return {
        u_toon_intensity: u(p.intensity),
        u_toon_bands: u(p.bands),
        u_toon_rim: u(p.rim)
      };
    },
    updateUniforms(uni, p) {
      uni.u_toon_intensity.value = p.intensity;
      uni.u_toon_bands.value = p.bands;
      uni.u_toon_rim.value = p.rim;
    },
    fnHeader: FRESNEL_FN,
    fragment: (p) => /* glsl */`
      {
        float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        float bands = max(u_toon_bands, 2.0);
        float qLum = floor(lum * bands + 0.5) / bands;
        float scale = (lum > 0.0001) ? (qLum / lum) : 1.0;
        vec3 toonColor = gl_FragColor.rgb * scale;
        vec3 viewDirW = normalize(cameraPosition - vNcmWorldPos);
        float rim = ncmFresnel(vNcmNormalW, viewDirW, 2.5) * u_toon_rim;
        toonColor = mix(toonColor, vec3(0.0), rim * 0.6);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, toonColor, u_toon_intensity);
      }
    `
  },

  xray: {
    key: 'xray',
    label: 'X-Ray',
    params: [
      { key: 'intensity', label: 'Intensidade', type: 'range', min: 0, max: 1, step: 0.01, default: 0.8 },
      { key: 'power',     label: 'Power',        type: 'range', min: 0.1, max: 6, step: 0.1, default: 2.2 },
      { key: 'color',     label: 'Cor',          type: 'color', default: '#3fd0ff' }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms(p) {
      return {
        u_xray_intensity: u(p.intensity),
        u_xray_power: u(p.power),
        u_xray_color: u(new THREE.Color(p.color))
      };
    },
    updateUniforms(uni, p) {
      uni.u_xray_intensity.value = p.intensity;
      uni.u_xray_power.value = p.power;
      uni.u_xray_color.value.set(p.color);
    },
    fnHeader: FRESNEL_FN,
    // materialPatch: aplica configurações extras de material necessárias para
    // o X-Ray funcionar corretamente em objetos 3D (transparência + BackSide).
    materialPatch: (mat, active) => {
      if (active) {
        mat.userData._ncmPrevTransparent = mat.userData._ncmPrevTransparent ?? mat.transparent;
        mat.userData._ncmPrevSide = mat.userData._ncmPrevSide ?? mat.side;
        mat.userData._ncmPrevDepthWrite = mat.userData._ncmPrevDepthWrite ?? mat.depthWrite;
        mat.transparent = true;
        mat.side = THREE.DoubleSide;
        mat.depthWrite = false;
      } else if (mat.userData._ncmPrevTransparent !== undefined) {
        mat.transparent = mat.userData._ncmPrevTransparent;
        mat.side = mat.userData._ncmPrevSide;
        mat.depthWrite = mat.userData._ncmPrevDepthWrite;
        delete mat.userData._ncmPrevTransparent;
        delete mat.userData._ncmPrevSide;
        delete mat.userData._ncmPrevDepthWrite;
      }
    },
    fragment: (p) => /* glsl */`
      {
        vec3 viewDirW = normalize(cameraPosition - vNcmWorldPos);
        float fres = ncmFresnel(vNcmNormalW, viewDirW, u_xray_power);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_xray_color, fres * u_xray_intensity);
        gl_FragColor.rgb += u_xray_color * fres * fres * u_xray_intensity;
        float alpha = mix(0.12, 1.0, fres);
        gl_FragColor.a = mix(gl_FragColor.a, alpha, u_xray_intensity);
      }
    `
  },

  fresnel: {
    key: 'fresnel',
    label: 'Fresnel',
    params: [
      { key: 'intensity', label: 'Intensidade', type: 'range', min: 0, max: 2, step: 0.01, default: 1.0 },
      { key: 'power',     label: 'Power',        type: 'range', min: 0.1, max: 8, step: 0.1, default: 2.0 },
      { key: 'color',     label: 'Cor',          type: 'color', default: '#ffffff' }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms(p) {
      return {
        u_fres_intensity: u(p.intensity),
        u_fres_power: u(p.power),
        u_fres_color: u(new THREE.Color(p.color))
      };
    },
    updateUniforms(uni, p) {
      uni.u_fres_intensity.value = p.intensity;
      uni.u_fres_power.value = p.power;
      uni.u_fres_color.value.set(p.color);
    },
    fnHeader: FRESNEL_FN,
    fragment: (p) => /* glsl */`
      {
        vec3 viewDirW = normalize(cameraPosition - vNcmWorldPos);
        float fres = ncmFresnel(vNcmNormalW, viewDirW, u_fres_power);
        gl_FragColor.rgb += u_fres_color * fres * u_fres_intensity;
      }
    `
  },

  // Outline "puro": só a casca (o shell é criado/gerido pelo OutlineShell.js).
  // Não modifica o fragment shader do material original.
  outline: {
    key: 'outline',
    label: 'Outline',
    needsShell: true,
    shellOnly: true,
    params: [
      { key: 'width', label: 'Espessura', type: 'range', min: 0.001, max: 0.08, step: 0.001, default: 0.02 },
      { key: 'color', label: 'Cor', type: 'color', default: '#ffffff' }
    ],
    defaults() { return Object.fromEntries(this.params.map(p => [p.key, p.default])); },
    uniforms: () => ({}),
    updateUniforms: () => {},
    vertex: () => '',
    fragment: () => ''
  }
};

export const EFFECT_KEYS = Object.keys(EFFECTS).filter(k => k !== 'none');
export const DOMAIN_EFFECT_KEYS = EFFECT_KEYS; // Domínio permite todos os mesmos tipos

export function getEffect(key) {
  return EFFECTS[key] || EFFECTS.none;
}
