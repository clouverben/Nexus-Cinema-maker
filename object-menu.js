// object-menu.js — Menu de objeto (segure o clique 1,5 s em um objeto da cena 3D).
//
// Janela flutuante, não modal, arrastável pela barra de título — mesmo padrão do
// visualizer de render (render-result.js), com o DOBRO do tamanho.
//
//   Home ─┬─ Informações : nome do objeto, transformação, dimensões, geometria, material
//         ├─ Mesh        : subdivisão (Suave/Loop ou Plano/Ponto médio), restaurar malha
//         └─ Física      : corpo rígido (Rapier), material, gravidade, simular/pausar/resetar
//
// "✕": dentro de uma categoria volta para o Home; no Home fecha o menu (Esc faz o mesmo).
import * as THREE from 'three';
import { app, setSelected, markSceneDirty } from './scene.js';

const HOLD_MS = 1500;       // tempo segurando para abrir
const RING_DELAY = 250;     // o anel de progresso só aparece depois disso
const MOVE_TOL = 6;         // px — acima disso é arrasto (órbita), não long-press

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rafYield = () => new Promise((r) => requestAnimationFrame(r));

const PRIM_NAMES = {
  box: 'Cubo', sphere: 'Esfera', cylinder: 'Cilindro', cone: 'Cone', torus: 'Toro',
  plane: 'Plano', capsule: 'Cápsula', icosahedron: 'Icosaedro', octahedron: 'Octaedro',
  tetrahedron: 'Tetraedro', dodecahedron: 'Dodecaedro', torusKnot: 'Nó toroidal',
  ring: 'Anel', circle: 'Círculo', triangularPrism: 'Prisma triangular', pyramid: 'Pirâmide',
};

// ═══════════════════════════════════════════════════════════════════════
//  Estado do menu
// ═══════════════════════════════════════════════════════════════════════
let win = null;
let target = null;
let view = 'home';            // 'home' | 'info' | 'mesh' | 'physics'
let infoRaf = 0;
const meshOpts = { mode: 'smooth', level: 1, busy: false, msg: '' };

const $ = (sel) => win?.querySelector(sel);

// ═══════════════════════════════════════════════════════════════════════
//  Utilidades de objeto
// ═══════════════════════════════════════════════════════════════════════
function objName(o) {
  return o?.name || PRIM_NAMES[o?.userData?.primitiveType] || o?.userData?.primitiveType || o?.type || 'Objeto';
}

function collectMeshes(o) {
  const out = [];
  o?.traverse?.((c) => {
    if (c.isMesh && c.geometry && !c.userData.isHelper && !c.userData.isBoneMarker) out.push(c);
  });
  return out;
}

function geoStats(o) {
  let verts = 0, tris = 0;
  const meshes = collectMeshes(o);
  for (const m of meshes) {
    const pos = m.geometry.attributes?.position;
    if (!pos) continue;
    verts += pos.count;
    tris += m.geometry.index ? m.geometry.index.count / 3 : pos.count / 3;
  }
  return { meshes, verts, tris: Math.round(tris) };
}

const fmtN = (n) => Number(n).toLocaleString('pt-BR');
const f3 = (n) => (Math.abs(n) < 5e-4 ? 0 : n).toFixed(3);
const vec3 = (v) => `${f3(v.x)}, ${f3(v.y)}, ${f3(v.z)}`;

// ═══════════════════════════════════════════════════════════════════════
//  Janela
// ═══════════════════════════════════════════════════════════════════════
function ensureWindow() {
  if (win) return win;
  win = document.createElement('div');
  win.id = 'omWin';
  win.className = 'omWin hidden';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', 'Menu do objeto');
  win.innerHTML = `
    <div class="omTitle" id="omTitle">
      <div class="omTitleText">
        <div class="omName" id="omName"></div>
        <div class="omCrumb" id="omCrumb"></div>
      </div>
      <button class="omClose" id="omClose" type="button" title="Fechar" aria-label="Fechar">&#10005;</button>
    </div>
    <div class="omBody" id="omBody"></div>`;
  document.body.appendChild(win);

  $('#omClose').addEventListener('click', back);
  const body = $('#omBody');
  body.addEventListener('click', onBodyClick);
  body.addEventListener('input', onBodyInput);
  body.addEventListener('change', onBodyChange);
  enableDrag();
  window.addEventListener('resize', clampToViewport);
  window.addEventListener('keydown', (e) => {
    if (!win || win.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); back(); }
  });
  return win;
}

function enableDrag() {
  const bar = $('#omTitle');
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = win.getBoundingClientRect();
    dragging = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    bar.setPointerCapture(e.pointerId);
    win.classList.add('omDragging');
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const x = Math.min(Math.max(0, ox + e.clientX - sx), window.innerWidth - 80);
    const y = Math.min(Math.max(0, oy + e.clientY - sy), window.innerHeight - 40);
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    win.classList.remove('omDragging');
    try { bar.releasePointerCapture(e.pointerId); } catch { /* já liberado */ }
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

/** 2× o visualizer de render (520×400 → 1040×800), limitado à tela. */
function placeDefault() {
  const w = Math.min(1040, Math.round(window.innerWidth * 0.96));
  const h = Math.min(800, Math.round(window.innerHeight * 0.94));
  win.style.width = `${w}px`;
  win.style.height = `${h}px`;
  win.style.left = `${Math.max(0, Math.round((window.innerWidth - w) / 2))}px`;
  win.style.top = `${Math.max(0, Math.round((window.innerHeight - h) / 2))}px`;
}

function clampToViewport() {
  if (!win || win.classList.contains('hidden')) return;
  const r = win.getBoundingClientRect();
  win.style.left = `${Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth - 80))}px`;
  win.style.top = `${Math.min(Math.max(0, r.top), Math.max(0, window.innerHeight - 40))}px`;
}

function isOpen() { return !!win && !win.classList.contains('hidden'); }

function openMenu(obj) {
  ensureWindow();
  target = obj;
  view = 'home';
  meshOpts.msg = '';
  if (!win.style.left) placeDefault();
  win.classList.remove('hidden');
  render();
}

function closeMenu() {
  if (!win) return;
  win.classList.add('hidden');
  cancelAnimationFrame(infoRaf);
}

function back() {
  if (view !== 'home') { setView('home'); return; }
  closeMenu();
}

function setView(v) {
  view = v;
  meshOpts.msg = '';
  render();
}

// ═══════════════════════════════════════════════════════════════════════
//  Render das views
// ═══════════════════════════════════════════════════════════════════════
const CRUMBS = { home: 'Escolha uma categoria', info: 'Informações', mesh: 'Mesh', physics: 'Física' };

function render() {
  if (!isOpen()) return;
  if (!target || (!target.parent && target !== app.scene)) { closeMenu(); return; }
  $('#omName').textContent = objName(target);
  $('#omCrumb').textContent = CRUMBS[view];
  const body = $('#omBody');
  const prev = body.scrollTop;
  body.dataset.view = view;
  body.innerHTML = ({ home: homeHTML, info: infoHTML, mesh: meshHTML, physics: physicsHTML }[view])();
  body.scrollTop = prev;
  if (view === 'physics') updatePhysStatus();
}

// ── Home ────────────────────────────────────────────────────────────────
function homeHTML() {
  const row = (id, emoji, label, desc) => `
    <button class="omCat" type="button" data-act="go" data-view="${id}">
      <span class="omCatIcon"><span>${emoji}</span></span>
      <span class="omCatText"><b>${label}</b><small>${desc}</small></span>
      <span class="omCatArrow">&#8250;</span>
    </button>`;
  return `<div class="omHome">
    ${row('info', '&#8505;&#65039;', 'Informações', 'Transformação, dimensões, geometria e material')}
    ${row('mesh', '&#128311;', 'Mesh', 'Subdividir a malha do objeto')}
    ${row('physics', '&#9883;&#65039;', 'Física', 'Corpo rígido, colisão, gravidade e simulação')}
  </div>`;
}

// ── Informações ────────────────────────────────────────────────────────
function infoHTML() {
  const o = target;
  const { meshes, verts, tris } = geoStats(o);
  o.updateWorldMatrix(true, false);
  const wp = new THREE.Vector3(), ws = new THREE.Vector3();
  o.matrixWorld.decompose(wp, new THREE.Quaternion(), ws);
  const rotDeg = new THREE.Vector3(
    THREE.MathUtils.radToDeg(o.rotation.x),
    THREE.MathUtils.radToDeg(o.rotation.y),
    THREE.MathUtils.radToDeg(o.rotation.z));
  const box = new THREE.Box3().setFromObject(o);
  const size = box.isEmpty() ? null : box.getSize(new THREE.Vector3());

  const prim = o.userData.primitiveType;
  const kind = prim ? (PRIM_NAMES[prim] || prim) : (o.isGroup ? 'Grupo / modelo' : o.isLight ? 'Luz' : o.isCamera ? 'Câmera' : o.type);

  const mat = meshes[0]?.material;
  const m0 = Array.isArray(mat) ? mat[0] : mat;
  const colorHex = m0?.color ? `#${m0.color.getHexString()}` : null;
  const phys = o.userData.physics;
  const sub = o.userData._omSubdivLevel || 0;

  const row = (k, v) => `<div class="omRow"><span>${k}</span><b>${v}</b></div>`;
  const card = (title, rows) => `<section class="omCard"><h3>${title}</h3>${rows.join('')}</section>`;

  return `<div class="omInfoGrid">
    ${card('Geral', [
      row('Tipo', esc(kind)),
      row('Visível', o.visible ? 'Sim' : 'Não'),
      row('Filhos', fmtN(o.children.filter((c) => !c.userData.isHelper).length)),
      row('Malhas', fmtN(meshes.length)),
    ])}
    ${card('Transformação', [
      row('Posição', vec3(o.position)),
      row('Rotação (°)', vec3(rotDeg)),
      row('Escala', vec3(o.scale)),
    ])}
    ${card('Dimensões (mundo)', size ? [
      row('Largura (X)', f3(size.x)),
      row('Altura (Y)', f3(size.y)),
      row('Profundidade (Z)', f3(size.z)),
    ] : [row('Dimensões', '—')])}
    ${card('Geometria', [
      row('Vértices', fmtN(verts)),
      row('Triângulos', fmtN(tris)),
      row('Subdivisão aplicada', sub ? `nível ${sub}` : 'nenhuma'),
    ])}
    ${card('Material', m0 ? [
      row('Tipo', esc(m0.type || '—')),
      row('Cor', colorHex ? `<span class="omSwatch" style="background:${colorHex}"></span>${colorHex}` : '—'),
      row('Rugosidade', typeof m0.roughness === 'number' ? m0.roughness.toFixed(2) : '—'),
      row('Metalicidade', typeof m0.metalness === 'number' ? m0.metalness.toFixed(2) : '—'),
      row('Opacidade', typeof m0.opacity === 'number' ? m0.opacity.toFixed(2) : '—'),
    ] : [row('Material', '—')])}
    ${card('Render & física', [
      row('Projeta sombra', meshes.some((m) => m.castShadow) ? 'Sim' : 'Não'),
      row('Recebe sombra', meshes.some((m) => m.receiveShadow) ? 'Sim' : 'Não'),
      row('Física', phys?.enabled ? ({ dynamic: 'Dinâmico', static: 'Estático', kinematic: 'Cinemático' }[phys.body] || 'Ativa') : 'Desativada'),
    ])}
  </div>`;
}

// Mantém a aba Informações viva (posição muda ao arrastar o gizmo ou simular física).
window.addEventListener('ncm-scene-dirty', () => {
  if (!isOpen() || view !== 'info' || infoRaf) return;
  infoRaf = requestAnimationFrame(() => { infoRaf = 0; if (view === 'info') render(); });
});

// Se o usuário clicar em outro objeto com o menu aberto, o menu passa a mostrá-lo.
window.addEventListener('scene-selection-changed', (e) => {
  const o = e.detail?.object;
  if (!isOpen() || !o || o === target || o.userData?.isBoneMarker) return;
  target = o;
  meshOpts.msg = '';
  render();
});

// ═══════════════════════════════════════════════════════════════════════
//  Mesh — subdivisão
// ═══════════════════════════════════════════════════════════════════════
const MAX_TRIS = 3_000_000;

function meshHTML() {
  const { meshes, tris } = geoStats(target);
  if (!meshes.length) {
    return `<div class="omEmpty">Este objeto não possui malha para subdividir.</div>`;
  }
  const lvl = meshOpts.level;
  const after = tris * Math.pow(4, lvl);
  const tooBig = after > MAX_TRIS;
  const sub = target.userData._omSubdivLevel || 0;
  const hasOrig = meshes.some((m) => m.userData._omOrigGeometry);
  const seg = (name, val, label, hint) => `
    <button type="button" class="omSeg ${meshOpts[name] === val ? 'active' : ''}" data-act="mesh-${name}" data-val="${val}">
      <b>${label}</b>${hint ? `<small>${hint}</small>` : ''}
    </button>`;

  return `<div class="omStack">
    <section class="omCard">
      <h3>Subdivisão</h3>
      <div class="omLabel">Método</div>
      <div class="omSegRow">
        ${seg('mode', 'smooth', 'Suave', 'Loop — arredonda a forma')}
        ${seg('mode', 'flat', 'Plano', 'Ponto médio — mantém a forma')}
      </div>
      <div class="omLabel">Níveis</div>
      <div class="omSegRow omSegRow4">
        ${[1, 2, 3, 4].map((n) => seg('level', n, String(n), '')).join('')}
      </div>
      <div class="omPreview ${tooBig ? 'warn' : ''}">
        <span>Triângulos</span>
        <b>${fmtN(tris)} &rarr; ${fmtN(after)}</b>
      </div>
      ${tooBig ? `<div class="omHint warn">Acima de ${fmtN(MAX_TRIS)} triângulos — reduza os níveis.</div>` : ''}
      ${meshOpts.msg ? `<div class="omHint">${esc(meshOpts.msg)}</div>` : ''}
      <div class="omBtnRow">
        <button type="button" class="omBtn primary" data-act="mesh-apply" ${tooBig || meshOpts.busy ? 'disabled' : ''}>
          ${meshOpts.busy ? 'Processando…' : 'Aplicar subdivisão'}
        </button>
        <button type="button" class="omBtn" data-act="mesh-restore" ${hasOrig ? '' : 'disabled'}>Restaurar malha original</button>
      </div>
    </section>
    <section class="omCard">
      <h3>Estado atual</h3>
      <div class="omRow"><span>Triângulos</span><b>${fmtN(tris)}</b></div>
      <div class="omRow"><span>Subdivisão aplicada</span><b>${sub ? `nível ${sub}` : 'nenhuma'}</b></div>
      <div class="omRow"><span>Malhas afetadas</span><b>${fmtN(meshes.length)}</b></div>
    </section>
  </div>`;
}

/** Geometria → arrays Float32 não indexados (cada 3 cantos = 1 triângulo). */
function flattenGeometry(g) {
  const idx = g.index;
  const vcount = idx ? idx.count : g.attributes.position.count;
  const names = [], sizes = [], arrays = [];
  for (const name of Object.keys(g.attributes)) {
    if (name.startsWith('skin')) continue;
    const a = g.attributes[name];
    const s = a.itemSize;
    const arr = new Float32Array(vcount * s);
    for (let i = 0; i < vcount; i++) {
      const src = idx ? idx.getX(i) : i;
      arr[i * s] = a.getX(src);
      if (s > 1) arr[i * s + 1] = a.getY(src);
      if (s > 2) arr[i * s + 2] = a.getZ(src);
      if (s > 3) arr[i * s + 3] = a.getW(src);
    }
    names.push(name); sizes.push(s); arrays.push(arr);
  }
  return { names, sizes, arrays };
}

/** Solda vértices por posição (quantizada) — usado só para topologia/normais. */
function weldPositions(P) {
  const vc = P.length / 3;
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < vc; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const diag = Math.hypot(maxx - minx, maxy - miny, maxz - minz) || 1;
  const q = Math.max(diag * 1e-5, 1e-9);
  const map = new Map();
  const wid = new Uint32Array(vc);
  const wp = [];
  for (let i = 0; i < vc; i++) {
    const key = `${Math.round(P[i * 3] / q)},${Math.round(P[i * 3 + 1] / q)},${Math.round(P[i * 3 + 2] / q)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = wp.length / 3; map.set(key, id);
      wp.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    }
    wid[i] = id;
  }
  return { wid, wp: Float32Array.from(wp), wn: wp.length / 3 };
}

// Cantos dos 4 triângulos filhos: 0..2 = cantos do pai, 3 = meio(0,1), 4 = meio(1,2), 5 = meio(2,0)
const CHILD_TRIS = [0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5];

function subdivideLevel(data, smooth) {
  const { names, sizes, arrays } = data;
  const pi = names.indexOf('position');
  const P = arrays[pi];
  const vc = P.length / 3, tc = vc / 3;

  let wid = null, vNew = null, edgeNew = null, triEdge = null;
  if (smooth) {
    const w = weldPositions(P);
    wid = w.wid;
    const wn = w.wn, wp = w.wp;
    const eMap = new Map();
    const eA = [], eB = [], eO1 = [], eO2 = [], eCnt = [];
    triEdge = new Int32Array(vc);
    for (let t = 0; t < tc; t++) {
      for (let e = 0; e < 3; e++) {
        const a = wid[3 * t + e], b = wid[3 * t + (e + 1) % 3], o = wid[3 * t + (e + 2) % 3];
        const lo = a < b ? a : b, hi = a < b ? b : a;
        const k = lo * wn + hi;
        let ei = eMap.get(k);
        if (ei === undefined) {
          ei = eA.length; eMap.set(k, ei);
          eA.push(lo); eB.push(hi); eO1.push(o); eO2.push(-1); eCnt.push(1);
        } else {
          if (eCnt[ei] === 1) eO2[ei] = o;
          eCnt[ei]++;
        }
        triEdge[3 * t + e] = ei;
      }
    }
    const ne = eA.length;
    const val = new Uint32Array(wn), bcount = new Uint8Array(wn);
    const sum = new Float64Array(wn * 3), bsum = new Float64Array(wn * 3);
    for (let ei = 0; ei < ne; ei++) {
      const a = eA[ei], b = eB[ei];
      if (a === b) continue;
      val[a]++; val[b]++;
      for (let k = 0; k < 3; k++) { sum[a * 3 + k] += wp[b * 3 + k]; sum[b * 3 + k] += wp[a * 3 + k]; }
      if (eCnt[ei] !== 2) {
        bcount[a]++; bcount[b]++;
        for (let k = 0; k < 3; k++) { bsum[a * 3 + k] += wp[b * 3 + k]; bsum[b * 3 + k] += wp[a * 3 + k]; }
      }
    }
    vNew = new Float32Array(wn * 3);
    for (let v = 0; v < wn; v++) {
      const n = val[v];
      for (let k = 0; k < 3; k++) {
        const p = wp[v * 3 + k];
        if (n === 0) vNew[v * 3 + k] = p;
        else if (bcount[v] > 0) vNew[v * 3 + k] = bcount[v] === 2 ? 0.75 * p + 0.125 * bsum[v * 3 + k] : p;
        else {
          const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
          vNew[v * 3 + k] = (1 - n * beta) * p + beta * sum[v * 3 + k];
        }
      }
    }
    edgeNew = new Float32Array(ne * 3);
    for (let ei = 0; ei < ne; ei++) {
      const a = eA[ei], b = eB[ei];
      const interior = eCnt[ei] === 2;
      for (let k = 0; k < 3; k++) {
        const s = wp[a * 3 + k] + wp[b * 3 + k];
        edgeNew[ei * 3 + k] = interior
          ? 0.375 * s + 0.125 * (wp[eO1[ei] * 3 + k] + wp[eO2[ei] * 3 + k])
          : 0.5 * s;
      }
    }
  }

  const outV = tc * 12;
  const out = sizes.map((s) => new Float32Array(outV * s));
  for (let t = 0; t < tc; t++) {
    const base = 3 * t;
    for (let c = 0; c < 12; c++) {
      const id = CHILD_TRIS[c];
      const oi = t * 12 + c;
      for (let ai = 0; ai < names.length; ai++) {
        const s = sizes[ai], src = arrays[ai], dst = out[ai];
        if (smooth && ai === pi) {
          if (id < 3) {
            const w = wid[base + id];
            dst[oi * 3] = vNew[w * 3]; dst[oi * 3 + 1] = vNew[w * 3 + 1]; dst[oi * 3 + 2] = vNew[w * 3 + 2];
          } else {
            const e = triEdge[base + id - 3];
            dst[oi * 3] = edgeNew[e * 3]; dst[oi * 3 + 1] = edgeNew[e * 3 + 1]; dst[oi * 3 + 2] = edgeNew[e * 3 + 2];
          }
          continue;
        }
        if (id < 3) {
          const si = (base + id) * s;
          for (let k = 0; k < s; k++) dst[oi * s + k] = src[si + k];
        } else {
          const ia = (base + id - 3) * s, ib = (base + (id - 2) % 3) * s;
          for (let k = 0; k < s; k++) dst[oi * s + k] = (src[ia + k] + src[ib + k]) * 0.5;
        }
      }
    }
  }
  const ni = names.indexOf('normal');
  if (ni >= 0) {
    const N = out[ni];
    for (let i = 0; i < outV; i++) {
      const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
      N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l;
    }
  }
  return { names, sizes, arrays: out };
}

/** Normais suaves (soldadas por posição) — usado no modo Suave. */
function smoothNormals(data) {
  const ni = data.names.indexOf('normal');
  if (ni < 0) return;
  const P = data.arrays[data.names.indexOf('position')];
  const N = data.arrays[ni];
  const { wid, wn } = weldPositions(P);
  const acc = new Float64Array(wn * 3);
  const tc = P.length / 9;
  for (let t = 0; t < tc; t++) {
    const i0 = 3 * t, i1 = i0 + 1, i2 = i0 + 2;
    const ax = P[i1 * 3] - P[i0 * 3], ay = P[i1 * 3 + 1] - P[i0 * 3 + 1], az = P[i1 * 3 + 2] - P[i0 * 3 + 2];
    const bx = P[i2 * 3] - P[i0 * 3], by = P[i2 * 3 + 1] - P[i0 * 3 + 1], bz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;   // área-ponderada
    for (const i of [i0, i1, i2]) {
      const w = wid[i];
      acc[w * 3] += nx; acc[w * 3 + 1] += ny; acc[w * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < P.length / 3; i++) {
    const w = wid[i];
    const l = Math.hypot(acc[w * 3], acc[w * 3 + 1], acc[w * 3 + 2]);
    if (l > 0) { N[i * 3] = acc[w * 3] / l; N[i * 3 + 1] = acc[w * 3 + 1] / l; N[i * 3 + 2] = acc[w * 3 + 2] / l; }
  }
}

function subdivideGeometry(g, levels, smooth) {
  let data = flattenGeometry(g);
  const groups = g.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex }));
  for (let l = 0; l < levels; l++) {
    data = subdivideLevel(data, smooth);
    for (const gr of groups) { gr.start *= 4; gr.count *= 4; }
  }
  if (smooth) smoothNormals(data);
  const out = new THREE.BufferGeometry();
  data.names.forEach((n, i) => out.setAttribute(n, new THREE.BufferAttribute(data.arrays[i], data.sizes[i])));
  for (const gr of groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

async function applySubdivision() {
  if (meshOpts.busy || !target) return;
  const meshes = collectMeshes(target).filter((m) => !m.isSkinnedMesh && !m.isInstancedMesh && !m.geometry.morphAttributes?.position);
  if (!meshes.length) { meshOpts.msg = 'Nenhuma malha compatível (malhas com esqueleto/morph não são suportadas).'; render(); return; }
  meshOpts.busy = true; meshOpts.msg = ''; render();
  await rafYield(); await rafYield();
  try {
    const smooth = meshOpts.mode === 'smooth';
    for (const m of meshes) {
      const old = m.geometry;
      const neu = subdivideGeometry(old, meshOpts.level, smooth);
      if (!m.userData._omOrigGeometry) m.userData._omOrigGeometry = old;
      else old.dispose();
      m.geometry = neu;
    }
    target.userData._omSubdivLevel = (target.userData._omSubdivLevel || 0) + meshOpts.level;
    app._ptTopologyDirty = true;
    markSceneDirty();
    const skipped = collectMeshes(target).length - meshes.length;
    meshOpts.msg = skipped > 0 ? `Aplicado. ${skipped} malha(s) com esqueleto/morph foram ignoradas.` : 'Subdivisão aplicada.';
  } catch (err) {
    console.error('[object-menu] subdivisão falhou:', err);
    meshOpts.msg = `Falha ao subdividir: ${err?.message || err}`;
  }
  meshOpts.busy = false;
  render();
}

function restoreMesh() {
  let n = 0;
  for (const m of collectMeshes(target)) {
    const orig = m.userData._omOrigGeometry;
    if (!orig) continue;
    m.geometry.dispose();
    m.geometry = orig;
    delete m.userData._omOrigGeometry;
    n++;
  }
  delete target.userData._omSubdivLevel;
  app._ptTopologyDirty = true;
  markSceneDirty();
  meshOpts.msg = n ? 'Malha original restaurada.' : '';
  render();
}

// ═══════════════════════════════════════════════════════════════════════
//  Física — Rapier
// ═══════════════════════════════════════════════════════════════════════
const PHYS_DEFAULTS = {
  enabled: false, body: 'dynamic', shape: 'auto',
  mass: 1, friction: 0.6, restitution: 0.2, linDamp: 0.05, angDamp: 0.05, gravityScale: 1,
};
const physGlobal = { gravity: -9.81, ground: true };

const PHYS_PRESETS = {
  Borracha: { friction: 1.2, restitution: 0.85, mass: 0.5 },
  Madeira: { friction: 0.6, restitution: 0.25, mass: 2 },
  Metal: { friction: 0.4, restitution: 0.1, mass: 8 },
  Pedra: { friction: 0.8, restitution: 0.05, mass: 12 },
  Gelo: { friction: 0.03, restitution: 0.1, mass: 1 },
};

const SHAPES = [
  ['auto', 'Automática'], ['box', 'Caixa'], ['sphere', 'Esfera'], ['capsule', 'Cápsula'],
  ['cylinder', 'Cilindro'], ['convex', 'Convexa'], ['trimesh', 'Malha exata'],
];

const SLIDERS = [
  ['mass', 'Massa', 0.05, 100, 0.05, 'kg'],
  ['friction', 'Fricção', 0, 2, 0.01, ''],
  ['restitution', 'Elasticidade', 0, 1, 0.01, ''],
  ['linDamp', 'Amortecimento linear', 0, 5, 0.01, ''],
  ['angDamp', 'Amortecimento angular', 0, 5, 0.01, ''],
  ['gravityScale', 'Escala de gravidade', 0, 3, 0.05, '×'],
];

function physCfg(o) {
  if (!o.userData.physics) o.userData.physics = { ...PHYS_DEFAULTS };
  return o.userData.physics;
}

function physicsHTML() {
  const c = physCfg(target);
  const dis = c.enabled ? '' : 'disabled';
  const seg = (key, val, label) =>
    `<button type="button" class="omSeg ${c[key] === val ? 'active' : ''}" data-act="phys-set" data-key="${key}" data-val="${val}" ${dis}><b>${label}</b></button>`;
  const slider = ([key, label, min, max, step, unit]) => `
    <label class="omSlider ${c.enabled ? '' : 'off'}">
      <span class="omSliderTop"><span>${label}</span><output data-out="${key}">${(+c[key]).toFixed(2)}${unit ? ` ${unit}` : ''}</output></span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${c[key]}" data-bind="${key}" data-unit="${unit}" ${dis}>
    </label>`;

  return `<div class="omPhysGrid">
    <div class="omStack">
      <section class="omCard">
        <label class="omSwitchRow">
          <span><b>Ativar física neste objeto</b><small>Entra na simulação como corpo rígido</small></span>
          <span class="omSwitch"><input type="checkbox" data-act="phys-enable" ${c.enabled ? 'checked' : ''}><i></i></span>
        </label>
      </section>
      <section class="omCard ${c.enabled ? '' : 'dim'}">
        <h3>Corpo</h3>
        <div class="omLabel">Tipo</div>
        <div class="omSegRow omSegRow3">
          ${seg('body', 'dynamic', 'Dinâmico')}${seg('body', 'static', 'Estático')}${seg('body', 'kinematic', 'Cinemático')}
        </div>
        <div class="omLabel">Forma de colisão</div>
        <div class="omChips">
          ${SHAPES.map(([v, l]) => `<button type="button" class="omChip ${c.shape === v ? 'active' : ''}" data-act="phys-set" data-key="shape" data-val="${v}" ${dis}>${l}</button>`).join('')}
        </div>
        <div class="omLabel">Material rápido</div>
        <div class="omChips">
          ${Object.keys(PHYS_PRESETS).map((n) => `<button type="button" class="omChip" data-act="phys-preset" data-val="${n}" ${dis}>${n}</button>`).join('')}
        </div>
      </section>
    </div>
    <div class="omStack">
      <section class="omCard ${c.enabled ? '' : 'dim'}">
        <h3>Propriedades</h3>
        ${SLIDERS.map(slider).join('')}
      </section>
      <section class="omCard">
        <h3>Cena</h3>
        <label class="omSlider">
          <span class="omSliderTop"><span>Gravidade (Y)</span><output data-out="gravity">${physGlobal.gravity.toFixed(2)} m/s²</output></span>
          <input type="range" min="-30" max="10" step="0.1" value="${physGlobal.gravity}" data-bind="gravity" data-global="1" data-unit=" m/s²">
        </label>
        <label class="omCheckRow">
          <input type="checkbox" data-act="phys-ground" ${physGlobal.ground ? 'checked' : ''}>
          <span>Chão de colisão em Y = 0</span>
        </label>
      </section>
      <section class="omCard">
        <h3>Simulação</h3>
        <div class="omBtnRow">
          <button type="button" class="omBtn primary" id="omPhysPlay" data-act="phys-play">&#9654; Simular</button>
          <button type="button" class="omBtn" id="omPhysPause" data-act="phys-pause">&#10074;&#10074; Pausar</button>
          <button type="button" class="omBtn" id="omPhysReset" data-act="phys-reset">&#8634; Resetar</button>
        </div>
        <div class="omStatus" id="omPhysStatus"></div>
      </section>
    </div>
  </div>`;
}

const Phys = {
  R: null, loading: null, world: null, entries: [], running: false,
  raf: 0, acc: 0, last: 0, stale: false, msg: '', error: false,

  async load() {
    if (this.R) return this.R;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const sources = [
        '@dimforge/rapier3d-compat',
        'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/rapier.es.js',
        'https://esm.sh/@dimforge/rapier3d-compat@0.12.0',
      ];
      let lastErr = null;
      for (const src of sources) {
        try {
          const mod = await import(/* @vite-ignore */ src);
          const R = mod.default?.init ? mod.default : (mod.init ? mod : null);
          if (!R) throw new Error('módulo sem init()');
          await R.init();
          this.R = R;
          return R;
        } catch (err) { lastErr = err; }
      }
      throw lastErr || new Error('falha ao carregar Rapier');
    })();
    try { return await this.loading; } finally { this.loading = null; }
  },

  physObjects() {
    const set = new Set(app.objects);
    if (target) set.add(target);
    return [...set].filter((o) => o?.parent && o.userData?.physics?.enabled);
  },

  /** Caixa local do objeto (espaço do próprio objeto, SEM escala) + pontos para convexa/trimesh. */
  localData(o, wantPoints) {
    o.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    const box = new THREE.Box3();
    const pts = [];
    const rel = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const m of collectMeshes(o)) {
      const pos = m.geometry.attributes?.position;
      if (!pos) continue;
      rel.multiplyMatrices(inv, m.matrixWorld);
      const stride = wantPoints ? Math.max(1, Math.ceil(pos.count / 4000)) : Math.max(1, Math.ceil(pos.count / 8000));
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i).applyMatrix4(rel);
        box.expandByPoint(v);
        if (wantPoints) pts.push(v.x, v.y, v.z);
      }
    }
    return { box, pts };
  },

  buildCollider(o, c, scale, dynamicLike) {
    const R = this.R;
    let shape = c.shape;
    const prim = o.userData.primitiveType;
    const needPoints = shape === 'convex' || shape === 'trimesh' || shape === 'auto';
    const { box, pts } = this.localData(o, needPoints);
    const empty = box.isEmpty();
    if (empty) box.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    const size = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());
    const hx = Math.max(size.x * Math.abs(scale.x) / 2, 0.01);
    const hy = Math.max(size.y * Math.abs(scale.y) / 2, 0.01);
    const hz = Math.max(size.z * Math.abs(scale.z) / 2, 0.01);

    if (shape === 'auto') {
      const map = { box: 'box', sphere: 'sphere', cylinder: 'cylinder', cone: 'cone', capsule: 'capsule', plane: 'box', circle: 'box', ring: 'box' };
      shape = map[prim] || (empty ? 'box' : (dynamicLike ? 'convex' : 'trimesh'));
    }
    if (shape === 'trimesh' && dynamicLike) shape = 'convex';   // trimesh não tem massa/volume

    const scaled = (arr) => {
      const out = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i += 3) {
        out[i] = arr[i] * scale.x; out[i + 1] = arr[i + 1] * scale.y; out[i + 2] = arr[i + 2] * scale.z;
      }
      return out;
    };

    let desc = null;
    if (shape === 'sphere') desc = R.ColliderDesc.ball(Math.max(hx, hy, hz));
    else if (shape === 'capsule') { const r = Math.max(hx, hz); desc = R.ColliderDesc.capsule(Math.max(hy - r, 0.01), r); }
    else if (shape === 'cylinder') desc = R.ColliderDesc.cylinder(hy, Math.max(hx, hz));
    else if (shape === 'cone') desc = R.ColliderDesc.cone(hy, Math.max(hx, hz));
    else if (shape === 'convex' && pts.length >= 12) desc = R.ColliderDesc.convexHull(scaled(pts));
    else if (shape === 'trimesh') {
      const verts = [], idx = [];
      const rel = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), v = new THREE.Vector3();
      for (const m of collectMeshes(o)) {
        const pos = m.geometry.attributes?.position;
        if (!pos) continue;
        rel.multiplyMatrices(inv, m.matrixWorld);
        const off = verts.length / 3;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(rel);
          verts.push(v.x * scale.x, v.y * scale.y, v.z * scale.z);
        }
        if (m.geometry.index) for (let i = 0; i < m.geometry.index.count; i++) idx.push(off + m.geometry.index.getX(i));
        else for (let i = 0; i < pos.count; i++) idx.push(off + i);
      }
      if (verts.length >= 9) desc = R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx));
    }
    if (!desc) desc = R.ColliderDesc.cuboid(hx, hy, hz);    // 'box' ou fallback
    desc.setTranslation(ctr.x * scale.x, ctr.y * scale.y, ctr.z * scale.z);
    return desc;
  },

  async start() {
    if (this.running) return;
    if (this.world) { this.resume(); return; }          // pausado → continua
    this.setMsg('Carregando motor de física…');
    let R;
    try { R = await this.load(); }
    catch (err) {
      console.error('[object-menu] Rapier indisponível:', err);
      this.setMsg('Não foi possível carregar o motor de física (Rapier). Verifique a conexão com a internet.', true);
      return;
    }
    const objs = this.physObjects();
    if (!objs.length) { this.setMsg('Nenhum objeto com física ativada. Ative em “Ativar física neste objeto”.', true); return; }

    const world = new R.World({ x: 0, y: physGlobal.gravity, z: 0 });
    world.timestep = 1 / 60;
    if (physGlobal.ground) {
      world.createCollider(R.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(0.8).setRestitution(0.1));
    }
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    this.entries = [];
    for (const o of objs) {
      const c = o.userData.physics;
      o.updateWorldMatrix(true, false);
      o.matrixWorld.decompose(p, q, s);
      const dyn = c.body === 'dynamic';
      let bd = dyn ? R.RigidBodyDesc.dynamic() : c.body === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed();
      bd = bd.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      if (dyn) bd = bd.setLinearDamping(c.linDamp).setAngularDamping(c.angDamp).setGravityScale(c.gravityScale).setCcdEnabled(true);
      const body = world.createRigidBody(bd);
      const cd = this.buildCollider(o, c, s, dyn || c.body === 'kinematic')
        .setFriction(c.friction).setRestitution(c.restitution);
      if (dyn) cd.setMass(Math.max(c.mass, 0.001));
      world.createCollider(cd, body);
      this.entries.push({
        o, body, kind: c.body,
        pos: o.position.clone(), quat: o.quaternion.clone(), scl: o.scale.clone(), worldScale: s.clone(),
      });
    }
    this.world = world;
    this.stale = false;
    this.resume();
  },

  resume() {
    if (this.running || !this.world) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.setMsg(`Simulando ${this.entries.length} objeto(s)…`);
    const tmpM = new THREE.Matrix4(), tmpInv = new THREE.Matrix4();
    const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();
    const tick = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.acc += Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      let steps = 0;
      while (this.acc >= 1 / 60 && steps < 5) {
        for (const e of this.entries) {          // cinemáticos seguem o objeto na cena (gizmo/animação)
          if (e.kind !== 'kinematic') continue;
          e.o.updateWorldMatrix(true, false);
          e.o.matrixWorld.decompose(tp, tq, ts);
          e.body.setNextKinematicTranslation({ x: tp.x, y: tp.y, z: tp.z });
          e.body.setNextKinematicRotation({ x: tq.x, y: tq.y, z: tq.z, w: tq.w });
        }
        this.world.step();
        this.acc -= 1 / 60; steps++;
      }
      if (steps === 0) return;
      for (const e of this.entries) {
        if (e.kind !== 'dynamic') continue;
        const t = e.body.translation(), r = e.body.rotation();
        const o = e.o;
        if (!o.parent || o.parent === app.scene) {
          o.position.set(t.x, t.y, t.z);
          o.quaternion.set(r.x, r.y, r.z, r.w);
        } else {
          o.parent.updateWorldMatrix(true, false);
          tmpInv.copy(o.parent.matrixWorld).invert();
          tmpM.compose(tp.set(t.x, t.y, t.z), tq.set(r.x, r.y, r.z, r.w), e.worldScale);
          tmpM.premultiply(tmpInv).decompose(o.position, o.quaternion, o.scale);
        }
      }
      markSceneDirty();
    };
    this.raf = requestAnimationFrame(tick);
    updatePhysStatus();
  },

  pause() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.setMsg('Simulação pausada.');
  },

  reset() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const e of this.entries) {
      e.o.position.copy(e.pos); e.o.quaternion.copy(e.quat); e.o.scale.copy(e.scl);
      e.o.updateMatrixWorld(true);
    }
    try { this.world?.free(); } catch { /* já liberado */ }
    this.world = null; this.entries = []; this.stale = false;
    markSceneDirty();
    this.setMsg('Cena restaurada ao estado inicial.');
  },

  setMsg(m, err = false) { this.msg = m; this.error = err; updatePhysStatus(); },
};

function updatePhysStatus() {
  const st = $('#omPhysStatus');
  if (!st) return;
  let text = Phys.msg;
  if (Phys.stale && Phys.world) text += (text ? ' ' : '') + 'Mudanças nas propriedades valem ao resetar e simular de novo.';
  st.textContent = text || 'Pronto. Ative a física em um ou mais objetos e clique em Simular.';
  st.classList.toggle('err', Phys.error);
  const play = $('#omPhysPlay'), pause = $('#omPhysPause'), reset = $('#omPhysReset');
  if (play) { play.disabled = Phys.running; play.innerHTML = Phys.world && !Phys.running ? '&#9654; Continuar' : '&#9654; Simular'; }
  if (pause) pause.disabled = !Phys.running;
  if (reset) reset.disabled = !Phys.world;
}

// ═══════════════════════════════════════════════════════════════════════
//  Eventos do corpo do painel
// ═══════════════════════════════════════════════════════════════════════
function onBodyClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  switch (act) {
    case 'go': setView(el.dataset.view); break;
    case 'mesh-mode': meshOpts.mode = el.dataset.val; render(); break;
    case 'mesh-level': meshOpts.level = Number(el.dataset.val); render(); break;
    case 'mesh-apply': applySubdivision(); break;
    case 'mesh-restore': restoreMesh(); break;
    case 'phys-set': {
      physCfg(target)[el.dataset.key] = el.dataset.val;
      Phys.stale = true; render(); break;
    }
    case 'phys-preset': {
      Object.assign(physCfg(target), PHYS_PRESETS[el.dataset.val]);
      Phys.stale = true; render(); break;
    }
    case 'phys-play': Phys.start(); break;
    case 'phys-pause': Phys.pause(); break;
    case 'phys-reset': Phys.reset(); break;
    default: break;
  }
}

function onBodyInput(e) {
  const el = e.target;
  if (!el.matches?.('input[type="range"][data-bind]')) return;
  const key = el.dataset.bind;
  const v = parseFloat(el.value);
  if (el.dataset.global) physGlobal[key] = v;
  else physCfg(target)[key] = v;
  const out = win.querySelector(`output[data-out="${key}"]`);
  const unit = el.dataset.unit || '';
  if (out) out.textContent = `${v.toFixed(2)}${unit ? (unit.startsWith(' ') ? unit : ` ${unit}`) : ''}`;
  if (Phys.world) { Phys.stale = true; updatePhysStatus(); }
}

function onBodyChange(e) {
  const el = e.target;
  const act = el.dataset?.act;
  if (act === 'phys-enable') {
    physCfg(target).enabled = el.checked;
    if (Phys.world) Phys.stale = true;
    render();
  } else if (act === 'phys-ground') {
    physGlobal.ground = el.checked;
    if (Phys.world) { Phys.stale = true; updatePhysStatus(); }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Long-press (1,5 s) em um objeto da cena
// ═══════════════════════════════════════════════════════════════════════
function pickObject(clientX, clientY) {
  const el = app.renderer?.domElement;
  if (!el || !app.camera) return null;
  const rect = el.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, app.camera);
  if (app.deepSelectMode) {
    const hits = rc.intersectObjects(app.scene.children, true);
    const h = hits.find((x) => {
      const o = x.object;
      return o !== app.floor && !o.userData.isHelper && !o.userData.isBoneMarker && o.visible
        && o !== app.transformControls?.getHelper?.();
    });
    return h ? h.object : null;
  }
  const hits = rc.intersectObjects(app.objects, false);
  return hits.length ? (hits[0].object.userData.selectTarget ?? hits[0].object) : null;
}

function createRing() {
  const ring = document.createElement('div');
  ring.className = 'omHoldRing';
  ring.innerHTML = `<svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18"/></svg>`;
  document.body.appendChild(ring);
  return ring;
}

function bindLongPress() {
  const el = app.renderer.domElement;
  const ring = createRing();
  let hold = null, ringT = null, sx = 0, sy = 0, lx = 0, ly = 0;

  const cancel = () => {
    clearTimeout(hold); clearTimeout(ringT);
    hold = ringT = null;
    ring.classList.remove('on');
  };

  el.addEventListener('pointerdown', (e) => {
    cancel();
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (app.domainDrawing || window._groupPickMode) return;
    if (e.target.closest?.('#ui')) return;
    if (!pickObject(e.clientX, e.clientY)) return;       // só começa se estiver sobre um objeto
    sx = lx = e.clientX; sy = ly = e.clientY;
    ring.style.left = `${sx}px`; ring.style.top = `${sy}px`;
    ringT = setTimeout(() => { void ring.offsetWidth; ring.classList.add('on'); }, RING_DELAY);
    hold = setTimeout(() => {
      cancel();
      if (app.transformControls?.dragging || app.domainDrawing) return;
      const obj = pickObject(lx, ly);
      if (!obj) return;
      setSelected(obj);
      openMenu(obj);
    }, HOLD_MS);
  });

  window.addEventListener('pointermove', (e) => {
    if (!hold) return;
    lx = e.clientX; ly = e.clientY;
    const dx = lx - sx, dy = ly - sy;
    if (dx * dx + dy * dy > MOVE_TOL * MOVE_TOL) cancel();      // virou arrasto/órbita
  });
  window.addEventListener('pointerup', cancel);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  el.addEventListener('wheel', cancel, { passive: true });
}

// ═══════════════════════════════════════════════════════════════════════
let inited = false;
export function initObjectMenu() {
  if (inited || !app.renderer) return;
  inited = true;
  bindLongPress();
}

export { openMenu as openObjectMenu, closeMenu as closeObjectMenu };
