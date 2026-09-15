// undo-redo.js — snapshot-based undo/redo for the 3D editor

import * as THREE from 'three';
import { app, markSceneDirty } from './scene.js';
import { resolveEffectTarget, serializeOwnEffect, restoreOwnEffects } from './ShaderEffectManager.js';

const MAX_HISTORY = 50;
const _history    = [];  // array of snapshot JSON strings
let   _cursor     = -1;
let   _paused     = false;
const _listeners  = [];

// ── Internal helpers ─────────────────────────────────────────────────────────
function _isUserObject(obj) {
  if (!app.scene) return false;
  if (obj === app.gridRoot)          return false;
  if (obj === app.axesHelper)        return false;
  if (obj === app.floor)             return false;
  if (obj === app.transformControls) return false;
  if (obj === app._tcHelper)         return false;
  if (obj.userData?.isHelper)        return false;
  if (obj.isLight && !obj.userData?.isLightObject) return false;
  if (obj.userData?.isBoneMarker)    return false;
  if (obj.isMesh && !obj.name)       return false;
  if (obj.isGroup && !obj.userData?.isLightObject && !obj.name) return false;
  return !!(obj.name?.trim()) || !!obj.userData?.isLightObject;
}

function _firstMesh(obj) {
  if (obj?.isMesh || obj?.isSkinnedMesh) return obj;
  let found = null;
  obj.traverse?.(o => {
    if (!found && (o.isMesh || o.isSkinnedMesh) && !o.userData?.isBoneMarker) found = o;
  });
  return found;
}

function _serializeObj(obj) {
  const entry = {
    uuid:     obj.uuid,
    name:     obj.name,
    type:     obj.type,
    position: obj.position.toArray(),
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.order],
    scale:    obj.scale.toArray(),
    visible:  obj.visible,
    shaderState: (() => {
      try {
        const target = resolveEffectTarget(obj);
        return target ? serializeOwnEffect(target) : { key: 'none', params: {} };
      } catch { return { key: 'none', params: {} }; }
    })(),
  };

  if (obj.userData?.isLightObject && obj.userData?.lightRef) {
    const l = obj.userData.lightRef;
    entry.lightState = {
      color:      l.color.getHex(),
      intensity:  l.intensity,
      distance:   l.distance ?? 0,
      castShadow: l.castShadow,
    };
  }

  const mesh = _firstMesh(obj);
  if (mesh?.material && !obj.userData?.isLightObject) {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    entry.matState = {
      color:             m.color?.getHex(),
      emissive:          m.emissive?.getHex(),
      emissiveIntensity: m.emissiveIntensity,
      roughness:         m.roughness,
      metalness:         m.metalness,
      opacity:           m.opacity,
      transparent:       m.transparent,
      wireframe:         m.wireframe,
    };
  }
  return entry;
}

function _takeSnapshot() {
  if (!app.scene || _paused) return null;
  try {
    const objs = app.scene.children.filter(_isUserObject).map(_serializeObj);
    // Particle Labs systems aren't regular scene children with the fields
    // _serializeObj captures (they're config-driven — see particle-engine.js
    // toJSON()) so they ride along as their own snapshot field instead.
    const particleLab = window._nexusParticleLab?.serializeSystems?.() ?? null;
    return JSON.stringify({ objects: objs, particleLab });
  } catch { return null; }
}

function _notify() {
  const canU = canUndo();
  const canR = canRedo();
  _listeners.forEach(fn => fn(canU, canR));
  const u = document.getElementById('undoBtn');
  const r = document.getElementById('redoBtn');
  if (u) u.disabled = !canU;
  if (r) r.disabled = !canR;
}

function _applyMat(m, s) {
  if (!m || !s) return;
  if (s.color     !== undefined) m.color?.setHex(s.color);
  if (s.emissive  !== undefined) m.emissive?.setHex(s.emissive);
  if (s.emissiveIntensity !== undefined) m.emissiveIntensity = s.emissiveIntensity;
  if (s.roughness !== undefined) m.roughness   = s.roughness;
  if (s.metalness !== undefined) m.metalness   = s.metalness;
  if (s.opacity   !== undefined) m.opacity     = s.opacity;
  if (s.transparent !== undefined) m.transparent = s.transparent;
  if (s.wireframe !== undefined) m.wireframe   = s.wireframe;
  m.needsUpdate = true;
}

function _restore(snap) {
  if (!snap || !app.scene) return;
  _paused = true;
  try {
    const data   = JSON.parse(snap);
    const byUUID = new Map();
    app.scene.children.filter(_isUserObject).forEach(o => byUUID.set(o.uuid, o));

    const snapUUIDs = new Set(data.objects.map(e => e.uuid));

    // Remove objects absent from snapshot
    byUUID.forEach((obj, uuid) => {
      if (!snapUUIDs.has(uuid)) {
        app.scene.remove(obj);
        const i = app.objects.indexOf(obj);
        if (i !== -1) app.objects.splice(i, 1);
      }
    });

    // Restore transforms + state for existing objects
    data.objects.forEach(entry => {
      const obj = byUUID.get(entry.uuid);
      if (!obj) return;

      obj.position.fromArray(entry.position);
      obj.rotation.set(entry.rotation[0], entry.rotation[1], entry.rotation[2], entry.rotation[3] || 'XYZ');
      obj.scale.fromArray(entry.scale);
      obj.visible = entry.visible;
      obj.name    = entry.name;

      if (entry.lightState && obj.userData?.lightRef) {
        const l = obj.userData.lightRef;
        l.color.setHex(entry.lightState.color);
        l.intensity  = entry.lightState.intensity;
        l.castShadow = entry.lightState.castShadow;
        if ('distance' in l) l.distance = entry.lightState.distance;
      }

      if (entry.matState) {
        const mesh = _firstMesh(obj);
        if (mesh?.material) {
          const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          _applyMat(m, entry.matState);
        }
      }

      if (entry.shaderState) {
        try {
          const target = resolveEffectTarget(obj);
          if (target) restoreOwnEffects(target, entry.shaderState);
        } catch (e) {
          console.warn('[undo-redo] Shader restore failed:', e);
        }
      }
    });

    markSceneDirty();
    app._ptTopologyDirty = true; // undo/redo can add/remove objects — path tracer BVH needs a full rebuild next time it's active
    if (app.transformControls) app.transformControls.detach();
    app.selected = null;
    window.dispatchEvent(new CustomEvent('scene-selection-changed', { detail: { object: null } }));

    // Particle Labs — only touch it when the snapshot actually recorded it
    // (older snapshots / scenes without a Lab instance have `null` here,
    // vs. a real-but-empty `[]`, so we never wipe an unrelated Lab).
    if (data.particleLab !== undefined && data.particleLab !== null && window._nexusParticleLab?.restoreSystems) {
      try {
        window._nexusParticleLab.restoreSystems(data.particleLab);
        window.dispatchEvent(new CustomEvent('_labsSystemsRestored'));
      } catch (e) {
        console.warn('[undo-redo] Particle Labs restore failed:', e);
      }
    }
  } catch (e) {
    console.warn('[undo-redo] Restore failed:', e);
  } finally {
    _paused = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function pushState() {
  if (_paused) return;
  const snap = _takeSnapshot();
  if (!snap) return;
  if (_cursor >= 0 && _history[_cursor] === snap) return;
  _history.splice(_cursor + 1);
  _history.push(snap);
  if (_history.length > MAX_HISTORY) _history.shift();
  _cursor = _history.length - 1;
  _notify();
}

export function undo() {
  if (!canUndo()) return;
  _cursor--;
  _restore(_history[_cursor]);
  _notify();
}

export function redo() {
  if (!canRedo()) return;
  _cursor++;
  _restore(_history[_cursor]);
  _notify();
}

export function canUndo() { return _cursor > 0; }
export function canRedo() { return _cursor < _history.length - 1; }

export function onHistoryChange(fn) { _listeners.push(fn); }

// ── Compat stubs used by older main.js wiring ────────────────────────────────
export function captureTransformState(obj) {
  if (!obj) return null;
  return {
    position: obj.position.toArray(),
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.order],
    scale:    obj.scale.toArray(),
  };
}

export function recordTransform(obj, before, after) {
  if (!obj || !before || !after) return;
  const changed =
    before.position.some((v, i) => Math.abs(v - after.position[i]) > 1e-6) ||
    before.rotation.some((v, i) => Math.abs(v - after.rotation[i]) > 1e-6) ||
    before.scale.some((v, i) => Math.abs(v - after.scale[i]) > 1e-6);
  if (changed) pushState();
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initUndoRedo() {
  // Take initial snapshot once scene is ready
  setTimeout(() => { pushState(); _notify(); }, 400);
}
