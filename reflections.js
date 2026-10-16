// reflections.js — Screen Space Reflections (SSR): a single shared
// THREE.js SSRPass covering the whole scene.
//
// This is a global render setting (Render panel → Pós-proc. tab), not a
// per-object property — the addon only ever supported one shared pass for
// the whole scene, so there was never a real reason to gate it per mesh.
// SSR is a post-process pass, so it only runs while the footer lamp (post-
// processing) is on.
import * as THREE from 'three';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { app } from './scene.js';

export const SSR_DEFAULTS = Object.freeze({
  enabled:         false,   // desligado por padrão: o usuário liga em Render → Pós-proc.
  opacity:         0.5,
  maxDistance:     180,
  thickness:       0.018,
  resolutionScale: 1,
  blur:            true,
  steps:           64,       // 64 = cobertura total do raio na tela (MAX_STEP = diagonal)
  fadeDistance:    60,
  fresnel:         1,
  minGlossiness:   0,
  distanceAttenuation: true,
  infiniteThick:   false,
});

// Shared, scene-wide SSR settings.
export const ssrSettings = { ...SSR_DEFAULTS };

let _ssrPass = null;

function _applySSRSettings(pass) {
  pass.opacity         = +ssrSettings.opacity         || 0;
  pass.maxDistance     = +ssrSettings.maxDistance     || 0;
  pass.thickness       = +ssrSettings.thickness       || 0;
  pass.resolutionScale = THREE.MathUtils.clamp(+ssrSettings.resolutionScale || 1, 0.1, 1);
  pass.blur            = !!ssrSettings.blur;
  // Flags reais do SSRPass (viram #defines no shader).
  if ('fresnel' in pass)             pass.fresnel = (+ssrSettings.fresnel) > 0;
  if ('distanceAttenuation' in pass) pass.distanceAttenuation = ssrSettings.distanceAttenuation !== false;
  if ('infiniteThick' in pass)       pass.infiniteThick = !!ssrSettings.infiniteThick;
  _applyMarchSteps(pass);
  if ('fadeDistance' in pass) pass.fadeDistance = +ssrSettings.fadeDistance || 0;
  if ('minGlossiness' in pass) pass.minGlossiness = +ssrSettings.minGlossiness || 0;
}

// MAX_STEP é o nº de passos do raio em pixels. O SSRPass fixa em diagonal da
// tela a cada setSize; aqui escalamos por "steps/64" (64 = cobertura total),
// o que dá controle real de qualidade x desempenho.
function _applyMarchSteps(pass) {
  const mat = pass.ssrMaterial;
  if (!mat || !mat.defines) return;
  const w = Math.max(1, pass.width || 1), h = Math.max(1, pass.height || 1);
  const diag = Math.sqrt(w * w + h * h) * THREE.MathUtils.clamp(pass.resolutionScale ?? 1, 0.1, 1);
  const frac = THREE.MathUtils.clamp((+ssrSettings.steps || 64) / 64, 0.125, 1);
  const next = Math.max(8, Math.ceil(diag * frac));
  if (mat.defines.MAX_STEP !== next) { mat.defines.MAX_STEP = next; mat.needsUpdate = true; }
}

function _reflectableMeshes() {
  const meshes = [];
  app.scene?.traverse((obj) => {
    if (obj.isMesh && obj.material && !obj.userData?.isBoneMarker && !obj.userData?.isHelper) {
      meshes.push(obj);
    }
  });
  return meshes;
}

// Returns the shared SSR pass when SSR is switched on (Render → Pós-proc. →
// Reflexos) AND the render pipeline is active (lamp / final render).
// Off by default: SSR is the most expensive layer and only helps scenes
// with glossy surfaces.
export function buildSSRPasses() {
  if (!ssrSettings.enabled) return [];
  if (!app.scene || !app.camera || !app.renderer) return [];

  const selected = _reflectableMeshes();
  if (!selected.length) return [];

  if (!_ssrPass) {
    const size = app.renderer.getSize(new THREE.Vector2());
    _ssrPass = new SSRPass({
      renderer: app.renderer,
      scene: app.scene,
      camera: app.camera,
      width: Math.max(1, Math.round(size.x)),
      height: Math.max(1, Math.round(size.y)),
      selects: selected,
    });
  }
  if (!_ssrPass._ncmHooked) {
    // setSize do SSRPass reescreve MAX_STEP — reaplica nosso valor depois.
    const origSetSize = _ssrPass.setSize?.bind(_ssrPass);
    if (origSetSize) _ssrPass.setSize = (w, h) => { origSetSize(w, h); _applyMarchSteps(_ssrPass); };
    _ssrPass._ncmHooked = true;
  }
  _ssrPass.selects = selected;
  _applySSRSettings(_ssrPass);
  return [_ssrPass];
}

// Call after changing any ssrSettings.* value — the pass instance is live,
// no pipeline rebuild needed, just re-apply the properties.
export function syncSSRSettings() {
  if (_ssrPass) _applySSRSettings(_ssrPass);
}

export function disposeReflections() {
  _ssrPass?.dispose?.();
  _ssrPass = null;
}
