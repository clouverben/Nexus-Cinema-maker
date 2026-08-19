// shader-system/DomainManager.js
//
// Domínio = uma região espacial real da cena 3D (não um retângulo 2D da
// tela). O usuário toca/arrasta na viewport; o traçado é projetado no plano
// do chão (raycasting real, y = 0) e extrudado numa caixa 3D com altura
// ajustável. Todo objeto cuja bounding box (mundo) intersecta essa caixa
// recebe os efeitos marcados na aba Domínio; ao sair, volta ao material
// normal — tudo verificado por posição/limites em coordenadas de mundo
// (nunca por posição 2D de tela).

import * as THREE from 'three';
import { app, markSceneDirty } from '../scene.js';
import { getEffect, DOMAIN_EFFECT_KEYS } from './EffectLibrary.js';
import { setDomainForMesh } from './ShaderEffectManager.js';

const _unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _tmpBox = new THREE.Box3();
const _domainBox = new THREE.Box3();

const state = {
  domain: null,        // { mesh, wire, center:Vector3, size:Vector3 }
  drawing: false,
  dragStart: null,      // Vector3 on floor
  onNotify: null,        // callback(message|null) set by ui.js
  effects: {},           // key -> { enabled: bool, params: {...} }
  height: 3,
  elevation: 0,
  opacity: 0.20
};

for (const key of DOMAIN_EFFECT_KEYS) {
  state.effects[key] = { enabled: false, params: getEffect(key).defaults() };
}

function _notify(msg) {
  state.onNotify?.(msg);
}

export function onDomainNotify(cb) {
  state.onNotify = cb;
}

function _ndc(event, rect) {
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
}

function _floorPoint(event) {
  const rect = app.renderer.domElement.getBoundingClientRect();
  const ndc = _ndc(event, rect);
  app.raycaster.setFromCamera(ndc, app.camera);
  const out = new THREE.Vector3();
  const hit = app.raycaster.ray.intersectPlane(_floorPlane, out);
  return hit || null;
}

function _ensurePreviewMesh() {
  if (state._preview) return state._preview;
  const mat = new THREE.MeshBasicMaterial({
    color: 0x35e8ff,
    transparent: true,
    opacity: state.opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(_unitBoxGeo, mat);
  mesh.userData.isHelper = true;
  mesh.visible = false;
  app.scene.add(mesh);
  state._preview = mesh;
  return mesh;
}

// ─── Fluxo de desenho ───────────────────────────────────────────────────────

export function beginDomainDraw() {
  if (state.drawing) return;
  if (!app.renderer || !app.scene) return;
  state.drawing = true;
  app.domainDrawing = true;
  if (app.controls) app.controls.enabled = false;
  _notify('Toque e arraste na cena para definir o domínio.');

  const canvas = app.renderer.domElement;
  canvas.addEventListener('pointerdown', _onPointerDown);
  canvas.addEventListener('pointermove', _onPointerMove);
  canvas.addEventListener('pointerup', _onPointerUp);
}

function _cancelDrawListeners() {
  const canvas = app.renderer.domElement;
  canvas.removeEventListener('pointerdown', _onPointerDown);
  canvas.removeEventListener('pointermove', _onPointerMove);
  canvas.removeEventListener('pointerup', _onPointerUp);
  state.drawing = false;
  app.domainDrawing = false;
  if (app.controls) app.controls.enabled = true;
}

function _onPointerDown(e) {
  e.preventDefault();
  const p = _floorPoint(e);
  if (!p) return;
  state.dragStart = p;
  const prev = _ensurePreviewMesh();
  prev.visible = true;
  prev.position.set(p.x, 0.01, p.z);
  prev.scale.set(0.001, 0.02, 0.001);
}

function _onPointerMove(e) {
  if (!state.dragStart) return;
  e.preventDefault();
  const p = _floorPoint(e);
  if (!p) return;
  const minX = Math.min(state.dragStart.x, p.x);
  const maxX = Math.max(state.dragStart.x, p.x);
  const minZ = Math.min(state.dragStart.z, p.z);
  const maxZ = Math.max(state.dragStart.z, p.z);
  const sizeX = Math.max(maxX - minX, 0.05);
  const sizeZ = Math.max(maxZ - minZ, 0.05);
  const prev = _ensurePreviewMesh();
  prev.position.set((minX + maxX) / 2, 0.01, (minZ + maxZ) / 2);
  prev.scale.set(sizeX, 0.02, sizeZ);
}

function _onPointerUp(e) {
  if (!state.dragStart) { _cancelDrawListeners(); _notify(null); return; }
  e.preventDefault();
  const p = _floorPoint(e) || state.dragStart;
  const minX = Math.min(state.dragStart.x, p.x);
  const maxX = Math.max(state.dragStart.x, p.x);
  const minZ = Math.min(state.dragStart.z, p.z);
  const maxZ = Math.max(state.dragStart.z, p.z);
  const sizeX = Math.max(maxX - minX, 0.3);
  const sizeZ = Math.max(maxZ - minZ, 0.3);

  _finalizeDomain((minX + maxX) / 2, (minZ + maxZ) / 2, sizeX, sizeZ);

  if (state._preview) state._preview.visible = false;
  state.dragStart = null;
  _cancelDrawListeners();
  _notify(null);
}

function _finalizeDomain(cx, cz, sizeX, sizeZ) {
  clearDomain();

  const mat = new THREE.MeshBasicMaterial({
    color: 0x35e8ff,
    transparent: true,
    opacity: state.opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(_unitBoxGeo, mat);
  mesh.userData.isHelper = true;
  mesh.userData.isNcmDomain = true;

  const wireGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const wire = new THREE.LineSegments(
    wireGeo,
    new THREE.LineBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: 0.55 })
  );
  wire.userData.isHelper = true;
  mesh.add(wire);

  app.scene.add(mesh);

  state.domain = {
    mesh,
    wire,
    center: new THREE.Vector3(cx, 0, cz),
    size: new THREE.Vector2(sizeX, sizeZ)
  };

  _applyDomainTransform();
  markSceneDirty();
}

function _applyDomainTransform() {
  const d = state.domain;
  if (!d) return;
  const h = Math.max(state.height, 0.05);
  const y = state.elevation + h / 2;
  d.mesh.position.set(d.center.x, y, d.center.z);
  d.mesh.scale.set(d.size.x, h, d.size.y);
}

export function setDomainHeight(h) {
  state.height = Math.max(Number(h) || 0.05, 0.05);
  _applyDomainTransform();
  markSceneDirty();
}

export function setDomainElevation(y) {
  state.elevation = Number(y) || 0;
  _applyDomainTransform();
  markSceneDirty();
}

export function setDomainOpacity(value) {
  const n = Number(value);
  state.opacity = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : state.opacity;
  if (state._preview?.material) state._preview.material.opacity = state.opacity;
  if (state.domain?.mesh?.material) state.domain.mesh.material.opacity = state.opacity;
  markSceneDirty();
}

// Objetos que não devem participar do domínio: proxies de seleção (ex.: a
// esfera invisível de clique de uma luz), o próprio grupo de luz, e helpers
// internos (grid/eixos/gizmo já nem entram em app.objects — isso é reforço).
function _isDomainEligible(obj) {
  if (!obj) return false;
  if (obj.userData?.selectTarget) return false;
  if (obj.userData?.isLightObject) return false;
  if (obj.userData?.isHelper || obj.userData?.isNcmDomain || obj.userData?.isNcmShell) return false;
  return true;
}

export function getDomainSettings() {
  return { height: state.height, elevation: state.elevation, opacity: state.opacity, exists: !!state.domain };
}

export function clearDomain() {
  if (!state.domain) return;
  const d = state.domain;
  app.scene.remove(d.mesh);
  d.wire.geometry.dispose();
  d.wire.material.dispose();
  d.mesh.material.dispose();
  state.domain = null;

  // Reverte todos os objetos que pudessem estar dentro do domínio removido.
  for (const obj of app.objects) {
    if (!_isDomainEligible(obj)) continue;
    setDomainForMesh(obj, false, [], {}, { min: new THREE.Vector3(), max: new THREE.Vector3(), soft: 0.05 });
  }
  markSceneDirty();
}

// ─── Efeitos do domínio (aba "Domínio") ────────────────────────────────────

export function toggleDomainEffect(key, enabled) {
  if (!state.effects[key]) return;
  state.effects[key].enabled = !!enabled;
}

export function updateDomainEffectParam(key, paramKey, value) {
  if (!state.effects[key]) return;
  state.effects[key].params[paramKey] = value;
}

export function getDomainEffectsState() {
  return state.effects;
}

function _activeDomainKeysAndParams() {
  const keys = [];
  const paramsByKey = {};
  for (const key of DOMAIN_EFFECT_KEYS) {
    const e = state.effects[key];
    if (e?.enabled) {
      keys.push(key);
      paramsByKey[key] = e.params;
    }
  }
  return { keys, paramsByKey };
}

// ─── Tick (containment em tempo real) ──────────────────────────────────────

export function tickDomain() {
  const d = state.domain;
  if (!d || !app.objects) return;

  const halfX = d.size.x / 2;
  const halfZ = d.size.y / 2;
  const h = Math.max(state.height, 0.05);
  const minY = state.elevation;
  const maxY = state.elevation + h;
  _domainBox.min.set(d.center.x - halfX, minY, d.center.z - halfZ);
  _domainBox.max.set(d.center.x + halfX, maxY, d.center.z + halfZ);

  const { keys, paramsByKey } = _activeDomainKeysAndParams();
  for (const obj of app.objects) {
    // Só objetos "de verdade" participam do domínio: pula proxies de seleção
    // (ex.: a esfera invisível de clique de uma luz) e helpers internos —
    // Grupos (modelos importados) SÃO testados normalmente via bounding box.
    if (!_isDomainEligible(obj)) continue;
    // Garante matrizes de mundo atualizadas mesmo antes do renderer rodar
    // neste frame (evita 1 frame de atraso ao mover objetos via TransformControls).
    obj.updateMatrixWorld(true);
    _tmpBox.setFromObject(obj);
    const intersects = !_tmpBox.isEmpty() && _tmpBox.intersectsBox(_domainBox);
    // O domínio é um seletor de OBJETOS: quando o bounding box do objeto
    // entra no volume, o efeito do domínio deve ser aplicado ao objeto inteiro.
    // Isso evita mascarar/descartar fragmentos apenas na borda do volume e
    // elimina o caso em que o objeto parece desaparecer ao entrar no domínio.
    const fullObject = intersects;
    const boxInfo = {
      min: _domainBox.min,
      max: _domainBox.max,
      soft: Math.max(Math.min(halfX, halfZ, h) * 0.08, 0.02),
      fullObject
    };
    setDomainForMesh(obj, intersects, keys, paramsByKey, boxInfo);
  }
}
