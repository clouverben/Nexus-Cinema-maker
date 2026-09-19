import { app, markSceneDirty, updateInfiniteGrid } from './scene.js';
import { syncRenderTargets, renderFrame } from './posprocess.js';
import { tickShaderSystem } from './ShaderEffectManager.js';
import { tickDomain } from './DomainManager.js';
import { updateViewportGizmo } from './viewportGizmo.js';

let running      = false;
let _lastLabTick = 0;
let _lastShaderTick = 0;
let _lastFrameErrorLog = 0;

export function startRenderLoop() {
  if (running) return;
  running = true;

  const tick = (timestamp) => {
    requestAnimationFrame(tick);

    // ── Pause while video export is capturing frames ────────────
    // videoexport.js sets window._exportPaused = true so it can
    // call renderer.render() directly without race conditions.
    if (window._exportPaused) return;

    // ── WebGL context currently lost — see scene.js's
    // webglcontextlost/webglcontextrestored handlers. Nothing GPU-related
    // is safe to touch until the browser restores it; just wait.
    if (app.contextLost) return;

    try {
      if (app.controls)    app.controls.update();
      if (app.boneUpdateFn) app.boneUpdateFn();
      if (app.simUpdateFn)  app.simUpdateFn();

      // ── Grid shader camera-position uniform (drives distance fade) ──
      updateInfiniteGrid();

      // ── Procedural Shader / Domain system tick ───────────────────
      // (grid/axes/gizmo are untouched — this only ever touches app.objects
      // and materials that opted into an effect, see ShaderEffectManager.js / DomainManager.js / EffectLibrary.js / OutlineShell.js)
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
        if (window._nexusAuraLab) window._nexusAuraLab.update(dt);
        markSceneDirty();
      }

      // ── Animation system tick ───────────────────────────────────
      if (window.AnimationSystem?.isPlaying?.()) {
        window.AnimationSystem.update(timestamp || performance.now());
        markSceneDirty();
      }

      // ── 2D orientation gizmo (top-right of viewport) ─────────────
      updateViewportGizmo();

      syncRenderTargets();
      renderFrame();
    } catch (err) {
      // A frame that throws used to leave the canvas showing whatever half-
      // drawn/cleared state it was in (often just the clear color — the
      // "piscando cinza" gray flicker), and if the same broken state
      // persisted, it re-threw on every subsequent frame forever with
      // nothing ever reaching the screen again. requestAnimationFrame is
      // already re-queued above, so the loop itself survives either way —
      // this just also (a) doesn't spam the console every single frame and
      // (b) attempts a bare-bones direct render as a fallback, so a broken
      // post-processing pass degrades to "plain scene, no effects" instead
      // of "frozen".
      const now = timestamp || performance.now();
      if (now - _lastFrameErrorLog > 2000) {
        console.error('[render] Frame falhou; usando render simples neste frame:', err);
        _lastFrameErrorLog = now;
      }
      try {
        if (app.renderer && app.scene && app.camera && !app.contextLost) {
          app.renderer.setRenderTarget(null);
          app.renderer.render(app.scene, app.camera);
        }
      } catch { /* genuinely nothing safe to draw this frame — skip it */ }
    }
  };

  // Move requestAnimationFrame to TOP of tick so it always re-queues
  // even if an exception is thrown inside the body (avoids loop death).
  tick(performance.now());
}
