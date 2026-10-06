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

function kindLabel(o) {
  if (o.isMesh) return 'Mesh';
  if (o.isLight) return 'Luz';
  if (o.isCamera) return 'Câmera';
  if (o.isGroup) return 'Grupo';
  return o.type || 'Objeto';
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

/** Posiciona perto do ponto onde o clique longo aconteceu (sem cobrir o objeto). */
function placeNear(pt) {
  const r = win.getBoundingClientRect();
  const w = r.width, h = r.height, m = 8, gap = 30;
  let x, y;
  if (pt) {
    x = pt.x + gap;
    if (x + w > window.innerWidth - m) x = pt.x - gap - w;
    y = pt.y - 40;
  } else {
    x = (window.innerWidth - w) / 2;
    y = (window.innerHeight - h) / 2;
  }
  win.style.left = `${Math.max(m, Math.min(x, window.innerWidth - w - m))}px`;
  win.style.top = `${Math.max(m, Math.min(y, window.innerHeight - h - m))}px`;
}

/** Mantém a janela inteira visível quando o conteúdo muda de altura. */
function fitInViewport() {
  if (!isOpen()) return;
  const r = win.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8) win.style.top = `${Math.max(8, window.innerHeight - 8 - r.height)}px`;
  if (r.right > window.innerWidth - 8) win.style.left = `${Math.max(8, window.innerWidth - 8 - r.width)}px`;
}

function clampToViewport() {
  if (!win || win.classList.contains('hidden')) return;
  const r = win.getBoundingClientRect();
  win.style.left = `${Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth - 80))}px`;
  win.style.top = `${Math.min(Math.max(0, r.top), Math.max(0, window.innerHeight - 40))}px`;
  fitInViewport();
}

function isOpen() { return !!win && !win.classList.contains('hidden'); }

function openMenu(obj, pt) {
  const wasOpen = isOpen();
  ensureWindow();
  target = obj;
  view = 'home';
  meshOpts.msg = '';
  Phys.msg = ''; Phys.error = false;
  win.classList.remove('hidden');
  render();
  if (!wasOpen) placeNear(pt); else fitInViewport();
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
  fitInViewport();
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
  const rotDeg = { x: THREE.MathUtils.radToDeg(o.rotation.x), y: THREE.MathUtils.radToDeg(o.rotation.y), z: THREE.MathUtils.radToDeg(o.rotation.z) };
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
  Phys.msg = ''; Phys.error = false;
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

  return `<div class="omStack">
    <section class="omCard">
      <label class="omSwitchRow">
        <span><b>Ativar física neste objeto</b><small>Corpo rígido (Rapier)</small></span>
        <span class="omSwitch"><input type="checkbox" data-act="phys-enable" ${c.enabled ? 'checked' : ''}><i></i></span>
      </label>
    </section>
    <section class="omCard ${c.enabled ? '' : 'dim'}">
      <h3>Corpo</h3>
      <div class="omSegRow omSegRow3">
        ${seg('body', 'dynamic', 'Dinâmico')}${seg('body', 'static', 'Estático')}${seg('body', 'kinematic', 'Cinemático')}
      </div>
      <div class="omLabel">Colisão</div>
      <div class="omChips">
        ${SHAPES.map(([v, l]) => `<button type="button" class="omChip ${c.shape === v ? 'active' : ''}" data-act="phys-set" data-key="shape" data-val="${v}" ${dis}>${l}</button>`).join('')}
      </div>
      <div class="omLabel">Material rápido</div>
      <div class="omChips">
        ${Object.keys(PHYS_PRESETS).map((n) => `<button type="button" class="omChip" data-act="phys-preset" data-val="${n}" ${dis}>${n}</button>`).join('')}
      </div>
    </section>
    <section class="omCard ${c.enabled ? '' : 'dim'}">
      <h3>Propriedades</h3>
      <div class="omSliderGrid">${SLIDERS.map(slider).join('')}</div>
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
      <h3>Simulação <em>— só este objeto</em></h3>
      <div class="omStatus" style="margin:0 0 8px">Na timeline: a física roda ao dar play. Selecione um keyframe e use <b>&#9883; Física</b> (ponto azul) para a física assumir dali; keyframes comuns movem o objeto e ele empurra os outros.</div>
      <div class="omBtnRow">
        <button type="button" class="omBtn primary" id="omPhysPlay" data-act="phys-play">&#9654; Simular</button>
        <button type="button" class="omBtn" id="omPhysPause" data-act="phys-pause">&#10074;&#10074; Pausar</button>
        <button type="button" class="omBtn" id="omPhysReset" data-act="phys-reset">&#8634; Resetar</button>
      </div>
      <div class="omStatus" id="omPhysStatus"></div>
      <div class="omStatus" id="omPhysDiag" style="margin-top:6px"></div>
    </section>
  </div>`;
}

/**
 * Física por objeto: um único mundo Rapier compartilhado, mas Simular / Pausar /
 * Resetar valem só para o objeto selecionado no menu. Os demais objetos com física
 * ativada (e ainda não simulados) entram no mundo como obstáculos fixos.
 */
const Phys = {
  R: null, loading: null, world: null, entries: new Map(),
  running: false, raf: 0, acc: 0, last: 0, msg: '', error: false,

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

  stateOf(o) {
    const e = this.entries.get(o);
    if (!e || !e.active) return 'idle';
    return e.paused ? 'paused' : 'running';
  },
  hasActive() { for (const e of this.entries.values()) if (e.active) return true; return false; },
  hasRunning() { for (const e of this.entries.values()) if (e.active && !e.paused) return true; return false; },

  physObjects() {
    const set = new Set(app.objects);
    if (target) set.add(target);
    return [...set].filter((o) => o?.parent && o.userData?.physics?.enabled);
  },

  /** Caixa local do objeto (espaço do próprio objeto, SEM escala) + pontos para convexa. */
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
      const stride = Math.max(1, Math.ceil(pos.count / (wantPoints ? 4000 : 8000)));
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
    const { box, pts } = this.localData(o, shape === 'convex' || shape === 'auto');
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
    if (shape === 'trimesh' && dynamicLike) shape = 'convex';   // malha exata não tem volume/massa

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
    else if (shape === 'convex') {
      let P = pts;
      if (P.length < 12) { const { pts: more } = this.localData(o, true); P = more; }
      if (P.length >= 12) desc = R.ColliderDesc.convexHull(scaled(P));
    } else if (shape === 'trimesh') {
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
    if (shape !== 'trimesh') desc.setTranslation(ctr.x * scale.x, ctr.y * scale.y, ctr.z * scale.z);
    return desc;
  },

  ensureWorld() {
    if (this.world) return;
    const R = this.R;
    this.world = new R.World({ x: 0, y: physGlobal.gravity, z: 0 });
    this.world.timestep = 1 / 60;
    if (physGlobal.ground) {
      this.world.createCollider(R.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(0.8).setRestitution(0.1));
    }
  },

  bodyType(kind) {
    const T = this.R.RigidBodyType;
    return kind === 'dynamic' ? T.Dynamic : kind === 'kinematic' ? T.KinematicPositionBased : T.Fixed;
  },

  makeEntry(o, active) {
    const R = this.R;
    const c = o.userData.physics;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    o.updateWorldMatrix(true, false);
    o.matrixWorld.decompose(p, q, s);
    const dyn = c.body === 'dynamic';
    let bd = dyn ? R.RigidBodyDesc.dynamic() : c.body === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed();
    bd = bd.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    if (dyn) bd = bd.setLinearDamping(c.linDamp).setAngularDamping(c.angDamp).setGravityScale(c.gravityScale).setCcdEnabled(true);
    const body = this.world.createRigidBody(bd);
    const cd = this.buildCollider(o, c, s, c.body !== 'static').setFriction(c.friction).setRestitution(c.restitution);
    if (dyn) cd.setMass(Math.max(c.mass, 0.001));
    const collider = this.world.createCollider(cd, body);
    if (!active && c.body !== 'static') body.setBodyType(R.RigidBodyType.Fixed, false);   // obstáculo fixo
    const e = {
      o, body, collider, kind: c.body, active, paused: false, vel: null,
      pos: o.position.clone(), quat: o.quaternion.clone(), scl: o.scale.clone(), worldScale: s.clone(),
    };
    this.entries.set(o, e);
    return e;
  },

  /** Leva o corpo para onde a malha está agora (usado ao arrastar com o gizmo e ao retomar). */
  teleport(e, zeroVel) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    e.o.updateWorldMatrix(true, false);
    e.o.matrixWorld.decompose(p, q, s);
    e.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    e.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    if (zeroVel) { e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  },

  /** Aplica ao vivo o que o Rapier permite mudar sem recriar o corpo. */
  applyLive(o) {
    const e = this.entries.get(o);
    const c = o.userData.physics;
    if (!e || !c) return;
    try {
      if (e.kind === 'dynamic') {
        e.body.setLinearDamping(c.linDamp);
        e.body.setAngularDamping(c.angDamp);
        e.body.setGravityScale(c.gravityScale, true);
        e.collider.setMass(Math.max(c.mass, 0.001));
      }
      e.collider.setFriction(c.friction);
      e.collider.setRestitution(c.restitution);
    } catch { /* corpo já removido */ }
  },

  async play(o) {
    const c = o?.userData?.physics;
    if (!c?.enabled) { this.setMsg('Ative a física neste objeto primeiro.', true); return; }
    const cur = this.entries.get(o);
    if (cur?.active && !cur.paused) return;
    this.setMsg('Carregando motor de física…');
    try { await this.load(); }
    catch (err) {
      console.error('[object-menu] Rapier indisponível:', err);
      this.setMsg('Não foi possível carregar o motor de física (Rapier). Verifique a conexão com a internet.', true);
      return;
    }
    this.ensureWorld();
    // Demais objetos com física ativada entram como obstáculos fixos
    for (const other of this.physObjects()) {
      if (other !== o && !this.entries.has(other)) this.makeEntry(other, false);
    }
    let e = this.entries.get(o);
    if (!e) e = this.makeEntry(o, true);
    else {
      this.teleport(e, false);             // se foi movido enquanto parado/pausado
      e.body.setBodyType(this.bodyType(e.kind), true);
      if (e.paused && e.vel && e.kind === 'dynamic') {
        e.body.setLinvel(e.vel.lin, true); e.body.setAngvel(e.vel.ang, true);
      }
      e.vel = null; e.active = true; e.paused = false;
      this.applyLive(o);
    }
    this.startLoop();
    this.setMsg('Simulando este objeto…');
  },

  pause(o) {
    const e = this.entries.get(o);
    if (!e || !e.active || e.paused) return;
    if (e.kind === 'dynamic') e.vel = { lin: { ...e.body.linvel() }, ang: { ...e.body.angvel() } };
    e.body.setBodyType(this.R.RigidBodyType.Fixed, false);
    e.paused = true;
    if (!this.hasRunning()) this.stopLoop();
    this.setMsg('Simulação pausada.');
  },

  reset(o) {
    const e = this.entries.get(o);
    if (!e) { this.setMsg('Este objeto não está em simulação.'); return; }
    e.o.position.copy(e.pos); e.o.quaternion.copy(e.quat); e.o.scale.copy(e.scl);
    e.o.updateMatrixWorld(true);
    this.dropEntry(e);
    markSceneDirty();
    this.setMsg('Objeto restaurado ao estado inicial.');
  },

  dropEntry(e) {
    try { this.world?.removeRigidBody(e.body); } catch { /* já removido */ }
    this.entries.delete(e.o);
    if (!this.hasRunning()) this.stopLoop();
    if (!this.hasActive()) {                       // sobraram só obstáculos → desmonta o mundo
      try { this.world?.free(); } catch { /* já liberado */ }
      this.world = null; this.entries.clear();
    }
  },

  startLoop() {
    if (this.running || !this.world) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const tmpM = new THREE.Matrix4(), tmpInv = new THREE.Matrix4();
    const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();
    const tick = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (!this.world) return;
      this.acc += Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      for (const e of [...this.entries.values()]) {            // objeto removido da cena
        if (!e.o.parent) this.dropEntry(e);
      }
      if (!this.world) return;
      const dragObj = app.transformControls?.dragging ? app.transformControls.object : null;
      let steps = 0;
      while (this.acc >= 1 / 60 && steps < 5) {
        for (const e of this.entries.values()) {
          if (e.o === dragObj) { this.teleport(e, true); continue; }     // gizmo manda enquanto arrasta
          if (e.active && !e.paused && e.kind === 'kinematic') {          // cinemático segue a malha
            e.o.updateWorldMatrix(true, false);
            e.o.matrixWorld.decompose(tp, tq, ts);
            e.body.setNextKinematicTranslation({ x: tp.x, y: tp.y, z: tp.z });
            e.body.setNextKinematicRotation({ x: tq.x, y: tq.y, z: tq.z, w: tq.w });
          }
        }
        this.world.step();
        this.acc -= 1 / 60; steps++;
      }
      if (steps === 0) return;
      for (const e of this.entries.values()) {
        if (!e.active || e.paused || e.kind !== 'dynamic' || e.o === dragObj) continue;
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
  },

  stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  },

  setMsg(m, err = false) { this.msg = m; this.error = err; updatePhysStatus(); },
};

/**
 * Física na TIMELINE (keyframes).
 *
 * Cada objeto com física "Dinâmico" é simulado junto, num mundo Rapier "assado" por
 * quadro (cache determinístico: play, voltar e arrastar o playhead mostram sempre o
 * mesmo resultado). Quem manda no objeto em cada trecho depende do keyframe que o governa:
 *
 *   • keyframe com física LIGADA (⚛, ponto azul): a partir dele a física simula o objeto
 *     até o próximo keyframe. O keyframe guarda pose + velocidade, então a simulação
 *     continua exatamente de onde estava ("keyframes salvam a física").
 *   • keyframe comum (ponto amarelo): a animação (interpolação) manda e o objeto vira um
 *     collider animado — empurra os outros. Ao chegar num keyframe com física ligada ele é
 *     "solto" levando a velocidade que vinha da animação (embalo).
 *   • sem nenhum keyframe: simulado desde o quadro 0, a partir da pose em que foi deixado.
 *
 * Criar um keyframe num quadro em que o objeto está sendo simulado (sem ter sido movido
 * à mão) já grava a física nele automaticamente.
 */
const TL = {
  world: null, ents: [], baked: -1, sub: 1, fps: 24,
  sig: '', sigAt: 0, loading: false, _first: true,
  _p: new THREE.Vector3(), _q: new THREE.Quaternion(), _s: new THREE.Vector3(),
  _m: new THREE.Matrix4(), _e: new THREE.Euler(),

  reset() {
    try { this.world?.free(); } catch { /* já liberado */ }
    this.world = null; this.ents = []; this.baked = -1; this._first = true;
  },

  hasKeys(k) { if (!k) return false; for (const _ in k) return true; return false; },

  isDriven(o) {
    const c = o?.userData?.physics;
    return !!(c?.enabled && c.body === 'dynamic' && o.parent);
  },

  hasCandidates() {
    if (!window.__animEval) return false;
    for (const o of app.objects || []) if (this.isDriven(o)) return true;
    return false;
  },

  /** Objeto sem keyframes: guarda a pose de repouso e percebe quando o usuário o move. */
  trackRest(o) {
    const u = o.userData, last = u._tlLast;
    const cur = [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.scale.x, o.scale.y, o.scale.z];
    if (!u._tlRest || (last && cur.some((v, i) => Math.abs(v - last[i]) > 1e-4))) u._tlRest = cur;
  },

  signature() {
    const A = window.__animEval;
    let s = `${A.fps()}|${physGlobal.gravity}|${physGlobal.ground}`;
    for (const o of Phys.physObjects()) {
      const k = A.kfsOf(o.uuid);
      s += `#${o.uuid}${JSON.stringify(o.userData.physics)}`;
      s += this.hasKeys(k) ? JSON.stringify(k) : JSON.stringify(o.userData._tlRest || o.position.toArray());
      if (this.hasKeys(k)) s += JSON.stringify(o.userData._tlRest || 0);
    }
    return s;
  },

  /** Pose MUNDIAL do objeto no quadro `frame` (keyframes; ou pose de repouso se forceRest / sem keys). */
  poseAt(o, frame, p, q, s, forceRest) {
    const r = o.userData._tlRest;
    const useRest = r && o.userData.physics?.body === 'dynamic';
    const kf = (forceRest && useRest) ? null : window.__animEval.kfAt(o.uuid, frame);
    if (kf) {
      p.set(kf.position.x, kf.position.y, kf.position.z);
      q.setFromEuler(this._e.set(kf.rotation.x, kf.rotation.y, kf.rotation.z, kf.rotation.order || 'XYZ'));
      s.set(kf.scale.x, kf.scale.y, kf.scale.z);
    } else if (useRest) {
      p.set(r[0], r[1], r[2]); q.set(r[3], r[4], r[5], r[6]); s.set(r[7], r[8], r[9]);
    } else {
      p.copy(o.position); q.copy(o.quaternion); s.copy(o.scale);
    }
    if (o.parent && o.parent !== app.scene) {
      o.parent.updateWorldMatrix(true, false);
      this._m.compose(p, q, s).premultiply(o.parent.matrixWorld).decompose(p, q, s);
    }
  },

  build() {
    const R = Phys.R, A = window.__animEval;
    this.fps = A.fps();
    this.sub = Math.max(1, Math.round(120 / this.fps));
    this.world = new R.World({ x: 0, y: physGlobal.gravity, z: 0 });
    this.world.timestep = 1 / (this.fps * this.sub);
    if (physGlobal.ground) {
      this.world.createCollider(R.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(0.8).setRestitution(0.1));
    }
    this.ents = []; this.baked = -1; this._first = true;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const o of Phys.physObjects()) {
      const c = o.userData.physics;
      const kfs = A.kfsOf(o.uuid), keyed = this.hasKeys(kfs);
      const fr = keyed ? Object.keys(kfs).map(Number).sort((a, b) => a - b) : [];
      const dyn = c.body === 'dynamic';
      const follow = !dyn && keyed;                                // collider animado
      this.poseAt(o, fr[0] ?? 0, p, q, s, dyn);
      let bd = dyn ? R.RigidBodyDesc.dynamic() : follow ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed();
      bd = bd.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      if (dyn) bd = bd.setLinearDamping(c.linDamp).setAngularDamping(c.angDamp).setGravityScale(c.gravityScale).setCcdEnabled(true);
      const body = this.world.createRigidBody(bd);
      const cd = Phys.buildCollider(o, c, s, c.body !== 'static').setFriction(c.friction).setRestitution(c.restitution);
      if (dyn) cd.setMass(Math.max(c.mass, 0.001));
      this.world.createCollider(cd, body);
      this.ents.push({
        o, body, dyn, follow, kfs, fr, hasRest: !!o.userData._tlRest,
        type: dyn ? 'd' : 'x', prev: null, cache: [], modes: [], worldScale: s.clone(),
        pa: new THREE.Vector3(), qa: new THREE.Quaternion(), pb: new THREE.Vector3(), qb: new THREE.Quaternion(), sc: new THREE.Vector3(),
      });
    }
  },

  /** 'p' = física manda neste quadro, 'a' = animação manda. */
  modeAt(e, f) {
    if (!e.fr.length) return 'p';
    let g = -1;
    for (let i = 0; i < e.fr.length; i++) { if (e.fr[i] <= f) g = i; else break; }
    if (g < 0) return (e.kfs[e.fr[0]]?.phys && e.hasRest) ? 'p' : 'a';
    return e.kfs[e.fr[g]]?.phys ? 'p' : 'a';
  },

  ensureBaked(target) {
    const T = Phys.R.RigidBodyType;
    target = Math.min(target, 20000);
    const qi = new THREE.Quaternion(), pp = new THREE.Vector3();
    const fps = this.fps;
    while (this.baked < target) {
      const f = this.baked + 1;
      for (const e of this.ents) {
        if (e.dyn) {
          const mode = this.modeAt(e, f);
          e.modes[f] = mode;
          e.follow = mode === 'a';
          if (mode === 'a') {                                      // animação manda → collider animado
            if (e.type !== 'k') { e.body.setBodyType(T.KinematicPositionBased, true); e.type = 'k'; }
            this.poseAt(e.o, f, e.pa, e.qa, e.sc);
            this.poseAt(e.o, f + 1, e.pb, e.qb, e.sc);
            if (e.prev !== 'a') { e.body.setTranslation(e.pa, true); e.body.setRotation(e.qa, true); }
          } else {                                                 // física manda
            const kf = e.kfs?.[f];
            const reseed = f === 0 || e.prev !== 'p' || !!kf?.phys;
            if (reseed) {
              const before = e.fr.length && f < e.fr[0];
              const ph = kf?.phys;
              let lin = { x: 0, y: 0, z: 0 }, ang = { x: 0, y: 0, z: 0 };
              if (ph && ph.lin) { lin = { x: ph.lin[0], y: ph.lin[1], z: ph.lin[2] }; ang = { x: ph.ang[0], y: ph.ang[1], z: ph.ang[2] }; }
              else if (e.prev === 'p') { lin = e.body.linvel(); ang = e.body.angvel(); }   // continua o embalo
              else if (e.prev === 'a' && f > 0) {                                           // solta com a velocidade da animação
                this.poseAt(e.o, f, e.pa, e.qa, e.sc);
                this.poseAt(e.o, f - 1, e.pb, e.qb, e.sc);
                lin = { x: (e.pa.x - e.pb.x) * fps, y: (e.pa.y - e.pb.y) * fps, z: (e.pa.z - e.pb.z) * fps };
              }
              if (e.type !== 'd') { e.body.setBodyType(T.Dynamic, true); e.type = 'd'; }
              this.poseAt(e.o, f, e.pa, e.qa, e.sc, before);
              e.worldScale.copy(e.sc);
              e.body.setTranslation(e.pa, true); e.body.setRotation(e.qa, true);
              e.body.setLinvel(lin, true); e.body.setAngvel(ang, true);
            }
            const t = e.body.translation(), r = e.body.rotation(), lv = e.body.linvel(), av = e.body.angvel();
            e.cache[f] = { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w], lv: [lv.x, lv.y, lv.z], av: [av.x, av.y, av.z] };
          }
          e.prev = mode;
        } else if (e.follow) {
          this.poseAt(e.o, f, e.pa, e.qa, e.sc);
          this.poseAt(e.o, f + 1, e.pb, e.qb, e.sc);
          if (this._first) { e.body.setTranslation(e.pa, true); e.body.setRotation(e.qa, true); }
        }
      }
      this._first = false;
      for (let k = 1; k <= this.sub; k++) {                       // avança f → f+1
        const t = k / this.sub;
        for (const e of this.ents) {
          if (!e.follow) continue;
          pp.copy(e.pa).lerp(e.pb, t);
          qi.copy(e.qa).slerp(e.qb, t);
          e.body.setNextKinematicTranslation(pp); e.body.setNextKinematicRotation(qi);
        }
        this.world.step();
      }
      this.baked = f;
    }
  },

  diag(text) { this.info = text; const el = $('#omPhysDiag'); if (el) el.textContent = text ? `Timeline: ${text}` : ''; },

  /** Chamado a cada quadro da timeline (seek ou play). */
  apply(frame) {
    if (Phys.hasActive()) { this.diag('simulação manual ativa (botão Simular) — clique em Resetar nos objetos para a timeline assumir.'); return; }
    if (!this.hasCandidates()) { if (this.world) this.reset(); this.diag('nenhum objeto com física Dinâmica ativada.'); return; }
    if (!Phys.R) {
      if (!this.loading) {
        this.loading = true;
        Phys.setMsg('Carregando motor de física…');
        Phys.load().then(() => { Phys.setMsg(''); window.__animEval?.refresh(); })
          .catch((err) => {
            console.error('[object-menu] Rapier indisponível:', err);
            Phys.setMsg('Não foi possível carregar o motor de física (Rapier). Verifique a internet.', true);
          })
          .finally(() => { this.loading = false; });
      }
      return;
    }
    const A = window.__animEval, now = performance.now();
    for (const o of app.objects || []) if (this.isDriven(o) && !this.hasKeys(A.kfsOf(o.uuid))) this.trackRest(o);
    if (!A.isPlaying() || now - this.sigAt > 400) {               // detecta edição de keyframes/física
      this.sigAt = now;
      const sg = this.signature();
      if (sg !== this.sig) { this.sig = sg; this.reset(); }
    }
    if (!this.world) this.build();
    const f0 = Math.floor(frame), f1 = Math.ceil(frame);
    this.ensureBaked(f1);
    const tt = f1 === f0 ? 0 : frame - f0;
    const tmpM = new THREE.Matrix4(), tmpInv = new THREE.Matrix4();
    const tp = new THREE.Vector3(), tp2 = new THREE.Vector3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion();
    let moved = false;
    for (const e of this.ents) {
      if (!e.dyn || e.modes[f0] !== 'p') continue;                // animação manda neste quadro
      const a = e.cache[f0];
      if (!a) continue;
      const b = (e.modes[f1] === 'p' && e.cache[f1]) || a;
      tp.set(a.p[0], a.p[1], a.p[2]).lerp(tp2.set(b.p[0], b.p[1], b.p[2]), tt);
      tq.set(a.q[0], a.q[1], a.q[2], a.q[3]).slerp(tq2.set(b.q[0], b.q[1], b.q[2], b.q[3]), tt);
      const o = e.o;
      if (!o.parent || o.parent === app.scene) {
        o.position.copy(tp); o.quaternion.copy(tq);
      } else {
        o.parent.updateWorldMatrix(true, false);
        tmpInv.copy(o.parent.matrixWorld).invert();
        tmpM.compose(tp, tq, e.worldScale).premultiply(tmpInv).decompose(o.position, o.quaternion, o.scale);
      }
      o.updateMatrixWorld(true);
      if (!this.hasKeys(e.kfs)) {
        o.userData._tlLast = [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.scale.x, o.scale.y, o.scale.z];
      }
      moved = true;
    }
    if (moved) markSceneDirty();
    if (!A.isPlaying() || (now - (this._diagAt || 0)) > 250) {
      this._diagAt = now;
      this.diag(`quadro ${f0} · ` + this.ents.filter((e) => e.dyn).map((e) => {
        const m = e.modes[f0], d = e.cache[f0];
        return `${objName(e.o)}: ${m === 'p' ? `física${d ? ` (y=${d.p[1].toFixed(2)})` : ''}` : 'animação'}`;
      }).join(' · '));
    }
  },

  /**
   * Chamado quando um keyframe é criado em `frame`: se o objeto estava sendo simulado ali
   * (e não foi movido à mão), devolve o estado físico para ser gravado no keyframe.
   */
  captureKF(obj, frame) {
    const c = obj?.userData?.physics;
    if (!c?.enabled || c.body !== 'dynamic' || !Phys.R || !this.world) return null;
    const e = this.ents.find((x) => x.o === obj && x.dyn);
    const d = e?.modes[frame] === 'p' ? e.cache[frame] : null;
    if (!d) return null;
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(this._p, this._q, this._s);
    if (this._p.distanceTo(this._s.set(d.p[0], d.p[1], d.p[2])) > 1e-3) return null;   // movido à mão → animação
    return { lin: d.lv.slice(), ang: d.av.slice() };
  },
};
window.__physTimeline = TL;

function updatePhysStatus() {
  const st = $('#omPhysStatus');
  if (!st || !target) return;
  const state = Phys.stateOf(target);
  const enabled = !!target.userData.physics?.enabled;
  st.textContent = Phys.msg || ({
    idle: enabled ? 'Parado. Clique em Simular para este objeto.' : 'Ative a física neste objeto para simular.',
    running: 'Simulando este objeto…',
    paused: 'Simulação pausada.',
  }[state]);
  st.classList.toggle('err', Phys.error);
  const play = $('#omPhysPlay'), pause = $('#omPhysPause'), reset = $('#omPhysReset');
  if (play) { play.disabled = !enabled || state === 'running'; play.innerHTML = state === 'paused' ? '&#9654; Continuar' : '&#9654; Simular'; }
  if (pause) pause.disabled = state !== 'running';
  if (reset) reset.disabled = !Phys.entries.has(target);
  const dg = $('#omPhysDiag'); if (dg && TL.info) dg.textContent = `Timeline: ${TL.info}`;
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
      Phys.msg = Phys.entries.has(target) ? 'Resete este objeto para aplicar o novo tipo/forma.' : '';
      render(); break;
    }
    case 'phys-preset': {
      Object.assign(physCfg(target), PHYS_PRESETS[el.dataset.val]);
      Phys.applyLive(target);
      render(); break;
    }
    case 'phys-play': Phys.play(target); break;
    case 'phys-pause': Phys.pause(target); break;
    case 'phys-reset': Phys.reset(target); break;
    default: break;
  }
}

function onBodyInput(e) {
  const el = e.target;
  if (!el.matches?.('input[type="range"][data-bind]')) return;
  const key = el.dataset.bind;
  const v = parseFloat(el.value);
  if (el.dataset.global) {
    physGlobal[key] = v;
    if (key === 'gravity' && Phys.world) Phys.world.gravity = { x: 0, y: v, z: 0 };
  } else {
    physCfg(target)[key] = v;
    Phys.applyLive(target);
  }
  const out = win.querySelector(`output[data-out="${key}"]`);
  const unit = el.dataset.unit || '';
  if (out) out.textContent = `${v.toFixed(2)}${unit ? (unit.startsWith(' ') ? unit : ` ${unit}`) : ''}`;
}

function onBodyChange(e) {
  const el = e.target;
  const act = el.dataset?.act;
  if (act === 'phys-enable') {
    physCfg(target).enabled = el.checked;
    if (!el.checked && Phys.entries.has(target)) Phys.reset(target);   // desligou → sai da simulação
    render();
  } else if (act === 'phys-ground') {
    physGlobal.ground = el.checked;
    Phys.msg = Phys.world ? 'O chão muda na próxima simulação (resete os objetos).' : '';
    updatePhysStatus();
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
      openMenu(obj, { x: lx, y: ly });
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
