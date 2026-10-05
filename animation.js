```javascript
// ==================== ANIMATION.JS (animacao_app port) ====================
// Per-object timeline: showing only selected object's keyframes
// Dope Sheet · Graph Editor · Onion Skin · Marcadores · Loop Region · Auto-Key · Catmull-Rom Splines

import * as THREE from 'three';
import { helperRegistry, setSelected, markSceneDirty } from './scene.js';

export const AnimState = {
    visible: false, isPlaying: false, currentFrame: 0, frameExact: 0,
    fps: 24, keyframes: {}, lastTimestamp: null,
    interpMode: 'smooth', selectedKF: null, copiedKF: null,
    markers: {},
    clips: {},              // { [objUUID]: [ {id,name,duration}, ... ] }  ★ múltiplos clipes por objeto
    activeClip: {},         // { [objUUID]: clipId }  — clipe sendo editado/exibido
    playbackSpeed: 1,       // multiplicador de velocidade do preview (não afeta export/fps real)
    bitDepth: 24,           // "Bits" no painel Settings — profundidade de cor/qualidade p/ export futuro
    importLibrary: [],      // [ {id, rootUuid, rootName, clip}, ... ]
    selectedImportId: null,
};

const DopeSheetState = { visible: false };
const GraphEdState   = { visible: true, channels: new Set(['px','py','pz']) };
const OnionState     = { panelVisible: false, enabled: false, framesBefore: 2, framesAfter: 2, opacity: 0.35, ghosts: [] };
const MarkerState    = { visible: false };
const LoopState      = { visible: false, enabled: false, inFrame: 0, outFrame: 100 };
const AutoKeyState   = { enabled: false };
const PathState      = { enabled: false, lineObj: null, dots: [] };
const MoreMenuState  = { visible: false };

// Frame width set to 6px (2x more compact horizontally)
const FRAME_WIDTH = 6;

// ── Scene helpers ────────────────────────────────────────────────────────────
function _scene()  { return window._app?.scene; }
function _camera() { return window._app?.camera; }

let _uuidCache = null;
function _isAttachedToScene(obj, scene) {
    let n = obj;
    while (n) { if (n === scene) return true; n = n.parent; }
    return false;
}
function findObjectByUUID(uuid) {
    const s = _scene(); if (!s) return null;
    if (!_uuidCache) { _uuidCache = new Map(); s.traverse(o => _uuidCache.set(o.uuid, o)); }
    let obj = _uuidCache.get(uuid);
    if (obj && !_isAttachedToScene(obj, s)) obj = undefined;
    if (obj === undefined) {
        obj = s.getObjectByProperty('uuid', uuid) ?? null;
        _uuidCache.set(uuid, obj);
    }
    return obj;
}

function getActiveObject() { return window.activeObject ?? null; }

// ==================== CLIPS ====================
function _clipId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function peekClips(uuid)          { return (uuid && AnimState.clips[uuid]) || []; }
function peekActiveClipId(uuid)   { return uuid ? (AnimState.activeClip[uuid] || null) : null; }
function peekActiveClip(uuid) {
    const id = peekActiveClipId(uuid);
    return id ? peekClips(uuid).find(c => c.id === id) || null : null;
}
function peekClipKFs(uuid, clipId) { return (uuid && clipId && AnimState.keyframes[uuid]?.[clipId]) || {}; }
function peekActiveClipKFs(uuid)   { return peekClipKFs(uuid, peekActiveClipId(uuid)); }
function getClipMaxFrame(uuid, clipId) {
    const kfs = peekClipKFs(uuid, clipId);
    return Object.keys(kfs).reduce((m, f) => Math.max(m, parseInt(f)), 0);
}

function createNewClip(uuid) {
    if (!AnimState.clips[uuid]) AnimState.clips[uuid] = [];
    const id = _clipId();
    const n  = AnimState.clips[uuid].length + 1;
    AnimState.clips[uuid].push({ id, name: `Clip ${n}`, duration: Math.max(1, Math.round(AnimState.fps * 2)) });
    if (!AnimState.keyframes[uuid]) AnimState.keyframes[uuid] = {};
    AnimState.keyframes[uuid][id] = {};
    AnimState.activeClip[uuid] = id;
    markSceneDirty();
    return id;
}

function deleteClip(uuid, clipId) {
    if (!uuid || !clipId || !AnimState.clips[uuid]) return false;
    const idx = AnimState.clips[uuid].findIndex(c => c.id === clipId);
    if (idx < 0) return false;
    AnimState.clips[uuid].splice(idx, 1);
    if (AnimState.keyframes[uuid]) delete AnimState.keyframes[uuid][clipId];
    if (AnimState.activeClip[uuid] === clipId) {
        const remaining = AnimState.clips[uuid];
        AnimState.activeClip[uuid] = remaining.length
            ? remaining[Math.min(idx, remaining.length - 1)].id
            : null;
    }
    if (AnimState.selectedKF?.uuid === uuid && AnimState.selectedKF?.clipId === clipId) {
        AnimState.selectedKF = null;
    }
    markSceneDirty();
    return true;
}

function ensureActiveClipId(uuid) {
    if (!AnimState.clips[uuid] || !AnimState.clips[uuid].length) return createNewClip(uuid);
    if (!AnimState.activeClip[uuid]) AnimState.activeClip[uuid] = AnimState.clips[uuid][0].id;
    return AnimState.activeClip[uuid];
}

function setActiveClip(uuid, clipId) {
    AnimState.activeClip[uuid] = clipId;
    markSceneDirty();
    refreshDiamonds(); renderClipsSection(); buildRuler(); refreshAnimSidebar();
    if (DopeSheetState.visible) renderDopeSheet();
    if (GraphEdState.visible)   renderGraphEditor();
    if (PathState.enabled)      updateMotionPath();
}

// ==================== UI ====================
function createTimelineUI() {
    if (document.getElementById('timeline-container')) return;
    const container = document.createElement('div');
    container.id = 'timeline-container';
    container.innerHTML = `
        <!-- KF Toolbar -->
        <div id="kf-toolbar" class="kf-toolbar hidden">
            <span class="kf-toolbar-label">KF <span id="kf-toolbar-frame">—</span></span>
            <button id="kf-copy-btn"   class="kf-tool-btn">Copiar</button>
            <button id="kf-paste-btn"  class="kf-tool-btn" style="display:none">Colar</button>
            <button id="kf-delete-btn" class="kf-tool-btn kf-delete-btn">Eliminar</button>
        </div>

        <!-- Dope Sheet -->
        <div id="dopesheet-panel" class="tl-tool-panel hidden">
            <div class="tl-tool-header">
                <svg viewBox="0 0 16 16" width="11" height="11"><rect x="1" y="2" width="14" height="3" rx="1" fill="currentColor" opacity=".6"/><rect x="1" y="7" width="14" height="3" rx="1" fill="currentColor" opacity=".4"/><rect x="1" y="12" width="14" height="3" rx="1" fill="currentColor" opacity=".3"/></svg>
                TRACK <span style="opacity:.45;font-weight:500">· Dope Sheet</span>
                <span class="tl-tool-hint">Clique = seek · Duplo = selecionar KF</span>
                <button class="tl-tool-close" id="dopesheet-close"><svg viewBox="0 0 16 16" width="9" height="9"><path d="M2 2l12 12M14 2 2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div class="dopesheet-body" id="dopesheet-body">
                <div class="dopesheet-empty">Nenhum keyframe ainda.</div>
            </div>
        </div>

        <!-- Onion Skin -->
        <div id="onion-panel" class="tl-tool-panel tl-panel-small hidden">
            <div class="tl-tool-header">
                <svg viewBox="0 0 16 16" width="11" height="11"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.2" fill="none" opacity=".6"/><circle cx="8" cy="8" r="1.2" fill="currentColor" opacity=".5"/></svg>
                Onion Skin
                <button class="tl-tool-close" id="onion-close"><svg viewBox="0 0 16 16" width="9" height="9"><path d="M2 2l12 12M14 2 2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div class="onion-body">
                <div class="onion-row"><label class="onion-label">Ativado</label><label class="onion-switch"><input type="checkbox" id="onion-enabled"><span class="onion-slider"></span></label></div>
                <div class="onion-row"><label class="onion-label" style="color:#6ec6ff">Antes</label><input type="range" id="onion-before" min="1" max="6" value="2" class="onion-range"><span id="onion-before-val" class="onion-val">2</span></div>
                <div class="onion-row"><label class="onion-label" style="color:#ffb347">Depois</label><input type="range" id="onion-after"  min="1" max="6" value="2" class="onion-range"><span id="onion-after-val"  class="onion-val">2</span></div>
                <div class="onion-row"><label class="onion-label">Opacidade</label><input type="range" id="onion-opacity" min="5" max="80" value="35" class="onion-range"><span id="onion-opacity-val" class="onion-val">35%</span></div>
            </div>
        </div>

        <!-- Marcadores -->
        <div id="marker-panel" class="tl-tool-panel hidden">
            <div class="tl-tool-header">
                <svg viewBox="0 0 16 16" width="11" height="11"><path d="M4 2h8v9l-4 3-4-3z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
                Marcadores
                <span class="tl-tool-hint">M = adicionar no frame atual</span>
                <button class="tl-tool-close" id="marker-close"><svg viewBox="0 0 16 16" width="9" height="9"><path d="M2 2l12 12M14 2 2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div class="marker-body">
                <div class="marker-add-row">
                    <input type="text" id="marker-label-input" class="marker-input" placeholder="Nome do marcador…" maxlength="24">
                    <button id="marker-add-btn" class="marker-add-btn"><svg viewBox="0 0 16 16" width="9" height="9"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
                </div>
                <div id="marker-list" class="marker-list"><div class="dopesheet-empty">Nenhum marcador.</div></div>
            </div>
        </div>

        <!-- Loop Region -->
        <div id="loop-panel" class="tl-tool-panel tl-panel-small hidden">
            <div class="tl-tool-header">
                <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3 8a5 5 0 1 1 2 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><polyline points="3,4 3,8 7,8" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
                Loop Region
                <button class="tl-tool-close" id="loop-close"><svg viewBox="0 0 16 16" width="9" height="9"><path d="M2 2l12 12M14 2 2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div class="loop-body">
                <div class="loop-row"><label class="loop-label">Ativado</label><label class="onion-switch"><input type="checkbox" id="loop-enabled"><span class="onion-slider"></span></label></div>
                <div class="loop-row"><label class="loop-label" style="color:#6ec6ff">In</label><input type="number" id="loop-in" class="loop-num-input" value="0" min="0"><button id="loop-in-set" class="loop-set-btn">Usar atual</button></div>
                <div class="loop-row"><label class="loop-label" style="color:#ffb347">Out</label><input type="number" id="loop-out" class="loop-num-input" value="100" min="0"><button id="loop-out-set" class="loop-set-btn">Usar atual</button></div>
            </div>
        </div>

        <!-- Auto-Key -->
        <div id="autokey-panel" class="tl-tool-panel tl-panel-small hidden">
            <div class="tl-tool-header">
                <svg viewBox="0 0 16 16" width="11" height="11"><rect x="2" y="4" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="13" cy="7" r="2.5" stroke="currentColor" stroke-width="1.4" fill="none"/><line x1="13" y1="9.5" x2="13" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>
                Auto-Key
                <button class="tl-tool-close" id="autokey-close"><svg viewBox="0 0 16 16" width="9" height="9"><path d="M2 2l12 12M14 2 2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div class="autokey-body">
                <div class="onion-row">
                    <label class="onion-label">Ativado</label>
                    <label class="onion-switch"><input type="checkbox" id="autokey-enabled"><span class="onion-slider"></span></label>
                    <span id="autokey-status" class="autokey-status">OFF</span>
                </div>
                <div class="autokey-hint">Ao mover/rotar/escalar com o gizmo, um KF é inserido automaticamente.</div>
            </div>
        </div>

        <!-- ═══ TOOLBAR ROW ═══ -->
        <div class="tl-toolbar-row">
            <div class="tl-timebox" title="Tempo atual">
                <span id="tl-timecode">00:00.000</span>
            </div>
            <div class="tl-framebox" title="Frame atual / duração do clipe">
                <span id="tl-frame-current">0</span><span class="tl-frame-sep">/</span><span id="tl-frame-total">48</span>
            </div>

            <div class="tl-sep"></div>

            <button id="tl-tostart-btn" class="tl-btn" title="Ir para o início">
                <svg viewBox="0 0 16 16" width="9" height="9"><path d="M3.4 2.5v11M13 2.5 5 8l8 5.5z" fill="currentColor"/></svg>
            </button>
            <button id="tl-play-btn" class="tl-btn tl-play" title="Play / Pause (Espaço)">
                <span id="tl-play-icon"><svg viewBox="0 0 16 16" width="9" height="9"><path d="M4 2.3v11.4L13.5 8z" fill="currentColor"/></svg></span>
            </button>
            <button id="tl-toend-btn" class="tl-btn" title="Ir para o fim">
                <svg viewBox="0 0 16 16" width="9" height="9"><path d="M12.6 2.5v11M3 2.5l8 5.5-8 5.5z" fill="currentColor"/></svg>
            </button>

            <div class="tl-sep"></div>

            <button id="tl-track-btn" class="tl-pill tl-pill-track" title="Track / Dope Sheet (D)">
                <svg viewBox="0 0 16 16" width="9" height="9"><rect x="1" y="2.5" width="14" height="2.4" rx="1" fill="currentColor" opacity=".9"/><rect x="1" y="6.8" width="14" height="2.4" rx="1" fill="currentColor" opacity=".6"/><rect x="1" y="11.1" width="14" height="2.4" rx="1" fill="currentColor" opacity=".4"/></svg>
                <span>TRACK</span>
            </button>
            <button id="tl-add-kf-btn" class="tl-pill tl-pill-kf" title="Adicionar Keyframe (K)">
                <svg viewBox="0 0 16 16" width="7" height="7"><rect x="3.4" y="3.4" width="9.2" height="9.2" rx="1.6" transform="rotate(45 8 8)" fill="currentColor"/></svg>
                <span>Add KF</span>
            </button>
            <div class="tl-sep"></div>

            <button id="tl-autokey-btn" class="tl-pill tl-pill-autokey" title="Auto-Key (A)">
                <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none"/></svg>
                <span>AUTO-KEY</span>
            </button>
            <button id="tl-path-btn" class="tl-pill tl-pill-path" title="Mostrar caminho de movimento do objeto selecionado">
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 13c2-1 2-4.5 4-5.5s2 3.5 4 2.5 2-5.5 4-5.5"/><circle cx="2" cy="13" r="1.3" fill="currentColor" stroke="none"/><circle cx="14" cy="4.5" r="1.3" fill="currentColor" stroke-none"/></svg>
                <span>PATH</span>
            </button>

            <div class="tl-sep"></div>

            <button id="tl-speed-btn" class="tl-pill tl-pill-speed" title="Velocidade de reprodução (preview)">1x</button>
            <button id="tl-more-btn" class="tl-btn" title="Mais ferramentas">
                <svg viewBox="0 0 16 16" width="10" height="10"><circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>
            </button>

            <!-- Menu "mais" -->
            <div id="more-menu-panel" class="tl-more-menu hidden">
                <button id="tl-onion-btn" class="tl-more-item" title="Onion Skin (O)">
                    <svg viewBox="0 0 16 16" width="12" height="12"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.2" fill="none" opacity=".55"/></svg>
                    <span>Onion Skin</span>
                </button>
                <button id="tl-marker-btn" class="tl-more-item" title="Marcadores (M)">
                    <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2h8v9l-4 3-4-3z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
                    <span>Marcadores</span>
                </button>
                <button id="tl-loop-btn" class="tl-more-item" title="Loop Region (L)">
                    <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8a5 5 0 1 1 2 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><polyline points="3,4 3,8 7,8" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
                    <span>Loop Region</span>
                </button>
            </div>
        </div>

        <!-- ═══ CLIPS ═══ -->
        <div class="tl-clips-section">
            <div class="tl-clips-header">CLIPS</div>

            <!-- Mini ruler row without useless left spacer -->
            <div class="tl-mini-ruler-row">
                <div class="timeline-track-wrapper">
                    <div id="timeline-track" class="timeline-track">
                        <div id="timeline-frames" class="timeline-frames">
                            <div id="timeline-ruler"        class="timeline-ruler"></div>
                            <div id="timeline-loop-overlay" class="timeline-loop-overlay" style="display:none"></div>
                            <div id="timeline-markers"      class="timeline-markers"></div>
                        </div>
                        <div id="timeline-playhead" class="timeline-playhead"><div class="tl-playhead-flag"></div></div>
                    </div>
                </div>
            </div>

            <div class="tl-clips-body">
                <div class="tl-clips-sidebar">
                    <button id="tl-addclip-btn" class="tl-clips-sidebtn" title="Criar um novo clipe no objeto selecionado">+ Add Clip</button>
                    <div id="tl-clips-list" class="tl-clips-list"></div>
                </div>
                <div class="tl-clips-track-wrapper">
                    <div id="tl-clips-track" class="tl-clips-track">
                        <div id="tl-clips-playhead" class="tl-clips-playhead"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    container.style.display = 'none';
    document.body.appendChild(container);
    mountAnimSidebarExtras();
    buildRuler();
    setupEvents();
    injectStyles();
}

function mountAnimSidebarExtras() {
    const fpsMount = document.getElementById('animFpsMount');
    if (fpsMount && !document.getElementById('fps-panel')) {
        fpsMount.innerHTML = `
            <div class="fps-panel anim-embedded" id="fps-panel">
                <label class="fps-label">Interpolação de novas keyframes</label>
                <div class="interp-btns">
                    <button id="interp-smooth-btn"   class="interp-btn active">
                        <svg viewBox="0 0 22 10" width="18" height="8"><path d="M1 9 C6 9 8 1 11 1 S16 1 21 1" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>Suave
                    </button>
                    <button id="interp-linear-btn"   class="interp-btn">
                        <svg viewBox="0 0 22 10" width="18" height="8"><line x1="1" y1="9" x2="21" y2="1" stroke="currentColor" stroke-width="1.8"/></svg>Linear
                    </button>
                    <button id="interp-constant-btn" class="interp-btn">
                        <svg viewBox="0 0 22 10" width="18" height="8"><polyline points="1,9 11,9 11,1 21,1" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>Constante
                    </button>
                </div>
            </div>`;
    }
    const graphMount = document.getElementById('animGraphMount');
    if (graphMount && !document.getElementById('graph-panel')) {
        graphMount.innerHTML = `
            <div id="graph-panel" class="tl-tool-panel anim-embedded">
                <div class="tl-tool-header">
                    <svg viewBox="0 0 16 16" width="11" height="11"><polyline points="1,14 5,8 9,11 15,2" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>
                    Graph Editor
                    <div class="graph-channel-toggles" id="graph-channel-toggles">
                        <button data-ch="px" class="ch-btn active" style="--ch-color:#ff5f5f">PX</button>
                        <button data-ch="py" class="ch-btn active" style="--ch-color:#5fff8a">PY</button>
                        <button data-ch="pz" class="ch-btn active" style="--ch-color:#5faeff">PZ</button>
                        <button data-ch="rx" class="ch-btn" style="--ch-color:#ffb347">RX</button>
                        <button data-ch="ry" class="ch-btn" style="--ch-color:#e0a0ff">RY</button>
                        <button data-ch="rz" class="ch-btn" style="--ch-color:#00e5d4">RZ</button>
                        <button data-ch="sx" class="ch-btn" style="--ch-color:#ffe066">SX</button>
                        <button data-ch="sy" class="ch-btn" style="--ch-color:#ff91d4">SY</button>
                        <button data-ch="sz" class="ch-btn" style="--ch-color:#c0ff80">SZ</button>
                    </div>
                </div>
                <div class="graph-body" id="graph-body"><canvas id="graph-canvas"></canvas></div>
            </div>`;
    }
}

// ==================== ESTILOS (2X MENOR & CLIPS FULL-WIDTH) ====================
function injectStyles() {
    if (document.getElementById('_anim_css')) return;
    const s = document.createElement('style');
    s.id = '_anim_css';
    s.textContent = `
#timeline-container {
    --tl-clips-sidebar-w: 70px;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 200;
    background: rgba(6,8,20,.98);
    border-top: 1px solid rgba(255,255,255,.1);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    user-select: none;
    overflow: visible;
    display: flex;
    flex-direction: column;
}
#timeline-container, #timeline-container * {
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
}
#timeline-container button,
#timeline-container input,
#timeline-container [tabindex] {
    outline: none;
    -webkit-user-select: none;
}
#timeline-container button:focus,
#timeline-container button:focus-visible,
#timeline-container input:focus { outline: none; box-shadow: none; }

.tl-toolbar-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 4px;
    height: 22px;
    flex-shrink: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
}
.tl-toolbar-row::-webkit-scrollbar { display: none; }

.tl-sep { width: 1px; height: 12px; background: rgba(255,255,255,.1); margin: 0 1px; flex-shrink: 0; }

.tl-timebox, .tl-framebox {
    flex-shrink: 0;
    display: flex; align-items: center;
    height: 17px; padding: 0 5px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,.11);
    background: rgba(18,21,30,.82);
    font-family: var(--font-mono, 'JetBrains Mono'), 'Courier New', monospace;
    font-size: 9px; font-weight: 700;
    color: rgba(255,255,255,.85);
    white-space: nowrap;
}
.tl-framebox { color: rgba(255,255,255,.55); font-weight: 600; }
.tl-frame-sep { margin: 0 1px; color: rgba(255,255,255,.25); }
#tl-frame-current { color: rgba(255,255,255,.85); }

.tl-btn {
    flex-shrink: 0;
    width: 18px; height: 18px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.05);
    color: rgba(255,255,255,.7);
    cursor: pointer;
    font-size: 9px;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s, color .15s;
}
.tl-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
.tl-btn.active { background: rgba(255,255,255,.16); border-color: rgba(255,255,255,.3); color: #fff; }
.tl-btn.playing { background: rgba(76,239,172,.15); border-color: rgba(76,239,172,.4); color: #4cefac; }

.tl-pill {
    flex-shrink: 0;
    display: flex; align-items: center; gap: 2px;
    height: 17px; padding: 0 5px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,.11);
    background: rgba(255,255,255,.05);
    color: rgba(255,255,255,.6);
    font-size: 8.5px; font-weight: 700; letter-spacing: .1px;
    white-space: nowrap;
    cursor: pointer;
    transition: background .15s, color .15s;
}
.tl-pill:hover { background: rgba(255,255,255,.11); color: #fff; }
.tl-pill.active { background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.3); color: #fff; }

.tl-pill-track { color: #7fd4ff; border-color: rgba(76,200,255,.3); }
.tl-pill-track:hover, .tl-pill-track.active { background: rgba(76,200,255,.16); border-color: rgba(76,200,255,.5); color: #4cc8ff; }

.tl-pill-kf { color: #ffd95c; border-color: rgba(255,217,92,.3); }
.tl-pill-kf:hover { background: rgba(255,217,92,.12); border-color: rgba(255,217,92,.5); }

.tl-pill-autokey { color: var(--accent-amber, #ffd032); border-color: rgba(255,208,50,.4); background: rgba(255,208,50,.06); }
.tl-pill-autokey:hover { background: rgba(255,208,50,.14); }
.tl-pill-autokey.autokey-on { background: rgba(255,60,60,.18) !important; border-color: rgba(255,80,80,.55) !important; color: #ff7070 !important; }

.tl-pill-path { color: #ffb14a; border-color: rgba(255,177,74,.35); }
.tl-pill-path:hover { background: rgba(255,177,74,.14); border-color: rgba(255,177,74,.55); }
.tl-pill-path.active { background: rgba(255,177,74,.2); border-color: rgba(255,177,74,.6); color: #ffd6a3; }

.tl-pill-speed { min-width: 20px; justify-content: center; color: rgba(255,255,255,.55); }

.tl-more-menu {
    position: absolute; top: calc(100% + 2px); right: 6px;
    display: flex; flex-direction: column; gap: 2px;
    background: rgba(8,10,22,.98);
    border: 1px solid rgba(255,255,255,.14);
    border-radius: 6px;
    padding: 3px;
    box-shadow: 0 6px 18px rgba(0,0,0,.5);
    z-index: 300;
    min-width: 120px;
}
.tl-more-menu.hidden { display: none !important; }
.tl-more-item {
    display: flex; align-items: center; gap: 5px;
    padding: 4px 6px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: rgba(255,255,255,.65);
    font-size: 10px; font-weight: 600;
    cursor: pointer; text-align: left;
    transition: background .15s, color .15s;
}
.tl-more-item:hover { background: rgba(255,255,255,.08); color: #fff; }
.tl-more-item.active { background: rgba(76,200,255,.14); color: #4cc8ff; }

.kf-flash { animation: _kfFlash .35s ease-out; }
@keyframes _kfFlash { 0%,100%{transform:scale(1)} 50%{transform:scale(1.25);color:#fff;} }

.tl-mini-ruler-row { display: flex; align-items: stretch; height: 10px; margin-bottom: 2px; flex-shrink: 0; }
.timeline-track-wrapper { flex: 1; min-width: 0; overflow: hidden; }
.timeline-track {
    position: relative;
    height: 100%;
    overflow-x: auto; overflow-y: hidden;
    scrollbar-width: none;
    cursor: pointer;
    background: transparent;
    border: none;
    border-bottom: 1px solid rgba(255,255,255,.08);
}
.timeline-track::-webkit-scrollbar { display: none; }
.timeline-frames { position: absolute; top: 0; bottom: 0; min-width: 100%; }
.timeline-ruler { position: absolute; top: 0; left: 0; height: 9px; pointer-events: none; }
.ruler-tick { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.07); }
.ruler-tick-major { background: rgba(255,255,255,.2); }
.ruler-label { position: absolute; top: 0px; left: 2px; font-size: 7px; color: rgba(255,255,255,.32); font-family: var(--font-mono, 'JetBrains Mono'), monospace; white-space: nowrap; }
.timeline-playhead {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: rgba(255,80,80,.9);
    box-shadow: 0 0 4px rgba(255,80,80,.6);
    pointer-events: none; z-index: 10;
}
.tl-playhead-flag {
    position: absolute; top: -1px; left: -3px;
    width: 0; height: 0;
    border-left: 4px solid rgba(255,80,80,.95);
    border-top: 4px solid rgba(255,80,80,.95);
    border-bottom: 4px solid transparent;
    border-radius: 0 1px 1px 0;
}
.timeline-markers { position: absolute; top: 0; bottom: 0; left: 0; pointer-events: none; z-index: 2; }
.tl-marker-pin { position: absolute; top: 0; bottom: 0; width: 1px; background: #ffdd55; cursor: pointer; }
.tl-marker-pin::after { content: attr(data-label); position: absolute; top: 1px; left: 2px; font-size: 7px; color: #ffdd55; white-space: nowrap; font-family: var(--font-mono, 'JetBrains Mono'), monospace; pointer-events: none; }
.timeline-loop-overlay { position: absolute; top: 0; bottom: 0; background: rgba(76,200,255,.08); border-left: 1px solid rgba(76,200,255,.4); border-right: 1px solid rgba(255,180,60,.4); pointer-events: none; z-index: 1; }

.tl-clips-section { flex-shrink: 0; padding: 0 4px 4px; }
.tl-clips-header {
    height: 10px; display: flex; align-items: center;
    padding: 0 4px;
    border-radius: 4px 4px 0 0;
    background: rgba(230,150,60,.28);
    color: #ffe4c2;
    font-size: 8px; font-weight: 800; letter-spacing: .5px;
}
.tl-clips-body { display: flex; align-items: stretch; gap: 4px; height: 24px; }
.tl-clips-sidebar {
    width: var(--tl-clips-sidebar-w, 70px); flex-shrink: 0;
    display: flex; flex-direction: column; gap: 2px;
    padding-top: 2px;
    border-radius: 0 0 0 4px;
    background: rgba(255,255,255,.03);
    overflow: hidden;
}
.tl-clips-sidebtn {
    flex-shrink: 0;
    height: 12px; margin: 0 2px;
    border-radius: 3px;
    border: 1px solid rgba(255,177,74,.3);
    background: rgba(255,177,74,.08);
    color: #ffb14a;
    font-size: 7.5px; font-weight: 700;
    cursor: pointer; transition: background .15s;
    line-height: 12px; padding: 0 2px;
}
.tl-clips-sidebtn:hover { background: rgba(255,177,74,.18); }
.tl-clips-list { flex: 1; min-height: 0; overflow-y: auto; }
.tl-clips-list .dopesheet-empty { padding: 2px 4px; font-size: 7.5px; }
.tl-clip-entry {
    display: flex; align-items: center; gap: 3px;
    padding: 1px 4px;
    font-size: 7.5px; color: rgba(255,255,255,.5);
    cursor: pointer;
    border-left: 2px solid transparent;
}
.tl-clip-entry:hover { background: rgba(255,255,255,.05); color: #fff; }
.tl-clip-entry.active { background: rgba(255,177,74,.12); border-left-color: #ffb14a; color: #ffe4c2; }
.tl-clip-entry .tl-clip-dot { width: 3px; height: 3px; border-radius: 50%; background: #ffb14a; flex-shrink: 0; }
.tl-clip-entry .tl-clip-entry-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-clip-entry .tl-clip-entry-dur { color: rgba(255,255,255,.3); flex-shrink: 0; }

.tl-clips-track-wrapper { flex: 1; min-width: 0; overflow: hidden; border-radius: 0 4px 4px 0; }
.tl-clips-track {
    position: relative;
    height: 100%;
    overflow: auto;
    scrollbar-width: none;
    cursor: pointer;
    background: rgba(0,0,0,.35);
    border: 1px solid rgba(255,255,255,.07);
    padding: 1px 0;
}
.tl-clips-track::-webkit-scrollbar { display: none; }
.tl-clip-row { position: relative; height: 18px; margin-bottom: 1px; }
.tl-clip-row:last-child { margin-bottom: 0; }
.tl-clip-block {
    position: absolute; top: 1px; bottom: 1px; left: 2px;
    width: calc(100% - 4px);
    border-radius: 3px;
    background: rgba(90,92,101,.55);
    border: 1px solid rgba(150,152,164,.5);
    display: flex; align-items: center;
    padding: 0 6px;
    overflow: hidden;
    min-width: calc(100% - 4px);
}
.tl-clip-block.active { background: rgba(255,177,74,.38); border-color: #ffb14a; }
.tl-clip-block-label { font-size: 7.5px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.5); white-space: nowrap; }
.tl-clip-kf-dot {
    position: absolute; top: 50%; width: 5px; height: 5px;
    transform: translate(-50%,-50%) rotate(45deg);
    background: #ffd95c;
    border: 1px solid rgba(0,0,0,.4);
    cursor: pointer;
    transition: transform .1s;
    z-index: 5;
}
.tl-clip-kf-dot:hover { transform: translate(-50%,-50%) rotate(45deg) scale(1.35); background: #ffec99; }
.tl-clip-kf-dot.kf-selected {
    outline: 1.5px solid #ff3333;
    outline-offset: 1px;
    box-shadow: 0 0 0 2px rgba(255,50,50,.35), 0 0 6px rgba(255,217,92,.8);
    z-index: 20;
}
.tl-clips-playhead {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: rgba(255,80,80,.9);
    pointer-events: none; z-index: 10;
}
.fps-panel {
    position: absolute; bottom: 100%; left: 8px;
    background: rgba(8,10,22,.98);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 6px;
    padding: 6px 8px;
    display: flex; align-items: center; gap: 6px;
    flex-wrap: wrap;
    backdrop-filter: blur(16px);
    box-shadow: 0 -4px 16px rgba(0,0,0,.5);
    z-index: 300;
}
.fps-panel.hidden { display: none !important; }
.fps-label { font-size: 10px; color: rgba(255,255,255,.5); }
.fps-panel input[type=number] {
    width: 44px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
    color: #ddd; border-radius: 4px; padding: 2px 5px; font-size: 10px;
}
.fps-panel button { padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(76,239,172,.3); background: rgba(76,239,172,.1); color: #4cefac; cursor: pointer; font-size: 10px; }
.interp-btns { display: flex; gap: 3px; }
.interp-btn { display: flex; align-items: center; gap: 3px; padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: rgba(255,255,255,.55); font-size: 10px; cursor: pointer; transition: all .15s; }
.interp-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
.interp-btn.active { background: rgba(76,239,172,.15); border-color: rgba(76,239,172,.45); color: #4cefac; }

.kf-toolbar { position: absolute; top: -32px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 3px; background: rgba(10,12,26,.98); border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 3px 6px; backdrop-filter: blur(12px); box-shadow: 0 4px 12px rgba(0,0,0,.5); white-space: nowrap; z-index: 300; pointer-events: all; }
.kf-toolbar.hidden { display: none !important; }
.kf-toolbar-label { font-size: 10px; color: rgba(255,255,255,.45); font-family: var(--font-mono, 'JetBrains Mono'), monospace; margin-right: 2px; }
.kf-tool-btn { display: flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05); color: rgba(255,255,255,.7); font-size: 10px; cursor: pointer; transition: all .15s; }
.kf-tool-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
.kf-delete-btn:hover { background: rgba(255,60,60,.15); border-color: rgba(255,80,80,.4); color: #ff8888; }

.tl-tool-panel { position: absolute; left: 0; right: 0; bottom: 100%; background: rgba(8,10,22,.97); border-top: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(16px); z-index: 200; box-shadow: 0 -4px 20px rgba(0,0,0,.6); }
.tl-tool-panel.hidden { display: none !important; }
.tl-panel-small { left: auto; right: 0; width: 220px; border-radius: 6px 6px 0 0; border: 1px solid rgba(255,255,255,.1); }
.tl-tool-header { display: flex; align-items: center; gap: 5px; padding: 4px 8px; background: rgba(255,255,255,.03); border-bottom: 1px solid rgba(255,255,255,.07); font-size: 10.5px; font-weight: 600; color: rgba(255,255,255,.75); }
.tl-tool-hint { font-size: 9px; color: rgba(255,255,255,.3); font-weight: 400; margin-left: 2px; flex: 1; }
.tl-tool-close { margin-left: auto; background: none; border: none; color: rgba(255,255,255,.35); cursor: pointer; font-size: 11px; padding: 1px 4px; border-radius: 3px; transition: all .15s; }
.tl-tool-close:hover { background: rgba(255,80,80,.15); color: #ff8888; }

.dopesheet-body { height: 100px; overflow: auto; display: flex; flex-direction: column; }
.dopesheet-empty { padding: 10px 12px; font-size: 10px; color: rgba(255,255,255,.25); font-style: italic; }
.ds-row { display: flex; align-items: stretch; border-bottom: 1px solid rgba(255,255,255,.05); min-height: 20px; }
.ds-row:hover { background: rgba(255,255,255,.03); }
.ds-name { width: 90px; flex-shrink: 0; padding: 0 8px; display: flex; align-items: center; font-size: 10px; color: rgba(255,255,255,.55); border-right: 1px solid rgba(255,255,255,.07); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ds-track { flex: 1; position: relative; overflow: hidden; }
.ds-diamond { position: absolute; top: 50%; transform: translate(-50%,-50%) rotate(45deg); width: 6px; height: 6px; background: #ffd95c; border: 1px solid rgba(255,255,255,.3); cursor: pointer; transition: transform .1s; }
.ds-diamond:hover { transform: translate(-50%,-50%) rotate(45deg) scale(1.4); }
.ds-playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,80,80,.6); pointer-events: none; }

.graph-channel-toggles { display: flex; gap: 2px; margin-left: 4px; flex: 1; flex-wrap: wrap; }
.ch-btn { padding: 1px 5px; border-radius: 3px; font-size: 9px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: rgba(255,255,255,.4); cursor: pointer; font-family: var(--font-mono, 'JetBrains Mono'), monospace; transition: all .15s; }
.ch-btn.active { background: color-mix(in srgb, var(--ch-color) 18%, transparent); border-color: color-mix(in srgb, var(--ch-color) 55%, transparent); color: var(--ch-color); }
.graph-body { height: 140px; position: relative; overflow: hidden; }
#graph-canvas { width: 100%; height: 100%; display: block; }

.onion-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.onion-row  { display: flex; align-items: center; gap: 6px; }
.onion-label{ font-size: 10px; color: rgba(255,255,255,.55); width: 60px; flex-shrink: 0; }
.onion-val  { font-size: 10px; font-family: var(--font-mono, 'JetBrains Mono'), monospace; color: rgba(255,255,255,.5); width: 26px; text-align: right; flex-shrink: 0; }
.onion-range{ flex: 1; accent-color: #4cc8ff; cursor: pointer; }
.onion-switch { position: relative; display: inline-block; width: 30px; height: 16px; }
.onion-switch input { opacity: 0; width: 0; height: 0; }
.onion-slider { position: absolute; inset: 0; background: rgba(255,255,255,.1); border-radius: 16px; cursor: pointer; transition: .2s; }
.onion-slider::before { content: ''; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px; background: rgba(255,255,255,.5); border-radius: 50%; transition: .2s; }
.onion-switch input:checked + .onion-slider { background: rgba(76,200,255,.35); }
.onion-switch input:checked + .onion-slider::before { transform: translateX(14px); background: #4cc8ff; }

.marker-body { padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
.marker-add-row { display: flex; gap: 4px; align-items: center; }
.marker-input { flex: 1; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: #fff; border-radius: 4px; padding: 2px 6px; font-size: 10px; }
.marker-input::placeholder { color: rgba(255,255,255,.3); }
.marker-add-btn { padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(76,200,255,.35); background: rgba(76,200,255,.12); color: #4cc8ff; font-size: 12px; cursor: pointer; }
.marker-list { max-height: 80px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.marker-item { display: flex; align-items: center; gap: 4px; padding: 2px 4px; border-radius: 3px; background: rgba(255,255,255,.04); cursor: pointer; }
.marker-item:hover { background: rgba(255,255,255,.08); }
.marker-color { width: 6px; height: 6px; border-radius: 50%; background: #ffdd55; flex-shrink: 0; }
.marker-frame { font-size: 9px; color: rgba(255,255,255,.4); font-family: var(--font-mono, 'JetBrains Mono'), monospace; min-width: 30px; }
.marker-name  { font-size: 10px; color: rgba(255,255,255,.75); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.marker-del   { background: none; border: none; color: rgba(255,80,80,.5); cursor: pointer; font-size: 10px; padding: 0 2px; }
.marker-del:hover { color: #ff5555; }

.loop-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.loop-row   { display: flex; align-items: center; gap: 6px; }
.loop-label { font-size: 10px; color: rgba(255,255,255,.55); width: 24px; flex-shrink: 0; }
.loop-num-input { width: 50px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: #fff; border-radius: 4px; padding: 2px 5px; font-size: 10px; font-family: var(--font-mono, 'JetBrains Mono'), monospace; }
.loop-set-btn { padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: rgba(255,255,255,.6); font-size: 9px; cursor: pointer; }
.loop-set-btn:hover { background: rgba(255,255,255,.12); color: #fff; }

.autokey-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.autokey-hint { font-size: 9.5px; color: rgba(255,255,255,.35); line-height: 1.4; }
.autokey-status { font-size: 9px; font-family: var(--font-mono, 'JetBrains Mono'), monospace; color: rgba(255,80,80,.6); margin-left: auto; }

.tl-flash-msg { position: fixed; bottom: 48px; left: 50%; transform: translateX(-50%); background: rgba(8,10,22,.97); border: 1px solid rgba(255,255,255,.14); color: rgba(255,255,255,.75); padding: 4px 12px; border-radius: 5px; font-size: 11px; font-weight: 600; z-index: 9999; pointer-events: none; opacity: 0; transition: opacity .2s; }
.tl-flash-msg.visible { opacity: 1; }
    `;
    document.head.appendChild(s);
}

// ==================== RÉGUA ====================
function formatTimecode(frame) {
    const fps = Math.max(1, AnimState.fps || 24);
    const totalMs = Math.max(0, (frame / fps) * 1000);
    const mm = Math.floor(totalMs / 60000);
    const ss = Math.floor((totalMs % 60000) / 1000);
    const ms = Math.floor(totalMs % 1000);
    return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

function buildRuler() {
    const ruler = document.getElementById('timeline-ruler'); if (!ruler) return;
    ruler.innerHTML = '';
    const framesEl = document.getElementById('timeline-frames');
    const fps   = Math.max(1, AnimState.fps || 24);
    const end   = Math.max(currentRulerEnd(), fps);
    const total = end + fps;
    if (framesEl) framesEl.style.width = (total * FRAME_WIDTH) + 'px';

    const frag = document.createDocumentFragment();
    const addTick = (f, major, label) => {
        const tick = document.createElement('div');
        tick.className = 'ruler-tick' + (major ? ' ruler-tick-major' : '');
        tick.style.left = (f * FRAME_WIDTH) + 'px';
        if (label != null) {
            const lbl = document.createElement('span');
            lbl.className = 'ruler-label';
            lbl.textContent = label;
            tick.appendChild(lbl);
        }
        frag.appendChild(tick);
    };
    for (let s = 0; s * fps <= total; s++) {
        addTick(s * fps, true, s + 's');
        const half = s * fps + fps / 2;
        if (half <= total) addTick(half, false, null);
    }
    ruler.appendChild(frag);

    const totalEl = document.getElementById('tl-frame-total');
    if (totalEl) totalEl.textContent = Math.round(end);
}

// ==================== PLAYHEAD ====================
let _heavyPanelThrottle = 0;
const HEAVY_PANEL_EVERY_N_FRAMES = 3;

function updatePlayhead() {
    const playhead   = document.getElementById('timeline-playhead');
    const track      = document.getElementById('timeline-track');
    const timecodeEl = document.getElementById('tl-timecode');
    const frameCurEl = document.getElementById('tl-frame-current');
    const clipsPh    = document.getElementById('tl-clips-playhead');
    if (!playhead || !track) return;
    const x = AnimState.currentFrame * FRAME_WIDTH;
    playhead.style.left = x + 'px';
    if (clipsPh) clipsPh.style.left = x + 'px';
    const tw = track.clientWidth, sl = track.scrollLeft, mg = 40;
    if (x < sl + mg) track.scrollLeft = Math.max(0, x - mg);
    else if (x > sl + tw - mg) track.scrollLeft = x - tw + mg;
    if (timecodeEl) timecodeEl.textContent = formatTimecode(AnimState.currentFrame);
    if (frameCurEl) frameCurEl.textContent = AnimState.currentFrame;

    const runHeavy = !AnimState.isPlaying || (++_heavyPanelThrottle % HEAVY_PANEL_EVERY_N_FRAMES === 0);
    if (runHeavy) {
        if (DopeSheetState.visible) renderDopeSheet();
        if (GraphEdState.visible)   renderGraphEditor();
        if (OnionState.enabled)     updateOnionGhosts();
    }
    updateLoopOverlay();
}

// ==================== KF SELECTION ====================
function selectKF(uuid, clipId, frame) {
    AnimState.selectedKF = { uuid, clipId, frame };
    renderClipsSection(); refreshAnimSidebar();
    const tb = document.getElementById('kf-toolbar');
    if (tb) {
        tb.classList.remove('hidden');
        const lbl = document.getElementById('kf-toolbar-frame');
        if (lbl) lbl.textContent = frame;
        const pb = document.getElementById('kf-paste-btn');
        if (pb) pb.style.display = AnimState.copiedKF ? '' : 'none';
    }
}
function deselectKF() {
    AnimState.selectedKF = null;
    renderClipsSection(); refreshAnimSidebar();
    document.getElementById('kf-toolbar')?.classList.add('hidden');
}

function refreshDiamonds() {
    renderClipsSection();
}

// ==================== ADD KF ====================
function resolveAnimTarget(obj) {
    if (!obj) return null;
    if (obj.userData?.isBoneMarker && obj.userData?.boneRef) {
        return obj.userData.boneRef;
    }
    return obj;
}

function addKeyframe() {
    const raw = getActiveObject();
    if (!raw) { flashMessage('Selecione um objeto primeiro'); return; }
    const obj    = resolveAnimTarget(raw);
    const uuid   = obj.uuid;
    const clipId = ensureActiveClipId(uuid);
    const frame  = AnimState.currentFrame;
    const isBone = obj.isBone;

    const kfs = peekClipKFs(uuid, clipId);
    kfs[frame] = {
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z, order: obj.rotation.order },
        scale:    { x: obj.scale.x,    y: obj.scale.y,    z: obj.scale.z },
        interp:   AnimState.interpMode,
        isBone,
        parentSkinnedMeshUUID: isBone ? _findSkinnedMeshForBone(obj) : null,
    };
    const clip = AnimState.clips[uuid]?.find(c => c.id === clipId);
    if (clip && frame > clip.duration) clip.duration = frame + Math.round(AnimState.fps);
    markSceneDirty();
    buildRuler();
    refreshDiamonds();
    flashKFButton();
    renderClipsSection();
    refreshAnimSidebar();
    if (PathState.enabled) updateMotionPath();
}

function copySelectedKF() {
    const sel = AnimState.selectedKF; if (!sel) return;
    const kf = AnimState.keyframes[sel.uuid]?.[sel.clipId]?.[sel.frame]; if (!kf) return;
    AnimState.copiedKF = JSON.parse(JSON.stringify(kf));
    flashMessage(`Copiado: frame ${sel.frame}`);
    const p = document.getElementById('kf-paste-btn'); if (p) p.style.display = '';
}

function pasteKF() {
    if (!AnimState.copiedKF) return;
    const raw = getActiveObject();
    if (!raw) { flashMessage('Selecione um objeto para colar'); return; }
    const obj    = resolveAnimTarget(raw);
    const uuid   = obj.uuid;
    const clipId = ensureActiveClipId(uuid);
    const frame  = AnimState.currentFrame;
    peekClipKFs(uuid, clipId)[frame] = JSON.parse(JSON.stringify(AnimState.copiedKF));
    const clip = AnimState.clips[uuid]?.find(c => c.id === clipId);
    if (clip && frame > clip.duration) clip.duration = frame + Math.round(AnimState.fps);
    markSceneDirty();
    buildRuler();
    refreshDiamonds();
    flashMessage(`Colado no frame ${frame}`);
    renderClipsSection();
    refreshAnimSidebar();
}

function deleteSelectedKF() {
    const sel = AnimState.selectedKF; if (!sel) return;
    const clipKFs = AnimState.keyframes[sel.uuid]?.[sel.clipId];
    if (clipKFs) delete clipKFs[sel.frame];
    markSceneDirty();
    deselectKF();
    flashMessage('Keyframe eliminado');
    renderClipsSection();
    if (PathState.enabled) updateMotionPath();
}

function flashKFButton() {
    const btn = document.getElementById('tl-add-kf-btn'); if (!btn) return;
    btn.classList.add('kf-flash');
    setTimeout(() => btn.classList.remove('kf-flash'), 400);
}

function flashMessage(msg) {
    let el = document.getElementById('tl-flash-msg');
    if (!el) { el = document.createElement('div'); el.id = 'tl-flash-msg'; el.className = 'tl-flash-msg'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), 2000);
}

// ==================== PATH GENERATORS ====================
const PATH_TYPE_META = {
    circular: { label: 'Circular Path', defaultFrames: fps => Math.max(1, Math.round(fps * 2)) },
    jitter:   { label: 'Shake',         defaultFrames: fps => Math.max(1, Math.round(fps)) },
    linear:   { label: 'Custom Path',   defaultFrames: fps => Math.max(1, Math.round(fps)) },
};

function pathConfigTemplate(type) {
    const fps        = Math.max(1, Math.round(AnimState.fps));
    const startFrame = AnimState.currentFrame;
    if (type === 'circular') return `
        <div class="gridForm">
            <label><span>Raio</span><input type="number" id="pathCircRadius" min="0.1" step="0.1" value="3"></label>
            <label><span>Voltas</span><input type="number" id="pathCircLoops" min="1" max="20" step="1" value="1"></label>
            <label><span>Segmentos</span><input type="number" id="pathCircSegments" min="3" max="64" step="1" value="24"></label>
            <label><span>Duração (frames)</span><input type="number" id="pathCircDuration" min="1" step="1" value="${fps * 2}"></label>
            <label><span>Frame inicial</span><input type="number" id="pathCircStartFrame" min="0" step="1" value="${startFrame}"></label>
        </div>
        <div class="sectionTitle">Plano</div>
        <div class="animToggleBtns" id="pathCircPlane">
            <button type="button" class="animToggleBtn active" data-val="xz">XZ</button>
            <button type="button" class="animToggleBtn" data-val="xy">XY</button>
            <button type="button" class="animToggleBtn" data-val="yz">YZ</button>
        </div>
        <div class="sectionTitle">Sentido</div>
        <div class="animToggleBtns" id="pathCircDir">
            <button type="button" class="animToggleBtn active" data-val="ccw">Anti-horário</button>
            <button type="button" class="animToggleBtn" data-val="cw">Horário</button>
        </div>
        <button type="button" class="animPathAddBtn" id="animPathAddBtn">+ Adicionar ao objeto</button>`;
    if (type === 'jitter') return `
        <div class="gridForm">
            <label><span>Amplitude</span><input type="number" id="pathJitAmp" min="0.01" step="0.01" value="0.15"></label>
            <label><span>Frequência (kf/s)</span><input type="number" id="pathJitFreq" min="1" max="30" step="1" value="10"></label>
            <label><span>Duração (frames)</span><input type="number" id="pathJitDuration" min="1" step="1" value="${fps}"></label>
            <label><span>Frame inicial</span><input type="number" id="pathJitStartFrame" min="0" step="1" value="${startFrame}"></label>
        </div>
        <div class="sectionTitle">Eixos afetados</div>
        <div class="animToggleBtns" id="pathJitAxes">
            <button type="button" class="animToggleBtn active" data-val="x">X</button>
            <button type="button" class="animToggleBtn active" data-val="y">Y</button>
            <button type="button" class="animToggleBtn active" data-val="z">Z</button>
        </div>
        <button type="button" class="animPathAddBtn" id="animPathAddBtn">+ Adicionar ao objeto</button>`;
    if (type === 'linear') return `
        <div class="gridForm">
            <label><span>Deslocamento X</span><input type="number" id="pathLinDX" step="0.1" value="2"></label>
            <label><span>Deslocamento Y</span><input type="number" id="pathLinDY" step="0.1" value="0"></label>
            <label><span>Deslocamento Z</span><input type="number" id="pathLinDZ" step="0.1" value="0"></label>
            <label><span>Duração (frames)</span><input type="number" id="pathLinDuration" min="1" step="1" value="${fps}"></label>
            <label><span>Frame inicial</span><input type="number" id="pathLinStartFrame" min="0" step="1" value="${startFrame}"></label>
            <label class="checkField"><span>Ida e volta</span><input type="checkbox" id="pathLinRoundTrip"></label>
        </div>
        <button type="button" class="animPathAddBtn" id="animPathAddBtn">+ Adicionar ao objeto</button>`;
    return '';
}

function wireToggleGroup(containerId, multi) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.addEventListener('click', e => {
        const btn = e.target.closest('.animToggleBtn'); if (!btn) return;
        if (multi) {
            btn.classList.toggle('active');
        } else {
            el.querySelectorAll('.animToggleBtn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
    });
}
function toggleGroupValue(containerId) {
    return document.getElementById(containerId)?.querySelector('.animToggleBtn.active')?.dataset.val ?? null;
}
function toggleGroupValues(containerId) {
    return Array.from(document.getElementById(containerId)?.querySelectorAll('.animToggleBtn.active') ?? []).map(b => b.dataset.val);
}

function openAnimPathMenu(type) {
    const menu     = document.getElementById('animPathMenu');
    const backdrop = document.getElementById('animPathMenuBackdrop');
    const body     = document.getElementById('animPathMenuBody');
    const titleEl  = document.getElementById('animPathMenuTitle');
    if (!menu || !backdrop || !body) return;
    titleEl.textContent = `Configurar ${PATH_TYPE_META[type]?.label ?? 'Path'}`;
    body.innerHTML = `<div class="setSection">${pathConfigTemplate(type)}</div>`;
    menu.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    if (type === 'circular') { wireToggleGroup('pathCircPlane', false); wireToggleGroup('pathCircDir', false); }
    if (type === 'jitter')   { wireToggleGroup('pathJitAxes', true); }
    document.getElementById('animPathAddBtn')?.addEventListener('click', () => { handleAddPath(type); closeAnimPathMenu(); });
}

function closeAnimPathMenu() {
    document.getElementById('animPathMenu')?.classList.add('hidden');
    document.getElementById('animPathMenuBackdrop')?.classList.add('hidden');
}

function initAnimPathMenuDrag() {
    const menu = document.getElementById('animPathMenu');
    const head = document.getElementById('animPathMenuHeader');
    if (!menu || !head || head.dataset.dragWired) return;
    head.dataset.dragWired = '1';
    let dragging = false, offX = 0, offY = 0;
    head.addEventListener('pointerdown', e => {
        dragging = true;
        head.setPointerCapture(e.pointerId);
        const rect = menu.getBoundingClientRect();
        offX = e.clientX - rect.left; offY = e.clientY - rect.top;
        menu.style.transition = 'none';
    });
    head.addEventListener('pointermove', e => {
        if (!dragging) return;
        const maxX = window.innerWidth  - menu.offsetWidth  - 6;
        const maxY = window.innerHeight - menu.offsetHeight - 6;
        menu.style.left = Math.min(Math.max(6, e.clientX - offX), maxX) + 'px';
        menu.style.top  = Math.min(Math.max(6, e.clientY - offY), maxY) + 'px';
        menu.style.right = 'auto'; menu.style.bottom = 'auto';
        menu.style.transform = 'none';
    });
    head.addEventListener('pointerup',     () => { dragging = false; });
    head.addEventListener('pointercancel', () => { dragging = false; });
}

function _writePathKeyframe(uuid, clipId, frame, position, rotation, scale, interp) {
    peekClipKFs(uuid, clipId)[frame] = {
        position: { ...position }, rotation: { ...rotation }, scale: { ...scale },
        interp, isBone: false, parentSkinnedMeshUUID: null,
    };
}
function _growClipDuration(uuid, clipId, lastFrame) {
    const clip = AnimState.clips[uuid]?.find(c => c.id === clipId);
    if (clip && lastFrame > clip.duration) clip.duration = lastFrame + Math.round(AnimState.fps);
    markSceneDirty();
}

function generateCircularPath(obj) {
    const uuid = obj.uuid, clipId = ensureActiveClipId(uuid);
    const radius     = Math.max(0.001, parseFloat(document.getElementById('pathCircRadius')?.value) || 3);
    const loops      = Math.max(1, parseInt(document.getElementById('pathCircLoops')?.value)         || 1);
    let   segments   = Math.max(3, parseInt(document.getElementById('pathCircSegments')?.value)      || 24);
    const duration   = Math.max(1, parseInt(document.getElementById('pathCircDuration')?.value)      || 48);
    const startFrame = Math.max(0, parseInt(document.getElementById('pathCircStartFrame')?.value)    || 0);
    const plane = toggleGroupValue('pathCircPlane') || 'xz';
    const dir   = toggleGroupValue('pathCircDir') === 'cw' ? -1 : 1;

    let totalSteps = segments * loops;
    if (totalSteps > 240) { segments = Math.max(3, Math.floor(240 / loops)); totalSteps = segments * loops; flashMessage('Segmentos reduzidos para manter a performance'); }

    const rot = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z, order: obj.rotation.order };
    const scl = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };
    const p   = { x: obj.position.x, y: obj.position.y, z: obj.position.z };

    let aKey, bKey;
    if (plane === 'xy')      { aKey = 'x'; bKey = 'y'; }
    else if (plane === 'yz') { aKey = 'y'; bKey = 'z'; }
    else                     { aKey = 'x'; bKey = 'z'; }
    const centerA = p[aKey] - radius, centerB = p[bKey];

    for (let i = 0; i <= totalSteps; i++) {
        const t     = i / totalSteps;
        const angle = dir * t * loops * Math.PI * 2;
        const frame = Math.round(startFrame + t * duration);
        const pos   = { ...p };
        pos[aKey] = centerA + radius * Math.cos(angle);
        pos[bKey] = centerB + radius * Math.sin(angle);
        _writePathKeyframe(uuid, clipId, frame, pos, rot, scl, 'smooth');
    }
    _growClipDuration(uuid, clipId, startFrame + duration);
    return totalSteps + 1;
}

function generateJitterPath(obj) {
    const uuid = obj.uuid, clipId = ensureActiveClipId(uuid);
    const amp        = Math.max(0, parseFloat(document.getElementById('pathJitAmp')?.value)     || 0.15);
    const freq       = Math.max(1, parseInt(document.getElementById('pathJitFreq')?.value)       || 10);
    const duration   = Math.max(1, parseInt(document.getElementById('pathJitDuration')?.value)   || 24);
    const startFrame = Math.max(0, parseInt(document.getElementById('pathJitStartFrame')?.value) || 0);
    const axes = toggleGroupValues('pathJitAxes');

    const rot  = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z, order: obj.rotation.order };
    const scl  = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };
    const base = { x: obj.position.x, y: obj.position.y, z: obj.position.z };

    const stepFrames = Math.max(1, Math.round(AnimState.fps / freq));
    const endFrame   = startFrame + duration;
    const frames = [];
    for (let f = startFrame; f < endFrame; f += stepFrames) frames.push(f);
    frames.push(endFrame);
    const uniqueFrames = [...new Set(frames)];

    uniqueFrames.forEach((frame, idx) => {
        const isEdge = idx === 0 || idx === uniqueFrames.length - 1;
        const pos = { ...base };
        if (!isEdge && axes.length) axes.forEach(ax => { pos[ax] = base[ax] + (Math.random() * 2 - 1) * amp; });
        _writePathKeyframe(uuid, clipId, frame, pos, rot, scl, 'linear');
    });
    _growClipDuration(uuid, clipId, endFrame);
    return uniqueFrames.length;
}

function generateLinearPath(obj) {
    const uuid = obj.uuid, clipId = ensureActiveClipId(uuid);
    const dx = parseFloat(document.getElementById('pathLinDX')?.value) || 0;
    const dy = parseFloat(document.getElementById('pathLinDY')?.value) || 0;
    const dz = parseFloat(document.getElementById('pathLinDZ')?.value) || 0;
    const duration   = Math.max(1, parseInt(document.getElementById('pathLinDuration')?.value)   || 24);
    const startFrame = Math.max(0, parseInt(document.getElementById('pathLinStartFrame')?.value) || 0);
    const roundTrip  = !!document.getElementById('pathLinRoundTrip')?.checked;

    const rot   = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z, order: obj.rotation.order };
    const scl   = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };
    const start = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    const end   = { x: start.x + dx, y: start.y + dy, z: start.z + dz };

    _writePathKeyframe(uuid, clipId, startFrame, start, rot, scl, 'linear');
    _writePathKeyframe(uuid, clipId, startFrame + duration, end, rot, scl, 'linear');
    let count = 2, lastFrame = startFrame + duration;
    if (roundTrip) {
        _writePathKeyframe(uuid, clipId, startFrame + duration * 2, start, rot, scl, 'linear');
        count = 3; lastFrame = startFrame + duration * 2;
    }
    _growClipDuration(uuid, clipId, lastFrame);
    return count;
}

function handleAddPath(type) {
    const raw = getActiveObject();
    if (!raw) { flashMessage('Selecione um objeto primeiro'); return; }
    const obj = resolveAnimTarget(raw);
    let count = 0;
    if (type === 'circular')      count = generateCircularPath(obj);
    else if (type === 'jitter')   count = generateJitterPath(obj);
    else if (type === 'linear')   count = generateLinearPath(obj);
    if (!count) return;
    buildRuler(); refreshDiamonds(); renderClipsSection(); refreshAnimSidebar();
    if (GraphEdState.visible) renderGraphEditor();
    if (PathState.enabled)    updateMotionPath();
    flashMessage(`Path ${PATH_TYPE_META[type].label} adicionado (${count} keyframes)`);
}

function initAnimDefaultClipsUI() {
    document.querySelectorAll('.animDefaultClipItem').forEach(btn => {
        btn.addEventListener('click', () => openAnimPathMenu(btn.dataset.pathType));
    });
    document.getElementById('animPathMenuClose')?.addEventListener('click', closeAnimPathMenu);
    document.getElementById('animPathMenuBackdrop')?.addEventListener('click', closeAnimPathMenu);
    initAnimPathMenuDrag();
}

function renderAnimDefaultClipDurations() {
    const fps = Math.max(1, Math.round(AnimState.fps || 24));
    document.querySelectorAll('.animDefaultClipDur').forEach(el => {
        const type = el.dataset.durType;
        const meta = PATH_TYPE_META[type];
        el.textContent = (meta ? meta.defaultFrames(fps) : fps) + 'f';
    });
}

// ==================== INTERPOLAÇÃO ====================
function catmullRom1D(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
}
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }
function applyInterp(rawT, mode) {
    const t = Math.max(0, Math.min(1, rawT));
    if (mode === 'constant') return 0;
    if (mode === 'linear')   return t;
    return easeInOutCubic(t);
}

const _sortedFramesCache = new WeakMap();
function _getSortedFrames(objKFs) {
    const cached = _sortedFramesCache.get(objKFs);
    const keys = Object.keys(objKFs);
    if (cached && cached.count === keys.length) return cached.frames;
    const frames = keys.map(Number).sort((a, b) => a - b);
    _sortedFramesCache.set(objKFs, { count: keys.length, frames });
    return frames;
}

function getInterpolatedKF(uuid, clipId, frame) {
    const objKFs = AnimState.keyframes[uuid]?.[clipId]; if (!objKFs) return null;
    const frames = _getSortedFrames(objKFs);
    if (!frames.length) return null;

    let prevIndex = -1, nextIndex = -1;
    for (let i = 0; i < frames.length; i++) {
        if (frames[i] <= frame) prevIndex = i;
        if (frames[i] >= frame && nextIndex === -1) nextIndex = i;
    }

    if (prevIndex === -1) return { ...objKFs[frames[0]] };
    if (nextIndex === -1 || prevIndex === nextIndex) return { ...objKFs[frames[prevIndex]] };

    const f1 = frames[prevIndex];
    const f2 = frames[nextIndex];
    const A = objKFs[f1];
    const B = objKFs[f2];
    const mode = A.interp || AnimState.interpMode;

    if (mode === 'constant') return { ...A };

    const rawT = (frame - f1) / (f2 - f1);
    const clampedT = Math.max(0, Math.min(1, rawT));

    let pos = { x: 0, y: 0, z: 0 };

    if (mode === 'smooth') {
        const idx0 = Math.max(0, prevIndex - 1);
        const idx3 = Math.min(frames.length - 1, nextIndex + 1);

        const P0 = objKFs[frames[idx0]];
        const P3 = objKFs[frames[idx3]];

        pos = {
            x: catmullRom1D(P0.position.x, A.position.x, B.position.x, P3.position.x, clampedT),
            y: catmullRom1D(P0.position.y, A.position.y, B.position.y, P3.position.y, clampedT),
            z: catmullRom1D(P0.position.z, A.position.z, B.position.z, P3.position.z, clampedT)
        };
    } else {
        const t = applyInterp(rawT, mode);
        pos = {
            x: lerp(A.position.x, B.position.x, t),
            y: lerp(A.position.y, B.position.y, t),
            z: lerp(A.position.z, B.position.z, t)
        };
    }

    const tEased = applyInterp(rawT, mode);
    return {
        position: pos,
        rotation: {
            x: lerp(A.rotation.x, B.rotation.x, tEased),
            y: lerp(A.rotation.y, B.rotation.y, tEased),
            z: lerp(A.rotation.z, B.rotation.z, tEased),
            order: A.rotation.order
        },
        scale: {
            x: lerp(A.scale.x, B.scale.x, tEased),
            y: lerp(A.scale.y, B.scale.y, tEased),
            z: lerp(A.scale.z, B.scale.z, tEased)
        },
        interp: A.interp,
        isBone: A.isBone,
        parentSkinnedMeshUUID: A.parentSkinnedMeshUUID
    };
}

function _findSkinnedMeshForBone(bone) {
    const scene = _scene(); if (!scene) return null;
    let uuid = null;
    scene.traverse(o => { if (o.isSkinnedMesh && o.skeleton?.bones.includes(bone)) uuid = o.uuid; });
    return uuid;
}
function _getSkinnedMeshByUUID(uuid) {
    if (!uuid) return null;
    return findObjectByUUID(uuid);
}

function applyKFData(obj, kf) {
    obj.position.set(kf.position.x, kf.position.y, kf.position.z);
    obj.rotation.set(kf.rotation.x, kf.rotation.y, kf.rotation.z, kf.rotation.order ?? 'XYZ');
    obj.scale.set(kf.scale.x, kf.scale.y, kf.scale.z);
}

function applyKeyframesAtFrame(frame) {
    const skinnedMeshesToUpdate = new Set();

    Object.keys(AnimState.clips).forEach(uuid => {
        const clipId = AnimState.activeClip[uuid]; if (!clipId) return;
        const objKFs = AnimState.keyframes[uuid]?.[clipId]; if (!objKFs) return;
        const obj = findObjectByUUID(uuid); if (!obj) return;
        
        const kfInterp = getInterpolatedKF(uuid, clipId, frame);
        if (kfInterp) {
            applyKFData(obj, kfInterp);
            if (kfInterp.isBone || obj.isBone) {
                const smUUID = kfInterp.parentSkinnedMeshUUID;
                if (smUUID) skinnedMeshesToUpdate.add(smUUID);
            }
        }
    });

    skinnedMeshesToUpdate.forEach(smUUID => {
        const sm = _getSkinnedMeshByUUID(smUUID);
        if (sm?.skeleton) sm.skeleton.update();
    });
}

function currentRulerEnd() {
    const obj = resolveAnimTarget(getActiveObject());
    if (obj) { const c = peekActiveClip(obj.uuid); if (c) return Math.max(c.duration, Math.round(AnimState.fps)); }
    return Math.round(AnimState.fps * 4);
}

// ==================== SEEK / PLAY ====================
function seekFrame(frame) {
    AnimState.frameExact = Math.max(0, frame);
    AnimState.currentFrame = Math.round(AnimState.frameExact);
    applyKeyframesAtFrame(AnimState.frameExact);
    updatePlayhead();
}
function jumpToStart() { seekFrame(0); }
function jumpToEnd()   { seekFrame(currentRulerEnd()); }

const _PLAY_ICON  = '<svg viewBox="0 0 16 16" width="9" height="9"><path d="M4 2.3v11.4L13.5 8z" fill="currentColor"/></svg>';
const _PAUSE_ICON = '<svg viewBox="0 0 16 16" width="9" height="9"><rect x="3.2" y="2.3" width="3.2" height="11.4" rx="1" fill="currentColor"/><rect x="9.6" y="2.3" width="3.2" height="11.4" rx="1" fill="currentColor"/></svg>';
function play()  { AnimState.isPlaying = true;  AnimState.lastTimestamp = null; const i = document.getElementById('tl-play-icon'); if (i) i.innerHTML = _PAUSE_ICON; document.getElementById('tl-play-btn')?.classList.add('playing'); }
function pause() { AnimState.isPlaying = false; const i = document.getElementById('tl-play-icon'); if (i) i.innerHTML = _PLAY_ICON;  document.getElementById('tl-play-btn')?.classList.remove('playing'); }

const SPEED_STEPS = [0.5, 1, 1.5, 2];
function cyclePlaybackSpeed() {
    const i = SPEED_STEPS.indexOf(AnimState.playbackSpeed);
    AnimState.playbackSpeed = SPEED_STEPS[(i + 1) % SPEED_STEPS.length];
    const btn = document.getElementById('tl-speed-btn');
    if (btn) btn.textContent = AnimState.playbackSpeed + 'x';
    flashMessage(`Velocidade: ${AnimState.playbackSpeed}x`);
}

function updatePlayback(nowMs) {
    if (!AnimState.isPlaying) return;
    if (AnimState.lastTimestamp === null) { AnimState.lastTimestamp = nowMs; return; }
    AnimState.frameExact += ((nowMs - AnimState.lastTimestamp) / (1000 / AnimState.fps)) * (AnimState.playbackSpeed || 1);
    AnimState.lastTimestamp = nowMs;
    const loopEnd   = LoopState.enabled ? LoopState.outFrame  : currentRulerEnd();
    const loopStart = LoopState.enabled ? LoopState.inFrame : 0;
    if (AnimState.frameExact > loopEnd) AnimState.frameExact = loopStart + (AnimState.frameExact - loopEnd);
    AnimState.currentFrame = Math.floor(AnimState.frameExact);
    applyKeyframesAtFrame(AnimState.frameExact);
    updatePlayhead();
}

// ══ Dope Sheet ═══════════════════════════════════════
function toggleDopeSheet()  { const p = document.getElementById('dopesheet-panel'), b = document.getElementById('tl-track-btn'); if (!p||!b) return; if (!DopeSheetState.visible) closeAllPanels('dopesheet'); DopeSheetState.visible = !DopeSheetState.visible; p.classList.toggle('hidden', !DopeSheetState.visible); b.classList.toggle('active', DopeSheetState.visible); if (DopeSheetState.visible) renderDopeSheet(); }
function closeDopeSheet()   { DopeSheetState.visible = false; document.getElementById('dopesheet-panel')?.classList.add('hidden'); document.getElementById('tl-track-btn')?.classList.remove('active'); }
function renderDopeSheet() {
    const body = document.getElementById('dopesheet-body'); if (!body) return;
    body.innerHTML = '';
    const uuids = Object.keys(AnimState.clips).filter(u => peekClips(u).length);
    if (!uuids.length) { body.innerHTML = '<div class="dopesheet-empty">Nenhum clipe na cena ainda.</div>'; return; }
    uuids.forEach(uuid => {
        const clipId = peekActiveClipId(uuid); if (!clipId) return;
        const objKFs = peekClipKFs(uuid, clipId);
        const obj = findObjectByUUID(uuid), clip = peekActiveClip(uuid);
        const name = (obj ? (obj.name || 'Objeto') : uuid.slice(0,8)) + (clip ? ` · ${clip.name}` : '');
        const row = document.createElement('div'); row.className = 'ds-row';
        const nameEl = document.createElement('div'); nameEl.className = 'ds-name'; nameEl.textContent = name; nameEl.title = name;
        const trackEl = document.createElement('div'); trackEl.className = 'ds-track';
        const ph = document.createElement('div'); ph.className = 'ds-playhead'; ph.style.left = (AnimState.currentFrame * FRAME_WIDTH) + 'px'; trackEl.appendChild(ph);
        Object.keys(objKFs).forEach(fs => {
            const frame = parseInt(fs);
            const d = document.createElement('div'); d.className = 'ds-diamond'; d.style.left = (frame*FRAME_WIDTH+FRAME_WIDTH/2)+'px'; d.title = `Frame ${frame}`;
            d.addEventListener('click', () => seekFrame(frame));
            d.addEventListener('dblclick', () => { seekFrame(frame); selectKF(uuid, clipId, frame); });
            trackEl.appendChild(d);
        });
        row.appendChild(nameEl); row.appendChild(trackEl); body.appendChild(row);
    });
}

// ══ Graph Editor ═══════════════════════════════════════
const CH_META = {
    px:{color:'#ff5f5f',get:k=>k.position.x}, py:{color:'#5fff8a',get:k=>k.position.y}, pz:{color:'#5faeff',get:k=>k.position.z},
    rx:{color:'#ffb347',get:k=>k.rotation.x}, ry:{color:'#e0a0ff',get:k=>k.rotation.y}, rz:{color:'#00e5d4',get:k=>k.rotation.z},
    sx:{color:'#ffe066',get:k=>k.scale.x},    sy:{color:'#ff91d4',get:k=>k.scale.y},    sz:{color:'#c0ff80',get:k=>k.scale.z},
};

function toggleGraphEditor() { GraphEdState.visible = !GraphEdState.visible; document.getElementById('graph-panel')?.classList.toggle('hidden', !GraphEdState.visible); if (GraphEdState.visible) renderGraphEditor(); }
function closeGraphEditor()  { GraphEdState.visible = false; document.getElementById('graph-panel')?.classList.add('hidden'); }

function renderGraphEditor() {
    const cvs = document.getElementById('graph-canvas'); if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width = cvs.parentElement.clientWidth;
    const h = cvs.height = cvs.parentElement.clientHeight;
    ctx.clearRect(0,0,w,h);

    const obj = resolveAnimTarget(getActiveObject()); if (!obj) return;
    const clipId = peekActiveClipId(obj.uuid); if (!clipId) return;
    const kfs = peekClipKFs(obj.uuid, clipId);
    const frames = Object.keys(kfs).map(Number).sort((a,b)=>a-b);
    if (frames.length < 2) return;

    const endFrame = Math.max(frames[frames.length-1], currentRulerEnd());
    const channels = Array.from(GraphEdState.channels);

    let minV = Infinity, maxV = -Infinity;
    channels.forEach(ch => {
        const meta = CH_META[ch]; if (!meta) return;
        for (let f = 0; f <= endFrame; f++) {
            const kf = getInterpolatedKF(obj.uuid, clipId, f);
            if (kf) { const v = meta.get(kf); if (v < minV) minV = v; if (v > maxV) maxV = v; }
        }
    });

    if (minV === Infinity) return;
    if (minV === maxV) { minV -= 1; maxV += 1; }
    const range = maxV - minV;

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    channels.forEach(ch => {
        const meta = CH_META[ch]; if (!meta) return;
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let f = 0; f <= endFrame; f++) {
            const kf = getInterpolatedKF(obj.uuid, clipId, f);
            if (!kf) continue;
            const val = meta.get(kf);
            const x = (f / endFrame) * w;
            const y = h - ((val - minV) / range) * (h - 20) - 10;
            if (f === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    });

    const px = (AnimState.currentFrame / endFrame) * w;
    ctx.strokeStyle = 'rgba(255,80,80,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
}

// ══ Onion Skin ═══════════════════════════════════════
function toggleOnionSkin() {
    OnionState.panelVisible = !OnionState.panelVisible;
    document.getElementById('onion-panel')?.classList.toggle('hidden', !OnionState.panelVisible);
}
function closeOnionSkin() {
    OnionState.panelVisible = false;
    document.getElementById('onion-panel')?.classList.add('hidden');
}

function clearOnionGhosts() {
    const scene = _scene(); if (!scene) return;
    OnionState.ghosts.forEach(g => scene.remove(g));
    OnionState.ghosts = [];
}

function updateOnionGhosts() {
    clearOnionGhosts();
    if (!OnionState.enabled) return;
    const scene = _scene(); if (!scene) return;
    const obj = resolveAnimTarget(getActiveObject()); if (!obj) return;
    const uuid = obj.uuid, clipId = peekActiveClipId(uuid); if (!clipId) return;

    const cur = AnimState.currentFrame;
    const frames = [];
    for (let i = OnionState.framesBefore; i >= 1; i--) if (cur - i >= 0) frames.push({ f: cur - i, color: 0x6ec6ff });
    for (let i = 1; i <= OnionState.framesAfter; i++) frames.push({ f: cur + i, color: 0xffb347 });

    frames.forEach(({ f, color }) => {
        const kf = getInterpolatedKF(uuid, clipId, f); if (!kf) return;
        const ghost = obj.clone(true);
        ghost.traverse(child => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity: OnionState.opacity * 0.6, wireframe: true
                });
            }
        });
        applyKFData(ghost, kf);
        scene.add(ghost);
        OnionState.ghosts.push(ghost);
    });
}

// ══ Marcadores ═══════════════════════════════════════
function toggleMarkers() {
    MarkerState.visible = !MarkerState.visible;
    document.getElementById('marker-panel')?.classList.toggle('hidden', !MarkerState.visible);
    if (MarkerState.visible) renderMarkerList();
}
function closeMarkers() {
    MarkerState.visible = false;
    document.getElementById('marker-panel')?.classList.add('hidden');
}

function renderMarkerList() {
    const list = document.getElementById('marker-list'); if (!list) return;
    const container = document.getElementById('timeline-markers');
    list.innerHTML = '';
    if (container) container.innerHTML = '';

    const frames = Object.keys(AnimState.markers).map(Number).sort((a,b)=>a-b);
    if (!frames.length) { list.innerHTML = '<div class="dopesheet-empty">Nenhum marcador.</div>'; return; }

    frames.forEach(f => {
        const name = AnimState.markers[f];
        const item = document.createElement('div');
        item.className = 'marker-item';
        item.innerHTML = `<div class="marker-color"></div><span class="marker-frame">f${f}</span><span class="marker-name">${name}</span><button class="marker-del">×</button>`;
        item.addEventListener('click', () => seekFrame(f));
        item.querySelector('.marker-del').addEventListener('click', (e) => { e.stopPropagation(); deleteMarker(f); });
        list.appendChild(item);

        if (container) {
            const pin = document.createElement('div');
            pin.className = 'tl-marker-pin';
            pin.style.left = (f * FRAME_WIDTH) + 'px';
            pin.dataset.label = name;
            pin.title = `f${f}: ${name}`;
            pin.addEventListener('click', () => seekFrame(f));
            container.appendChild(pin);
        }
    });
}

function addMarkerAtCurrentFrame() {
    const input = document.getElementById('marker-label-input');
    const label = input?.value.trim() || `M${AnimState.currentFrame}`;
    AnimState.markers[AnimState.currentFrame] = label;
    if (input) input.value = '';
    renderMarkerList();
    flashMessage(`Marcador f${AnimState.currentFrame} adicionado`);
}

function deleteMarker(f) {
    delete AnimState.markers[f];
    renderMarkerList();
}

// ══ Loop Region ═══════════════════════════════════════
function toggleLoopRegion() {
    LoopState.visible = !LoopState.visible;
    document.getElementById('loop-panel')?.classList.toggle('hidden', !LoopState.visible);
}
function closeLoopRegion() {
    LoopState.visible = false;
    document.getElementById('loop-panel')?.classList.add('hidden');
}

function updateLoopOverlay() {
    const overlay = document.getElementById('timeline-loop-overlay'); if (!overlay) return;
    if (!LoopState.enabled) { overlay.style.display = 'none'; return; }
    overlay.style.display = 'block';
    overlay.style.left  = (LoopState.inFrame  * FRAME_WIDTH) + 'px';
    overlay.style.width = ((LoopState.outFrame - LoopState.inFrame) * FRAME_WIDTH) + 'px';
}

// ══ Auto-Key ══════════════════════════════════════════
function toggleAutoKey() {
    AutoKeyState.enabled = !AutoKeyState.enabled;
    const btn = document.getElementById('tl-autokey-btn');
    const chk = document.getElementById('autokey-enabled');
    const st  = document.getElementById('autokey-status');
    if (btn) btn.classList.toggle('autokey-on', AutoKeyState.enabled);
    if (chk) chk.checked = AutoKeyState.enabled;
    if (st)  st.textContent = AutoKeyState.enabled ? 'ON' : 'OFF';
    flashMessage(AutoKeyState.enabled ? 'Auto-Key ATIVADO' : 'Auto-Key desativado');
}

function handleAutoKeyTransform(obj) {
    if (!AutoKeyState.enabled || !obj) return;
    const uuid = obj.uuid, clipId = ensureActiveClipId(uuid);
    const frame = AnimState.currentFrame;
    peekClipKFs(uuid, clipId)[frame] = {
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z, order: obj.rotation.order },
        scale:    { x: obj.scale.x,    y: obj.scale.y,    z: obj.scale.z },
        interp:   AnimState.interpMode,
        isBone:   obj.isBone
    };
    renderClipsSection();
}

// ══ Path Motion ═══════════════════════════════════════
function toggleMotionPath() {
    PathState.enabled = !PathState.enabled;
    document.getElementById('tl-path-btn')?.classList.toggle('active', PathState.enabled);
    if (PathState.enabled) updateMotionPath(); else clearMotionPath();
}

function clearMotionPath() {
    const scene = _scene(); if (!scene) return;
    if (PathState.lineObj) { scene.remove(PathState.lineObj); PathState.lineObj = null; }
}

function updateMotionPath() {
    clearMotionPath();
    if (!PathState.enabled) return;
    const scene = _scene(); if (!scene) return;
    const obj = resolveAnimTarget(getActiveObject()); if (!obj) return;
    const uuid = obj.uuid, clipId = peekActiveClipId(uuid); if (!clipId) return;

    const endFrame = Math.max(getClipMaxFrame(uuid, clipId), currentRulerEnd());
    const points = [];
    for (let f = 0; f <= endFrame; f++) {
        const kf = getInterpolatedKF(uuid, clipId, f);
        if (kf) points.push(new THREE.Vector3(kf.position.x, kf.position.y, kf.position.z));
    }
    if (points.length < 2) return;

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat  = new THREE.LineBasicMaterial({ color: 0xffb14a, linewidth: 2 });
    PathState.lineObj = new THREE.Line(geom, mat);
    scene.add(PathState.lineObj);
}

// ══ More Menu & Close All ═════════════════════════════
function toggleMoreMenu() {
    MoreMenuState.visible = !MoreMenuState.visible;
    document.getElementById('more-menu-panel')?.classList.toggle('hidden', !MoreMenuState.visible);
}
function closeMoreMenu() {
    MoreMenuState.visible = false;
    document.getElementById('more-menu-panel')?.classList.add('hidden');
}

function closeAllPanels(except) {
    if (except !== 'dopesheet') closeDopeSheet();
    if (except !== 'onion')     closeOnionSkin();
    if (except !== 'marker')    closeMarkers();
    if (except !== 'loop')      closeLoopRegion();
    closeMoreMenu();
}

// ==================== CLIPS SECTION RENDER ====================
function renderClipsSection() {
    const listEl = document.getElementById('tl-clips-list');
    const trackEl = document.getElementById('tl-clips-track');
    if (!listEl || !trackEl) return;

    listEl.innerHTML = '';
    
    let playhead = document.getElementById('tl-clips-playhead');
    if (!playhead) {
        playhead = document.createElement('div');
        playhead.id = 'tl-clips-playhead';
        playhead.className = 'tl-clips-playhead';
    }
    trackEl.innerHTML = '';
    trackEl.appendChild(playhead);

    const activeObj = resolveAnimTarget(getActiveObject());
    if (!activeObj) {
        listEl.innerHTML = '<div class="dopesheet-empty">Selecione um objeto</div>';
        return;
    }

    const uuid = activeObj.uuid;
    const clips = peekClips(uuid);
    const activeClipId = peekActiveClipId(uuid);

    if (!clips.length) {
        listEl.innerHTML = '<div class="dopesheet-empty">Nenhum clipe</div>';
        return;
    }

    const trackWidth = trackEl.clientWidth || 300;

    clips.forEach(clip => {
        const item = document.createElement('div');
        item.className = 'tl-clip-entry' + (clip.id === activeClipId ? ' active' : '');
        item.innerHTML = `
            <div class="tl-clip-dot"></div>
            <span class="tl-clip-entry-name">${clip.name}</span>
            <span class="tl-clip-entry-dur">${clip.duration}f</span>
        `;
        item.addEventListener('click', () => setActiveClip(uuid, clip.id));
        listEl.appendChild(item);

        const row = document.createElement('div');
        row.className = 'tl-clip-row';

        const block = document.createElement('div');
        block.className = 'tl-clip-block' + (clip.id === activeClipId ? ' active' : '');
        block.style.width = `calc(100% - 4px)`;
        block.style.left = `2px`;

        const label = document.createElement('span');
        label.className = 'tl-clip-block-label';
        label.textContent = `${clip.name} (${clip.duration}f)`;
        block.appendChild(label);

        const kfs = peekClipKFs(uuid, clip.id);
        const calcWidth = Math.max(clip.duration * FRAME_WIDTH, trackWidth - 6);
        Object.keys(kfs).forEach(fs => {
            const frame = parseInt(fs);
            const dot = document.createElement('div');
            dot.className = 'tl-clip-kf-dot';
            const kfX = (frame * FRAME_WIDTH);
            dot.style.left = Math.min(kfX, calcWidth - 4) + 'px';
            dot.title = `KF Frame ${frame}`;

            if (AnimState.selectedKF && AnimState.selectedKF.uuid === uuid && AnimState.selectedKF.clipId === clip.id && AnimState.selectedKF.frame === frame) {
                dot.classList.add('kf-selected');
            }

            dot.addEventListener('click', (e) => {
                e.stopPropagation();
                seekFrame(frame);
            });
            dot.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                seekFrame(frame);
                selectKF(uuid, clip.id, frame);
            });
            block.appendChild(dot);
        });

        row.appendChild(block);
        trackEl.appendChild(row);
    });

    const x = AnimState.currentFrame * FRAME_WIDTH;
    if (playhead) playhead.style.left = x + 'px';
}

function refreshAnimSidebar() {
    renderClipsSection();
    renderAnimDefaultClipDurations();
}

// ==================== EVENTS SETUP ====================
function setupEvents() {
    document.getElementById('tl-play-btn')?.addEventListener('click', () => {
        if (AnimState.isPlaying) pause(); else play();
    });
    document.getElementById('tl-tostart-btn')?.addEventListener('click', jumpToStart);
    document.getElementById('tl-toend-btn')?.addEventListener('click', jumpToEnd);
    document.getElementById('tl-add-kf-btn')?.addEventListener('click', addKeyframe);
    document.getElementById('tl-track-btn')?.addEventListener('click', toggleDopeSheet);
    document.getElementById('tl-autokey-btn')?.addEventListener('click', toggleAutoKey);
    document.getElementById('tl-path-btn')?.addEventListener('click', toggleMotionPath);
    document.getElementById('tl-speed-btn')?.addEventListener('click', cyclePlaybackSpeed);
    document.getElementById('tl-more-btn')?.addEventListener('click', toggleMoreMenu);

    document.getElementById('tl-onion-btn')?.addEventListener('click', () => { closeMoreMenu(); toggleOnionSkin(); });
    document.getElementById('tl-marker-btn')?.addEventListener('click', () => { closeMoreMenu(); toggleMarkers(); });
    document.getElementById('tl-loop-btn')?.addEventListener('click', () => { closeMoreMenu(); toggleLoopRegion(); });

    document.getElementById('kf-copy-btn')?.addEventListener('click', copySelectedKF);
    document.getElementById('kf-paste-btn')?.addEventListener('click', pasteKF);
    document.getElementById('kf-delete-btn')?.addEventListener('click', deleteSelectedKF);

    document.getElementById('tl-addclip-btn')?.addEventListener('click', () => {
        const obj = resolveAnimTarget(getActiveObject());
        if (!obj) { flashMessage('Selecione um objeto para criar clipe'); return; }
        createNewClip(obj.uuid);
        renderClipsSection();
    });

    // Interp buttons
    ['smooth','linear','constant'].forEach(mode => {
        document.getElementById(`interp-${mode}-btn`)?.addEventListener('click', e => {
            AnimState.interpMode = mode;
            document.querySelectorAll('.interp-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
        });
    });

    // Graph channels
    document.getElementById('graph-channel-toggles')?.addEventListener('click', e => {
        const btn = e.target.closest('.ch-btn'); if (!btn) return;
        const ch = btn.dataset.ch;
        if (GraphEdState.channels.has(ch)) {
            if (GraphEdState.channels.size > 1) GraphEdState.channels.delete(ch);
        } else {
            GraphEdState.channels.add(ch);
        }
        btn.classList.toggle('active', GraphEdState.channels.has(ch));
        renderGraphEditor();
    });

    // Track scrub
    const track = document.getElementById('timeline-track');
    if (track) {
        let scrubbing = false;
        const onScrub = e => {
            const rect = track.getBoundingClientRect();
            const x = e.clientX - rect.left + track.scrollLeft;
            seekFrame(Math.max(0, Math.round(x / FRAME_WIDTH)));
        };
        track.addEventListener('pointerdown', e => { scrubbing = true; track.setPointerCapture(e.pointerId); onScrub(e); });
        track.addEventListener('pointermove', e => { if (scrubbing) onScrub(e); });
        track.addEventListener('pointerup',   e => { scrubbing = false; });
    }

    // Panel close buttons
    document.getElementById('dopesheet-close')?.addEventListener('click', closeDopeSheet);
    document.getElementById('onion-close')?.addEventListener('click', closeOnionSkin);
    document.getElementById('marker-close')?.addEventListener('click', closeMarkers);
    document.getElementById('loop-close')?.addEventListener('click', closeLoopRegion);
    document.getElementById('autokey-close')?.addEventListener('click', () => {
        AutoKeyState.enabled = false;
        document.getElementById('tl-autokey-btn')?.classList.remove('autokey-on');
        document.getElementById('autokey-panel')?.classList.add('hidden');
    });

    // Onion controls
    document.getElementById('onion-enabled')?.addEventListener('change', e => { OnionState.enabled = e.target.checked; updateOnionGhosts(); });
    document.getElementById('onion-before')?.addEventListener('input', e => { OnionState.framesBefore = parseInt(e.target.value); document.getElementById('onion-before-val').textContent = e.target.value; updateOnionGhosts(); });
    document.getElementById('onion-after')?.addEventListener('input', e => { OnionState.framesAfter = parseInt(e.target.value); document.getElementById('onion-after-val').textContent = e.target.value; updateOnionGhosts(); });
    document.getElementById('onion-opacity')?.addEventListener('input', e => { OnionState.opacity = parseInt(e.target.value)/100; document.getElementById('onion-opacity-val').textContent = e.target.value+'%'; updateOnionGhosts(); });

    // Marker controls
    document.getElementById('marker-add-btn')?.addEventListener('click', addMarkerAtCurrentFrame);

    // Loop controls
    document.getElementById('loop-enabled')?.addEventListener('change', e => { LoopState.enabled = e.target.checked; updateLoopOverlay(); });
    document.getElementById('loop-in')?.addEventListener('change', e => { LoopState.inFrame = Math.max(0, parseInt(e.target.value)||0); updateLoopOverlay(); });
    document.getElementById('loop-out')?.addEventListener('change', e => { LoopState.outFrame = Math.max(1, parseInt(e.target.value)||100); updateLoopOverlay(); });
    document.getElementById('loop-in-set')?.addEventListener('click', () => { LoopState.inFrame = AnimState.currentFrame; document.getElementById('loop-in').value = AnimState.currentFrame; updateLoopOverlay(); });
    document.getElementById('loop-out-set')?.addEventListener('click', () => { LoopState.outFrame = AnimState.currentFrame; document.getElementById('loop-out').value = AnimState.currentFrame; updateLoopOverlay(); });

    initAnimDefaultClipsUI();
}

// ==================== PUBLIC API ====================
export function initAnimation() {
    createTimelineUI();
    AnimState.visible = true;
    document.getElementById('timeline-container').style.display = 'flex';
}

export function showTimeline() {
    initAnimation();
}

export function hideTimeline() {
    AnimState.visible = false;
    const c = document.getElementById('timeline-container');
    if (c) c.style.display = 'none';
    pause();
    clearOnionGhosts();
    clearMotionPath();
}

export function toggleTimeline() {
    if (AnimState.visible) hideTimeline(); else showTimeline();
}

export function onSceneSelectionChanged(selectedObj) {
    refreshAnimSidebar();
    buildRuler();
    updatePlayhead();
}

export function tickAnimation(nowMs) {
    if (AnimState.isPlaying) updatePlayback(nowMs);
}

export {
    addKeyframe, seekFrame, play, pause,
    createNewClip, deleteClip, setActiveClip, handleAutoKeyTransform
};
```