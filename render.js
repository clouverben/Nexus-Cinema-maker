import { app, markSceneDirty, updateInfiniteGrid } from './scene.js';
import { syncRenderTargets, renderFrame } from './posprocess.js';
import { tickShaderSystem } from './shader-system/ShaderEffectManager.js';
import { tickDomain } from './shader-system/DomainManager.js';

let running      = false;
let _lastLabTick = 0;
let _lastShaderTick = 0;

export function startRenderLoop() {
  if (running) return;
  running = true;

  const tick = (timestamp) => {
    requestAnimationFrame(tick);

    // ── Pause while video export is capturing frames ────────────
    // videoexport.js sets window._exportPaused = true so it can
    // call renderer.render() directly without race conditions.
    if (window._exportPaused) return;

    if (app.controls)    app.controls.update();
    if (app.boneUpdateFn) app.boneUpdateFn();
    if (app.simUpdateFn)  app.simUpdateFn();

    // ── Grid shader camera-position uniform (drives distance fade) ──
    updateInfiniteGrid();

    // ── Procedural Shader / Domain system tick ───────────────────
    // (grid/axes/gizmo are untouched — this only ever touches app.objects
    // and materials that opted into an effect, see shader-system/*)
    {
      const now = timestamp || performance.now();
      const dt  = _lastShaderTick > 0 ? Math.min((now - _lastShaderTick) / 1000, 0.1) : 0.016;
      _lastShaderTick = now;
      tickShaderSystem(dt);
      tickDomain();
    }

    // ── Particle Labs tick ──────────────────────────────────────
    if (window._nexusParticleLab) {
      const now = timestamp || performance.now();
      const dt  = _lastLabTick > 0
        ? Math.min((now - _lastLabTick) / 1000, 0.1)
        : 0.016;
      _lastLabTick = now;
      window._nexusParticleLab.update(dt);
      markSceneDirty();
    }

    // ── Animation system tick ───────────────────────────────────
    if (window.AnimationSystem?.isPlaying?.()) {
      window.AnimationSystem.update(timestamp || performance.now());
      markSceneDirty();
    }

    syncRenderTargets();
    renderFrame();
  };

  // Move requestAnimationFrame to TOP of tick so it always re-queues
  // even if an exception is thrown inside the body (avoids loop death).
  tick(performance.now());
}
