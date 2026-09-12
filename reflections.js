// reflections.js — global Screen Space Reflections for the Render panel.
// CubeCamera/per-object reflection rigs were removed. Reflection is a render
// effect now: when the viewport render lamp is active, SSR is part of the
// compositor automatically. There is no per-object activation toggle.
import * as THREE from 'three';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { app } from './scene.js';

export const SSR_DEFAULTS = Object.freeze({
  opacity: 0.5,
  maxDistance: 180,
  thickness: 0.018,
  resolutionScale: 1,
  blur: true,
});

export const ssrSettings = {
  ...SSR_DEFAULTS,
  active: false,
};

let _ssrPass = null;

function _applySSRSettings(pass) {
  pass.opacity = Math.max(0, Number(ssrSettings.opacity) || 0);
  pass.maxDistance = Math.max(0, Number(ssrSettings.maxDistance) || 0);
  pass.thickness = Math.max(0.0001, Number(ssrSettings.thickness) || 0.0001);
  pass.resolutionScale = THREE.MathUtils.clamp(Number(ssrSettings.resolutionScale) || 1, 0.1, 1);
  pass.blur = !!ssrSettings.blur;
}

export function setSSRActive(active) {
  ssrSettings.active = !!active;
}

// Build one scene-wide SSR pass whenever the viewport render lamp is active.
// All visible meshes are eligible; there is no longer a per-object toggle.
export function buildSSRPasses() {
  if (!ssrSettings.active || !app.scene || !app.camera || !app.renderer) return [];

  const selected = [];
  app.scene.traverse(obj => {
    if (obj.isMesh && !obj.userData?.isBoneMarker && !obj.userData?.isHelper) selected.push(obj);
  });

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
  _ssrPass.scene = app.scene;
  _ssrPass.camera = app.camera;
  _ssrPass.selects = selected;
  _applySSRSettings(_ssrPass);
  return [_ssrPass];
}

export function syncSSRSettings() {
  if (_ssrPass) {
    _ssrPass.scene = app.scene;
    _ssrPass.camera = app.camera;
    _applySSRSettings(_ssrPass);
  }
}

export function disposeReflections() {
  _ssrPass?.dispose?.();
  _ssrPass = null;
  ssrSettings.active = false;
}
