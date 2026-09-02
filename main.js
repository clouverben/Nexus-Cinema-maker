import {
  initScene,
  addPrimitive,
  setGizmoMode,
  clearSelection,
  setRenderPreviewMode,
  markSceneDirty,
  app
} from './scene.js';

import { startRenderLoop } from './render.js';
import { initMaterialUI, syncMaterialUI } from './material.js';
import {
  initPostProcess,
  setRenderModeValue,
  setPostProcessValue,
  setBloomValue,
  setObjBloomField,
  getObjBloom,
  updateOutlineSelected,
  downloadCurrentFrame,
  setVisualizationMode,
  toggleLayer,
  setLayerConfig,
  activeLayers,
  setLightPreviewActive,
  isLightPreviewActive,
} from './posprocess.js';
import {
  setSamplesValue,
  setSubSamplesValue,
  setAccumulationValue,
  setResetOnMoveValue,
  setTargetSamplesValue,
  setNoiseModeValue,
  setPostValue,
  setBloomValue as setBloomFieldValue,
  setRayValue,
  setPathValue
} from './shader.js';
import { addLight } from './lights.js';
import { initConfig } from './config.js';
import {
  initUndoRedo, pushState, undo, redo, canUndo, canRedo,
  onHistoryChange, captureTransformState, recordTransform,
} from './undo-redo.js';
// simulation.js removed — replaced by Particle Labs

// Exposed for the Particle Labs UI controller (a plain, non-module
// <script> in index.html, so it can't `import` this directly) — every
// Labs mutation (add/remove module, Style/Animation/Aura edits, etc.)
// calls window._pushLabsState() so undo/redo covers Particle Labs too.
window._pushLabsState = pushState;

// ─── Painel "Importar animações?" (GLTF/GLB embutidas) ─────────────────────
// Mesmo padrão visual dos demais painéis de confirmação do app (backdrop +
// card centralizado, classes .animConfirmBackdrop/.animConfirmModal já
// definidas globalmente em ui.css) — substitui o antigo confirm() nativo.
// Injetado sob demanda e reaproveitado nas próximas importações.
function ensureGltfAnimConfirmModal() {
  if (document.getElementById('gltfAnimConfirmModal')) return;
  const backdrop = document.createElement('div');
  backdrop.id = 'gltfAnimConfirmBackdrop';
  backdrop.className = 'animConfirmBackdrop hidden';
  const modal = document.createElement('div');
  modal.id = 'gltfAnimConfirmModal';
  modal.className = 'animConfirmModal hidden';
  modal.innerHTML = `
    <div class="animConfirmIcon">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      </svg>
    </div>
    <div class="animConfirmTitle">Importar animações?</div>
    <div class="animConfirmText" id="gltfAnimConfirmText"></div>
    <div class="animConfirmActions">
      <button id="gltfAnimConfirmCancelBtn" class="animConfirmBtn animConfirmCancel" type="button">Cancelar</button>
      <button id="gltfAnimConfirmOkBtn" class="animConfirmBtn animConfirmOk" type="button">Importar</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
}
function showGltfAnimImportConfirm(n) {
  ensureGltfAnimConfirmModal();
  const backdrop = document.getElementById('gltfAnimConfirmBackdrop');
  const modal    = document.getElementById('gltfAnimConfirmModal');
  const text     = document.getElementById('gltfAnimConfirmText');
  text.textContent = `Esse modelo tem ${n} animação${n > 1 ? 'ões' : ''} embutida${n > 1 ? 's' : ''}. Elas vão aparecer numa "Biblioteca de Animações" no final do painel Animação — você clica numa pra rodar ela no modelo.`;
  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');
  return new Promise((resolve) => {
    const okBtn     = document.getElementById('gltfAnimConfirmOkBtn');
    const cancelBtn = document.getElementById('gltfAnimConfirmCancelBtn');
    const close = (result) => {
      backdrop.classList.add('hidden');
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setActiveButton(group, active) {
  group.forEach((b) => b.classList.toggle('active', b === active));
}
function bindNumber(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => fn(Number(el.value)));
}
function bindCheckbox(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => fn(el.checked));
}

// Global safety net for the classic <input type="number"> + mouse-wheel
// bug: browsers treat a wheel tick over a FOCUSED number input as a
// +/- click on the input itself instead of scrolling the page. On a long
// panel (Aura, Style, any module list) that fires 'input' -> onChange ->
// a full section re-render per tick, which reads as the whole panel
// hanging/looping while scrolling. One delegated, passive listener blurs
// whatever number input is focused the instant a wheel event happens
// anywhere — covers every number input in the app (present and future),
// not just the ones built through the Labs field-builder.
document.addEventListener('wheel', () => {
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && el.type === 'number') el.blur();
}, { passive: true });

// ─── Init ─────────────────────────────────────────────────────────────────────
// Boot is wrapped in try/catch and backed by a hard timeout so a failure
// (or a hang) anywhere in this chain can never leave the splash screen —
// and the whole UI underneath it — stuck forever. Worst case the user
// sees a console error and the app still opens instead of staying on
// "Carregando…" indefinitely.
let _bootDone = false;
function _fireEngineReady() {
  if (_bootDone) return;
  _bootDone = true;
  window.dispatchEvent(new Event('_nexusEngineReady'));
}
// Safety net: if boot hasn't finished on its own after a generous window
// (slow device, slow CDN fetch, an unexpected exception, WebGL failing to
// initialize, etc.), unblock the UI anyway rather than leaving it hidden
// behind the splash screen forever.
setTimeout(() => {
  if (_bootDone) return;
  console.warn('[main] Inicialização excedeu o tempo esperado — liberando a interface mesmo assim.');
  _fireEngineReady();
}, 12000);

window.addEventListener('DOMContentLoaded', async () => {
  try {
    initScene(document.body);
    window._app = app;  // expose globally so bottom bar + Labs stats can access scene
    initMaterialUI();
    initPostProcess();
    startRenderLoop();
    await initConfig(app);   // must be awaited — uses async import for grid functions
    initUndoRedo();
    // initSimulation removed — replaced by Particle Labs

    // ── Particle Labs bootstrap ─────────────────────────────────────────────
    // particle-engine.js exposes window._ParticleEngine (loaded as a separate
    // <script type="module"> tag in index.html, before this main.js bundle).
    if (window._ParticleEngine && app.scene) {
      window._nexusParticleLab = new window._ParticleEngine.ParticleLab(app.scene);
    }
    if (window._AuraEngine && app.scene) {
      window._nexusAuraLab = new window._AuraEngine.AuraLab(app.scene);
    }
  } catch (err) {
    // Whatever broke, don't strand the user on the loading screen — log it
    // so it's diagnosable and let the finally block below still open the app.
    console.error('[main] Falha ao inicializar o motor:', err);
  } finally {
    // Fire once render loop + scene are ready (or once we've given up on
    // the failed step above) so the Labs UI controller (inline script at
    // the bottom of index.html) can build its preset grid and particle
    // list, and the splash screen is never left on-screen indefinitely.
    setTimeout(_fireEngineReady, 50);
  }

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');

  onHistoryChange((canU, canR) => {
    if (undoBtn) undoBtn.disabled = !canU;
    if (redoBtn) redoBtn.disabled = !canR;
  });

  undoBtn?.addEventListener('click', () => { undo(); markSceneDirty(); });
  redoBtn?.addEventListener('click', () => { redo(); markSceneDirty(); });

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); markSceneDirty(); }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); markSceneDirty(); }
  });

  // Record transform on gizmo drag end
  let _transformSnapshot = null;
  app.transformControls?.addEventListener('mouseDown', () => {
    if (app.selected) _transformSnapshot = captureTransformState(app.selected);
  });
  app.transformControls?.addEventListener('mouseUp', () => {
    if (app.selected && _transformSnapshot) {
      const next = captureTransformState(app.selected);
      recordTransform(app.selected, _transformSnapshot, next);
      _transformSnapshot = null;
    }
  });

  // ── Left panel ────────────────────────────────────────────────────────────
  const leftPanelBtns = {
    add:      document.getElementById('addToggle'),
    material: document.getElementById('materialToggle'),
    lights:   document.getElementById('lightsToggle'),
    render:   document.getElementById('renderToggle'),
    camera:   document.getElementById('cameraToggle'),
  };
  const leftSubPanels = {
    add:      document.getElementById('addPanel'),
    material: document.getElementById('materialPanel'),
    lights:   document.getElementById('lightsPanel'),
    render:   document.getElementById('renderPanel'),
    camera:   document.getElementById('cameraPanel'),
  };
  let activeLeftPanel = null;

  function openLeftPanel(name) {
    Object.keys(leftSubPanels).forEach((k) => {
      leftSubPanels[k].classList.add('hidden');
      leftPanelBtns[k].classList.remove('active');
    });
    if (activeLeftPanel === name) { activeLeftPanel = null; return; }
    activeLeftPanel = name;
    leftSubPanels[name].classList.remove('hidden');
    leftPanelBtns[name].classList.add('active');
    if (name === 'material') syncMaterialUI();
    if (name === 'lights') syncLightUI();
  }
  Object.keys(leftPanelBtns).forEach((name) => {
    leftPanelBtns[name].addEventListener('click', () => openLeftPanel(name));
  });

  // ── Labs-mode left panel swap ───────────────────────────────────────────
  // When Particle Labs is toggled on (via the Settings menu), the entire
  // left panel becomes the SFM-style function palette — the normal
  // Add/Material/Luzes/Render/Camera tools are hidden and replaced.
  const normalLeftPanel = document.getElementById('leftPanel');
  const labsLeftPanel   = document.getElementById('labsLeftPanel');
  const animLeftPanel   = document.getElementById('animLeftPanel');
  const animBtnEl       = document.getElementById('animBtn');
  const labsIconBtnEl   = document.getElementById('labsIconBtn');
  window.addEventListener('_labsModeChange', (e) => {
    const labsOn = !!e.detail?.active;
    if (normalLeftPanel) normalLeftPanel.classList.toggle('hidden', labsOn);
    if (labsLeftPanel)   labsLeftPanel.classList.toggle('hidden', !labsOn);
    // Labs and the animation timeline are mutually exclusive left panels —
    // if Labs turns on, make sure the Animation Panel isn't left showing
    // underneath it (in practice #animBtn is already hidden while Labs is
    // on, so this is just a defensive safety net).
    if (labsOn && animLeftPanel) animLeftPanel.classList.add('hidden');
    // Animar → Labs icon (spec #8): the animation system itself is
    // untouched — only this top-bar button is swapped for the duration.
    if (animBtnEl)     animBtnEl.classList.toggle('hidden', labsOn);
    if (labsIconBtnEl) labsIconBtnEl.classList.toggle('hidden', !labsOn);
    if (!labsOn) {
      document.getElementById('labsIconMenu')?.classList.add('hidden');
      document.getElementById('labsIconMenuBackdrop')?.classList.add('hidden');
      window.dispatchEvent(new CustomEvent('_labsForceExitPreview'));
    }
    if (labsOn) {
      // Close whatever normal sub-panel was open so it doesn't linger
      // hidden-but-"active" underneath, and detach the transform gizmo
      // from any non-particle object so it doesn't visually persist
      // while the user works in Labs mode.
      Object.keys(leftSubPanels).forEach((k) => {
        leftSubPanels[k].classList.add('hidden');
        leftPanelBtns[k].classList.remove('active');
      });
      activeLeftPanel = null;
    }
  });

  // ── Animation-mode left panel swap ───────────────────────────────────────
  // When the animation timeline is toggled on (via #animBtn), the entire
  // left panel becomes the Animation Panel — the normal Add/Material/
  // Luzes/Render/Camera tools are hidden and replaced with the motion-path
  // builder, Graph Editor and FPS controls. Mirrors the Labs swap above;
  // dispatched from animation.js's AnimationSystem.toggle().
  window.addEventListener('_animModeChange', (e) => {
    const animOn = !!e.detail?.active;
    if (normalLeftPanel) normalLeftPanel.classList.toggle('hidden', animOn);
    if (animLeftPanel)   animLeftPanel.classList.toggle('hidden', !animOn);
    if (animOn && labsLeftPanel) labsLeftPanel.classList.add('hidden');
    if (animOn) {
      Object.keys(leftSubPanels).forEach((k) => {
        leftSubPanels[k].classList.add('hidden');
        leftPanelBtns[k].classList.remove('active');
      });
      activeLeftPanel = null;
    }
  });

  // ── Light panel ───────────────────────────────────────────────────────────
  const lightTypeLabel      = document.getElementById('lightTypeLabel');
  const lightColor          = document.getElementById('lightColor');
  const lightIntensity      = document.getElementById('lightIntensity');
  const lightDistance       = document.getElementById('lightDistance');
  const lightDistanceRow    = document.getElementById('lightDistanceRow');
  const lightShadowMapSize  = document.getElementById('lightShadowMapSize');
  const lightShadowBias     = document.getElementById('lightShadowBias');
  const lightShadowRadius   = document.getElementById('lightShadowRadius');
  const lightShadowNear     = document.getElementById('lightShadowNear');
  const lightShadowFar      = document.getElementById('lightShadowFar');
  const selectedLightSec    = document.getElementById('selectedLightSection');
  const noLightSelected     = document.getElementById('noLightSelected');

  function syncLightUI() {
    const group = app.selected;
    if (!group || !group.userData.isLightObject) {
      selectedLightSec.classList.add('hidden');
      noLightSelected.classList.remove('hidden');
      return;
    }
    selectedLightSec.classList.remove('hidden');
    noLightSelected.classList.add('hidden');
    const light = group.userData.lightRef;
    const type  = group.userData.lightType;
    lightTypeLabel.textContent = group.name;
    lightColor.value     = '#' + light.color.getHexString();
    lightIntensity.value = light.intensity;
    const hasDist = type === 'point' || type === 'spot';
    lightDistanceRow.classList.toggle('hidden', !hasDist);
    if (hasDist) lightDistance.value = light.distance ?? 0;
    // Shadow
    const mapSize = light.castShadow ? (light.shadow?.mapSize?.width ?? 1024) : 0;
    lightShadowMapSize.value = mapSize;
    lightShadowBias.value    = light.shadow?.bias    ?? 0;
    lightShadowRadius.value  = light.shadow?.radius  ?? 1;
    lightShadowNear.value    = light.shadow?.camera?.near ?? 0.5;
    lightShadowFar.value     = light.shadow?.camera?.far  ?? 500;
  }

  lightColor.addEventListener('input', () => {
    const g = app.selected;
    if (!g?.userData.isLightObject) return;
    g.userData.lightRef.color.set(lightColor.value);
    if (g.userData.modelRef?.isSprite) {
      g.userData.modelRef.material.color.set(lightColor.value);
      g.userData.modelRef.material.needsUpdate = true;
    }
    markSceneDirty();
  });
  lightIntensity.addEventListener('input', () => {
    if (!app.selected?.userData.isLightObject) return;
    app.selected.userData.lightRef.intensity = Number(lightIntensity.value);
    markSceneDirty();
  });
  lightDistance.addEventListener('input', () => {
    if (!app.selected?.userData.isLightObject) return;
    app.selected.userData.lightRef.distance = Number(lightDistance.value);
    markSceneDirty();
  });

  // Shadow numeric controls — map size 0 = shadows off
  function _applyShadow() {
    if (!app.selected?.userData.isLightObject) return;
    const light = app.selected.userData.lightRef;
    const size  = Math.round(Number(lightShadowMapSize.value));
    if (size <= 0) {
      light.castShadow = false;
    } else {
      light.castShadow = true;
      if (light.shadow) {
        light.shadow.mapSize.width  = size;
        light.shadow.mapSize.height = size;
        light.shadow.bias           = Number(lightShadowBias.value);
        light.shadow.radius         = Number(lightShadowRadius.value);
        if (light.shadow.camera) {
          light.shadow.camera.near = Number(lightShadowNear.value);
          light.shadow.camera.far  = Number(lightShadowFar.value);
          light.shadow.camera.updateProjectionMatrix();
        }
        light.shadow.map?.dispose();
        light.shadow.map = null; // force shadow map rebuild
      }
      if (app.renderer) {
        app.renderer.shadowMap.enabled = true;
        app.renderer.shadowMap.needsUpdate = true;
      }
    }
    markSceneDirty();
  }
  lightShadowMapSize.addEventListener('input', _applyShadow);
  lightShadowBias.addEventListener('input',    _applyShadow);
  lightShadowRadius.addEventListener('input',  _applyShadow);
  lightShadowNear.addEventListener('input',    _applyShadow);
  lightShadowFar.addEventListener('input',     _applyShadow);

  // ── Model import ──────────────────────────────────────────────────────────
  const importModelBtn  = document.getElementById('importModelBtn');
  const modelFilePicker = document.getElementById('modelFilePicker');

  importModelBtn.addEventListener('click', () => modelFilePicker.click());

  modelFilePicker.addEventListener('change', async () => {
    const file = modelFilePicker.files?.[0];
    if (!file) return;
    modelFilePicker.value = '';
    await importModel(file);
  });

  async function importModel(file) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const name = file.name.toLowerCase();
    let arrayBuffer;
    // Map of filename (basename) -> blob URL for textures from ZIP
    const blobURLs = [];
    let resourcePathBase = '';
    let manager = null;

    if (name.endsWith('.zip')) {
      const JSZip = window.JSZip;
      if (!JSZip) { alert('JSZip não carregou. Verifique conexão.'); return; }
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((f) => !f.dir);

      const gltfEntry = entries.find((f) => /\.(glb|gltf)$/i.test(f.name));
      if (!gltfEntry) { alert('Nenhum .glb ou .gltf encontrado dentro do .zip'); return; }

      // Extract all files and build a name->blobURL map
      const fileMap = {};
      await Promise.all(entries.map(async (entry) => {
        const blob = await entry.async('blob');
        const basename = entry.name.split('/').pop();
        const url = URL.createObjectURL(blob);
        blobURLs.push(url);
        // Map both full path and basename so either reference works
        fileMap[entry.name] = url;
        fileMap[basename] = url;
      }));

      arrayBuffer = await gltfEntry.async('arraybuffer');

      // Custom LoadingManager that intercepts texture URL requests
      const { LoadingManager } = await import('three');
      manager = new LoadingManager();
      manager.setURLModifier((url) => {
        // Try exact match first, then basename match
        const basename = url.split('/').pop().split('?')[0];
        if (fileMap[url]) return fileMap[url];
        if (fileMap[basename]) return fileMap[basename];
        // Try matching any path suffix
        const found = Object.keys(fileMap).find(
          (k) => url.endsWith(k) || url.includes(k)
        );
        if (found) return fileMap[found];
        return url;
      });
    } else {
      arrayBuffer = await file.arrayBuffer();
    }

    const { GLTFLoader: GLTFLoaderClass } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = manager ? new GLTFLoaderClass(manager) : new GLTFLoaderClass();
    loader.parse(arrayBuffer, '', (gltf) => {
      // Revoke blob URLs after model loaded to free memory
      blobURLs.forEach((u) => URL.revokeObjectURL(u));
      const root = gltf.scene;
      root.name = file.name.replace(/\.[^.]+$/, '');
      // Mark as imported model so the save system serializes geometry + textures
      root.userData.isImportedModel = true;
      app.scene.add(root);
      app.objects.push(root);
      app._ptTopologyDirty = true; // real geometry changed — path tracer BVH needs a full rebuild next time it's active
      // Enable shadows on all meshes inside the model
      root.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow    = true;
          o.receiveShadow = true;
        }
      });
      // Center model
      import('three').then(({ Box3, Vector3 }) => {
        const box = new Box3().setFromObject(root);
        const center = new Vector3();
        box.getCenter(center);
        root.position.sub(center);
        root.position.y = 0;
      });
      markSceneDirty();
      renderObjectsList();
      checkSceneForSkeletons();

      // ── Animações embutidas no arquivo (GLTF/GLB podem trazer clipes
      // prontos) — nunca eram nem detectadas antes. Agora, se existir
      // pelo menos uma, perguntamos e (se aceito) elas ficam disponíveis
      // na "Biblioteca" no final do painel Animação pra importar quando
      // quiser, em vez de aplicar tudo automaticamente sem avisar.
      if (gltf.animations?.length) {
        const n = gltf.animations.length;
        showGltfAnimImportConfirm(n).then((wants) => {
          if (wants) window.AnimationSystem?.addToImportLibrary?.(root, gltf.animations, root.name);
        });
      }
    }, (err) => {
      alert('Erro ao carregar modelo: ' + err.message);
    });
  }

  // ── Render preview ────────────────────────────────────────────────────────
  let renderPreviewActive = false;
  const renderPreviewToggle = document.getElementById('renderPreviewToggle');
  const renderLightToggleBtn = document.getElementById('renderLightToggleBtn');

  renderPreviewToggle?.addEventListener('click', () => {
    renderPreviewActive = !renderPreviewActive;
    renderPreviewToggle.classList.toggle('active', renderPreviewActive);
    setRenderPreviewMode(renderPreviewActive);
  });

  // The footer "light" button is its OWN action, separate from "Modo Render"
  // above: it actually renders the objects (GPU path tracer) right there in
  // the viewport WITHOUT hiding the grid — "Modo Render" hides grid/gizmos
  // for a clean preview, which is a different thing and stays untouched.
  renderLightToggleBtn?.addEventListener('click', () => {
    const next = !isLightPreviewActive();
    renderLightToggleBtn.classList.toggle('active', next);
    setLightPreviewActive(next);
  });

  // ── Add primitives / lights ───────────────────────────────────────────────
  Array.from(document.querySelectorAll('[data-add]')).forEach((btn) => {
    btn.addEventListener('click', () => {
      addPrimitive(btn.dataset.add);
      syncMaterialUI();
      renderObjectsList();
      pushState();
    });
  });
  Array.from(document.querySelectorAll('[data-add-light]')).forEach((btn) => {
    btn.addEventListener('click', () => {
      addLight(btn.dataset.addLight);
      renderObjectsList();
      pushState();
    });
  });

  // ── Gizmo ─────────────────────────────────────────────────────────────────
  const gizmoButtons = Array.from(document.querySelectorAll('[data-mode]'));
  gizmoButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setGizmoMode(btn.dataset.mode);
      setActiveButton(gizmoButtons, btn);
    });
  });

  // ── Deep-select toggle ────────────────────────────────────────────────────
  const deepSelectBtn = document.getElementById('deepSelectBtn');
  deepSelectBtn.addEventListener('click', () => {
    app.deepSelectMode = !app.deepSelectMode;
    deepSelectBtn.classList.toggle('active', app.deepSelectMode);
    deepSelectBtn.title = app.deepSelectMode
      ? 'Selecionar dentro de grupo: ATIVO (clique para desativar)'
      : 'Selecionar dentro de grupo (clique em objetos agrupados/importados)';
  });

  // ── Render tabs ───────────────────────────────────────────────────────────
  const tabButtons = Array.from(document.querySelectorAll('[data-tab]'));
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tabPanel').forEach((p) => {
        p.classList.toggle('hidden', p.id !== tab);
      });
    });
  });

  // ── Engine mode buttons (exclusive) ──────────────────────────────────────
  const renderModeButtons = Array.from(document.querySelectorAll('[data-render-mode]'));
  renderModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.renderMode;
      setRenderModeValue(mode);
      setActiveButton(renderModeButtons, btn);
    });
  });

  // ── Layer buttons (multi-select, Blender-style) ────────────────────────
  const visModePanel       = document.getElementById('visModePanel');
  const outlineLayerPanel  = document.getElementById('outlineLayerPanel');
  const filmLayerPanel     = document.getElementById('filmLayerPanel');
  const bokehLayerPanel    = document.getElementById('bokehLayerPanel');

  const layerButtons = Array.from(document.querySelectorAll('[data-layer]'));
  layerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      const isNowActive = !btn.classList.contains('active');
      btn.classList.toggle('active', isNowActive);
      toggleLayer(layer, isNowActive);

      // Show/hide sub-panels
      visModePanel?.classList.toggle('hidden',
        !activeLayers.has('visualization'));
      outlineLayerPanel?.classList.toggle('hidden',
        !activeLayers.has('outline'));
      filmLayerPanel?.classList.toggle('hidden',
        !activeLayers.has('film'));
      bokehLayerPanel?.classList.toggle('hidden',
        !activeLayers.has('bokeh'));

      // When enabling visualization layer, apply active vis mode
      if (layer === 'visualization' && isNowActive) {
        const activeVis = document.querySelector('.visModeBtn.active');
        setVisualizationMode(activeVis?.dataset?.visMode || 'normals');
      } else if (layer === 'visualization' && !isNowActive) {
        setVisualizationMode(null);
      }
    });
  });

  // ── Visualization sub-mode buttons ────────────────────────────────────────
  const visModeButtons = Array.from(document.querySelectorAll('[data-vis-mode]'));
  visModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveButton(visModeButtons, btn);
      setVisualizationMode(btn.dataset.visMode);
    });
  });

  // ── Layer sub-panel bindings ───────────────────────────────────────────────
  bindNumber('outlineStrength',  (v) => setLayerConfig('outline','strength',v));
  bindNumber('outlineGlow',      (v) => setLayerConfig('outline','glow',v));
  bindNumber('outlineThickness', (v) => setLayerConfig('outline','thickness',v));
  bindNumber('filmNoise',        (v) => setLayerConfig('film','noise',v));
  bindNumber('filmScanlines',    (v) => setLayerConfig('film','scanlines',v));
  bindNumber('bokehFocus',       (v) => setLayerConfig('bokeh','focus',v));
  bindNumber('bokehAperture',    (v) => setLayerConfig('bokeh','aperture',v));
  bindNumber('bokehMaxblur',     (v) => setLayerConfig('bokeh','maxblur',v));

  // ── Shader bindings ───────────────────────────────────────────────────────
  bindNumber  ('sampleCount',      setSamplesValue);
  bindNumber  ('subSamples',       setSubSamplesValue);
  bindCheckbox('sampleAccumulate', setAccumulationValue);
  bindCheckbox('sampleResetOnMove',setResetOnMoveValue);
  bindNumber  ('targetSamples',    setTargetSamplesValue);
  bindCheckbox('noiseMode',        setNoiseModeValue);
  bindCheckbox('postEnabled', (v) => { setPostProcessValue(v); setPostValue('enabled', v); });
  bindNumber('postExposure',   (v) => setPostValue('exposure', v));
  bindNumber('postContrast',   (v) => setPostValue('contrast', v));
  bindNumber('postSaturation', (v) => setPostValue('saturation', v));
  bindNumber('postVignette',   (v) => setPostValue('vignette', v));
  bindCheckbox('bloomEnabled', (v) => { setBloomValue(v); setBloomFieldValue('enabled', v); });
  bindNumber('bloomThreshold', (v) => setBloomFieldValue('threshold', v));
  bindNumber('bloomStrength',  (v) => setBloomFieldValue('strength', v));
  bindNumber('bloomRadius',    (v) => setBloomFieldValue('radius', v));
  // bindCheckbox/bindNumber above only fire on user interaction — without
  // this, the "Enabled" checkbox shows checked from boot while
  // renderState.bloom stays undefined (bloom effectively off) until the
  // user first touches a control. Apply the panel's own starting values
  // immediately so what's displayed matches what's actually rendering.
  {
    const be = document.getElementById('bloomEnabled');
    const bt = document.getElementById('bloomThreshold');
    const bs = document.getElementById('bloomStrength');
    const br = document.getElementById('bloomRadius');
    if (be) { setBloomValue(be.checked); setBloomFieldValue('enabled', be.checked); }
    if (bt) setBloomFieldValue('threshold', Number(bt.value));
    if (bs) setBloomFieldValue('strength', Number(bs.value));
    if (br) setBloomFieldValue('radius', Number(br.value));
  }

  // ── Per-object persistent bloom ──────────────────────────────────────────
  // Each object keeps its own bloom settings in userData.bloom.
  // Selecting an object loads its settings into the UI.
  // Changing a setting writes back to that specific object — persists after deselect.

  const bloomObjSection = document.getElementById('bloomObjSection');
  const bloomObjName    = document.getElementById('bloomObjName');

  let _bloomObjTarget = null; // the object currently shown in the bloom UI

  function loadBloomObjUI(obj) {
    _bloomObjTarget = obj && !obj.userData?.isLightObject ? obj : null;
    const hasObj = !!_bloomObjTarget;
    bloomObjSection.classList.toggle('hasSelection', hasObj);
    bloomObjName.textContent = hasObj ? (_bloomObjTarget.name || 'Sem nome') : '—';

    const inputs = ['bloomObjEnabled','bloomObjThreshold','bloomObjStrength','bloomObjRadius'];
    inputs.forEach((id) => { document.getElementById(id).disabled = !hasObj; });

    if (hasObj) {
      const b = getObjBloom(_bloomObjTarget);
      document.getElementById('bloomObjEnabled').checked           = b.enabled;
      document.getElementById('bloomObjThreshold').value           = b.threshold;
      document.getElementById('bloomObjStrength').value            = b.strength;
      document.getElementById('bloomObjRadius').value              = b.radius;
    }
  }

  // Bind inputs — write to _bloomObjTarget.userData.bloom
  document.getElementById('bloomObjEnabled').addEventListener('change', (e) => {
    setObjBloomField(_bloomObjTarget, 'enabled', e.target.checked);
  });
  document.getElementById('bloomObjThreshold').addEventListener('input', (e) => {
    setObjBloomField(_bloomObjTarget, 'threshold', parseFloat(e.target.value));
  });
  document.getElementById('bloomObjStrength').addEventListener('input', (e) => {
    setObjBloomField(_bloomObjTarget, 'strength', parseFloat(e.target.value));
  });
  document.getElementById('bloomObjRadius').addEventListener('input', (e) => {
    setObjBloomField(_bloomObjTarget, 'radius', parseFloat(e.target.value));
  });

  // Load UI when selection changes
  window.addEventListener('scene-selection-changed', (e) => {
    // Expose selected object globally for AnimationSystem and bottom bar
    window.activeObject = e.detail?.object ?? null;
    loadBloomObjUI(e.detail?.object ?? null);
    // Bone gizmo sensitivity: reduce size so small drags don't over-rotate
    const isBone = !!e.detail?.object?.userData?.isBoneMarker;
    if (app.transformControls) {
      app.transformControls.setSize(isBone ? 0.45 : 1.15); // 1.15 must match the default set in scene.js
    }
  });
  loadBloomObjUI(null);


  bindNumber  ('rayBounces',       (v) => setRayValue('bounces', v));
  bindNumber  ('rayFilterGlossy',  (v) => setRayValue('filterGlossyFactor', v));
  bindNumber  ('rayTilesX',        (v) => setRayValue('tilesX', v));
  bindNumber  ('rayTilesY',        (v) => setRayValue('tilesY', v));
  bindNumber  ('rayRenderDelay',   (v) => setRayValue('renderDelay', v));
  bindNumber  ('rayFadeDuration',  (v) => setRayValue('fadeDuration', v));
  bindNumber  ('rayMinSamples',    (v) => setRayValue('minSamples', v));
  bindCheckbox('rayDynamicLowRes', (v) => setRayValue('dynamicLowRes', v));
  bindNumber  ('rayLowResScale',   (v) => setRayValue('lowResScale', v));
  bindNumber  ('rayRenderScale',   (v) => setRayValue('renderScale', v));
  bindNumber  ('ptBounces',          (v) => setPathValue('bounces', v));
  bindNumber  ('ptFilterGlossy',     (v) => setPathValue('filterGlossyFactor', v));
  bindNumber  ('ptTilesX',           (v) => setPathValue('tilesX', v));
  bindNumber  ('ptTilesY',           (v) => setPathValue('tilesY', v));
  bindNumber  ('ptRenderDelay',      (v) => setPathValue('renderDelay', v));
  bindNumber  ('ptFadeDuration',     (v) => setPathValue('fadeDuration', v));
  bindNumber  ('ptMinSamples',       (v) => setPathValue('minSamples', v));
  bindCheckbox('ptDynamicLowRes',    (v) => setPathValue('dynamicLowRes', v));
  bindNumber  ('ptLowResScale',      (v) => setPathValue('lowResScale', v));
  bindNumber  ('ptRenderScale',      (v) => setPathValue('renderScale', v));
  bindNumber  ('ptFocusDistance',    (v) => setPathValue('focusDistance', v));
  bindNumber  ('ptFStop',            (v) => setPathValue('fStop', v));
  bindNumber  ('ptApertureBlades',   (v) => setPathValue('apertureBlades', v));
  bindNumber  ('ptApertureRotation', (v) => setPathValue('apertureRotation', v));
  bindNumber  ('ptAnamorphicRatio',  (v) => setPathValue('anamorphicRatio', v));
  document.getElementById('downloadImageBtn').addEventListener('click', downloadCurrentFrame);

  // ──────────────────────────────────────────────────────────────────────────
  //  RIGHT PANEL — Objects List
  // ──────────────────────────────────────────────────────────────────────────
  const objectsList    = document.getElementById('objectsList');
  const objectsSection = document.getElementById('objectsSection');
  const selectedUUIDs  = new Set();
  const expandedGroups = new Set();

  const ICON = {
    light:    `<svg viewBox="0 0 24 24"><path d="M9 21h6"/><path d="M12 3a6 6 0 0 1 4.5 10.1c-.8.9-1.3 1.8-1.5 2.9H9c-.2-1.1-.7-2-1.5-2.9A6 6 0 0 1 12 3z"/></svg>`,
    mesh:     `<svg viewBox="0 0 24 24"><path d="M6 8l6-4 6 4-6 4-6-4Z"/><path d="M6 8v8l6 4 6-4V8"/><path d="M12 12v8"/></svg>`,
    group:    `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`,
    skinned:  `<svg viewBox="0 0 24 24"><path d="M6 8l6-4 6 4-6 4-6-4Z"/><path d="M6 8v8l6 4 6-4V8"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`,
    particle: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="5" cy="6" r="1.2" fill="currentColor" opacity=".6"/><circle cx="19" cy="6" r="1" fill="currentColor" opacity=".5"/><circle cx="7" cy="18" r="1.4" fill="currentColor" opacity=".7"/><circle cx="17" cy="17" r="1" fill="currentColor" opacity=".4"/><circle cx="12" cy="4" r=".9" fill="currentColor" opacity=".5"/></svg>`,
    aura:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`,
    lightning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    camera:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7L16 12l7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  };

  function isUserObject(obj) {
    if (!app.scene)                          return false;
    if (obj === app.gridRoot)                return false;
    if (obj === app.axesHelper)              return false;
    if (obj === app.transformControls)       return false;
    if (obj === app._tcHelper)               return false;
    if (obj.isLight)                         return false;
    if (obj.userData.isHelper)               return false;
    if (obj.userData.isLightObject)          return true;
    if (obj.userData.isLabMarker)            return true;
    if (obj.userData.isSceneCamera)          return true;   // scene cameras ✓
    if (obj.isMesh && !obj.name)             return false;
    if (obj.isGroup && !obj.userData.isLightObject && !obj.name) return false;
    return !!(obj.name && obj.name.trim().length > 0);
  }

  function getUserTopLevel() {
    return app.scene ? app.scene.children.filter(isUserObject) : [];
  }

  function getUserChildren(group) {
    return group.children.filter((c) => {
      if (c.isLight && !c.userData.isLightObject) return false;
      return c.isMesh || c.isSkinnedMesh || c.isGroup || c.userData.isLightObject;
    });
  }

  function renderObjectsList() {
    if (!app.scene) return;
    const top = getUserTopLevel();
    if (top.length === 0) {
      objectsList.innerHTML = '<div class="objectsEmpty">Cena vazia.<br>Adicione objetos pelo painel.</div>';
      return;
    }
    let html = '';
    for (const obj of top) html += buildObjectRow(obj, 0);
    objectsList.innerHTML = html;
    attachListListeners();
  }

  function buildObjectRow(obj, depth) {
    const isSel   = selectedUUIDs.has(obj.uuid);
    const isActive = app.selected?.uuid === obj.uuid;
    const isGrp   = obj.isGroup && !obj.userData.isLightObject;
    const isExp   = expandedGroups.has(obj.uuid);
    const isSkinned = obj.isSkinnedMesh;
    const pad     = 8 + depth * 14;

    const icon = obj.userData.isLightObject      ? ICON.light
               : obj.userData.isLightningOnly    ? ICON.lightning
               : obj.userData.isAura             ? ICON.aura
               : obj.userData.isLabMarker        ? ICON.particle
               : obj.userData.isSceneCamera      ? ICON.camera
               : isSkinned                       ? ICON.skinned
               : isGrp                           ? ICON.group
               : ICON.mesh;

    let html = `<div class="objectItem${isSel ? ' selected' : ''}${isActive ? ' active' : ''}" data-uuid="${obj.uuid}" data-depth="${depth}" style="padding-left:${pad}px">
      ${Array.from({length: depth}, (_, lvl) => `<span class="treeGuide" style="left:${8 + lvl * 14 + 6}px"></span>`).join('')}
      ${isGrp
        ? `<button class="groupToggleBtn" data-group-uuid="${obj.uuid}" type="button"><svg class="groupArrow${isExp?' expanded':''}" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>`
        : `<span class="groupToggleSpacer"></span>`}
      ${icon}
      <span class="objectName">${obj.name || obj.type}</span>
      ${isGrp && getUserChildren(obj).length ? `<span class="objectChildCount">${getUserChildren(obj).length}</span>` : ''}
    </div>`;

    if (isGrp && isExp) {
      for (const child of getUserChildren(obj)) html += buildObjectRow(child, depth + 1);
    }
    return html;
  }

  function attachListListeners() {
    objectsList.querySelectorAll('.groupToggleBtn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uuid = btn.dataset.groupUuid;
        expandedGroups.has(uuid) ? expandedGroups.delete(uuid) : expandedGroups.add(uuid);
        renderObjectsList();
      });
    });

    objectsList.querySelectorAll('.objectItem').forEach((el) => {
      el.addEventListener('click', () => {
        // A long-press-drag reparent just completed on this pointer sequence —
        // swallow the trailing click so it doesn't also toggle selection.
        if (_suppressNextClick) { _suppressNextClick = false; return; }

        const uuid = el.dataset.uuid;

        // ── Group pick mode: bypass the normal toggle so that clicking any
        // item — including one that's already selected — always fires the pick
        // event. The group pick handler (scene-selection-changed listener below)
        // processes first/second picks and creates the Group node.
        if (_groupPickMode) {
          const found = findByUUID(app.scene, uuid);
          if (found && !found.userData.isHelper && !found.userData.isBoneMarker) {
            window.dispatchEvent(new CustomEvent('scene-selection-changed', { detail: { object: found } }));
          }
          return;   // don't touch selectedUUIDs or re-render mid-pick
        }

        // ── Normal single-click toggle ────────────────────────────────────
        if (selectedUUIDs.has(uuid)) {
          selectedUUIDs.delete(uuid);
          if (app.selected?.uuid === uuid) {
            app.transformControls?.detach();
            app.selected = null;
            window.dispatchEvent(new CustomEvent('scene-selection-changed', { detail: { object: null } }));
          }
        } else {
          selectedUUIDs.add(uuid);
          const found = findByUUID(app.scene, uuid);
          if (found && app.transformControls) {
            app.transformControls.attach(found);
            app.selected = found;
            window.dispatchEvent(new CustomEvent('scene-selection-changed', { detail: { object: found } }));
          }
        }
        renderObjectsList();
      });
    });
  }

  function findByUUID(root, uuid) {
    let found = null;
    root.traverse((o) => { if (o.uuid === uuid) found = o; });
    return found;
  }

  setTimeout(renderObjectsList, 150);

  // Refresh hierarchy when particle systems are added or removed
  window.addEventListener('labs-systems-changed', renderObjectsList);

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOAT PANEL — 2.5 s segurado num objeto → portátil, arrastável, ao vivo
  // ══════════════════════════════════════════════════════════════════════════
  const floatPanel = document.getElementById('floatPanel');
  const fpHeader   = document.getElementById('fpHeader');
  const fpClose    = document.getElementById('fpClose');
  const $fp = id => document.getElementById(id);

  let _fpTicker = null;
  let _fpTarget = null;

  // ── Populate static info ─────────────────────────────────────────────────
  function _fpPopulate(obj) {
    _fpTarget = obj;
    if ($fp('fpTitle')) $fp('fpTitle').textContent = obj.name || 'Objeto';
    const type = obj.userData.isLabMarker   ? 'Particle'
               : obj.userData.isLightObject ? 'Luz'
               : obj.isSkinnedMesh          ? 'Skinned'
               : obj.isMesh                 ? 'Mesh'
               : obj.isGroup                ? 'Grupo'
               : 'Object3D';
    if ($fp('fpType')) $fp('fpType').textContent = type;
    const geoSec = $fp('fpGeoSection');
    const matSec = $fp('fpMatSection');
    if (obj.isMesh && obj.geometry) {
      const geo   = obj.geometry;
      const verts = geo.attributes?.position?.count ?? 0;
      const tris  = geo.index ? geo.index.count / 3 : verts / 3;
      if ($fp('fpVerts')) $fp('fpVerts').textContent = verts.toLocaleString();
      if ($fp('fpTris'))  $fp('fpTris').textContent  = Math.round(tris).toLocaleString();
      geo.computeBoundingBox?.();
      const bb = geo.boundingBox;
      if (bb) {
        const f2 = v => v.toFixed(2);
        if ($fp('fpBBW')) $fp('fpBBW').textContent = f2(bb.max.x - bb.min.x);
        if ($fp('fpBBH')) $fp('fpBBH').textContent = f2(bb.max.y - bb.min.y);
        if ($fp('fpBBD')) $fp('fpBBD').textContent = f2(bb.max.z - bb.min.z);
      }
      if (geoSec) geoSec.style.display = '';
      if (obj.material && matSec) {
        const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if ($fp('fpMatName')) $fp('fpMatName').textContent = mat.name || '(sem nome)';
        if ($fp('fpMatType')) $fp('fpMatType').textContent = (mat.type || '').replace('Material', '');
        matSec.style.display = '';
      } else { if (matSec) matSec.style.display = 'none'; }
    } else {
      if (geoSec) geoSec.style.display = 'none';
      if (matSec) matSec.style.display = 'none';
    }
  }

  // ── Live tick ────────────────────────────────────────────────────────────
  function _fpTick() {
    const obj = _fpTarget; if (!obj) return;
    const f3  = v => v.toFixed(3);
    const r2d = v => (v * 180 / Math.PI).toFixed(1);
    if ($fp('fpPX')) $fp('fpPX').textContent = f3(obj.position.x);
    if ($fp('fpPY')) $fp('fpPY').textContent = f3(obj.position.y);
    if ($fp('fpPZ')) $fp('fpPZ').textContent = f3(obj.position.z);
    if ($fp('fpRX')) $fp('fpRX').textContent = r2d(obj.rotation.x) + '\u00b0';
    if ($fp('fpRY')) $fp('fpRY').textContent = r2d(obj.rotation.y) + '\u00b0';
    if ($fp('fpRZ')) $fp('fpRZ').textContent = r2d(obj.rotation.z) + '\u00b0';
    if ($fp('fpSX')) $fp('fpSX').textContent = f3(obj.scale.x);
    if ($fp('fpSY')) $fp('fpSY').textContent = f3(obj.scale.y);
    if ($fp('fpSZ')) $fp('fpSZ').textContent = f3(obj.scale.z);
  }

  // ── Show ─────────────────────────────────────────────────────────────────
  function _fpShow(screenX, screenY) {
    if (!floatPanel || !_fpTarget) return;
    const W = window.innerWidth, H = window.innerHeight;
    const panW = 234, panH = 200;
    let left = screenX + 14;
    if (left + panW > W - 8) left = screenX - panW - 14;
    let top = screenY - panH / 2;
    if (top < 62) top = 62;
    if (top + panH > H - 62) top = H - 62 - panH;
    left = Math.max(4, left);
    floatPanel.style.left = left + 'px';
    floatPanel.style.top  = top  + 'px';
    floatPanel.classList.remove('hidden', 'fp-out');
    requestAnimationFrame(() => floatPanel.classList.add('fp-in'));
    if (_fpTicker) clearInterval(_fpTicker);
    _fpTicker = setInterval(_fpTick, 100);
    _fpTick();
  }

  // ── Hide ─────────────────────────────────────────────────────────────────
  function _fpHide() {
    if (!floatPanel || floatPanel.classList.contains('hidden')) return;
    floatPanel.classList.remove('fp-in');
    floatPanel.classList.add('fp-out');
    if (_fpTicker) { clearInterval(_fpTicker); _fpTicker = null; }
    setTimeout(() => {
      floatPanel.classList.add('hidden');
      floatPanel.classList.remove('fp-out');
      _fpTarget = null;
    }, 180);
  }

  fpClose?.addEventListener('click', _fpHide);

  // ── Drag by header ───────────────────────────────────────────────────────
  if (floatPanel && fpHeader) {
    let _dragOx = 0, _dragOy = 0, _fpDrag = false;
    fpHeader.addEventListener('pointerdown', e => {
      e.stopPropagation();
      _fpDrag = true;
      _dragOx = e.clientX - parseFloat(floatPanel.style.left || 0);
      _dragOy = e.clientY - parseFloat(floatPanel.style.top  || 0);
      fpHeader.setPointerCapture(e.pointerId);
    });
    fpHeader.addEventListener('pointermove', e => {
      if (!_fpDrag) return;
      const W = window.innerWidth, H = window.innerHeight;
      floatPanel.style.left = Math.max(0, Math.min(e.clientX - _dragOx, W - 234)) + 'px';
      floatPanel.style.top  = Math.max(0, Math.min(e.clientY - _dragOy, H - 80))  + 'px';
    });
    fpHeader.addEventListener('pointerup',    () => { _fpDrag = false; });
    fpHeader.addEventListener('pointercancel',() => { _fpDrag = false; });
  }

  // ── Long press — 2.5 s, sem anel ────────────────────────────────────────
  let _pressTimer = null;
  let _pressX = 0, _pressY = 0;
  const HOLD_MS  = 2500;
  const MOVE_TOL = 14;

  function _startPress(cx, cy) {
    if (!app.selected) return;
    _pressX = cx; _pressY = cy;
    if (_pressTimer) clearTimeout(_pressTimer);
    _pressTimer = setTimeout(() => {
      _pressTimer = null;
      _fpPopulate(app.selected);
      _fpShow(cx, cy);
      if (navigator.vibrate) navigator.vibrate([12, 16, 12]);
    }, HOLD_MS);
  }
  function _cancelPress() {
    if (_pressTimer) { clearTimeout(_pressTimer); _pressTimer = null; }
  }

  const canvas = app.renderer?.domElement;
  if (canvas) {
    canvas.addEventListener('touchstart', e => {
      _fpHide();
      const t = e.touches[0];
      _startPress(t.clientX, t.clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - _pressX, t.clientY - _pressY) > MOVE_TOL) _cancelPress();
    }, { passive: true });
    canvas.addEventListener('touchend',    _cancelPress, { passive: true });
    canvas.addEventListener('touchcancel', _cancelPress, { passive: true });
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _fpHide();
      _startPress(e.clientX, e.clientY);
    });
    canvas.addEventListener('mousemove', e => {
      if (!_pressTimer) return;
      if (Math.hypot(e.clientX - _pressX, e.clientY - _pressY) > MOVE_TOL) _cancelPress();
    });
    canvas.addEventListener('mouseup', _cancelPress);
  }

  document.addEventListener('pointerdown', e => {
    if (floatPanel && !floatPanel.classList.contains('hidden') && !floatPanel.contains(e.target))
      _fpHide();
  }, { passive: true });

  // ── Scene selection changed ──────────────────────────────────────────────
  window.addEventListener('scene-selection-changed', (e) => {
    const obj = e.detail.object;
    if (obj) { selectedUUIDs.clear(); selectedUUIDs.add(obj.uuid); }
    else selectedUUIDs.clear();
    updateOutlineSelected(obj);
    if (activeLeftPanel === 'lights') syncLightUI();
    if (obj?.userData?.isLightObject && activeLeftPanel !== 'lights') {
      openLeftPanel('lights'); syncLightUI();
    }
    if (activeLeftPanel === 'material') syncMaterialUI();
    updateBonePanel(obj);
    renderObjectsList();
  });

  // ──────────────────────────────────────────────────────────────────────────
  //  BONE VISUALIZATION & PANEL
  // ──────────────────────────────────────────────────────────────────────────
  let currentSkeleton      = null;
  const bonePanelContainer = document.getElementById('bonePanelContainer');
  const bonePanelClose     = document.getElementById('bonePanelClose');
  const boneRevealBtn      = document.getElementById('boneRevealBtn');
  const boneTreeEl         = document.getElementById('boneTree');
  const expandedBones      = new Set();
  let   selectedBoneUUID   = null;   // uuid of the THREE.Bone object
  let   bonePanelVisible   = false;
  let   boneVizGroups      = [];     // one Group (fill+wire octahedron) per bone

  // ── Build / clear Blender-style OCTAHEDRAL bone visualization ─────────────
  // Blender's default bone display: two square-based pyramids joined at a
  // "waist" positioned close to the root — a wide joint indicator that
  // tapers to a point at the tip, oriented per-bone so it also shows roll
  // (the square cross-section rotates with the bone's local X/Z axes).
  // Built ONCE per bone in the bone's own LOCAL space and parented directly
  // to it — THREE's normal scene-graph matrixWorld propagation then makes
  // it follow animated poses automatically. No per-frame sync function
  // needed (the old sphere approach needed boneUpdateFn running every
  // frame just to reposition floating dots).
  function clearBoneVisualization() {
    boneVizGroups.forEach((g) => {
      g.parent?.remove(g);
      g.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); });
    });
    boneVizGroups    = [];
    app.boneObjects  = [];
    app.boneUpdateFn = null;
  }

  function buildBoneVisualization(skeleton) {
    clearBoneVisualization();
    if (!skeleton || !app.scene) return;
    import('three').then(({
      Vector3, BufferGeometry, Float32BufferAttribute,
      MeshBasicMaterial, Mesh, EdgesGeometry, LineBasicMaterial,
      LineSegments, Group, DoubleSide,
    }) => {
      const bones = skeleton.bones;

      // Fallback tip length for leaf bones (no children) — average of
      // this rig's actual parent→child offsets.
      let totalLen = 0, count = 0;
      bones.forEach((b) => {
        if (b.parent?.isBone) { totalLen += b.position.length(); count++; }
      });
      const avgLen = count > 0 ? totalLen / count : 0.12;

      function buildOctahedronGeometry(tipLocal, widthScale = 0.24) {
        const length = tipLocal.length();
        const width  = Math.max(length * widthScale, avgLen * 0.06, 0.006);
        const dir = tipLocal.clone().normalize();
        const up  = Math.abs(dir.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
        const xAx = new Vector3().crossVectors(up, dir).normalize();
        const zAx = new Vector3().crossVectors(dir, xAx).normalize();

        const waistT = 0.14; // matches Blender's proportions — bulge close to the root
        const waist  = tipLocal.clone().multiplyScalar(waistT);
        const w1 = waist.clone().addScaledVector(xAx,  width);
        const w2 = waist.clone().addScaledVector(zAx,  width);
        const w3 = waist.clone().addScaledVector(xAx, -width);
        const w4 = waist.clone().addScaledVector(zAx, -width);
        const root = new Vector3(0, 0, 0);
        const quad = [w1, w2, w3, w4];

        const positions = [];
        for (let i = 0; i < 4; i++) {
          const a = quad[i], b = quad[(i + 1) % 4];
          positions.push(root.x, root.y, root.z,  a.x, a.y, a.z,  b.x, b.y, b.z);
          positions.push(tipLocal.x, tipLocal.y, tipLocal.z,  b.x, b.y, b.z,  a.x, a.y, a.z);
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.computeVertexNormals();
        return geo;
      }

      bones.forEach((bone) => {
        const boneChildren = bone.children.filter((c) => c.isBone && bones.includes(c));
        let tipLocal;
        if (boneChildren.length === 1) {
          tipLocal = boneChildren[0].position.clone();
        } else if (boneChildren.length > 1) {
          // Multiple children (fork) — average their offsets for a single
          // representative tip direction, keeping the implementation and
          // click-target simple while still reading correctly on screen.
          tipLocal = new Vector3();
          boneChildren.forEach((c) => tipLocal.add(c.position));
          tipLocal.divideScalar(boneChildren.length);
        } else {
          // Leaf bone — extend along local +Y (THREE's bone convention)
          tipLocal = new Vector3(0, avgLen * 0.7, 0);
        }
        if (tipLocal.lengthSq() < 1e-8) tipLocal.set(0, Math.max(avgLen * 0.5, 0.02), 0);

        const geo = buildOctahedronGeometry(tipLocal);
        const fillMat = new MeshBasicMaterial({
          color: 0x8ecbff, transparent: true, opacity: 0.45,
          depthTest: false, depthWrite: false, side: DoubleSide,
        });
        const fillMesh = new Mesh(geo, fillMat);
        fillMesh.renderOrder = 997;
        fillMesh.userData.isBoneMarker = true;
        fillMesh.userData.boneRef      = bone;

        const edgeGeo = new EdgesGeometry(geo, 1);
        const wireMat = new LineBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.9,
          depthTest: false, depthWrite: false,
        });
        const wireMesh = new LineSegments(edgeGeo, wireMat);
        wireMesh.renderOrder = 998;
        fillMesh.userData.wireRef = wireMesh; // so setSelected() can recolor both together

        const group = new Group();
        group.userData.isHelper = true;
        group.add(fillMesh, wireMesh);
        bone.add(group); // parented directly — follows animated pose automatically

        boneVizGroups.push(group);
      });

      app.boneObjects = boneVizGroups.map((g) => g.children[0]); // fillMesh of each, for raycasting
      // No boneUpdateFn needed anymore — scene-graph parenting handles it.
    });
  }

  function findSkeleton(obj) {
    if (!obj) return null;
    let sk = null;
    obj.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) sk = o.skeleton; });
    if (!sk && obj.isSkinnedMesh && obj.skeleton) sk = obj.skeleton;
    return sk;
  }

  function checkSceneForSkeletons() {
    let hasSkeleton = false;
    if (app.scene) app.scene.traverse((o) => { if (o.isSkinnedMesh) hasSkeleton = true; });
    boneRevealBtn.classList.toggle('hidden', !hasSkeleton);
    if (!hasSkeleton && bonePanelVisible) closeBonePanel();
  }

  function openBonePanel() {
    bonePanelVisible = true;
    bonePanelContainer.classList.remove('hidden');
    objectsSection.classList.add('split');
    boneRevealBtn.classList.add('active');
  }

  function closeBonePanel() {
    bonePanelVisible = false;
    bonePanelContainer.classList.add('hidden');
    objectsSection.classList.remove('split');
    boneRevealBtn.classList.remove('active');
  }

  bonePanelClose.addEventListener('click', closeBonePanel);
  boneRevealBtn.addEventListener('click', () => {
    if (bonePanelVisible) closeBonePanel();
    else openBonePanel();
  });

  function updateBonePanel(obj) {
    // If a bone sphere was just selected — only sync tree highlight, no rebuild
    if (obj?.userData?.isBoneMarker) {
      selectedBoneUUID = obj.userData.boneRef.uuid;
      if (currentSkeleton) renderBoneTree(currentSkeleton);
      return;
    }
    // New mesh selected — rebuild visualization
    clearBoneVisualization();
    currentSkeleton = null;

    const sk = findSkeleton(obj);
    if (sk && app.scene) {
      currentSkeleton = sk;
      buildBoneVisualization(sk);
      renderBoneTree(sk);
      boneRevealBtn.classList.remove('hidden');
      if (!bonePanelVisible) openBonePanel();
    } else {
      boneTreeEl.innerHTML = '';
      checkSceneForSkeletons();
    }
  }

  function renderBoneTree(skeleton) {
    if (!skeleton) { boneTreeEl.innerHTML = ''; return; }
    const bones = skeleton.bones;
    const roots = bones.filter((b) => !b.parent?.isBone || !bones.includes(b.parent));

    let html = '';
    function walk(bone, depth) {
      const isExp    = expandedBones.has(bone.uuid);
      const isSel    = selectedBoneUUID === bone.uuid;
      const children = bone.children.filter((c) => c.isBone && bones.includes(c));
      const hasKids  = children.length > 0;
      const pad      = 6 + depth * 12;
      html += `<div class="boneNode${isSel ? ' selected' : ''}" data-bone-uuid="${bone.uuid}" style="padding-left:${pad}px">
        ${hasKids
          ? `<button class="boneExpandBtn" data-expand-bone="${bone.uuid}" type="button"><svg class="${isExp ? 'exp' : ''}" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>`
          : `<span class="boneSpacer"></span>`}
        <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.5" fill="currentColor"/><circle cx="12" cy="19" r="2.5" fill="currentColor"/><line x1="12" y1="7.5" x2="12" y2="16.5"/></svg>
        <span>${bone.name || 'Bone'}</span>
      </div>`;
      if (hasKids && isExp) {
        for (const child of children) walk(child, depth + 1);
      }
    }
    for (const root of roots) walk(root, 0);
    boneTreeEl.innerHTML = html;
    attachBoneListeners();
  }

  function attachBoneListeners() {
    boneTreeEl.querySelectorAll('.boneExpandBtn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uuid = btn.dataset.expandBone;
        expandedBones.has(uuid) ? expandedBones.delete(uuid) : expandedBones.add(uuid);
        if (currentSkeleton) renderBoneTree(currentSkeleton);
      });
    });

    boneTreeEl.querySelectorAll('.boneNode').forEach((el) => {
      el.addEventListener('click', () => {
        const boneUUID = el.dataset.boneUuid;
        selectedBoneUUID = boneUUID;
        // Find the fill mesh (children[0] of the group) for this bone and select it
        const fillMesh = boneVizGroups.map(g => g.children[0])
          .find((m) => m.userData.boneRef?.uuid === boneUUID);
        if (fillMesh) {
          import('./scene.js').then(({ setSelected }) => setSelected(fillMesh));
        }
        if (currentSkeleton) renderBoneTree(currentSkeleton);
      });
    });
  }

  // ── Actions menu ──────────────────────────────────────────────────────────
  const actionsBtn  = document.getElementById('actionsBtn');
  const actionsMenu = document.getElementById('actionsMenu');

  actionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !actionsMenu.classList.contains('hidden');
    actionsMenu.classList.toggle('hidden', open);
    actionsBtn.classList.toggle('active', !open);
  });
  document.addEventListener('click', () => {
    actionsMenu.classList.add('hidden');
    actionsBtn.classList.remove('active');
  });

  function getTargets() {
    const targets = [];
    selectedUUIDs.forEach((uuid) => {
      const o = findByUUID(app.scene, uuid);
      if (o) targets.push(o);
    });
    if (!targets.length && app.selected) targets.push(app.selected);
    return targets;
  }

  document.getElementById('actionDelete').addEventListener('click', () => {
    getTargets().forEach((o) => app.scene.remove(o));
    app.transformControls?.detach(); app.selected = null;
    selectedUUIDs.clear(); markSceneDirty(); renderObjectsList();
    app._ptTopologyDirty = true; // objects removed — path tracer BVH needs a full rebuild next time it's active
    checkSceneForSkeletons();
    actionsMenu.classList.add('hidden'); actionsBtn.classList.remove('active');
    pushState();
  });

  document.getElementById('actionClone').addEventListener('click', () => {
    getTargets().forEach((o) => {
      const c = o.clone(); c.position.x += 1;
      c.name = (o.name || 'objeto') + '_clone';
      app.scene.add(c);
    });
    markSceneDirty(); renderObjectsList();
    actionsMenu.classList.add('hidden'); actionsBtn.classList.remove('active');
    pushState();
  });

  document.getElementById('actionRename').addEventListener('click', () => {
    const targets = getTargets();
    if (targets.length === 1) {
      const n = prompt('Novo nome:', targets[0].name || '');
      if (n?.trim()) { targets[0].name = n.trim(); renderObjectsList(); pushState(); }
    }
    actionsMenu.classList.add('hidden'); actionsBtn.classList.remove('active');
  });

  // ── Group action: click first obj in hierarchy, then second → groups them ──
  let _groupPickMode = false;
  let _groupFirst    = null;
  document.getElementById('actionGroup').addEventListener('click', () => {
    actionsMenu.classList.add('hidden'); actionsBtn.classList.remove('active');
    _groupFirst    = null;
    _groupPickMode = true;
    window._groupPickMode = true;   // expose for scene.js viewport clicks
    const banner = document.createElement('div');
    banner.id = '_grp_banner';
    banner.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);background:rgba(255,160,60,.18);border:1px solid rgba(255,160,60,.5);color:#ffb347;padding:7px 18px;border-radius:8px;font-size:12px;font-weight:700;z-index:9999;pointer-events:none';
    banner.textContent = '🔗 Clique no 1º objeto a agrupar…';
    document.body.appendChild(banner);
    const cleanup = () => {
      _groupPickMode = false; _groupFirst = null;
      window._groupPickMode = false;   // clear global flag
      document.getElementById('_grp_banner')?.remove();
      window.removeEventListener('_groupPickTick', cleanup);
    };
    window.addEventListener('_groupPickTick', cleanup);
    setTimeout(cleanup, 15000); // auto-cancel after 15s
  });

  // Wire group pick onto the hierarchy row clicks
  window.addEventListener('scene-selection-changed', (e) => {
    if (!_groupPickMode) return;
    const obj = e.detail?.object;
    if (!obj || obj.userData.isHelper || obj.userData.isBoneMarker) return;
    if (!_groupFirst) {
      _groupFirst = obj;
      document.getElementById('_grp_banner').textContent = `🔗 Agora clique no 2º objeto (primeiro: "${obj.name || 'objeto'}")…`;
    } else if (_groupFirst !== obj) {
      // Have both — create the group. Capture refs into local consts FIRST:
      // the dynamic import below resolves asynchronously, and by then the
      // pick-mode reset a few lines down has already nulled out _groupFirst
      // (that was the bug — grouping crashed on every attempt with a null
      // dereference once the import callback finally ran).
      const first  = _groupFirst;
      const second = obj;
      window.dispatchEvent(new Event('_groupPickTick'));
      document.getElementById('_grp_banner')?.remove();
      _groupPickMode = false; _groupFirst = null;

      import('three').then(({ Group, Vector3 }) => {
        const grp = new Group(); grp.name = 'Grupo';
        const avg = new Vector3().addVectors(first.position, second.position).multiplyScalar(0.5);
        grp.position.copy(avg);
        [first, second].forEach((o) => {
          o.position.sub(avg);
          app.scene.remove(o);
          grp.add(o);
        });
        app.scene.add(grp);
        selectedUUIDs.clear(); selectedUUIDs.add(grp.uuid);
        expandedGroups.add(grp.uuid);
        markSceneDirty(); renderObjectsList();
        pushState();
      });
    }
  });

  // ── Long-press + drag to reparent in hierarchy (touch-first) ──────────────
  // Hold an object row for 1.5s, then drag onto another row to make it a
  // child of that object. (Replaces the old dragstart/dragover/drop wiring —
  // rows were never marked draggable="true" so it never fired, and native
  // HTML5 DnD doesn't work with touch input in a WebView anyway.)
  const LONG_PRESS_MS       = 1500;
  const LONG_PRESS_MOVE_TOL = 10;   // px of finger movement that cancels the hold

  let _lpTimer      = null;
  let _lpPointerId  = null;
  let _lpStartX     = 0, _lpStartY = 0;
  let _lpSrcUUID    = null;
  let _dragActive   = false;
  let _dragOverUUID = null;
  let _suppressNextClick = false;

  function _clearDragVisuals() {
    objectsList.querySelectorAll('.pressing, .drag-src, .drag-over').forEach((el) => {
      el.classList.remove('pressing', 'drag-src', 'drag-over');
    });
  }
  function _resetDragState() {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    _lpPointerId = null; _lpSrcUUID = null; _dragActive = false; _dragOverUUID = null;
    _clearDragVisuals();
  }

  objectsList.addEventListener('pointerdown', (e) => {
    if (_lpPointerId !== null) return;   // a press/drag is already in progress
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = e.target.closest('.objectItem');
    if (!row || e.target.closest('.groupToggleBtn')) return;
    _lpPointerId = e.pointerId;
    _lpStartX = e.clientX; _lpStartY = e.clientY;
    _lpSrcUUID = row.dataset.uuid;
    row.classList.add('pressing');
    try { objectsList.setPointerCapture(e.pointerId); } catch {}
    _lpTimer = setTimeout(() => {
      _lpTimer = null;
      if (_lpPointerId === null) return;
      _dragActive = true;
      row.classList.remove('pressing');
      row.classList.add('drag-src');
      try { navigator.vibrate?.(15); } catch {}
    }, LONG_PRESS_MS);
  });

  objectsList.addEventListener('pointermove', (e) => {
    if (e.pointerId !== _lpPointerId) return;
    if (!_dragActive) {
      const dx = e.clientX - _lpStartX, dy = e.clientY - _lpStartY;
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOL * LONG_PRESS_MOVE_TOL) _resetDragState();
      return;
    }
    e.preventDefault();   // holding + dragging shouldn't also scroll the list
    const el   = document.elementFromPoint(e.clientX, e.clientY);
    const row  = el?.closest?.('.objectItem');
    const uuid = (row && row.dataset.uuid !== _lpSrcUUID) ? row.dataset.uuid : null;
    if (uuid !== _dragOverUUID) {
      objectsList.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
      _dragOverUUID = uuid;
      if (uuid && row) row.classList.add('drag-over');
    }
  }, { passive: false });

  objectsList.addEventListener('pointerup', (e) => {
    if (e.pointerId !== _lpPointerId) return;
    const wasDragging = _dragActive;
    const srcUUID = _lpSrcUUID, tgtUUID = _dragOverUUID;
    _resetDragState();
    if (!wasDragging) return;   // quick tap — let the normal click handler run
    e.preventDefault();
    _suppressNextClick = true;
    setTimeout(() => { _suppressNextClick = false; }, 400);   // safety net
    if (!srcUUID || !tgtUUID || srcUUID === tgtUUID) return;
    const srcObj = app.scene.getObjectByProperty('uuid', srcUUID);
    const tgtObj = app.scene.getObjectByProperty('uuid', tgtUUID);
    if (!srcObj || !tgtObj) return;
    // Don't allow parenting an object onto its own descendant
    let ancestor = tgtObj.parent;
    while (ancestor) { if (ancestor === srcObj) return; ancestor = ancestor.parent; }
    tgtObj.attach(srcObj);   // re-parents while preserving world transform
    expandedGroups.add(tgtUUID);
    markSceneDirty(); renderObjectsList();
    pushState();
  }, { passive: false });

  objectsList.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== _lpPointerId) return;
    _resetDragState();
  });

  // ── Default state ─────────────────────────────────────────────────────────
  setGizmoMode('translate');
  setActiveButton(gizmoButtons, gizmoButtons.find((b) => b.dataset.mode === 'translate'));
  setRenderModeValue('standard');
  setActiveButton(renderModeButtons, renderModeButtons.find((b) => b.dataset.renderMode === 'standard'));

  if (app.renderer) {
    app.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { clearSelection(); selectedUUIDs.clear(); renderObjectsList(); }
    if (/^[gG]$/.test(e.key)) { const b = gizmoButtons.find((x) => x.dataset.mode === 'translate'); if(b){setGizmoMode('translate');setActiveButton(gizmoButtons,b);} }
    if (/^[rR]$/.test(e.key)) { const b = gizmoButtons.find((x) => x.dataset.mode === 'rotate');    if(b){setGizmoMode('rotate');   setActiveButton(gizmoButtons,b);} }
    if (/^[sS]$/.test(e.key)) { const b = gizmoButtons.find((x) => x.dataset.mode === 'scale');     if(b){setGizmoMode('scale');    setActiveButton(gizmoButtons,b);} }
  });
});
