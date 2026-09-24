/* NCM Desktop UI shell state. Keeps the visual title/status chrome synced
   with the existing project event system without changing scene behaviour. */
(() => {
  const title = () => document.querySelector('#pcWorkspaceTitle .pcTitleProject');
  const mode = () => document.querySelector('#pcWorkspaceTitle .pcTitleMode');

  function setTitle(name) {
    const el = title();
    if (!el) return;
    el.textContent = String(name || 'Cena sem nome').trim() || 'Cena sem nome';
  }

  function setMode(value) {
    const el = mode();
    if (!el) return;
    el.textContent = String(value || 'Editor');
  }

  function syncMode() {
    if (document.body.classList.contains('labs-preview-mode')) return setMode('Particle Preview');
    if (document.getElementById('labsLeftPanel') && !document.getElementById('labsLeftPanel').classList.contains('hidden')) return setMode('Labs');
    const timeline = document.getElementById('animLeftPanel');
    if (timeline && !timeline.classList.contains('hidden')) return setMode('Animation');
    setMode('Editor');
  }

  window.addEventListener('project-opened', e => {
    setTitle(e.detail?.name || 'Cena sem nome');
    syncMode();
  });
  window.addEventListener('_labsModeChange', syncMode);
  window.addEventListener('_animModeChange', syncMode);
  window.addEventListener('_labsForceExitPreview', syncMode);

  document.addEventListener('DOMContentLoaded', () => {
    setTitle('Cena sem nome');
    syncMode();
  });
})();
