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
  enabled:         false,
  opacity:         0.5,
  maxDistance:     180,
  thickness:       0.018,
  resolutionScale: 1,
  blur:            true,
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

// Returns [ssrPass] while the global SSR toggle is on and there's something
// in the scene to reflect, else []. Rebuilding only happens through
// refreshReflectionsPipeline() (see posprocess.js) — same on/off-doesn't-
// need-a-rebuild philosophy as the God Rays passes.
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
