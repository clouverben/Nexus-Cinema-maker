// reflections.js — two independent reflection techniques, both configured
// per-object from the Material panel's right-side extension (see main.js):
//
// 1. CubeCamera (per-object, fully independent settings each): six tiny
//    renders around the object's own position, baked into an env map on
//    its material. Works on any shape, keeps updating even with the
//    footer lamp off (it's a material property, not a post-process).
//
// 2. SSR — Screen Space Reflections (one shared THREE.js SSRPass for the
//    whole scene — that's how the addon works, it isn't per-object).
//    Each object only has an on/off switch that adds/removes it from the
//    pass's `selects` list; the 5 quality knobs are shared/global and
//    editable from whichever object's panel happens to be open. SSR is a
//    post-process pass, so it only runs while the footer lamp is on.
import * as THREE from 'three';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { app } from './scene.js';

export const CUBECAM_DEFAULTS = Object.freeze({
  enabled:    false,
  resolution: 256,
  intensity:  1.0,
  near:       0.1,
  far:        1000,
  updateEvery: 1, // render a fresh env map every N frames — perf vs. accuracy
});

export const SSR_DEFAULTS = Object.freeze({
  opacity:         0.5,
  maxDistance:     180,
  thickness:       0.018,
  resolutionScale: 1,
  blur:            true,
});

export function ensureReflectionConfig(mesh) {
  if (!mesh.userData.reflection) {
    mesh.userData.reflection = {
      cubeCamera: { ...CUBECAM_DEFAULTS },
      ssrEnabled: false,
    };
  }
  return mesh.userData.reflection;
}

// Shared, scene-wide SSR quality settings — there's only one SSRPass, so
// these can't be per-object no matter which object's panel is showing them.
export const ssrSettings = { ...SSR_DEFAULTS };

// ── CubeCamera manager ───────────────────────────────────────────────────────
// uuid -> { cubeCamera, renderTarget, resolution, frame }
const _cubeRigs = new Map();

function _getCubeRig(mesh, resolution) {
  let rig = _cubeRigs.get(mesh.uuid);
  if (rig && rig.resolution !== resolution) {
    rig.renderTarget.dispose();
    rig = null;
  }
  if (!rig) {
    const renderTarget = new THREE.WebGLCubeRenderTarget(resolution);
    const cubeCamera = new THREE.CubeCamera(0.1, 1000, renderTarget);
    rig = { cubeCamera, renderTarget, resolution, frame: 0 };
    _cubeRigs.set(mesh.uuid, rig);
  }
  return rig;
}

function _disposeCubeRig(uuid) {
  const rig = _cubeRigs.get(uuid);
  if (!rig) return;
  rig.renderTarget.dispose();
  _cubeRigs.delete(uuid);
}

// Called once per frame (regardless of the footer lamp — this touches
// materials, not the post-process composer). Cheap no-op when nothing in
// the scene has CubeCamera reflections enabled.
export function updateCubeCameraReflections(renderer, scene) {
  if (!scene || !renderer) return;

  const stillPresent = new Set();

  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material || obj.userData?.isBoneMarker || obj.userData?.isHelper) return;
    const cfg = obj.userData.reflection?.cubeCamera;
    if (!cfg?.enabled) return;
    stillPresent.add(obj.uuid);

    const rig = _getCubeRig(obj, Math.round(cfg.resolution) || 256);
    rig.cubeCamera.near = Math.max(0.001, +cfg.near || 0.1);
    rig.cubeCamera.far  = Math.max(rig.cubeCamera.near + 0.01, +cfg.far || 1000);
    rig.cubeCamera.updateProjectionMatrix?.();

    const every = Math.max(1, Math.round(+cfg.updateEvery || 1));
    rig.frame++;
    if (rig.frame % every !== 0 && obj.material.envMap) {
      // Skip the (relatively expensive) 6-face render this frame, but
      // still keep the intensity live-editable without a re-render.
      obj.material.envMapIntensity = +cfg.intensity || 0;
      return;
    }

    const wasVisible = obj.visible;
    obj.visible = false; // don't reflect the object's own surface onto itself
    rig.cubeCamera.position.copy(obj.getWorldPosition(new THREE.Vector3()));
    rig.cubeCamera.update(renderer, scene);
    obj.visible = wasVisible;

    obj.material.envMap = rig.renderTarget.texture;
    obj.material.envMapIntensity = +cfg.intensity || 0;
    obj.material.needsUpdate = true;
  });

  // Clean up rigs for objects that got deleted or had CubeCamera disabled.
  for (const uuid of Array.from(_cubeRigs.keys())) {
    if (!stillPresent.has(uuid)) _disposeCubeRig(uuid);
  }
}

// ── SSR (shared pass) ────────────────────────────────────────────────────────
let _ssrPass = null;

function _applySSRSettings(pass) {
  pass.opacity         = +ssrSettings.opacity         || 0;
  pass.maxDistance      = +ssrSettings.maxDistance     || 0;
  pass.thickness        = +ssrSettings.thickness       || 0;
  pass.resolutionScale = THREE.MathUtils.clamp(+ssrSettings.resolutionScale || 1, 0.1, 1);
  pass.blur              = !!ssrSettings.blur;
}

// Returns [ssrPass] if at least one mesh currently has SSR enabled, else [].
// Rebuilding only happens through refreshReflectionsPipeline() (see
// posprocess.js) — same on/off-doesn't-need-a-rebuild philosophy as the
// God Rays passes, except here the *pass itself* only needs to exist at
// all once something opts in; its `selects` array is refreshed every call.
export function buildSSRPasses() {
  if (!app.scene || !app.camera || !app.renderer) return [];

  const selected = [];
  app.scene.traverse((obj) => {
    if (obj.isMesh && obj.userData?.reflection?.ssrEnabled) selected.push(obj);
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
  for (const uuid of Array.from(_cubeRigs.keys())) _disposeCubeRig(uuid);
  _ssrPass?.dispose?.();
  _ssrPass = null;
}
