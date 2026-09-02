// ─────────────────────────────────────────────────────────────────────────────
// 2D VIEWPORT ORIENTATION GIZMO (Blender-style axes indicator)
// ─────────────────────────────────────────────────────────────────────────────
// A small always-on-top overlay, independent from the 3D scene: instead of
// rendering an actual 3D helper into a mini-viewport, we project the world
// X/Y/Z axes onto a 2D circle using nothing but the camera's quaternion, and
// redraw the six little dots + labels every frame. Cheap, and it's exactly
// what Blender's top-right gizmo looks like (no click-to-snap interaction —
// the ask was for the visual, not the navigation widget).
import { app } from './scene.js';

const AXES = [
  { axis: 'x', dir: [ 1, 0, 0], label: 'X', color: '#ff5f5f' },
  { axis: 'x', dir: [-1, 0, 0], label: '',  color: '#ff5f5f', neg: true },
  { axis: 'y', dir: [ 0, 1, 0], label: 'Y', color: '#8adb4a', neg: false },
  { axis: 'y', dir: [ 0,-1, 0], label: '',  color: '#8adb4a', neg: true },
  { axis: 'z', dir: [ 0, 0, 1], label: 'Z', color: '#4a9dff', neg: false },
  { axis: 'z', dir: [ 0, 0,-1], label: '',  color: '#4a9dff', neg: true },
];

const CENTER = 44;
const RADIUS = 32;
const DOT_R  = 8;

let linesG = null;
let dotsG  = null;
let built  = false;

function buildDots() {
  dotsG.innerHTML = '';
  AXES.forEach((a, i) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.dataset.i = i;

    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', a.neg ? DOT_R * 0.72 : DOT_R);
    c.setAttribute('class', 'axgDot' + (a.neg ? ' neg' : ''));
    c.setAttribute('fill', a.neg ? 'transparent' : a.color);
    c.setAttribute('stroke', a.color);
    g.appendChild(c);

    if (a.label) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('class', 'axgLabel');
      t.textContent = a.label;
      g.appendChild(t);
    }

    dotsG.appendChild(g);
  });
}

// Rotate a unit vector by the inverse of the camera's world quaternion so we
// get its position in camera (view) space, then do a simple orthographic
// (x,y) projection — z is only used for depth-sorting/scaling, matching the
// "front axes are bigger / behind axes are smaller" look Blender uses.
function projectToView(dir, invQuat) {
  const [x, y, z] = dir;
  const { x: qx, y: qy, z: qz, w: qw } = invQuat;

  // quaternion * vector * quaternion^-1 (invQuat already is the inverse)
  const ix =  qw * x + qy * z - qz * y;
  const iy =  qw * y + qz * x - qx * z;
  const iz =  qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;

  const vx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  const vy = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  const vz = iz * qw + iw * -qz + ix * -qy - iy * -qx;

  return { x: vx, y: -vy, z: vz };
}

export function updateViewportGizmo() {
  const svg = document.getElementById('axesGizmo2D');
  if (!svg || !app.camera) return;

  if (!built) {
    linesG = document.getElementById('axgLines');
    dotsG  = document.getElementById('axgDots');
    if (!linesG || !dotsG) return;
    buildDots();
    built = true;
  }

  const q = app.camera.quaternion;
  const invQuat = { x: -q.x, y: -q.y, z: -q.z, w: q.w };

  const projected = AXES.map((a) => {
    const p = projectToView(a.dir, invQuat);
    return {
      ...a,
      sx: CENTER + p.x * RADIUS,
      sy: CENTER + p.y * RADIUS,
      depth: p.z, // -1 (toward camera) .. 1 (away)
    };
  });

  // Connector lines from center to each POSITIVE axis tip only (Blender omits
  // lines on the negative stub dots).
  linesG.innerHTML = '';
  projected.filter((p) => !p.neg).forEach((p) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', CENTER); line.setAttribute('y1', CENTER);
    line.setAttribute('x2', p.sx);   line.setAttribute('y2', p.sy);
    line.setAttribute('class', 'axgLine');
    line.setAttribute('stroke', p.color);
    line.setAttribute('opacity', 0.35 + 0.35 * (1 - (p.depth + 1) / 2));
    linesG.appendChild(line);
  });

  // Position + scale every dot first...
  projected.forEach((p, i) => {
    const g = dotsG.querySelector(`g[data-i="${i}"]`);
    if (!g) return;
    g.setAttribute('transform', `translate(${p.sx},${p.sy})`);
    const scale = 0.72 + 0.28 * (1 - (p.depth + 1) / 2); // nearer = bigger
    const circle = g.querySelector('circle');
    if (circle) circle.setAttribute('r', (p.neg ? DOT_R * 0.72 : DOT_R) * scale);
  });
  // ...then re-append back-to-front so SVG paint order matches depth (nearer
  // dots visually sit on top of farther ones, like Blender's gizmo).
  projected
    .map((p, i) => i)
    .sort((a, b) => projected[a].depth - projected[b].depth)
    .forEach((i) => {
      const g = dotsG.querySelector(`g[data-i="${i}"]`);
      if (g) dotsG.appendChild(g);
    });
}
