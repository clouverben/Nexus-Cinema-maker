import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ─── Effective viewport size ────────────────────────────────────────────────
// Normally the app renders at the real browser window size. The launcher's
// "Tamanho do app" control (Configurações) can override this to a fixed
// width/height so the whole app can be previewed at an arbitrary screen
// size — every place that used to read window.innerWidth/innerHeight
// directly for sizing (camera aspect, renderer buffer) should go through
// this helper instead so both modes stay in sync.
//
// VIEWPORT_INSET: pulls the 3D view in by 3% of the base size on every
// side (6% off each axis in total), leaving a visible margin around the
// render instead of it going edge-to-edge. getViewportSize() also returns
// marginX/marginY (in px, relative to the base size) so callers that mount
// or reposition the canvas can center it inside that margin — see
// initScene()/onResize() below.
const VIEWPORT_INSET = 0.03;

export function getViewportSize() {
  const o = window._ncmViewportOverride;
  const base = (o && Number.isFinite(o.width) && Number.isFinite(o.height) && o.width > 0 && o.height > 0)
    ? { width: o.width, height: o.height }
    : { width: window.innerWidth, height: window.innerHeight };
  return {
    width:   Math.round(base.width  * (1 - 2 * VIEWPORT_INSET)),
    height:  Math.round(base.height * (1 - 2 * VIEWPORT_INSET)),
    marginX: Math.round(base.width  * VIEWPORT_INSET),
    marginY: Math.round(base.height * VIEWPORT_INSET),
  };
}

export const app = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  transformControls: null,
  gridRoot: null,
  axesHelper: null,
  defaultEnvironment: null,   // procedural studio IBL — fallback whenever no custom HDRI skybox is loaded
  _userGridVisible: true,   // Settings menu toggle — persists across per-frame helper resets
  _userAxesVisible: false,   // Settings menu toggle — persists across per-frame helper resets
  floor: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  objects: [],
  boneObjects: [],      // bone sphere meshes for raycasting
  boneUpdateFn: null,   // called every frame to sync bone sphere positions
  selected: null,
  initialized: false,
  mode: 'translate',
  deepSelectMode: false,
  sceneDirty: true,
  helpersVisible: true,
  renderPreviewActive: false,
  domainDrawing: false   // true while the user is dragging out a Domain area
};

export const helperRegistry = { objects: [] };

function physicalMaterialDefaults() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd7d7d7,
    roughness: 0.55,
    metalness: 0.08,
    clearcoat: 0,
    clearcoatRoughness: 0,
    transmission: 0,
    thickness: 0,
    ior: 1.5,
    sheen: 0,
    sheenRoughness: 1,
    iridescence: 0,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    specularIntensity: 1,
    specularColor: new THREE.Color(1, 1, 1),
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
    transparent: false,
    opacity: 1
  });
}

function makeGeometry(kind) {
  switch (kind) {
    case 'box':      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':   return new THREE.SphereGeometry(0.5, 32, 16);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    case 'cone':     return new THREE.ConeGeometry(0.55, 1, 24);
    case 'torus':    return new THREE.TorusGeometry(0.45, 0.16, 14, 28);
    default:         return new THREE.BoxGeometry(1, 1, 1);
  }
}

function geometryHeight(kind) {
  if (kind === 'sphere') return 0.5;
  if (kind === 'torus')  return 0.55;
  return 0.5;
}

function isUiTarget(target) {
  return !!(target && target.closest && target.closest('#ui'));
}

function dispatchSelectionChanged() {
  window.dispatchEvent(new CustomEvent('scene-selection-changed', {
    detail: { object: app.selected }
  }));
}

export function markSceneDirty() {
  app.sceneDirty = true;
}

function clearHighlight(object) {
  if (!object || !object.userData.__hl) return;
  const hl = object.userData.__hl;
  object.remove(hl);
  hl.geometry?.dispose?.();
  hl.material?.dispose?.();
  delete object.userData.__hl;
}

function addHighlight(object) {
  // No-op — selection glow is handled by OutlinePass via scene-selection-changed
  void object;
}

export function setSelected(object) {
  if (app.selected === object) {
    // In group-pick mode the user may click the same already-selected object
    // as their first or second pick — still fire the event so the group handler
    // can process it (scene.js has no direct access to the flag, so we read the
    // global that main.js sets when group pick is active).
    if (window._groupPickMode && object) dispatchSelectionChanged();
    return;
  }

  // Clear old selection visuals
  if (app.selected) {
    if (app.selected.userData.isBoneMarker) {
      app.selected.material.color.setHex(0xffffff);
      app.selected.material.opacity = 1.0;
    } else {
      clearHighlight(app.selected);
    }
  }

  app.selected = object || null;

  if (app.selected) {
    if (app.selected.userData.isBoneMarker) {
      // Highlight bone sphere with orange and attach TC to the bone
      app.selected.material.color.setHex(0xff8a00);
      app.selected.material.opacity = 1.0;
      app.transformControls.attach(app.selected.userData.boneRef);
    } else {
      addHighlight(app.selected);
      app.transformControls.attach(app.selected);
    }
    if(app._tcHelper) app._tcHelper.visible = !app.renderPreviewActive;
  } else {
    app.transformControls.detach();
    if(app._tcHelper) app._tcHelper.visible = false;
  }

  dispatchSelectionChanged();
}

// ─── Refined infinite shader grid ──────────────────────────────────────────
// Procedural grid matching the standalone viewport created for NCM:
// anti-aliased minor/major lines, colored world axes, distance fade and
// camera-following snap so the floor reads as effectively infinite.
function createInfiniteGridMesh() {
  const uniforms = {
    uCameraPosition: { value: new THREE.Vector3() },
    uGridSize:       { value: 1.0 },
    uMajorGridSize:  { value: 10.0 },
    uMinorColor:     { value: new THREE.Color(0x6c6c6c) },
    uMajorColor:     { value: new THREE.Color(0x515151) },
    uFadeDistance:   { value: 180.0 },
    uOpacity:        { value: 0.85 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;

      uniform vec3  uCameraPosition;
      uniform float uGridSize;
      uniform float uMajorGridSize;
      uniform vec3  uMinorColor;
      uniform vec3  uMajorColor;
      uniform float uFadeDistance;
      uniform float uOpacity;

      varying vec3 vWorldPosition;

      float gridLine(vec2 coordinate, float scale) {
        vec2 grid =
          abs(fract(coordinate / scale - 0.5) - 0.5) /
          fwidth(coordinate / scale);

        float line = 1.0 - min(grid.x, grid.y);
        return clamp(line, 0.0, 1.0);
      }

      void main() {
        vec2 position = vWorldPosition.xz;

        float minor = gridLine(position, uGridSize);
        float major = gridLine(position, uMajorGridSize);

        float distanceToCamera =
          distance(vWorldPosition, uCameraPosition);

        float distanceFade =
          1.0 - smoothstep(
            uFadeDistance * 0.35,
            uFadeDistance,
            distanceToCamera
          );

        vec3 color =
          mix(uMinorColor, uMajorColor, major);

        float lineStrength =
          max(minor, major * 1.5);

        // X axis = red
        float axisX =
          1.0 - smoothstep(
            0.0,
            0.015,
            abs(position.x)
          );

        // Z axis = blue
        float axisZ =
          1.0 - smoothstep(
            0.0,
            0.015,
            abs(position.y)
          );

        if (axisX > 0.0) {
          color = vec3(0.8, 0.12, 0.12);
        }

        if (axisZ > 0.0) {
          color = vec3(0.12, 0.30, 0.85);
        }

        float alpha =
          lineStrength *
          distanceFade *
          uOpacity;

        if (axisX > 0.0) {
          alpha = max(alpha, axisX * distanceFade);
        }

        if (axisZ > 0.0) {
          alpha = max(alpha, axisZ * distanceFade);
        }

        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color, alpha);
      }
    `
  });

  material.extensions = { derivatives: true };

  const geometry =
    new THREE.PlaneGeometry(1000, 1000, 1, 1);

  const mesh =
    new THREE.Mesh(geometry, material);

  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  mesh.userData.isHelper = true;
  mesh.userData._gridMaterial = material;

  return mesh;
}

// ─── Native Three.js axes helper ────────────────────────────────────────────
// Kept as a separate helper so the existing NCM visibility toggle can continue
// to control it independently from the shader grid.
function createSceneAxes() {
  const axes = new THREE.AxesHelper(3);
  axes.userData.isHelper = true;
  axes.frustumCulled = false;
  return axes;
}

// ── Transform-gizmo styling ─────────────────────────────────────────────────
// Three.js ships TransformControls with flat, fully-saturated primary colors
// and a hairline (1px, non-scaling) Line for the translate/scale arrow
// shafts. This repaints the handles to match the Blender-style world axes
// above — Y=blue/up, Z=green/depth, NOT the naive X/Y/Z=red/green/blue —
// and, where a shaft is a plain Line, swaps it for a slim 3D cylinder so the
// arms read as solid geometry instead of a wire (Android WebView ignores
// WebGL line width entirely, so a Line never renders thicker no matter what
// material property is set on it). Only cosmetic meshes are touched; the
// separate, invisible picker meshes TransformControls uses for hit-testing
// are left completely alone, so dragging behaviour can't be affected.
const GIZMO_AXIS_COLORS = {
  X:  0xcc4444,   // red   — ground        (matches createBlenderAxes)
  Y:  0x4477dd,   // blue  — vertical/up   (matches createBlenderAxes)
  Z:  0x44bb66,   // green — ground depth  (matches createBlenderAxes)
  XY: 0xc96ee0,
  YZ: 0x4dd2c9,
  XZ: 0xd9d24a,
};
const GIZMO_HIGHLIGHT_COLOR = 0xffe066; // matches TransformControls' own hover/drag highlight

function styleTransformGizmo(tcHelper, controls) {
  const customShafts = []; // { mesh, name, color } — kept in sync with hover below

  try {
    tcHelper.traverse((child) => {
      const color = GIZMO_AXIS_COLORS[child.name];
      if (color === undefined || !child.material || !child.material.color) return;

      child.material.color.setHex(color);
      if ((child.name === 'XY' || child.name === 'YZ' || child.name === 'XZ') && child.material.opacity !== undefined) {
        child.material.opacity = Math.max(child.material.opacity, 0.55);
      }

      // Upgrade a straight hairline shaft to a real cylinder. Rotate mode's
      // rings reuse the X/Y/Z names too, but get skipped here because a
      // ring's bounding box doesn't look like a thin rod.
      if (child.isLine && (child.name === 'X' || child.name === 'Y' || child.name === 'Z')) {
        try {
          child.geometry.computeBoundingBox();
          const box = child.geometry.boundingBox;
          const size = new THREE.Vector3();
          box.getSize(size);
          const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
          const looksLikeShaft = dims[0] > 0.05 && dims[1] < dims[0] * 0.2 && dims[2] < dims[0] * 0.2;
          if (looksLikeShaft) {
            const dir = new THREE.Vector3().subVectors(box.max, box.min).normalize();
            const mid = new THREE.Vector3();
            box.getCenter(mid);
            const radius = dims[0] * 0.035;
            const shaft = new THREE.Mesh(
              new THREE.CylinderGeometry(radius, radius, dims[0], 8),
              new THREE.MeshBasicMaterial({
                color,
                fog: false,
                toneMapped: false,
                depthTest: child.material.depthTest !== false
              })
            );
            shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            shaft.position.copy(mid);
            shaft.name = child.name;
            shaft.userData.isHelper = true;
            shaft.renderOrder = child.renderOrder;
            child.visible = false;
            child.parent.add(shaft);
            customShafts.push({ mesh: shaft, name: child.name, color });
          }
        } catch { /* leave the thin line as-is if the geometry isn't what we expect */ }
      }
    });

    // Replicate TransformControls' own hover/drag highlight for the shafts
    // above, since they're new meshes the library doesn't know to recolor.
    if (customShafts.length) {
      controls.addEventListener('axis-changed', (e) => {
        const active = e.value;
        customShafts.forEach(({ mesh, name, color }) => {
          const isActive = !!active && active.includes(name);
          mesh.material.color.setHex(isActive ? GIZMO_HIGHLIGHT_COLOR : color);
        });
      });
    }
  } catch { /* purely cosmetic — never let a styling hiccup break the gizmo */ }
}

export function initScene(container = document.body) {
  if (app.initialized) return app;
  app.initialized = true;

  // ------------------------------------------------------------
  // Scene
  // ------------------------------------------------------------
  const scene = new THREE.Scene();

  // Exact refined viewport background.
  scene.background = new THREE.Color(0x3f4145);
  scene.fog = null;

  // ------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------
  const vp0 = getViewportSize();
  const camera = new THREE.PerspectiveCamera(
    50,
    vp0.width / vp0.height,
    0.01,
    2000
  );

  camera.position.set(6.5, 5.0, 7.0);
  camera.lookAt(0, 0.5, 0);

  // ------------------------------------------------------------
  // Renderer
  // ------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true
  });

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 2)
  );

  renderer.setSize(
    vp0.width,
    vp0.height
  );

  renderer.outputColorSpace =
    THREE.SRGBColorSpace;

  renderer.toneMapping =
    THREE.ACESFilmicToneMapping;

  renderer.toneMappingExposure = 1.0;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type =
    THREE.PCFSoftShadowMap;

  renderer.setClearColor(0x3f4145, 1);

  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  // 3% viewport inset (see VIEWPORT_INSET/getViewportSize above) — the
  // canvas is already sized to the shrunk vp0.width/height via setSize()
  // a few lines up; position it centered inside the resulting margin.
  renderer.domElement.style.position = 'fixed';
  renderer.domElement.style.left = vp0.marginX + 'px';
  renderer.domElement.style.top  = vp0.marginY + 'px';

  container.appendChild(
    renderer.domElement
  );

  // ------------------------------------------------------------
  // Orbit controls
  // ------------------------------------------------------------
  const controls =
    new OrbitControls(
      camera,
      renderer.domElement
    );

  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  controls.enablePan = true;

  controls.minDistance = 0.5;
  controls.maxDistance = 500;

  controls.maxPolarAngle =
    Math.PI * 0.495;

  controls.target.set(
    0,
    0.5,
    0
  );

  // ------------------------------------------------------------
  // Transform controls
  // ------------------------------------------------------------
  const transformControls =
    new TransformControls(
      camera,
      renderer.domElement
    );

  transformControls.setSize(1.15);

  transformControls.addEventListener(
    'dragging-changed',
    (e) => {
      controls.enabled = !e.value;
    }
  );

  const tcHelper =
    typeof transformControls.getHelper === 'function'
      ? transformControls.getHelper()
      : transformControls;

  tcHelper.visible = false;

  tcHelper.traverse((child) => {
    child.userData.isHelper = true;
  });

  scene.add(tcHelper);

  app._tcHelper = tcHelper;

  styleTransformGizmo(
    tcHelper,
    transformControls
  );

  // ------------------------------------------------------------
  // Lighting
  // Exact lighting balance from the standalone scene.
  // ------------------------------------------------------------
  const ambientLight =
    new THREE.AmbientLight(
      0xffffff,
      1.5
    );

  scene.add(ambientLight);

  const keyLight =
    new THREE.DirectionalLight(
      0xffffff,
      3.0
    );

  keyLight.position.set(
    5,
    10,
    6
  );

  keyLight.castShadow = true;

  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;

  keyLight.shadow.camera.left = -15;
  keyLight.shadow.camera.right = 15;
  keyLight.shadow.camera.top = 15;
  keyLight.shadow.camera.bottom = -15;

  keyLight.shadow.bias = -0.0005;

  scene.add(keyLight);

  // NCM keeps this slot for a default environment because the configuration
  // / skybox system references app.defaultEnvironment. The standalone scene
  // itself does not require an HDRI environment, so leave it null by default.
  app.defaultEnvironment = null;

  // ------------------------------------------------------------
  // Infinite shader grid
  // ------------------------------------------------------------
  const gridRoot =
    createInfiniteGridMesh();

  scene.add(gridRoot);

  // ------------------------------------------------------------
  // Native AxesHelper
  // ------------------------------------------------------------
  const axesHelper =
    createSceneAxes();

  scene.add(axesHelper);

  // ------------------------------------------------------------
  // Shadow receiver
  // Exact visual role from standalone scene.
  // It is not selectable because it remains a helper.
  // ------------------------------------------------------------
  const shadowMaterial =
    new THREE.ShadowMaterial({
      opacity: 0.22
    });

  const shadowGeometry =
    new THREE.PlaneGeometry(
      12,
      12
    );

  const floor =
    new THREE.Mesh(
      shadowGeometry,
      shadowMaterial
    );

  floor.rotation.x =
    -Math.PI / 2;

  floor.position.y =
    0.002;

  floor.receiveShadow = true;
  floor.userData.isHelper = true;

  scene.add(floor);

  app.floor = floor;

  // Track pointer down position to distinguish click vs drag (orbit)
  let _downX = 0, _downY = 0;
  renderer.domElement.addEventListener('pointerdown', (event) => {
    _downX = event.clientX; _downY = event.clientY;
  });

  renderer.domElement.addEventListener('pointerup', (event) => {
    if (isUiTarget(event.target)) return;
    if (app.transformControls.dragging) return;
    // Modo de desenho de Domínio usa o mesmo canvas para
    // definir a área — não deixa esse arrasto mexer na seleção de objetos.
    if (app.domainDrawing) return;
    // Ignore if the pointer moved > 5px (it was an orbit/pan drag)
    const dx = event.clientX - _downX, dy = event.clientY - _downY;
    if (dx * dx + dy * dy > 25) return;

    const rect = renderer.domElement.getBoundingClientRect();
    app.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    app.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    app.raycaster.setFromCamera(app.pointer, camera);

    // 1. Check bone spheres first (they render on top)
    if (app.boneObjects.length > 0) {
      const boneHits = app.raycaster.intersectObjects(app.boneObjects, false);
      if (boneHits.length > 0) { setSelected(boneHits[0].object); return; }
    }

    // 2. Check regular user objects
    if (app.deepSelectMode) {
      // Deep-select: raycast recursively through all scene children,
      // find the first real mesh (skip floor, helpers, bone markers, gizmo)
      const deepHits = app.raycaster.intersectObjects(app.scene.children, true);
      const validHit = deepHits.find((h) => {
        const o = h.object;
        return o !== floor &&
               !o.userData.isHelper &&
               !o.userData.isBoneMarker &&
               o !== app.transformControls?.getHelper?.() &&
               o.visible;
      });
      if (validHit) {
        setSelected(validHit.object);
      } else {
        const floorHits = app.raycaster.intersectObjects([floor], false);
        if (floorHits.length === 0) setSelected(null);
      }
    } else {
      const hits = app.raycaster.intersectObjects(app.objects, false);
      if (hits.length > 0) {
        const target = hits[0].object.userData.selectTarget ?? hits[0].object;
        setSelected(target);
      } else {
        // 3. If we hit the floor/grid, keep selection — only clear on true void
        const floorHits = app.raycaster.intersectObjects([floor], false);
        if (floorHits.length === 0) setSelected(null);
      }
    }
  });

  window.addEventListener('resize', onResize);

  app.scene = scene;
  app.camera = camera;
  app.renderer = renderer;
  app.controls = controls;
  app.transformControls = transformControls;
  app.gridRoot = gridRoot;
  app.axesHelper = axesHelper;

  addPrimitive('box');

  return app;
}

export function onResize() {
  if (!app.renderer || !app.camera) return;
  const vp = getViewportSize();
  app.camera.aspect = vp.width / vp.height;
  app.camera.updateProjectionMatrix();
  app.renderer.setSize(vp.width, vp.height);
  app.renderer.domElement.style.left = vp.marginX + 'px';
  app.renderer.domElement.style.top  = vp.marginY + 'px';
  markSceneDirty();
}

export function updateInfiniteGrid() {
  if (!app.gridRoot || !app.camera) return;

  const mat =
    app.gridRoot.userData?._gridMaterial;

  if (mat?.uniforms?.uCameraPosition) {
    mat.uniforms.uCameraPosition.value.copy(
      app.camera.position
    );
  }

  // Snap the procedural plane in large blocks so its finite geometry never
  // exposes an edge while the camera pans through the scene.
  const snap = 10;

  app.gridRoot.position.x =
    Math.floor(app.camera.position.x / snap) * snap;

  app.gridRoot.position.z =
    Math.floor(app.camera.position.z / snap) * snap;
}

export function setHelperVisibility(visible) {
  app.helpersVisible = visible;
  const show     = visible && !app.renderPreviewActive;
  // ★ Grid/Axes respect a separate user-preference layer (set via the
  // Settings menu toggles) that's independent from the render-mode-driven
  // `show` above. Without this, setHelperVisibility(true) — called every
  // single frame from renderFrame() in 'standard' mode — would silently
  // stomp the user's toggle back to visible within ~16ms, before the
  // change was even perceptible.
  const showGrid = show && (app._userGridVisible ?? true);
  const showAxes = show && (app._userAxesVisible ?? true);
  if (app.gridRoot) app.gridRoot.visible = showGrid;
  if (app.axesHelper) app.axesHelper.visible = showAxes;
  helperRegistry.objects.forEach(obj => { obj.visible = show; });
  if (app.transformControls) {
    if(app._tcHelper) app._tcHelper.visible = show ? !!app.selected : false;
  }
}

export function setRenderPreviewMode(active) {
  app.renderPreviewActive = active;
  const show     = !active;
  const showGrid = show && (app._userGridVisible ?? true);
  const showAxes = show && (app._userAxesVisible ?? true);
  if (app.gridRoot) app.gridRoot.visible = showGrid;
  if (app.axesHelper) app.axesHelper.visible = showAxes;
  helperRegistry.objects.forEach(obj => { obj.visible = show; });
  if (app.transformControls) {
    if(app._tcHelper) app._tcHelper.visible = show && !!app.selected;
  }
  // Hide particle emitter crosshair markers in render mode
  if (app.scene) {
    app.scene.traverse(obj => {
      if (obj.userData.isLabMarker) obj.visible = show;
    });
  }
  markSceneDirty();
}

/** User-facing grid toggle (Settings menu) — persists across the
 *  per-frame setHelperVisibility(true) calls, unlike a bare .visible set. */
export function setUserGridVisible(visible) {
  app._userGridVisible = !!visible;
  setHelperVisibility(app.helpersVisible ?? true); // re-apply immediately
  markSceneDirty();
}

/** User-facing axes-helper toggle (Settings menu) — same reasoning as above. */
export function setUserAxesVisible(visible) {
  app._userAxesVisible = !!visible;
  setHelperVisibility(app.helpersVisible ?? true);
  markSceneDirty();
}

export function renderScene() {
  if (!app.renderer || !app.scene || !app.camera) return;
  app.renderer.render(app.scene, app.camera);
}

export function setGizmoMode(mode) {
  app.mode = mode;
  if (app.transformControls) {
    app.transformControls.setMode(mode);
  }
}

export function addPrimitive(kind) {
  if (!app.scene) return null;

  const material = new THREE.MeshStandardMaterial({
    color: 0xc8c8c8,
    roughness: 0.72,
    metalness: 0.0
  });

  const mesh = new THREE.Mesh(
    makeGeometry(kind),
    material
  );

  mesh.name = kind;

  mesh.position.set(
    app.controls.target.x,
    geometryHeight(kind),
    app.controls.target.z
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;

  app.scene.add(mesh);
  app.objects.push(mesh);
  app._ptTopologyDirty = true; // real geometry changed — path tracer BVH needs a full rebuild next time it's active

  setSelected(mesh);
  markSceneDirty();

  return mesh;
}

export function clearSelection() {
  setSelected(null);
}

export function getSelected() {
  return app.selected;
}

export function ensurePhysicalMaterial(mesh) {
  if (!mesh) return null;
  if (mesh.material?.isMeshPhysicalMaterial) return mesh.material;

  const old = mesh.material;
  const mat = physicalMaterialDefaults();

  if (old) {
    if (old.color) mat.color.copy(old.color);
    if (old.map) mat.map = old.map;
    if (old.normalMap) mat.normalMap = old.normalMap;
    if (old.roughnessMap) mat.roughnessMap = old.roughnessMap;
    if (old.metalnessMap) mat.metalnessMap = old.metalnessMap;
    if (old.aoMap) mat.aoMap = old.aoMap;
    if (old.emissiveMap) mat.emissiveMap = old.emissiveMap;
    if (old.alphaMap) mat.alphaMap = old.alphaMap;
    if (old.clearcoatMap) mat.clearcoatMap = old.clearcoatMap;
    if (old.clearcoatNormalMap) mat.clearcoatNormalMap = old.clearcoatNormalMap;
    if (old.clearcoatRoughnessMap) mat.clearcoatRoughnessMap = old.clearcoatRoughnessMap;
    if (old.specularColorMap) mat.specularColorMap = old.specularColorMap;
    if (old.specularIntensityMap) mat.specularIntensityMap = old.specularIntensityMap;
    if (old.sheenColorMap) mat.sheenColorMap = old.sheenColorMap;
    if (old.sheenRoughnessMap) mat.sheenRoughnessMap = old.sheenRoughnessMap;
    if (old.transmissionMap) mat.transmissionMap = old.transmissionMap;
    if (old.thicknessMap) mat.thicknessMap = old.thicknessMap;
    if (old.iridescenceMap) mat.iridescenceMap = old.iridescenceMap;
    if (old.iridescenceThicknessMap) mat.iridescenceThicknessMap = old.iridescenceThicknessMap;
    if (old.envMap) mat.envMap = old.envMap;

    if (typeof old.opacity === 'number') mat.opacity = old.opacity;
    if (typeof old.transparent === 'boolean') mat.transparent = old.transparent;
    if (typeof old.alphaTest === 'number') mat.alphaTest = old.alphaTest;
    if (typeof old.depthWrite === 'boolean') mat.depthWrite = old.depthWrite;
    if (typeof old.depthTest === 'boolean') mat.depthTest = old.depthTest;
    if (typeof old.dithering === 'boolean') mat.dithering = old.dithering;
    if (typeof old.vertexColors === 'boolean') mat.vertexColors = old.vertexColors;
    if (typeof old.side === 'number') mat.side = old.side;
    if (typeof old.blending === 'number') mat.blending = old.blending;
    if (typeof old.blendSrc === 'number') mat.blendSrc = old.blendSrc;
    if (typeof old.blendDst === 'number') mat.blendDst = old.blendDst;
    if (typeof old.blendEquation === 'number') mat.blendEquation = old.blendEquation;
    if (typeof old.premultipliedAlpha === 'boolean') mat.premultipliedAlpha = old.premultipliedAlpha;
    if (typeof old.alphaToCoverage === 'boolean') mat.alphaToCoverage = old.alphaToCoverage;
    if (typeof old.roughness === 'number') mat.roughness = old.roughness;
    if (typeof old.metalness === 'number') mat.metalness = old.metalness;
    if (typeof old.clearcoat === 'number') mat.clearcoat = old.clearcoat;
    if (typeof old.clearcoatRoughness === 'number') mat.clearcoatRoughness = old.clearcoatRoughness;
    if (typeof old.transmission === 'number') mat.transmission = old.transmission;
    if (typeof old.thickness === 'number') mat.thickness = old.thickness;
    if (typeof old.ior === 'number') mat.ior = old.ior;
    if (typeof old.sheen === 'number') mat.sheen = old.sheen;
    if (typeof old.sheenRoughness === 'number') mat.sheenRoughness = old.sheenRoughness;
    if (typeof old.iridescence === 'number') mat.iridescence = old.iridescence;
    if (typeof old.iridescenceIOR === 'number') mat.iridescenceIOR = old.iridescenceIOR;
    if (typeof old.emissiveIntensity === 'number') mat.emissiveIntensity = old.emissiveIntensity;
    if (old.emissive) mat.emissive.copy(old.emissive);
    if (old.specularColor) mat.specularColor.copy(old.specularColor);
    if (typeof old.specularIntensity === 'number') mat.specularIntensity = old.specularIntensity;
  }

  mesh.material = mat;
  markSceneDirty();
  return mat;
}
