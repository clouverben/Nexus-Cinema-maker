import * as THREE from 'three';
import { app, getSelected, ensurePhysicalMaterial, markSceneDirty } from './scene.js';

const state = {
  root: null,
  selectedLabel: null,
  texturePicker: null,
  pendingSlot: null,
  syncing: false,
  initialized: false
};

const slots = [
  ['map', 'Albedo'],
  ['normalMap', 'Normal'],
  ['roughnessMap', 'Roughness'],
  ['metalnessMap', 'Metalness'],
  ['aoMap', 'AO'],
  ['emissiveMap', 'Emissive'],
  ['alphaMap', 'Alpha'],
  ['clearcoatMap', 'Clearcoat'],
  ['clearcoatNormalMap', 'CC Normal'],
  ['clearcoatRoughnessMap', 'CC Rough'],
  ['specularColorMap', 'Spec C'],
  ['specularIntensityMap', 'Spec I'],
  ['sheenColorMap', 'Sheen C'],
  ['sheenRoughnessMap', 'Sheen R'],
  ['transmissionMap', 'Trans'],
  ['thicknessMap', 'Thick'],
  ['iridescenceMap', 'Irides'],
  ['iridescenceThicknessMap', 'Iri T'],
  ['envMap', 'Env']
];

function iconColor() { return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"></circle></svg>`; }
function iconOpacity() { return `<svg viewBox="0 0 24 24"><path d="M12 4c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9Z"></path></svg>`; }
function iconRoughness() { return `<svg viewBox="0 0 24 24"><path d="M5 17l4-8 3 5 3-3 4 6"></path></svg>`; }
function iconMetalness() { return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><path d="M12 7v10M7 12h10"></path></svg>`; }
function iconSpecular() { return `<svg viewBox="0 0 24 24"><path d="M12 4l1.4 4.1L18 10l-4.6 1.4L12 16l-1.4-4.6L6 10l4.6-1.9L12 4Z"></path></svg>`; }
function iconEmissive() { return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path></svg>`; }
function iconClearcoat() { return `<svg viewBox="0 0 24 24"><path d="M5 7h14v5H5z"></path><path d="M5 12h14v5H5z"></path></svg>`; }
function iconTransmission() { return `<svg viewBox="0 0 24 24"><path d="M6 6h12l-2 6 2 6H6l2-6-2-6Z"></path><path d="M9 9h6M9 15h6"></path></svg>`; }
function iconThickness() { return `<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"></path></svg>`; }
function iconIOR() { return `<svg viewBox="0 0 24 24"><path d="M6 14c2-5 10-5 12 0"></path><path d="M8 14l4-6 4 6"></path></svg>`; }
function iconSheen() { return `<svg viewBox="0 0 24 24"><path d="M4 9c2 0 2 6 4 6s2-6 4-6 2 6 4 6 2-6 4-6"></path></svg>`; }
function iconIridescence() { return `<svg viewBox="0 0 24 24"><path d="M4 15c6-10 10-10 16 0"></path><path d="M7 15c4-6 6-6 10 0"></path><path d="M10 15c2-2 2-2 4 0"></path></svg>`; }
function iconTexture() { return `<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 12l3-3 4 4 2-2 3 3"></path></svg>`; }

function row(label, inputHtml) {
  return `
    <div class="controlRow">
      <div class="controlLabel">${label}</div>
      ${inputHtml}
    </div>
  `;
}

function section(title, bodyId, bodyHtml) {
  return `
    <div class="panelSection">
      <button class="sectionHeader" type="button" data-toggle="${bodyId}">
        <span>${title}</span>
        <span>${iconTexture()}</span>
      </button>
      <div class="sectionBody hidden" id="${bodyId}">
        ${bodyHtml}
      </div>
    </div>
  `;
}

function buildHTML() {
  state.root.innerHTML = `
    <div class="materialShell">
      <div class="subPanelTitle"><svg viewBox="0 0 24 24"><path d="M4 8l8-5 8 5-8 5-8-5Z"/><path d="M4 16l8 5 8-5"/><path d="M4 8v8l8 5 8-5V8"/></svg>Material</div>
      <div class="materialTarget" id="materialTargetLabel">Nenhum objeto selecionado</div>

      ${section(
        'Base',
        'baseBody',
        `
          ${row('Cor', '<input id="matColor" type="color" value="#d7dde7">')}
          ${row('Opacidade', '<input id="matOpacity" type="number" min="0" max="1" step="0.01" value="1">')}
          ${row('Suavidade', '<input id="matSmoothness" type="number" min="0" max="180" step="1" value="180">')}
          ${row('Roughness', '<input id="matRoughness" type="number" min="0" max="1" step="0.01" value="0.55">')}
          ${row('Metalness', '<input id="matMetalness" type="number" min="0" max="1" step="0.01" value="0.08">')}
          ${row('Spec I', '<input id="matSpecularIntensity" type="number" min="0" max="1" step="0.01" value="1">')}
          ${row('Spec C', '<input id="matSpecularColor" type="color" value="#ffffff">')}
          ${row('Emiss C', '<input id="matEmissiveColor" type="color" value="#000000">')}
          ${row('Emiss I', '<input id="matEmissiveIntensity" type="number" min="0" max="10" step="0.01" value="0">')}
        `
      )}

      ${section(
        'PBR',
        'pbrBody',
        `
          ${row('Clearcoat', '<input id="matClearcoat" type="number" min="0" max="1" step="0.01" value="0">')}
          ${row('CC Rough', '<input id="matClearcoatRoughness" type="number" min="0" max="1" step="0.01" value="0">')}
          ${row('Trans', '<input id="matTransmission" type="number" min="0" max="1" step="0.01" value="0">')}
          ${row('Thickness', '<input id="matThickness" type="number" min="0" max="100" step="0.01" value="0">')}
          ${row('IOR', '<input id="matIOR" type="number" min="1" max="2.333" step="0.001" value="1.5">')}
          ${row('Sheen', '<input id="matSheen" type="number" min="0" max="1" step="0.01" value="0">')}
          ${row('Sheen R', '<input id="matSheenRoughness" type="number" min="0" max="1" step="0.01" value="1">')}
          ${row('Irides', '<input id="matIridescence" type="number" min="0" max="1" step="0.01" value="0">')}
          ${row('Iri IOR', '<input id="matIridescenceIOR" type="number" min="1" max="2.333" step="0.001" value="1.3">')}
          ${row('Iri Min', '<input id="matIriMin" type="number" min="0" max="5000" step="0.01" value="100">')}
          ${row('Iri Max', '<input id="matIriMax" type="number" min="0" max="5000" step="0.01" value="400">')}
          ${row('Atten', '<input id="matAttenuationDistance" type="number" min="0" max="10000" step="0.01" value="0">')}
        `
      )}

      ${section(
        'Mapas',
        'mapsBody',
        `
          <button class="importBaseTexBtn" type="button" id="importBaseTex">
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
            Importar textura base (albedo)
          </button>
          <input id="baseTexPicker" type="file" accept="image/*" class="hidden" />
          <div class="textureGrid">
            ${slots.map(([slot, label]) => `
              <button class="uiBtn textureBtn" type="button" data-slot="${slot}">
                ${iconTexture()}
                <span>${label}</span>
              </button>
            `).join('')}
          </div>
          <input id="materialTexturePicker" type="file" accept="image/*" class="hidden" />
        `
      )}
    </div>
  `;

  state.selectedLabel = state.root.querySelector('#materialTargetLabel');
  state.texturePicker = state.root.querySelector('#materialTexturePicker');

  state.root.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.root.querySelector(`#${btn.dataset.toggle}`)?.classList.toggle('hidden');
    });
  });

  state.root.querySelector('#baseBody').classList.remove('hidden');
  state.root.querySelector('#pbrBody').classList.remove('hidden');
}

// Finds the first real mesh inside obj (or obj itself), skipping light helpers
function _resolveMesh(obj) {
  if (!obj) return null;
  // Skip light objects — they have no user material
  if (obj.userData?.isLightObject) return null;
  if (obj.isMesh || obj.isSkinnedMesh) return obj;
  // Traverse children depth-first to find first mesh
  let found = null;
  obj.traverse(o => {
    if (found) return;
    if ((o.isMesh || o.isSkinnedMesh) && !o.userData?.isBoneMarker) found = o;
  });
  return found;
}

function applySmoothness(root, degrees, material) {
  const angle = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(Number(degrees) || 0, 0, 180)
  );
  const cosThreshold = Math.cos(angle);

  root.traverse?.(child => {
    if (!child.isMesh || !child.geometry) return;

    const geometry = child.geometry;
    const position = geometry.getAttribute('position');
    if (!position || position.count < 3) return;

    const vertexCount = position.count;
    const index = geometry.getIndex();
    const faces = [];

    const addFace = (a, b, c) => {
      const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
      const bx = position.getX(b), by = position.getY(b), bz = position.getZ(b);
      const cx = position.getX(c), cy = position.getY(c), cz = position.getZ(c);

      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;

      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const len = Math.hypot(nx, ny, nz) || 1;

      faces.push({
        a, b, c,
        nx: nx / len,
        ny: ny / len,
        nz: nz / len
      });
    };

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        addFace(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < vertexCount; i += 3) {
        addFace(i, i + 1, i + 2);
      }
    }

    // Group vertices by position so primitives such as BoxGeometry
    // can smooth across their intentionally duplicated corner vertices.
    const groups = new Map();
    const keyFor = (i) => {
      const x = position.getX(i).toFixed(6);
      const y = position.getY(i).toFixed(6);
      const z = position.getZ(i).toFixed(6);
      return `${x}|${y}|${z}`;
    };

    for (let i = 0; i < vertexCount; i++) {
      const key = keyFor(i);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }

    const facesAtVertex = new Map();
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      for (const vi of [f.a, f.b, f.c]) {
        if (!facesAtVertex.has(vi)) facesAtVertex.set(vi, []);
        facesAtVertex.get(vi).push(fi);
      }
    }

    const normals = new Float32Array(vertexCount * 3);

    for (const indices of groups.values()) {
      const adjacentFaces = [];
      const seen = new Set();

      for (const vi of indices) {
        for (const fi of (facesAtVertex.get(vi) || [])) {
          if (!seen.has(fi)) {
            seen.add(fi);
            adjacentFaces.push(fi);
          }
        }
      }

      for (const vi of indices) {
        const ownFaces = facesAtVertex.get(vi) || [];

        for (const ownFi of ownFaces) {
          const base = faces[ownFi];
          let nx = 0, ny = 0, nz = 0;

          for (const fi of adjacentFaces) {
            const candidate = faces[fi];
            const dot = base.nx * candidate.nx +
                        base.ny * candidate.ny +
                        base.nz * candidate.nz;

            if (dot >= cosThreshold - 1e-5) {
              nx += candidate.nx;
              ny += candidate.ny;
              nz += candidate.nz;
            }
          }

          const len = Math.hypot(nx, ny, nz) || 1;
          normals[vi * 3] = nx / len;
          normals[vi * 3 + 1] = ny / len;
          normals[vi * 3 + 2] = nz / len;
        }
      }
    }

    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(normals, 3)
    );

    material.flatShading = Number(degrees) <= 0;
    material.needsUpdate = true;
  });
}

function currentMaterial() {
  const obj = getSelected();
  const mesh = _resolveMesh(obj);
  if (!mesh) return null;
  return ensurePhysicalMaterial(mesh);
}

function setDisabled(disabled) {
  [
    'matColor','matOpacity','matSmoothness','matRoughness','matMetalness','matSpecularIntensity','matSpecularColor',
    'matEmissiveColor','matEmissiveIntensity','matClearcoat','matClearcoatRoughness','matTransmission',
    'matThickness','matIOR','matSheen','matSheenRoughness','matIridescence','matIridescenceIOR',
    'matIriMin','matIriMax','matAttenuationDistance'
  ].forEach((id) => {
    const el = state.root.querySelector(`#${id}`);
    if (el) el.disabled = disabled;
  });

  state.root.querySelectorAll('.textureBtn').forEach((btn) => {
    btn.disabled = disabled;
  });
}

function sync() {
  const obj  = getSelected();
  const mesh = _resolveMesh(obj);

  if (!mesh) {
    state.selectedLabel.textContent = 'Nenhum objeto selecionado';
    setDisabled(true);
    return;
  }

  const mat = ensurePhysicalMaterial(mesh);
  state.selectedLabel.textContent = obj.name || mesh.name || 'Objeto selecionado';
  setDisabled(false);

  state.syncing = true;
  state.root.querySelector('#matColor').value = `#${mat.color.getHexString()}`;
  state.root.querySelector('#matOpacity').value = mat.opacity ?? 1;
  const smoothnessEl = state.root.querySelector('#matSmoothness');
  if (smoothnessEl) {
    const storedSmoothness = Number(obj.userData?.ncmSmoothness);
    smoothnessEl.value = Number.isFinite(storedSmoothness) ? storedSmoothness : (mat.flatShading ? 0 : 180);
  }
  state.root.querySelector('#matRoughness').value = mat.roughness ?? 0.55;
  state.root.querySelector('#matMetalness').value = mat.metalness ?? 0.08;
  state.root.querySelector('#matSpecularIntensity').value = mat.specularIntensity ?? 1;
  state.root.querySelector('#matSpecularColor').value = `#${(mat.specularColor || new THREE.Color(1,1,1)).getHexString()}`;
  state.root.querySelector('#matEmissiveColor').value = `#${(mat.emissive || new THREE.Color(0,0,0)).getHexString()}`;
  state.root.querySelector('#matEmissiveIntensity').value = mat.emissiveIntensity ?? 0;
  state.root.querySelector('#matClearcoat').value = mat.clearcoat ?? 0;
  state.root.querySelector('#matClearcoatRoughness').value = mat.clearcoatRoughness ?? 0;
  state.root.querySelector('#matTransmission').value = mat.transmission ?? 0;
  state.root.querySelector('#matThickness').value = mat.thickness ?? 0;
  state.root.querySelector('#matIOR').value = mat.ior ?? 1.5;
  state.root.querySelector('#matSheen').value = mat.sheen ?? 0;
  state.root.querySelector('#matSheenRoughness').value = mat.sheenRoughness ?? 1;
  state.root.querySelector('#matIridescence').value = mat.iridescence ?? 0;
  state.root.querySelector('#matIridescenceIOR').value = mat.iridescenceIOR ?? 1.3;
  state.root.querySelector('#matIriMin').value = mat.iridescenceThicknessRange?.[0] ?? 100;
  state.root.querySelector('#matIriMax').value = mat.iridescenceThicknessRange?.[1] ?? 400;
  state.root.querySelector('#matAttenuationDistance').value = mat.attenuationDistance ?? 0;
  state.syncing = false;

  // Sync texture buttons — highlight buttons that already have a texture on the material
  state.root.querySelectorAll('.textureBtn').forEach((btn) => {
    const slot = btn.dataset.slot;
    const hasTex = !!(mat[slot]);
    btn.classList.toggle('hasTexture', hasTex);
    // Show a small dot indicator on the button if texture exists
    let dot = btn.querySelector('.texDot');
    if (hasTex) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'texDot';
        btn.appendChild(dot);
      }
    } else {
      dot?.remove();
    }
  });
}

function bindNumber(id, fn) {
  state.root.querySelector(`#${id}`).addEventListener('input', () => {
    if (state.syncing) return;
    const mat = currentMaterial();
    if (!mat) return;
    const raw = state.root.querySelector(`#${id}`).value;
    const num = raw === 'Infinity' ? Infinity : Number(raw);
    if (Number.isNaN(num)) return;
    fn(mat, num);
    mat.needsUpdate = true;
    markSceneDirty();
  });
}

function bindColor(id, fn) {
  state.root.querySelector(`#${id}`).addEventListener('input', () => {
    if (state.syncing) return;
    const mat = currentMaterial();
    if (!mat) return;
    fn(mat, state.root.querySelector(`#${id}`).value);
    mat.needsUpdate = true;
    markSceneDirty();
  });
}

function applyTexture(slot, file) {
  const mesh = _resolveMesh(getSelected());
  if (!mesh || !file) return;

  const mat = ensurePhysicalMaterial(mesh);
  const loader = new THREE.TextureLoader();
  const url = URL.createObjectURL(file);

  loader.load(url, (texture) => {
    URL.revokeObjectURL(url);

    if (app.renderer?.capabilities?.getMaxAnisotropy) {
      texture.anisotropy = app.renderer.capabilities.getMaxAnisotropy();
    }

    const srgbSlots = ['map', 'emissiveMap', 'specularColorMap', 'sheenColorMap'];
    texture.colorSpace = srgbSlots.includes(slot) ? THREE.SRGBColorSpace : THREE.NoColorSpace;

    if (slot === 'envMap') {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      mat.envMap = texture;
      mat.needsUpdate = true;
      return;
    }

    if (slot === 'aoMap' && mesh.geometry?.attributes?.uv && !mesh.geometry.attributes.uv2) {
      mesh.geometry.setAttribute(
        'uv2',
        new THREE.BufferAttribute(mesh.geometry.attributes.uv.array.slice(0), 2)
      );
    }

    mat[slot] = texture;
    if (slot === 'alphaMap') mat.transparent = true;
    if (slot === 'transmissionMap') mat.transmission = Math.max(mat.transmission, 0.2);
    mat.needsUpdate = true;
  });
}

export function initMaterialUI() {
  if (state.initialized) return;
  state.initialized = true;

  state.root = document.getElementById('materialRoot');
  if (!state.root) return;

  buildHTML();

  state.root.querySelectorAll('.textureBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pendingSlot = btn.dataset.slot;
      state.texturePicker.click();
    });
  });

  // Import base texture shortcut
  const importBaseBtn = state.root.querySelector('#importBaseTex');
  const baseTexPicker = state.root.querySelector('#baseTexPicker');
  if (importBaseBtn && baseTexPicker) {
    importBaseBtn.addEventListener('click', () => baseTexPicker.click());
    baseTexPicker.addEventListener('change', () => {
      const file = baseTexPicker.files?.[0];
      if (file) applyTexture('map', file);
      baseTexPicker.value = '';
    });
  }

  state.texturePicker.addEventListener('change', () => {
    const file = state.texturePicker.files?.[0];
    if (file && state.pendingSlot) applyTexture(state.pendingSlot, file);
    state.texturePicker.value = '';
    state.pendingSlot = null;
  });

  bindColor('matColor', (m, v) => m.color.set(v));
  bindNumber('matOpacity', (m, v) => {
    m.opacity = v;
    m.transparent = v < 1 || !!m.alphaMap || m.transmission > 0;
  });
  const smoothnessInput = state.root.querySelector('#matSmoothness');
  smoothnessInput?.addEventListener('input', () => {
    const mat = currentMaterial();
    const obj = getSelected();
    if (!mat || !obj) return;

    const value = THREE.MathUtils.clamp(
      Number(smoothnessInput.value) || 0,
      0,
      180
    );

    smoothnessInput.value = value;
    obj.userData = obj.userData || {};
    obj.userData.ncmSmoothness = value;

    applySmoothness(obj, value, mat);
    markSceneDirty();
  });
  bindNumber('matRoughness', (m, v) => { m.roughness = v; });
  bindNumber('matMetalness', (m, v) => { m.metalness = v; });
  bindNumber('matSpecularIntensity', (m, v) => { m.specularIntensity = v; });
  bindColor('matSpecularColor', (m, v) => { m.specularColor.set(v); });
  bindColor('matEmissiveColor', (m, v) => { m.emissive.set(v); });
  bindNumber('matEmissiveIntensity', (m, v) => { m.emissiveIntensity = v; });
  bindNumber('matClearcoat', (m, v) => { m.clearcoat = v; });
  bindNumber('matClearcoatRoughness', (m, v) => { m.clearcoatRoughness = v; });
  bindNumber('matTransmission', (m, v) => {
    m.transmission = v;
    m.transparent = v > 0 || m.opacity < 1 || !!m.alphaMap;
  });
  bindNumber('matThickness', (m, v) => { m.thickness = v; });
  bindNumber('matIOR', (m, v) => { m.ior = v; });
  bindNumber('matSheen', (m, v) => { m.sheen = v; });
  bindNumber('matSheenRoughness', (m, v) => { m.sheenRoughness = v; });
  bindNumber('matIridescence', (m, v) => { m.iridescence = v; });
  bindNumber('matIridescenceIOR', (m, v) => { m.iridescenceIOR = v; });
  bindNumber('matIriMin', (m, v) => {
    const r = m.iridescenceThicknessRange || [100, 400];
    m.iridescenceThicknessRange = [v, r[1] ?? 400];
  });
  bindNumber('matIriMax', (m, v) => {
    const r = m.iridescenceThicknessRange || [100, 400];
    m.iridescenceThicknessRange = [r[0] ?? 100, v];
  });
  bindNumber('matAttenuationDistance', (m, v) => { m.attenuationDistance = v; });

  window.addEventListener('scene-selection-changed', sync);
  sync();
}

export function syncMaterialUI() {
  sync();
}