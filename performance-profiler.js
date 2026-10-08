import { app } from './scene.js';
import { renderState } from './shader.js';

const state = {
  enabled: false,
  root: null,
  fps: 0,
  frameMs: 0,
  sampleCount: 0,
  lastSampleAt: 0,
  framesSinceSample: 0,
  sceneObjects: 0,
  visibleObjects: 0,
  meshes: 0,
  triangles: 0,
  points: 0,
  lines: 0,
  drawCalls: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  pixelRatio: 1,
  mode: 'Padrão',
  profile: '—',
  resolutionScale: 1,
};

const refs = {};

function text(id, value) {
  if (refs[id]) refs[id].textContent = value;
}

function fmt(n, digits = 0) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function collectSceneStats() {
  const scene = app.scene;
  if (!scene) return;

  let sceneObjects = 0, visibleObjects = 0, meshes = 0, triangles = 0, points = 0, lines = 0;
  scene.traverseVisible((obj) => {
    visibleObjects++;
    if (obj === scene) return;
    sceneObjects++;
    if (obj.isMesh || obj.isSkinnedMesh) {
      meshes++;
      const g = obj.geometry;
      if (g) {
        const index = g.getIndex();
        const count = index ? index.count : (g.getAttribute('position')?.count || 0);
        triangles += Math.floor(count / 3);
      }
    } else if (obj.isPoints) {
      points += obj.geometry?.getAttribute('position')?.count || 0;
    } else if (obj.isLine || obj.isLineSegments || obj.isLineLoop) {
      lines += obj.geometry?.getAttribute('position')?.count || 0;
    }
  });

  state.sceneObjects = sceneObjects;
  state.visibleObjects = visibleObjects;
  state.meshes = meshes;
  state.triangles = triangles;
  state.points = points;
  state.lines = lines;
}

function collectRendererStats() {
  const r = app.renderer;
  const info = r?.info;
  if (!info) return;
  state.drawCalls = info.render?.calls ?? 0;
  state.geometries = info.memory?.geometries ?? 0;
  state.textures = info.memory?.textures ?? 0;
  state.programs = Array.isArray(info.programs) ? info.programs.length : (info.programs?.length ?? 0);
  state.pixelRatio = r.getPixelRatio?.() ?? window.devicePixelRatio ?? 1;
}

function updateModeStats() {
  const s = renderState;
  if (s) {
    state.mode = s.mode === 'pathtracing' ? 'Path Tracing' : s.mode === 'standard' ? 'Padrão' : String(s.mode);
    state.profile = s.path?.mobileAuto ? String(s.path.mobileProfile || 'AUTO') : 'Manual';
    state.resolutionScale = Number(s.path?.mobileResolutionScale ?? s.path?.resolutionScale ?? 1) || 1;
  }
}

function render(root) {
  if (!root) return;
  root.classList.toggle('hidden', !state.enabled);
  if (!state.enabled) return;

  text('profFps', fmt(state.fps, 0));
  text('profFrame', fmt(state.frameMs, 1) + ' ms');
  text('profMode', state.mode);
  text('profProfile', state.profile);
  text('profObjects', `${state.visibleObjects}/${state.sceneObjects}`);
  text('profMeshes', fmt(state.meshes));
  text('profTriangles', state.triangles >= 1000000 ? (state.triangles / 1000000).toFixed(2) + ' M' : state.triangles >= 1000 ? (state.triangles / 1000).toFixed(1) + ' K' : fmt(state.triangles));
  text('profDraw', fmt(state.drawCalls));
  text('profGeo', fmt(state.geometries));
  text('profTex', fmt(state.textures));
  text('profProg', fmt(state.programs));
  text('profPR', fmt(state.pixelRatio, 2) + '×');
  text('profScale', fmt(state.resolutionScale, 2) + '×');

  const status = refs.profStatus;
  if (status) {
    if (state.fps < 18) status.textContent = 'Carga alta — reduzir qualidade';
    else if (state.fps < 28) status.textContent = 'Carga moderada — performance limitada';
    else if (state.fps < 50) status.textContent = 'Carga normal';
    else status.textContent = 'Desempenho saudável';
    status.className = 'profilerStatus' + (state.fps < 25 ? ' bad' : state.fps < 45 ? ' warn' : ' good');
  }
}

export function createPerformanceProfiler(root) {
  if (!root) return null;
  state.root = root;
  root.innerHTML = `
    <div class="profilerCard">
      <div class="profilerHeader">
        <div>
          <div class="profilerTitle">Performance Profiler</div>
          <div class="profilerSub">Métricas do renderer em tempo real</div>
        </div>
        <div id="profStatus" class="profilerStatus">Desligado</div>
      </div>
      <div class="profilerGrid">
        <div class="profilerMetric"><span>FPS</span><strong id="profFps">—</strong></div>
        <div class="profilerMetric"><span>Frame</span><strong id="profFrame">—</strong></div>
        <div class="profilerMetric"><span>Motor</span><strong id="profMode">—</strong></div>
        <div class="profilerMetric"><span>Perfil</span><strong id="profProfile">—</strong></div>
        <div class="profilerMetric"><span>Objetos</span><strong id="profObjects">—</strong></div>
        <div class="profilerMetric"><span>Meshes</span><strong id="profMeshes">—</strong></div>
        <div class="profilerMetric"><span>Triângulos</span><strong id="profTriangles">—</strong></div>
        <div class="profilerMetric"><span>Draw Calls</span><strong id="profDraw">—</strong></div>
        <div class="profilerMetric"><span>Geometrias</span><strong id="profGeo">—</strong></div>
        <div class="profilerMetric"><span>Texturas</span><strong id="profTex">—</strong></div>
        <div class="profilerMetric"><span>Programs</span><strong id="profProg">—</strong></div>
        <div class="profilerMetric"><span>Pixel Ratio</span><strong id="profPR">—</strong></div>
        <div class="profilerMetric"><span>Escala RT</span><strong id="profScale">—</strong></div>
      </div>
    </div>
  `;
  refs.profFps = root.querySelector('#profFps');
  refs.profFrame = root.querySelector('#profFrame');
  refs.profMode = root.querySelector('#profMode');
  refs.profProfile = root.querySelector('#profProfile');
  refs.profObjects = root.querySelector('#profObjects');
  refs.profMeshes = root.querySelector('#profMeshes');
  refs.profTriangles = root.querySelector('#profTriangles');
  refs.profDraw = root.querySelector('#profDraw');
  refs.profGeo = root.querySelector('#profGeo');
  refs.profTex = root.querySelector('#profTex');
  refs.profProg = root.querySelector('#profProg');
  refs.profPR = root.querySelector('#profPR');
  refs.profScale = root.querySelector('#profScale');
  refs.profStatus = root.querySelector('.profilerHeader .profilerStatus');
  root.querySelector('.profilerCard > .profilerStatus')?.remove();
  refs.profStatusBottom = root.querySelector('#profStatus');
  setProfilerEnabled(false);
  return state;
}

export function setProfilerEnabled(enabled) {
  state.enabled = !!enabled;
  if (state.root) state.root.classList.toggle('hidden', !state.enabled);
  if (refs.profStatus) refs.profStatus.textContent = state.enabled ? 'Ativo' : 'Desligado';
  if (!state.enabled) refs.profStatus?.classList.remove('good', 'warn', 'bad');
  window.dispatchEvent(new CustomEvent('ncm-profiler-change', { detail: { active: state.enabled } }));
}

export function isProfilerEnabled() { return state.enabled; }

export function profilerTick(timestamp = performance.now()) {
  if (!state.enabled) return;
  const now = timestamp || performance.now();
  if (state.lastSampleAt === 0) state.lastSampleAt = now;
  state.framesSinceSample++;
  if (now - state.lastSampleAt < 350) return;

  state.frameMs = (now - state.lastSampleAt) / Math.max(1, state.framesSinceSample);
  state.fps = 1000 / Math.max(0.1, state.frameMs);
  state.lastSampleAt = now;
  state.framesSinceSample = 0;
  state.sampleCount++;

  collectSceneStats();
  collectRendererStats();
  updateModeStats();
  render(state.root);
}

export function getProfilerSnapshot() {
  return { ...state };
}

window._ncmProfiler = { setProfilerEnabled, isProfilerEnabled, getProfilerSnapshot };
