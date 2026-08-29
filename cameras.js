// ==================== CAMERAS.JS v2 ====================
// Scene Camera System — Blender-accurate minimalist look
//
// Fixes vs v1:
//  1. New cameras spawn at the CURRENT viewport camera's position + look
//     direction + FOV/aspect — "Camera 2" now literally starts from where
//     you're looking, framing the same thing you were just seeing.
//  2. Gizmo is a lightweight wireframe pyramid + up-triangle (Blender's
//     actual camera look — confirmed: "looks like a wireframe pyramid with
//     a triangle attached"), NOT a solid shaded box/lens model. Its size is
//     tied to a fixed `gizmoSize` (default 1 unit ≈ the default cube),
//     completely independent of the camera's real `far` clip value — this
//     is what made the previous version look huge (THREE.CameraHelper's
//     frustum pyramid literally extends out to camera.far = 500 units).
//  3. Both the real POV camera AND the gizmo are parented directly to the
//     marker Object3D, so they inherit position/rotation automatically via
//     the normal scene-graph matrix update — no manual per-frame sync
//     needed at all (works correctly with TransformControls dragging AND
//     with AnimationSystem keyframes moving the marker).

import * as THREE from 'three';
import { app, markSceneDirty } from './scene.js';

let _cameras   = [];    // SceneCameraObj[]
let _nextId    = 1;
let _activePOV = null;  // SceneCameraObj | null
let _savedCam  = null;  // { camera, target } — viewport state saved on POV enter

const GIZMO_COLOR_DEFAULT  = 0xb5b5b5; // neutral grey, unselected (Blender-ish)
const GIZMO_COLOR_SELECTED = 0xffb14a; // orange highlight — matches --accent-orange in ui.css

// ─── SceneCameraObj ─────────────────────────────────────────────────────────
class SceneCameraObj {
    constructor(scene, opts = {}) {
        this.id   = _nextId++;
        this.name = opts.name ?? `Câmera ${this.id}`;

        const fov    = opts.fov    ?? 45;
        const aspect = opts.aspect ?? (app.camera ? app.camera.aspect : 16/9);
        const near   = opts.near   ?? 0.1;
        const far    = opts.far    ?? 1000;

        // ── Real camera, used only when the user "enters" its POV ─────────
        this.cam = new THREE.PerspectiveCamera(fov, aspect, near, far);
        this.cam.name = this.name + '_internal';

        // ── Marker: visible in hierarchy, TransformControls attaches here,
        //    AnimationSystem keyframes its position/rotation directly.
        this.marker = new THREE.Object3D();
        this.marker.name = this.name;
        this.marker.userData = { isSceneCamera: true, sceneCameraRef: this };

        // Both the real camera and the gizmo are CHILDREN of the marker —
        // they inherit its world transform automatically every frame via
        // the standard scene-graph matrixWorld update. No manual sync().
        this.marker.add(this.cam);

        this.gizmoSize = opts.gizmoSize ?? 1.0; // ≈ size of the default 1-unit cube
        this.gizmoGroup = new THREE.Group();
        this.gizmoGroup.userData.isHelper = true;
        this.marker.add(this.gizmoGroup);
        this._lastFov = null; this._lastAspect = null;
        this._rebuildGizmo(fov, aspect);

        // ── Position + orientation ─────────────────────────────────────────
        if (opts.position) {
            Array.isArray(opts.position) ? this.marker.position.fromArray(opts.position)
                                          : this.marker.position.copy(opts.position);
        } else {
            this.marker.position.set(0, 2, 6);
        }
        if (opts.quaternion) {
            this.marker.quaternion.copy(opts.quaternion);       // exact viewport orientation
        } else if (opts.rotation) {
            this.marker.rotation.set(opts.rotation[0], opts.rotation[1], opts.rotation[2]);
        } else {
            this.marker.lookAt(0, 0, 0);
        }

        scene.add(this.marker);
    }

    /** Rebuilds the wireframe pyramid gizmo (pos/rot inherited from parent — never touched here) */
    _rebuildGizmo(fov, aspect) {
        if (this._lastFov === fov && this._lastAspect === aspect && this.gizmoGroup.children.length) return;
        this._lastFov = fov; this._lastAspect = aspect;

        while (this.gizmoGroup.children.length) {
            const c = this.gizmoGroup.children.pop();
            c.geometry?.dispose();
            c.material?.dispose();
        }

        const dist = this.gizmoSize;
        const hH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * dist;
        const hW = hH * aspect;

        const c0 = [-hW, -hH, -dist], c1 = [hW, -hH, -dist];
        const c2 = [ hW,  hH, -dist], c3 = [-hW, hH, -dist];

        const pts = [];
        // 4 legs: apex (local origin = camera position) → each base corner
        [c0, c1, c2, c3].forEach(c => pts.push(0, 0, 0, ...c));
        // base rectangle
        pts.push(...c0, ...c1,  ...c1, ...c2,  ...c2, ...c3,  ...c3, ...c0);
        // little "up" triangle sitting on the top edge (Blender's orientation cue)
        const triApex = [0, hH + hH * 0.65, -dist];
        const triL    = [-hW * 0.28, hH, -dist];
        const triR    = [ hW * 0.28, hH, -dist];
        pts.push(...triL, ...triApex,  ...triApex, ...triR);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        this._gizmoMat = new THREE.LineBasicMaterial({ color: GIZMO_COLOR_DEFAULT });
        const lines = new THREE.LineSegments(geo, this._gizmoMat);
        lines.userData.isHelper = true;
        this.gizmoGroup.add(lines);

        // Tiny origin dot — helps see exactly where the apex/pivot sits
        const dotGeo = new THREE.SphereGeometry(dist * 0.035, 8, 6);
        this._dotMat = new THREE.MeshBasicMaterial({ color: GIZMO_COLOR_DEFAULT });
        const dot = new THREE.Mesh(dotGeo, this._dotMat);
        dot.userData.isHelper = true;
        this.gizmoGroup.add(dot);
    }

    setFOV(fov) {
        this.cam.fov = fov;
        this.cam.updateProjectionMatrix();
        this._rebuildGizmo(fov, this.cam.aspect);
        markSceneDirty();
    }
    setNear(v) { this.cam.near = v; this.cam.updateProjectionMatrix(); markSceneDirty(); }
    setFar(v)  { this.cam.far  = v; this.cam.updateProjectionMatrix(); markSceneDirty(); }

    setHelperVisible(v) { this.gizmoGroup.visible = v; }

    /** Orange highlight when selected — matches Blender's active-object outline color */
    setSelected(isSel) {
        const c = isSel ? GIZMO_COLOR_SELECTED : GIZMO_COLOR_DEFAULT;
        this._gizmoMat?.color.setHex(c);
        this._dotMat?.color.setHex(c);
    }

    destroy(scene) {
        this.marker.traverse(c => {
            c.geometry?.dispose();
            if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
        });
        scene.remove(this.marker);
    }

    toJSON() {
        return {
            id:       this.id,
            name:     this.name,
            position: this.marker.position.toArray(),
            rotation: [this.marker.rotation.x, this.marker.rotation.y, this.marker.rotation.z],
            fov:      this.cam.fov,
            aspect:   this.cam.aspect,
            near:     this.cam.near,
            far:      this.cam.far,
        };
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Adds a new scene camera. Unless explicitly overridden in `opts`, it spawns
 * at the CURRENT viewport camera's exact position, look direction, FOV,
 * aspect, near and far — so entering its POV immediately after creating it
 * shows the same framing you were just looking at in the viewport.
 */
export function addSceneCamera(opts = {}) {
    const vp = app.camera;
    const merged = { ...opts };
    if (!merged.position   && vp) merged.position   = vp.position.clone();
    if (!merged.quaternion && vp) merged.quaternion = vp.quaternion.clone();
    if (merged.fov    === undefined && vp) merged.fov    = vp.fov;
    if (merged.aspect === undefined && vp) merged.aspect = vp.aspect;
    if (merged.near   === undefined && vp) merged.near   = vp.near;
    if (merged.far    === undefined && vp) merged.far    = vp.far;

    const sc = new SceneCameraObj(app.scene, merged);
    _cameras.push(sc);
    _notify();
    markSceneDirty();
    return sc;
}

export function removeSceneCamera(sc) {
    if (_activePOV === sc) exitCameraPOV();
    sc.destroy(app.scene);
    _cameras = _cameras.filter(c => c !== sc);
    _notify();
    markSceneDirty();
}

export function enterCameraPOV(sc) {
    if (!sc || !app.camera) return;
    if (_activePOV === sc) return;       // already viewing through this one
    if (_activePOV) exitCameraPOV();     // exit any other active POV first

    _savedCam = {
        camera: app.camera,
        target: app.controls?.target.clone() ?? new THREE.Vector3(),
    };

    // Sync aspect to the actual current viewport size for correct framing
    if (app.renderer) {
        sc.cam.aspect = app.renderer.domElement.clientWidth / app.renderer.domElement.clientHeight;
        sc.cam.updateProjectionMatrix();
    }

    sc.setHelperVisible(false); // don't show your own frustum from inside (matches Blender)
    _activePOV = sc;
    app.camera = sc.cam;

    if (app.controls) {
        app.controls.object  = sc.cam;
        app.controls.enabled = false; // lock orbit while in POV
    }
    _notify();
    markSceneDirty();
}

export function exitCameraPOV() {
    if (!_activePOV) return;
    _activePOV.setHelperVisible(true);

    app.camera = app._mainCamera ?? _savedCam?.camera ?? app.camera;

    if (app.controls) {
        app.controls.object  = app.camera;
        app.controls.enabled = true;
        if (_savedCam?.target) app.controls.target.copy(_savedCam.target);
        app.controls.update();
    }
    _activePOV = null;
    _savedCam  = null;
    _notify();
    markSceneDirty();
}

export function getActivePOV()    { return _activePOV; }
export function getSceneCameras() { return _cameras; }

export function serializeCameras() {
    return _cameras.map(c => c.toJSON());
}
export function restoreCameras(data = []) {
    _cameras.forEach(c => c.destroy(app.scene));
    _cameras = [];
    data.forEach(d => {
        const sc = new SceneCameraObj(app.scene, {
            name: d.name, fov: d.fov, aspect: d.aspect, near: d.near, far: d.far,
            position: d.position, rotation: d.rotation,
        });
        sc.id = d.id;
        _cameras.push(sc);
    });
    _nextId = Math.max(_nextId, ..._cameras.map(c => c.id + 1), 1);
    _notify();
}

function _notify() {
    window.dispatchEvent(new Event('cameras-changed'));
    window.dispatchEvent(new Event('labs-systems-changed')); // refresh hierarchy panel
}

// ── Selection highlight: orange when the camera's marker is selected ───────
window.addEventListener('scene-selection-changed', e => {
    const sel = e.detail?.object ?? null;
    _cameras.forEach(sc => sc.setSelected(sel === sc.marker));
});

// Store main viewport camera ref once the engine finishes booting
window.addEventListener('_nexusEngineReady', () => {
    if (app.camera) app._mainCamera = app.camera;
});
