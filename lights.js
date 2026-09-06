import * as THREE from 'three';
import { app, markSceneDirty, setSelected, helperRegistry, SOFT_SHADOW_DEFAULTS } from './scene.js';

let rectAreaInitialized = false;

// ─────────────────────────────────────────────────────────────────────────────
// 3D light viewport models — real meshes, never camera-facing sprites.
// The shapes intentionally use the same low-poly / wireframe language as the
// scene's 3D primitive visuals, so lights read as actual objects in space.
// ─────────────────────────────────────────────────────────────────────────────

function makeLightMaterial(color, opacity = 0.95) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    wireframe: true,
    toneMapped: false
  });
}

function addModelPart(group, geometry, color, opacity = 0.95, rotation = null, position = null) {
  const mesh = new THREE.Mesh(geometry, makeLightMaterial(color, opacity));
  if (rotation) mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
  if (position) mesh.position.set(position.x || 0, position.y || 0, position.z || 0);
  group.add(mesh);
  return mesh;
}

function makePointModel(color) {
  const g = new THREE.Group();
  g.name = 'LightModel3D';
  addModelPart(g, new THREE.IcosahedronGeometry(0.18, 1), color, 1);
  addModelPart(g, new THREE.SphereGeometry(0.31, 12, 8), color, 0.34);
  g.userData.lightDisplayType = 'point';
  return g;
}

function makeSunModel(color) {
  const g = new THREE.Group();
  g.name = 'LightModel3D';
  addModelPart(g, new THREE.OctahedronGeometry(0.21, 0), color, 1);
  const rayLength = 0.43;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    addModelPart(
      g,
      new THREE.BoxGeometry(0.045, rayLength, 0.045),
      color,
      0.82,
      { x: 0, y: 0, z: -a },
      { x: Math.sin(a) * 0.33, y: Math.cos(a) * 0.33, z: 0 }
    );
  }
  g.userData.lightDisplayType = 'sun';
  return g;
}

function makeSpotModel(color) {
  const g = new THREE.Group();
  g.name = 'LightModel3D';
  // Cone points downward, matching the convention used by spot-style helpers.
  const cone = new THREE.ConeGeometry(0.30, 0.58, 16, 1, true);
  addModelPart(g, cone, color, 0.62, { x: Math.PI, y: 0, z: 0 }, { x: 0, y: -0.27, z: 0 });
  addModelPart(g, new THREE.IcosahedronGeometry(0.12, 1), color, 1, null, { x: 0, y: 0.14, z: 0 });
  g.userData.lightDisplayType = 'spot';
  return g;
}

function makeRimModel(color) {
  const g = new THREE.Group();
  g.name = 'LightModel3D';
  // A compact 3D rig: directional cone + offset ring, reading as a back/rim light.
  addModelPart(g, new THREE.ConeGeometry(0.26, 0.50, 12, 1, true), color, 0.66, { x: Math.PI, y: 0, z: 0 }, { x: 0, y: -0.21, z: 0 });
  addModelPart(g, new THREE.TorusGeometry(0.28, 0.035, 6, 16), color, 0.95, { x: Math.PI / 2, y: 0, z: 0 }, { x: 0, y: 0.03, z: -0.10 });
  addModelPart(g, new THREE.OctahedronGeometry(0.11, 0), color, 1, null, { x: 0, y: 0.16, z: 0 });
  g.userData.lightDisplayType = 'rim';
  return g;
}

function makeAreaModel(color) {
  const g = new THREE.Group();
  g.name = 'LightModel3D';
  const body = addModelPart(g, new THREE.BoxGeometry(0.60, 0.10, 0.46), color, 0.72);
  body.material.wireframe = false;
  body.material.opacity = 0.16;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.66, 0.13, 0.52)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false })
  );
  g.add(edges);
  g.userData.lightDisplayType = 'area';
  return g;
}

function tintLightModel(model, hex) {
  if (!model) return;
  model.traverse((obj) => {
    if (obj.isMesh && obj.material?.color) obj.material.color.set(hex);
    if (obj.isLineSegments && obj.material?.color) obj.material.color.set(hex);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function addLight(type) {
  if (!app.scene) return null;

  const group = new THREE.Group();
  group.userData.isLightObject = true;
  group.userData.lightType = type;
  group.position.set(
    app.controls?.target.x ?? 0,
    2,
    app.controls?.target.z ?? 0
  );

  let light, model;

  switch (type) {
    case 'point': {
      // decay 2 = physically-correct inverse-square falloff (how Blender's
      // Point lamp behaves) instead of the old decay 1, which fades too
      // evenly with distance and reads as flat/CG. Intensity is scaled up
      // to compensate — inverse-square falls off much faster near the light.
      light = new THREE.PointLight(0xfff5dd, 12, 25, 2);
      model = makePointModel(0xffe066);
      group.name = 'Ponto';
      break;
    }
    case 'sun': {
      light = new THREE.DirectionalLight(0xfff8e0, 2);
      light.position.set(0, 1, 0);
      model = makeSunModel(0xfff080);
      group.name = 'Solar';
      break;
    }
    case 'spot': {
      // Same physically-correct decay=2 falloff as the point light above.
      light = new THREE.SpotLight(0xffffff, 16, 12, Math.PI / 5, 0.25, 2);
      model = makeSpotModel(0xffa040);
      group.name = 'Spot';
      break;
    }
    case 'rim': {
      light = new THREE.SpotLight(0xbfd8ff, 18, 14, Math.PI / 6.5, 0.55, 2);
      light.position.set(0, 0.8, -2.0);
      model = makeRimModel(0x8cc7ff);
      group.name = 'Rim Light';
      break;
    }
    case 'area': {
      if (!rectAreaInitialized) {
        rectAreaInitialized = true;
        import('three/addons/lights/RectAreaLightUniformsLib.js')
          .then(m => m.RectAreaLightUniformsLib.init())
          .catch(() => {});
      }
      light = new THREE.RectAreaLight(0xaaeeff, 5, 0.72, 0.52);
      model = makeAreaModel(0x88ddff);
      group.name = 'Área';
      break;
    }
    default:
      return null;
  }

  group.add(light);
  group.add(model);

  // Shadows on by default, same as the scene's own key light — previously
  // only that original light cast a shadow, since every light added here
  // started with castShadow=false until someone opened the light panel and
  // turned it on manually. RectAreaLight is the one exception: three.js has
  // no shadow support for it at all, so it's left alone.
  if (type !== 'area') {
    light.castShadow = true;
    light.shadow.mapSize.set(SOFT_SHADOW_DEFAULTS.mapSize, SOFT_SHADOW_DEFAULTS.mapSize);
    light.shadow.radius = SOFT_SHADOW_DEFAULTS.radius;
    light.shadow.blurSamples = SOFT_SHADOW_DEFAULTS.blurSamples;
    light.shadow.bias = -0.0005;

    // Directional ("sun") lights default to a tiny ±5 unit shadow-camera
    // frustum in three.js — nowhere near big enough to cover a scene, so
    // shadows would silently fail to appear. Match the scene's own key
    // light's frustum instead.
    if (type === 'sun') {
      light.shadow.camera.left = -15;
      light.shadow.camera.right = 15;
      light.shadow.camera.top = 15;
      light.shadow.camera.bottom = -15;
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 500;
      light.shadow.camera.updateProjectionMatrix();
    }
  }

  // Invisible hit-sphere for raycasting selection
  const hitMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 6, 4),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitMesh.userData.selectTarget = group;
  group.add(hitMesh);

  group.userData.lightRef  = light;
  group.userData.modelRef  = model;

  app.scene.add(group);
  app.objects.push(hitMesh);          // raycasting target
  helperRegistry.objects.push(model); // hidden in render / traced modes

  markSceneDirty();
  setSelected(group);

  return group;
}
