import * as THREE from 'three';
import { app, markSceneDirty, setSelected, helperRegistry } from './scene.js';

let rectAreaInitialized = false;

// ─────────────────────────────────────────────────────────────────────────────
// 2.5D canvas-sprite light icons (always face camera, clean icon aesthetic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a billboard THREE.Sprite from a canvas draw function.
 * Sprites are drawn in white so SpriteMaterial.color tints them at runtime.
 */
function makeIconSprite(drawFn, threeColor, scale = 0.72) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    color: new THREE.Color(threeColor)
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale, scale, scale);
  return sprite;
}

// ── Point light: central dot + halo glow + 8 radial rays ─────────────────────
function makePointModel(color) {
  return makeIconSprite((ctx, s) => {
    const c = s / 2;

    // Halo glow
    const grd = ctx.createRadialGradient(c, c, 0, c, c, s * 0.44);
    grd.addColorStop(0.00, 'rgba(255,255,255,0.72)');
    grd.addColorStop(0.28, 'rgba(255,255,255,0.32)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.44, 0, Math.PI * 2);
    ctx.fill();

    // 8 rays
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const cos = Math.cos(a), sin = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(c + cos * s * 0.185, c + sin * s * 0.185);
      ctx.lineTo(c + cos * s * 0.340, c + sin * s * 0.340);
      ctx.stroke();
    }

    // Inner ring
    ctx.strokeStyle = 'rgba(255,255,255,0.52)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.145, 0, Math.PI * 2);
    ctx.stroke();

    // Core dot (bright white center)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c, c, s * 0.065, 0, Math.PI * 2);
    ctx.fill();
  }, color, 0.72);
}

// ── Sun/Directional: solid disk + alternating long/short rays ─────────────────
function makeSunModel(color) {
  return makeIconSprite((ctx, s) => {
    const c = s / 2;

    // Soft outer glow
    const grd = ctx.createRadialGradient(c, c, 0, c, c, s * 0.46);
    grd.addColorStop(0.00, 'rgba(255,255,255,0.60)');
    grd.addColorStop(0.40, 'rgba(255,255,255,0.24)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.46, 0, Math.PI * 2);
    ctx.fill();

    // 8 alternating rays (long + short)
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const cos = Math.cos(a), sin = Math.sin(a);
      const inner = s * 0.215;
      const isLong = i % 2 === 0;
      const outer = isLong ? s * 0.42 : s * 0.325;
      ctx.strokeStyle = isLong ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.52)';
      ctx.lineWidth = isLong ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(c + cos * inner, c + sin * inner);
      ctx.lineTo(c + cos * outer, c + sin * outer);
      ctx.stroke();
    }

    // Solid disk face
    ctx.fillStyle = 'rgba(255,255,255,0.90)';
    ctx.beginPath();
    ctx.arc(c, c, s * 0.17, 0, Math.PI * 2);
    ctx.fill();

    // Disk border
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.17, 0, Math.PI * 2);
    ctx.stroke();
  }, color, 0.80);
}

// ── Spot: apex circle + tapered cone beam ─────────────────────────────────────
function makeSpotModel(color) {
  return makeIconSprite((ctx, s) => {
    const c   = s / 2;
    const apexY   = s * 0.20;
    const botY    = s * 0.86;
    const topHalf = s * 0.055;
    const botHalf = s * 0.375;

    // Cone beam gradient fill
    const grd = ctx.createLinearGradient(c, apexY, c, botY);
    grd.addColorStop(0.00, 'rgba(255,255,255,0.82)');
    grd.addColorStop(0.65, 'rgba(255,255,255,0.20)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(c - topHalf, apexY);
    ctx.lineTo(c + topHalf, apexY);
    ctx.lineTo(c + botHalf, botY);
    ctx.lineTo(c - botHalf, botY);
    ctx.closePath();
    ctx.fill();

    // Cone edge lines
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c - topHalf, apexY);
    ctx.lineTo(c - botHalf, botY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c + topHalf, apexY);
    ctx.lineTo(c + botHalf, botY);
    ctx.stroke();

    // Bottom ellipse (beam footprint)
    ctx.strokeStyle = 'rgba(255,255,255,0.40)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(c, botY, botHalf, botHalf * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Mid cutoff ring (inner cone)
    const midY    = apexY + (botY - apexY) * 0.52;
    const midHalf = topHalf + (botHalf - topHalf) * 0.52;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(c, midY, midHalf, midHalf * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Apex bright dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c, apexY, s * 0.058, 0, Math.PI * 2);
    ctx.fill();
  }, color, 0.68);
}

// ── Area: rectangle frame + soft area glow + cross guides ────────────────────
function makeAreaModel(color) {
  return makeIconSprite((ctx, s) => {
    const padX = s * 0.07;
    const padY = s * 0.13;
    const rx = padX, ry = padY;
    const rw = s - padX * 2, rh = s - padY * 2;

    // Inner diffuse glow
    const grd = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, Math.hypot(rw, rh) * 0.52);
    grd.addColorStop(0.00, 'rgba(255,255,255,0.30)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.fill();

    // Rectangle border
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.strokeRect(rx, ry, rw, rh);

    // Cross guides
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx,       ry + rh / 2);
    ctx.lineTo(rx + rw,  ry + rh / 2);
    ctx.moveTo(rx + rw / 2, ry);
    ctx.lineTo(rx + rw / 2, ry + rh);
    ctx.stroke();

    // Corner accent dots
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    [[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]].forEach(([px, py]) => {
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, color, 0.80);
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
