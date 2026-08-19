import { listProjects, createProject, loadProject, saveProjectData, renameProject, deleteProject, duplicateProject } from './projects.js';
import { _serialize, _applyProjectData } from './config.js';

const STORAGE_ACTIVE_KEY = 'ncm_active_project_id_v1';
const STORAGE_ACTIVE_NAME_KEY = STORAGE_ACTIVE_KEY + '_name';

const blankPayload = () => ({
  version: '2.0',
  format: 'nex',
  timestamp: new Date().toISOString(),
  skybox: { type: 'color', value: '#373737' },
  objects: [],
  boneRegistry: {},
  cameras: [],
  particleSystems: [],
  animation: {
    fps: 24,
    interp: 'smooth',
    keyframes: {},
  },
});

let activeProjectId = localStorage.getItem(STORAGE_ACTIVE_KEY) || null;
let activeProjectName = localStorage.getItem(STORAGE_ACTIVE_NAME_KEY) || 'NEXUS ENGINE';
let launcherVisible = false;
let menuOpenEl = null;
let booted = false;
let launcherSettingsMenu = null;
let launcherSettingsBackdrop = null;

// ─── "Tamanho do app" — simulate a fixed screen width/height (px) ─────────
// <body> is the app's real root (splash, launcher, canvas, every panel are
// all direct/indirect children of it) and ui.css always keeps a `transform`
// set on it, which — regardless of body's own `position` — makes body the
// containing block for every position:fixed element inside it. So resizing
// body to an explicit W×H and scaling it down to fit the real window is
// enough to make the *entire* app behave as if the screen were that size;
// scene.js's getViewportSize()/onResize() mirror the same override for the
// 3D camera/renderer so the canvas matches rather than being cropped/
// stretched inside the resized body.
const VIEWPORT_SIZE_KEY = 'ncm_viewport_override_v1';

function _fitOverriddenBody() {
  const o = window._ncmViewportOverride;
  const b = document.body;
  if (!o) {
    b.style.width = '';
    b.style.height = '';
    b.style.transform = '';
    return;
  }
  const scale = Math.min(window.innerWidth / o.width, window.innerHeight / o.height, 1) || 1;
  b.style.width = o.width + 'px';
  b.style.height = o.height + 'px';
  b.style.transform = `scale(${scale})`;
}

function applyViewportOverride(width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!(w >= 120) || !(h >= 120)) return false;
  window._ncmViewportOverride = { width: w, height: h };
  try { localStorage.setItem(VIEWPORT_SIZE_KEY, JSON.stringify({ w, h })); } catch { /* storage unavailable — override still applies for this session */ }
  _fitOverriddenBody();
  window.dispatchEvent(new Event('resize')); // picked up by scene.js's onResize()
  return true;
}

function clearViewportOverride() {
  window._ncmViewportOverride = null;
  try { localStorage.removeItem(VIEWPORT_SIZE_KEY); } catch { /* ignore */ }
  _fitOverriddenBody();
  window.dispatchEvent(new Event('resize')); // picked up by scene.js's onResize()
}

window.addEventListener('resize', _fitOverriddenBody);

// Restore a previously chosen size immediately (module load, before the 3D
// engine boots) so the app opens straight at the right size with no flash.
(function _restoreViewportOverride() {
  try {
    const raw = localStorage.getItem(VIEWPORT_SIZE_KEY);
    if (!raw) return;
    const { w, h } = JSON.parse(raw);
    if (w >= 120 && h >= 120) {
      window._ncmViewportOverride = { width: w, height: h };
      _fitOverriddenBody();
    }
  } catch { /* ignore malformed/blocked storage */ }
})();

const ui = {};

function body() {
  return document.body;
}

function ensureUi() {
  if (ui.root) return ui;
  ui.root = document.getElementById('launcherScreen');
  ui.grid = document.getElementById('launcherGrid');
  ui.newBtn = document.getElementById('launcherNewProjectBtn');
  ui.settingsBtn = document.getElementById('launcherSettingsBtn');
  ui.refreshBtn = document.getElementById('launcherRefreshBtn');
  ui.backBtn = document.getElementById('launcherBackBtn');
  return ui;
}

function setProjectTitle(name) {
  document.title = `NEXUS ENGINE — ${name || 'Projetos'}`;
}

function setActiveProject(id, name) {
  activeProjectId = id || null;
  activeProjectName = name || 'Novo Projeto';
  try {
    if (activeProjectId) {
      localStorage.setItem(STORAGE_ACTIVE_KEY, activeProjectId);
      localStorage.setItem(STORAGE_ACTIVE_NAME_KEY, activeProjectName);
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_KEY);
      localStorage.removeItem(STORAGE_ACTIVE_NAME_KEY);
    }
  } catch {}
}

function hideEditorShell() {
  body().classList.add('launcher-active');
}

function showEditorShell() {
  body().classList.remove('launcher-active');
}

function closeMenu() {
  if (menuOpenEl) {
    menuOpenEl.remove();
    menuOpenEl = null;
  }
}


function closeLauncherSettings() {
  launcherSettingsMenu?.classList.add('hidden');
  launcherSettingsBackdrop?.classList.add('hidden');
  ui.settingsBtn?.classList.remove('active');
}

function openLauncherSettings() {
  ensureLauncherSettings();
  closeMenu();
  launcherSettingsMenu?.classList.remove('hidden');
  launcherSettingsBackdrop?.classList.remove('hidden');
  ui.settingsBtn?.classList.add('active');
}

function ensureLauncherSettings() {
  if (launcherSettingsMenu) return;

  launcherSettingsBackdrop = document.createElement('div');
  launcherSettingsBackdrop.id = 'launcherSettingsBackdrop';
  launcherSettingsBackdrop.className = 'launcherSettingsBackdrop hidden';

  launcherSettingsMenu = document.createElement('div');
  launcherSettingsMenu.id = 'launcherSettingsMenu';
  launcherSettingsMenu.className = 'launcherSettingsMenu hidden';
  launcherSettingsMenu.innerHTML = `
    <div class="launcherSettingsHeader">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
      <span>Configurações</span>
      <button class="launcherSettingsClose" type="button" aria-label="Fechar">✕</button>
    </div>
    <div class="launcherSettingsBody">
      <div class="launcherSettingsSection">
        <div class="launcherSettingsSectionTitle">Idioma</div>
        <div class="launcherSettingsRow">
          <span>Idioma do aplicativo</span>
          <select id="launcherLangSelect" class="launcherLangSelect">
            <option value="">Português (padrão)</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="zh-CN">中文 (简体)</option>
            <option value="ru">Русский</option>
            <option value="it">Italiano</option>
            <option value="ar">العربية</option>
          </select>
        </div>
        <div id="launcherLangStatus" class="launcherLangStatus"></div>
      </div>
      <div class="launcherSettingsSection">
        <div class="launcherSettingsSectionTitle">Tamanho do app</div>
        <div class="launcherSettingsHint">Simula o app rodando em uma tela de outro tamanho, em pixels. Útil para conferir como ele fica em telas menores ou maiores.</div>
        <div class="launcherSettingsRow launcherSizeRow">
          <label class="launcherSizeField">
            <span>Largura (px)</span>
            <input type="number" id="launcherSizeWidth" class="launcherSizeInput" min="120" max="8000" step="1" inputmode="numeric" placeholder="ex: 412">
          </label>
          <span class="launcherSizeX">×</span>
          <label class="launcherSizeField">
            <span>Altura (px)</span>
            <input type="number" id="launcherSizeHeight" class="launcherSizeInput" min="120" max="8000" step="1" inputmode="numeric" placeholder="ex: 915">
          </label>
        </div>
        <div class="launcherSettingsRow launcherSizeActions">
          <button type="button" id="launcherSizeReset" class="launcherSizeBtn">Tamanho normal</button>
          <button type="button" id="launcherSizeApply" class="launcherSizeBtn launcherSizeBtnPrimary">Aplicar</button>
        </div>
        <div id="launcherSizeStatus" class="launcherLangStatus"></div>
      </div>
    </div>
  `;

  document.body.appendChild(launcherSettingsBackdrop);
  document.body.appendChild(launcherSettingsMenu);

  launcherSettingsBackdrop.addEventListener('click', closeLauncherSettings);
  launcherSettingsMenu.querySelector('.launcherSettingsClose')?.addEventListener('click', closeLauncherSettings);

  const langSelect = launcherSettingsMenu.querySelector('#launcherLangSelect');
  const status = launcherSettingsMenu.querySelector('#launcherLangStatus');
  const savedLang = localStorage.getItem('ncm_app_language_v1') || '';
  if (langSelect) langSelect.value = savedLang;

  langSelect?.addEventListener('change', () => {
    const lang = langSelect.value;
    localStorage.setItem('ncm_app_language_v1', lang);

    // Reuse the already-installed application translator in index.html.
    const editorSelect = document.getElementById('cfgLangSelect');
    if (editorSelect) {
      editorSelect.value = lang;
      editorSelect.dispatchEvent(new Event('change', { bubbles: true }));
      status.textContent = lang ? 'Traduzindo…' : '';
      setTimeout(() => {
        if (status) status.textContent = lang ? 'Idioma aplicado' : '';
      }, 900);
    }
  });

  // ── "Tamanho do app" ───────────────────────────────────────────────────────
  const widthInput   = launcherSettingsMenu.querySelector('#launcherSizeWidth');
  const heightInput  = launcherSettingsMenu.querySelector('#launcherSizeHeight');
  const sizeStatus   = launcherSettingsMenu.querySelector('#launcherSizeStatus');
  const sizeApplyBtn = launcherSettingsMenu.querySelector('#launcherSizeApply');
  const sizeResetBtn = launcherSettingsMenu.querySelector('#launcherSizeReset');

  function _refreshSizeStatus() {
    const o = window._ncmViewportOverride;
    if (sizeStatus) {
      sizeStatus.textContent = o
        ? `Simulando ${o.width} × ${o.height} px`
        : 'Usando o tamanho real da tela';
    }
    if (widthInput)  widthInput.value  = o ? o.width  : '';
    if (heightInput) heightInput.value = o ? o.height : '';
  }
  _refreshSizeStatus();

  sizeApplyBtn?.addEventListener('click', () => {
    const ok = applyViewportOverride(widthInput?.value, heightInput?.value);
    if (!ok) {
      if (sizeStatus) sizeStatus.textContent = 'Informe largura e altura válidas (mínimo 120px).';
      return;
    }
    _refreshSizeStatus();
  });

  sizeResetBtn?.addEventListener('click', () => {
    clearViewportOverride();
    _refreshSizeStatus();
  });
}

function captureThumbnail(canvas) {
  try {
    if (!canvas || typeof canvas.toDataURL !== 'function') return null;
    const w = canvas.width || 0;
    const h = canvas.height || 0;
    if (!w || !h) return null;
    const thumbW = 480;
    const thumbH = Math.max(1, Math.round((h / w) * thumbW));
    const tmp = document.createElement('canvas');
    tmp.width = thumbW;
    tmp.height = thumbH;
    const ctx = tmp.getContext('2d', { alpha: false });
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, thumbW, thumbH);
    return tmp.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

async function saveCurrentProject() {
  if (!activeProjectId) return false;
  try {
    const data = _serialize();
    const thumb = captureThumbnail(document.querySelector('canvas'));
    await saveProjectData(activeProjectId, data, thumb);
    return true;
  } catch (err) {
    console.warn('[launcher] Falha ao salvar projeto:', err);
    return false;
  }
}

function makeEmptyProjectData() {
  return blankPayload();
}

function projectMenuItems(project) {
  return [
    { label: 'Abrir', action: () => openProject(project.id) },
    { label: 'Renomear', action: () => renameProjectFlow(project.id, project.name) },
    { label: 'Duplicar', action: () => duplicateProjectFlow(project.id) },
    { label: 'Excluir', danger: true, action: () => deleteProjectFlow(project.id, project.name) },
  ];
}

function toggleCardMenu(card, project) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'launcherMenu';
  projectMenuItems(project).forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'launcherMenuItem' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      closeMenu();
      await item.action();
    });
    menu.appendChild(btn);
  });
  card.appendChild(menu);
  menuOpenEl = menu;
  requestAnimationFrame(() => menu.classList.add('open'));
}

function buildCard(project) {
  const card = document.createElement('div');
  card.className = 'launcherCard';
  card.dataset.id = project.id;

  const thumb = document.createElement('div');
  thumb.className = 'launcherThumb';
  if (project.thumbnail) {
    const img = document.createElement('img');
    img.src = project.thumbnail;
    img.alt = project.name || 'Projeto';
    img.loading = 'lazy';
    thumb.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'launcherThumbPlaceholder';
    placeholder.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path></svg>';
    thumb.appendChild(placeholder);
  }

  if (project.hasAnimation) {
    const badge = document.createElement('div');
    badge.className = 'launcherBadge';
    badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16v12H4z"></path><path d="M9 9l6 3-6 3V9z" fill="currentColor" stroke="none"></path></svg><span>Animação</span>';
    thumb.appendChild(badge);
  }

  const meta = document.createElement('div');
  meta.className = 'launcherMeta';

  const name = document.createElement('div');
  name.className = 'launcherName';
  name.textContent = project.name || 'Novo Projeto';

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'launcherMenuBtn';
  menuBtn.title = 'Ações';
  menuBtn.textContent = '⋯';

  meta.appendChild(name);
  meta.appendChild(menuBtn);
  card.appendChild(thumb);
  card.appendChild(meta);

  card.addEventListener('click', e => {
    if (e.target.closest('.launcherMenuBtn') || e.target.closest('.launcherMenu')) return;
    openProject(project.id);
  });
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleCardMenu(card, project);
  });

  return card;
}

async function refreshProjectList() {
  ensureUi();
  if (!ui.grid) return;
  closeMenu();
  ui.grid.innerHTML = '';
  const projects = await listProjects().catch(() => []);
  if (!projects.length) {
    const empty = document.createElement('div');
    empty.className = 'launcherEmpty';
    empty.innerHTML = '<div><div class="launcherEmptyTitle">Nenhum projeto ainda</div><div class="launcherEmptyText">Crie um projeto para começar.</div></div>';
    ui.grid.appendChild(empty);
    return;
  }
  projects.forEach(project => ui.grid.appendChild(buildCard(project)));
}

async function openProject(id) {
  const project = await loadProject(id).catch(() => null);
  if (!project) return;
  await saveCurrentProject();
  setActiveProject(project.id, project.name);
  showEditorShell();
  closeLauncherSettings();
  launcherVisible = false;
  if (ui.root) ui.root.style.display = 'none';
  setProjectTitle(project.name);
  await _applyProjectData(project.data || makeEmptyProjectData());
  try { window.dispatchEvent(new CustomEvent('project-opened', { detail: { id: project.id, name: project.name } })); } catch {}
}

async function createNewProject() {
  const name = prompt('Nome do projeto:', 'Novo Projeto');
  if (name === null) return;
  const cleanName = name.trim() || 'Novo Projeto';
  await saveCurrentProject();
  const id = await createProject(cleanName);
  setActiveProject(id, cleanName);
  showEditorShell();
  closeLauncherSettings();
  launcherVisible = false;
  if (ui.root) ui.root.style.display = 'none';
  setProjectTitle(cleanName);
  await _applyProjectData(makeEmptyProjectData());
  await saveCurrentProject();
  await refreshProjectList();
}

async function renameProjectFlow(id, currentName) {
  const next = prompt('Novo nome do projeto:', currentName || 'Projeto');
  if (next === null) return;
  const clean = next.trim();
  if (!clean) return;
  await renameProject(id, clean).catch(() => false);
  if (id === activeProjectId) {
    setActiveProject(id, clean);
    setProjectTitle(clean);
  }
  await refreshProjectList();
}

async function duplicateProjectFlow(id) {
  await duplicateProject(id).catch(() => null);
  await refreshProjectList();
}

async function deleteProjectFlow(id, name) {
  const ok = confirm(`Excluir o projeto "${name || 'Projeto'}"?`);
  if (!ok) return;
  await deleteProject(id).catch(() => false);
  if (id === activeProjectId) {
    setActiveProject(null, null);
    showLauncher();
  } else {
    await refreshProjectList();
  }
}

async function showLauncher() {
  ensureUi();
  launcherVisible = true;
  hideEditorShell();
  if (ui.root) ui.root.style.display = 'flex';
  setProjectTitle('Projetos');
  await refreshProjectList();
}

async function hideLauncher() {
  ensureUi();
  launcherVisible = false;
  showEditorShell();
  if (ui.root) ui.root.style.display = 'none';
}

function wireEvents() {
  ensureUi();
  if (!ui.root || ui.root.dataset.wired === '1') return;
  ui.root.dataset.wired = '1';
  ui.newBtn?.addEventListener('click', createNewProject);
  ui.settingsBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = launcherSettingsMenu && !launcherSettingsMenu.classList.contains('hidden');
    isOpen ? closeLauncherSettings() : openLauncherSettings();
  });
  ui.refreshBtn?.addEventListener('click', refreshProjectList);
  ui.backBtn?.addEventListener('click', hideLauncher);

  document.addEventListener('click', e => {
    if (menuOpenEl && !e.target.closest('.launcherMenu') && !e.target.closest('.launcherMenuBtn')) closeMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menuOpenEl) closeMenu();
  });

  window.addEventListener('beforeunload', () => { saveCurrentProject(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveCurrentProject();
  });

  window.setInterval(() => {
    if (!launcherVisible) saveCurrentProject();
  }, 60000);
}

function boot() {
  if (booted) return;
  booted = true;
  ensureUi();
  wireEvents();
  showLauncher();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

window.addEventListener('_nexusEngineReady', () => {
  if (!launcherVisible) showLauncher();
});

window.NCMLauncher = {
  show: () => showLauncher(),
  hide: () => hideLauncher(),
  refresh: refreshProjectList,
  autosave: saveCurrentProject,
  openProject,
};
