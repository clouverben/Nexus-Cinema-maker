// ═══════════════════════════════════════════════════════════════════════
// AURA LABS — a module completely independent from particle-engine.js.
//
// Previously Shell/Billboard lived as optional config flags bolted onto
// ParticleSystem (auraShellEnabled/auraBillboardEnabled), which meant an
// aura only existed as a side effect of some particle system also
// existing, and turning it "on" meant toggling a boolean inside that
// system's shared config. An AuraSystem here has none of that: its own
// class, own position, own attach/update/dispose lifecycle, own file.
// Creating one *is* turning it on — there's no separate enabled switch —
// and removing it from an AuraLab's list is what turns it off.
//
// Technique (confirmed against how Blender/SFM artists actually build
// stylized character auras, not a generic particle system):
//  - Blender: a Fresnel/Layer-Weight node driving emission strength on a
//    glow shell, often paired with a scrolling-noise mask for a
//    hand-drawn "ki" edge instead of a perfectly smooth glow (community
//    "Super Saiyan Aura" / "Magical Aura Energy" shader packs use exactly
//    this — procedural, real-time, color/speed/visibility controls).
//    Some packs also drive the shell's *Mapping* node with an Empty so
//    artists can nudge the glow off-center by hand — that's the origin
//    of the shellOffset X/Y/Z controls below.
//  - SFM: a $rimlight/$rimlightexponent/$rimlightboost material combined
//    with an *animated* detail texture (scrolling frames via a
//    $detailframe proxy) for the "flame licking upward" motion.
// Shell below is the Fresnel-rim approach; Billboard is the animated-
// scrolling-texture-card approach (SFM's animated aura sprite, and the
// Roblox anime-game billboard technique) — same two real techniques,
// same math, just living in their own file/class now instead of being
// smuggled into a particle system's config.
//
// Billboard texture reuses the exact same generated-sprite library as
// particle-engine.js (window._ParticleEngine._getTexture) instead of a
// second copy, so "glow/streak/ember/flame/..." mean the same thing and
// look the same whether you're texturing a particle or an aura card.
//
// Shader FX mirrors ParticleSystem.getShaderFX/setShaderFX/toggleShaderFX
// (same shaderFxStack shape, same 6 modes from SHADER_FX_LIBRARY) so the
// Particle Labs shader-tab UI code can drive an Aura the same way it
// drives a particle system — the *visual* math is reimplemented here
// per-mode (rim/pulse/rainbow port over almost verbatim since Shell is
// already a rim effect; dissolve/chromatic are approximated against the
// noise mask and flame sampling since Shell has no sprite texture to
// manipulate the way particles do).
// ═══════════════════════════════════════════════════════════════════════
import * as THREE from 'three';

let _auraIdSeed = 0;
function _genAuraSystemId() { return `aura_${++_auraIdSeed}_${Date.now().toString(36)}`; }

const _AURA_DEFAULTS = {
    shellEnabled: true,
    shellColor: '#a78bfa', shellIntensity: 60, shellRadius: 12, shellHeight: 15,
    shellSharpness: 55, shellPulseSpeed: 30, shellJagged: 0, shellNoiseScale: 20, shellFlickerSpeed: 45,
    shellOffsetX: 0, shellOffsetY: 0, shellOffsetZ: 0,
    billboardCount: 4, billboardAlign: 'cameraY', billboardTexture: 'streak',
    billboardColorBottom: '#ff9500', billboardColorTop: '#ffffff',
    billboardWidth: 0.6, billboardHeight: 1.8, billboardRadius: 0.22, billboardIntensity: 150,
    billboardScrollSpeed: 0.6, billboardJagged: 65, billboardNoiseScale: 8, billboardFlickerSpeed: 3,
    // Cards previously just sat still at their ring angle (only the noise
    // texture scrolled in place). These make the cards themselves move —
    // 'orbit' spins them around the ring, 'float' bobs each one up/down
    // on its own phase (offset by angle so they don't move in lockstep),
    // 'both' does both at once.
    billboardMotion: 'static', billboardOrbitSpeed: 0.4, billboardFloatSpeed: 1.2, billboardFloatAmount: 0.15,
    // Drag — same idea as particles' "Arrasto" (drag) module: a 0.5-1
    // factor that scales down the card's own motion speed. Particles
    // apply drag to an accumulated velocity every frame; cards don't have
    // a velocity (their motion is a closed formula, not integrated), so
    // here it works as a direct multiplier on whichever speed(s) the
    // current Movimento mode uses — still "more drag = slower", just
    // applied the way a formula-driven motion can use it.
    billboardDrag: 1,
    // Forces — Gravidade only really reads on the 'spiral' movement (see
    // _newCardSpiral), where cards rise on their own individual life and
    // gravity pulls that rise back down like an ember losing momentum,
    // same spirit as particles' Gravidade operator. Turbulência is a
    // small per-card noise-based jitter, independent of which Movimento
    // mode is active — same idea as particles' Turbulência force.
    billboardGravity: 0, billboardTurbulence: 0,
    // Flipbook — sprite-sheet UV animation for the card texture, same
    // concept as particles' "Sprite Sheet / Flipbook" module (see
    // particle-engine.js's ncmFlipbookUV), driven by time here instead of
    // per-particle life since a card doesn't have one.
    billboardFlipbookEnabled: false, billboardFlipbookCols: 4, billboardFlipbookRows: 4, billboardFlipbookFps: 12,
    // Lightning — ported from special_fx.js's AuraEffect (arcs jumping
    // between random points on a cylinder around the anchor). Off by
    // default since it's a heavier, more specific look than Shell/
    // Billboard; lightningOffset moves the whole cluster independently
    // of Shell's own offset.
    lightningEnabled: false, lightningCount: 8, lightningColor: '#55bbff',
    lightningRadius: 12, lightningHeight: 15, lightningIntensity: 100,
    lightningSpeed: 100, lightningSegments: 8, lightningJitter: 100,
    lightningOffsetX: 0, lightningOffsetY: 0, lightningOffsetZ: 0,
};

// ── Shader FX (shared shell/billboard GLSL) ─────────────────────────────
// Same per-mode formulas as particle-engine.js's SHADER_FX loop (see
// uFxData/uFxColor there), so a given mode/params reads the same way to
// the user on an Aura as it does on a particle system. `cuv` is whatever
// the caller passes as its local 0..1-ish "shape space" coordinate:
// billboard passes vUv (real UV, has a texture to manipulate); shell
// passes a normal-derived pseudo-UV (no texture, so dissolve/chromatic
// there work against the flame noise mask instead of a sampled texture).
const _FX_GLSL_DECL = /* glsl */`
    #define AURA_FX_COUNT 6
    uniform vec4  uFxData[AURA_FX_COUNT];
    uniform vec3  uFxColor[AURA_FX_COUNT];
    float _fxHash(vec2 p){ p=fract(p*vec2(234.34,435.345)); p+=dot(p,p+34.23); return fract(p.x*p.y); }
    float _fxNoise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float a=_fxHash(i), b=_fxHash(i+vec2(1.0,0.0)), c=_fxHash(i+vec2(0.0,1.0)), d=_fxHash(i+vec2(1.0,1.0));
        return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    vec3 _fxHueShift(vec3 col, float hue){
        const vec3 k = vec3(0.57735);
        float cosA = cos(hue), sinA = sin(hue);
        return col*cosA + cross(k,col)*sinA + k*dot(k,col)*(1.0-cosA);
    }
`;
// Called once, before `col`/`alpha` exist, to let "wave" pre-distort the
// shape coordinate (mirrors the particle shader's UV pre-pass).
const _FX_GLSL_PREPASS = /* glsl */`
    for (int i = 0; i < AURA_FX_COUNT; i++) {
        float mode = uFxData[i].x;
        if (mode > 3.5 && mode < 4.5) {
            float p1 = uFxData[i].y, p2 = uFxData[i].z, p3 = uFxData[i].w;
            float amp = p1 * 0.15, freq = 4.0 + p2 * 16.0, spd = p3 * 4.0;
            cuv += vec2(sin(cuv.y * freq + uTime * spd), cos(cuv.x * freq + uTime * spd)) * amp;
        }
    }
`;
// Called after `col`/`alpha` are computed, to layer rim/dissolve/rainbow/
// pulse/chromatic on top. `fxMask` is a 0..1 "how solid is this pixel"
// value used by dissolve/chromatic when there's no real texture (shell).
const _FX_GLSL_MAINPASS = /* glsl */`
    for (int i = 0; i < AURA_FX_COUNT; i++) {
        float mode = uFxData[i].x;
        if (mode < 0.5) continue;
        float p1 = uFxData[i].y, p2 = uFxData[i].z, p3 = uFxData[i].w;
        vec3 fxColor = uFxColor[i];
        if (mode > 0.5 && mode < 1.5) {
            float d = 1.0 - fxMask;
            float rim = smoothstep(0.4 + (1.0 - p2) * 0.3, 1.0, d) * p1;
            col += fxColor * rim * 1.5;
            alpha = max(alpha, rim * p1 * alpha);
        } else if (mode > 1.5 && mode < 2.5) {
            float n = _fxNoise(cuv * (4.0 + p2 * 20.0) + uTime * 0.15);
            float threshold = p1;
            if (n < threshold * 0.7) discard;
            float edge = smoothstep(threshold * 0.7, threshold * 0.7 + 0.12, n);
            col = mix(fxColor * 2.0, col, edge);
        } else if (mode > 2.5 && mode < 3.5) {
            float hue = uTime * p3 * 2.0 + p1 * 6.2832;
            col = _fxHueShift(col, hue);
            col = mix(col, col * (1.0 + p2), 0.6);
        } else if (mode > 4.5 && mode < 5.5) {
            float p = 0.5 + 0.5 * sin(uTime * (1.0 + p3 * 8.0));
            col *= mix(1.0, 1.0 + p1 * 1.5, p);
            alpha *= mix(1.0, 1.0 - p2 * 0.5, 1.0 - p);
        } else if (mode > 5.5 && mode < 6.5) {
            float off = p1 * 0.08;
            float ang = uTime * p3 * 2.0;
            vec2 dir = vec2(cos(ang), sin(ang)) * off;
            float r = _fxNoise((cuv + dir) * 6.0);
            float b = _fxNoise((cuv - dir) * 6.0);
            col = mix(col, vec3(r, col.g, b) * max(fxMask, 0.4), 0.6);
        }
    }
`;

function _emptyFxUniforms() {
    return {
        uFxData:  { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0.5, 0.5, 0.5)) },
        uFxColor: { value: Array.from({ length: 6 }, () => new THREE.Color(0xffffff)) },
    };
}

const _FX_ORDER = ['rim', 'dissolve', 'rainbow', 'wave', 'pulse', 'chromatic'];
const _FX_MODE_ID = { rim: 1, dissolve: 2, rainbow: 3, wave: 4, pulse: 5, chromatic: 6 };
const _ZERO_VEC3 = new THREE.Vector3();

function _resolveAuraTexture(name) {
    const PE = window._ParticleEngine;
    try { return PE?._getTexture?.(name || 'streak') || null; } catch { return null; }
}

// ── Lightning arc — ported from special_fx.js's Lightning3D. Draws a
// flickering zigzag Line (plus a softer glow duplicate) between two
// points, regenerated every frame; AuraSystem drives A/B every frame to
// jump between random points around its silhouette (see _newLightningArc
// / _updateLightning below), same technique as the source file's
// AuraEffect.
class _LightningArc {
    constructor(scene, color = 0x55bbff, segs = 8) {
        this._scene = scene;
        this.visible = true;
        this._opacityScale = 1;
        this._jitterMul = 1;
        this._mat = new THREE.LineBasicMaterial({
            color, blending: THREE.AdditiveBlending,
            depthWrite: false, transparent: true, opacity: 1.0,
        });
        this._matGlow = new THREE.LineBasicMaterial({
            color, blending: THREE.AdditiveBlending,
            depthWrite: false, transparent: true, opacity: 0.25,
        });
        this.SEGS = Math.max(2, Math.min(16, Math.round(segs)));
        const pts = new Float32Array((this.SEGS + 1) * 3);
        this._geo     = new THREE.BufferGeometry();
        this._geoGlow = new THREE.BufferGeometry();
        this._geo.setAttribute('position',     new THREE.BufferAttribute(pts.slice(), 3));
        this._geoGlow.setAttribute('position', new THREE.BufferAttribute(pts.slice(), 3));
        this._line     = new THREE.Line(this._geo,     this._mat);
        this._lineGlow = new THREE.Line(this._geoGlow, this._matGlow);
        this._line.userData     = { isLab: true, isAura: true, isHelper: true };
        this._lineGlow.userData = { isLab: true, isAura: true, isHelper: true };
        this._line.frustumCulled     = false;
        this._lineGlow.frustumCulled = false;
        scene.add(this._line);
        scene.add(this._lineGlow);
        this._flickerTimer = 0;
        this._opacity      = 1;
    }
    setColor(hex) { this._mat.color.set(hex); this._matGlow.color.set(hex); }
    setOpacityScale(mult) { this._opacityScale = Math.max(0, mult); }
    setJitter(mult) { this._jitterMul = Math.max(0, mult); }
    update(A, B, dt) {
        this._flickerTimer -= dt;
        if (this._flickerTimer <= 0) {
            this._opacity      = 0.4 + Math.random() * 0.6;
            this._flickerTimer = 0.02 + Math.random() * 0.05;
        }
        const o = this._opacity * this._opacityScale;
        this._mat.opacity     = this.visible ? o : 0;
        this._matGlow.opacity = this.visible ? o * 0.3 : 0;
        if (!this.visible) return;
        this._buildZigzag(this._geo,     A, B, 0.0);
        this._buildZigzag(this._geoGlow, A, B, 0.04);
    }
    _buildZigzag(geo, A, B, offsetScale) {
        const arr = geo.attributes.position.array;
        const N   = this.SEGS;
        const AB  = new THREE.Vector3().subVectors(B, A);
        const len = AB.length();
        const up  = Math.abs(AB.y / Math.max(len, 0.001)) > 0.9
            ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const perp1 = new THREE.Vector3().crossVectors(AB, up).normalize();
        const perp2 = new THREE.Vector3().crossVectors(AB, perp1).normalize();
        const amp   = (len * 0.14 + 0.03) * this._jitterMul;
        for (let i = 0; i <= N; i++) {
            const tt   = i / N;
            const base = new THREE.Vector3().lerpVectors(A, B, tt);
            const env  = Math.sin(tt * Math.PI);
            const d1   = (Math.random() - 0.5) * 2 * amp * env;
            const d2   = (Math.random() - 0.5) * 2 * amp * env;
            const od   = (Math.random() - 0.5) * offsetScale * amp;
            arr[i*3]   = base.x + perp1.x*d1 + perp2.x*d2 + perp1.x*od;
            arr[i*3+1] = base.y + perp1.y*d1 + perp2.y*d2 + perp1.y*od;
            arr[i*3+2] = base.z + perp1.z*d1 + perp2.z*d2 + perp1.z*od;
        }
        geo.attributes.position.needsUpdate = true;
    }
    dispose() {
        this._scene.remove(this._line);
        this._scene.remove(this._lineGlow);
        this._geo.dispose(); this._geoGlow.dispose();
        this._mat.dispose(); this._matGlow.dispose();
    }
}

export class AuraSystem {
    constructor(scene, config = {}) {
        this._scene = scene;
        this.name = config.name || 'Aura';
        this.id = config.id || _genAuraSystemId();
        this.position = new THREE.Vector3();
        this._attachedTo = null;
        this._time = 0;
        this._pulse = null;
        this._pulseMul = 1;
        this._config = { ..._AURA_DEFAULTS, shaderFxStack: {}, ...config };
        this.userData = { isLab: true, isAura: true };

        // ── Marker — a named Object3D added to the scene so the Aura shows
        // up in the main Objects panel and can be dragged with the
        // transform gizmo, exactly like a particle system's emitter
        // marker (see ParticleSystem._marker in particle-engine.js).
        // update() reads the aura's position from this marker's *world*
        // position every frame; attachTo() reparents the marker under the
        // target object instead of copying a position each frame, so
        // following an object is just normal scene-graph inheritance.
        this._marker = new THREE.Object3D();
        this._marker.name = this.name;
        this._marker.userData = {
            isLab: true, isLabMarker: true, isAura: true,
            isHelper: false, // must appear in the Objects panel
            labSystemRef: this,
            auraSystemId: this.id,
        };
        const crossGeo = new THREE.BufferGeometry();
        const s = 0.18;
        crossGeo.setAttribute('position', new THREE.Float32BufferAttribute([
            -s, 0, 0, s, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, -s, 0, 0, s,
        ], 3));
        const crossMat = new THREE.LineBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.8, depthTest: false });
        const crossLines = new THREE.LineSegments(crossGeo, crossMat);
        crossLines.userData.isHelper = true; // excluded from the Objects panel itself
        crossLines.renderOrder = 999;
        this._marker.add(crossLines);
        this._scene.add(this._marker);

        this._buildShell();
        this._buildBillboards();
        this._buildLightning();
    }

    setConfig(patch) {
        Object.assign(this._config, patch);
        if (patch.name) { this.name = patch.name; this._marker.name = patch.name; }
    }
    getConfig() { return this._config; }

    // ── Attach to object — reparents the marker (same technique as
    // ParticleSystem.attachTo/detach) so the Aura simply inherits the
    // target's transform every frame instead of needing a special case
    // in update(). ─────────────────────────────────────────────────────
    _setMarkerParent(parentObject3D = null, preserveWorld = true) {
        const worldPos = new THREE.Vector3();
        if (preserveWorld) this._marker.getWorldPosition(worldPos);
        if (this._marker.parent) this._marker.parent.remove(this._marker);
        const targetParent = parentObject3D || this._scene;
        targetParent.add(this._marker);
        if (preserveWorld) {
            const local = worldPos.clone();
            if (targetParent !== this._scene && targetParent?.worldToLocal) targetParent.worldToLocal(local);
            this._marker.position.copy(local);
        } else {
            this._marker.position.set(0, 0, 0);
        }
    }
    attachTo(object3D) {
        if (!object3D?.isObject3D) { this.detach(); return; }
        this._attachedTo = object3D;
        this._config.attachedToUuid = object3D.uuid;
        this._config.attachedToName = object3D.name || (object3D.userData?.isBoneMarker && 'Osso') || 'Objeto';
        this._setMarkerParent(object3D, true);
        this._marker.getWorldPosition(this.position);
    }
    detach() {
        this._attachedTo = null;
        this._config.attachedToUuid = null;
        this._config.attachedToName = null;
        this._setMarkerParent(null, true);
        this._marker.getWorldPosition(this.position);
    }
    getAttachedObject() { return this._attachedTo || null; }
    getWorldPosition(target = new THREE.Vector3()) { return this._marker.getWorldPosition(target); }

    // ── Shader FX — same API/shape as ParticleSystem so the shared UI
    // (Particle Labs "Shader" tab) can drive either one. ───────────────
    getShaderFXStack() {
        return _FX_ORDER
            .map(mode => {
                const layer = this._config.shaderFxStack?.[mode];
                return layer ? { ...layer } : null;
            })
            .filter(Boolean);
    }
    getShaderFX(mode = null) {
        if (mode) {
            const layer = this._config.shaderFxStack?.[mode];
            return layer ? { ...layer } : { mode, p1: 0.5, p2: 0.5, p3: 0.5, color: '#ffffff', enabled: false };
        }
        const first = this.getShaderFXStack().find(l => l.enabled);
        return first || { mode: 'none', p1: 0.5, p2: 0.5, p3: 0.5, color: '#ffffff', enabled: false };
    }
    setShaderFX(mode, values = {}) {
        if (mode && typeof mode === 'object') {
            const fx = mode;
            if (fx.mode) return this.setShaderFX(fx.mode, fx);
            return;
        }
        if (!mode || mode === 'none' || !_FX_MODE_ID[mode]) return;
        const stack = { ...(this._config.shaderFxStack || {}) };
        const prev = stack[mode] || {};
        stack[mode] = {
            mode,
            p1: Number.isFinite(Number(values.p1 ?? prev.p1)) ? Number(values.p1 ?? prev.p1 ?? 0.5) : 0.5,
            p2: Number.isFinite(Number(values.p2 ?? prev.p2)) ? Number(values.p2 ?? prev.p2 ?? 0.5) : 0.5,
            p3: Number.isFinite(Number(values.p3 ?? prev.p3)) ? Number(values.p3 ?? prev.p3 ?? 0.5) : 0.5,
            color: values.color ?? prev.color ?? '#ffffff',
            enabled: true,
        };
        this.setConfig({ shaderFxStack: stack });
    }
    toggleShaderFX(mode, enabled = true) {
        if (!mode || mode === 'none' || !_FX_MODE_ID[mode]) return;
        const stack = { ...(this._config.shaderFxStack || {}) };
        const current = stack[mode] || { mode, p1: 0.5, p2: 0.5, p3: 0.5, color: '#ffffff' };
        stack[mode] = { ...current, enabled: !!enabled };
        this.setConfig({ shaderFxStack: stack });
    }
    _syncShaderFxUniforms(mat) {
        const u = mat?.uniforms;
        if (!u?.uFxData?.value || !u?.uFxColor?.value) return;
        const stack = this._config.shaderFxStack || {};
        _FX_ORDER.forEach((mode, idx) => {
            const layer = stack[mode];
            const data = u.uFxData.value[idx];
            const color = u.uFxColor.value[idx];
            if (layer?.enabled && data) {
                data.set(_FX_MODE_ID[mode] ?? 0, layer.p1 ?? 0.5, layer.p2 ?? 0.5, layer.p3 ?? 0.5);
                if (color?.set) color.set(layer.color ?? '#ffffff');
            } else if (data) {
                data.set(0, 0.5, 0.5, 0.5);
                if (color?.set) color.set('#ffffff');
            }
        });
    }

    _buildShell() {
        const shellGeo = new THREE.SphereGeometry(1, 24, 16);
        this._shellMat = new THREE.ShaderMaterial({
            uniforms: {
                uColor:        { value: new THREE.Color(this._config.shellColor) },
                uIntensity:    { value: 1.4 },
                uPower:        { value: 2.2 },
                uTime:         { value: 0 },
                uPulseSpeed:   { value: 1.2 },
                uJagged:       { value: 0.0 },
                uNoiseScale:   { value: 2.0 },
                uFlickerSpeed: { value: 1.2 },
                ..._emptyFxUniforms(),
            },
            vertexShader: /* glsl */`
                varying vec3 vNormalW;
                varying vec3 vViewDir;
                void main(){
                    vNormalW = normalize(mat3(modelMatrix) * normal);
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vViewDir = normalize(cameraPosition - worldPos.xyz);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3  uColor;
                uniform float uIntensity;
                uniform float uPower;
                uniform float uTime;
                uniform float uPulseSpeed;
                uniform float uJagged;
                uniform float uNoiseScale;
                uniform float uFlickerSpeed;
                varying vec3  vNormalW;
                varying vec3  vViewDir;
                ${_FX_GLSL_DECL}

                float _hash(vec3 p){
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }
                float _noise(vec3 p){
                    vec3 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(_hash(i+vec3(0,0,0)), _hash(i+vec3(1,0,0)), f.x),
                            mix(_hash(i+vec3(0,1,0)), _hash(i+vec3(1,1,0)), f.x), f.y),
                        mix(mix(_hash(i+vec3(0,0,1)), _hash(i+vec3(1,0,1)), f.x),
                            mix(_hash(i+vec3(0,1,1)), _hash(i+vec3(1,1,1)), f.x), f.y),
                        f.z);
                }

                void main(){
                    vec2 cuv = vNormalW.xy * 0.5 + 0.5;
                    ${_FX_GLSL_PREPASS}

                    float fres  = pow(1.0 - clamp(dot(normalize(vViewDir), normalize(vNormalW)), 0.0, 1.0), uPower);
                    float pulse = uPulseSpeed > 0.0 ? (0.78 + 0.22 * sin(uTime * uPulseSpeed)) : 1.0;

                    vec3  noiseCoord = vNormalW * max(uNoiseScale, 0.001) + vec3(0.0, -uTime * uFlickerSpeed, 0.0);
                    float flame  = _noise(noiseCoord) * 0.7 + _noise(noiseCoord * 2.3 + 11.0) * 0.3;
                    float shaped = mix(1.0, flame * 1.7, clamp(uJagged, 0.0, 1.0));

                    vec3  col   = uColor * fres * uIntensity * pulse;
                    float alpha = clamp(fres * pulse * shaped, 0.0, 1.0);
                    float fxMask = fres;

                    ${_FX_GLSL_MAINPASS}
                    gl_FragColor = vec4(max(col, vec3(0.0)), clamp(alpha, 0.0, 1.0));
                }
            `,
            transparent: true,
            depthWrite:  false,
            blending:    THREE.AdditiveBlending,
            side:        THREE.DoubleSide,
        });
        this._shellMesh = new THREE.Mesh(shellGeo, this._shellMat);
        this._shellMesh.frustumCulled = false;
        this._shellMesh.userData = this.userData;
        this._scene.add(this._shellMesh);
    }

    _makeBillboardMaterial(angleOffset) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uCenter:       { value: new THREE.Vector3() },
                uAngleOffset:  { value: angleOffset },
                uRadius:       { value: 0.22 },
                uAlign:        { value: 1.0 },
                uWidth:        { value: 0.6 },
                uHeight:       { value: 1.8 },
                uColorBottom:  { value: new THREE.Color(0xff9500) },
                uColorTop:     { value: new THREE.Color(0xffffff) },
                uIntensity:    { value: 1.5 },
                uPulseMul:     { value: 1.0 },
                uTime:         { value: 0 },
                uScrollSpeed:  { value: 0.6 },
                uJagged:       { value: 0.65 },
                uNoiseScale:   { value: 8.0 },
                uFlickerSpeed: { value: 3.0 },
                uTex:          { value: _resolveAuraTexture(this._config.billboardTexture) },
                // Motion — each card keeps its own uAngleOffset as a phase
                // seed, so orbit/float never look perfectly synchronized
                // across cards even though they share the same speeds.
                // uEnvelope is the 'spiral' mode's fade in/out (1 for the
                // other modes, which don't have a life cycle to fade).
                uOrbitSpeed:   { value: 0.0 },
                uFloatSpeed:   { value: 0.0 },
                uFloatAmount:  { value: 0.0 },
                uEnvelope:     { value: 1.0 },
                uJitter:       { value: new THREE.Vector3() },
                // Flipbook — same idea as particles' Sprite Sheet module,
                // driven by time instead of per-particle life.
                uFlipEnabled:  { value: 0.0 },
                uFlipCols:     { value: 1.0 },
                uFlipRows:     { value: 1.0 },
                uFlipFrame:    { value: 0.0 },
                ..._emptyFxUniforms(),
            },
            vertexShader: /* glsl */`
                uniform vec3  uCenter;
                uniform float uAngleOffset;
                uniform float uRadius;
                uniform float uAlign;
                uniform float uWidth;
                uniform float uHeight;
                uniform float uTime;
                uniform float uOrbitSpeed;
                uniform float uFloatSpeed;
                uniform float uFloatAmount;
                uniform vec3  uJitter;
                varying vec2 vUv;
                void main(){
                    vUv = uv;
                    float ang = uAngleOffset + uTime * uOrbitSpeed;
                    vec3 ringOffset  = vec3(cos(ang), 0.0, sin(ang)) * uRadius;
                    vec3 worldCenter = uCenter + ringOffset + uJitter;
                    worldCenter.y   += sin(uTime * uFloatSpeed + uAngleOffset * 3.0) * uFloatAmount;

                    vec3 toCam   = normalize(cameraPosition - worldCenter);
                    vec3 worldUp = vec3(0.0, 1.0, 0.0);
                    vec3 right   = cross(worldUp, toCam);
                    if (length(right) < 0.001) right = vec3(1.0, 0.0, 0.0);
                    right = normalize(right);
                    vec3 fullUp  = normalize(cross(toCam, right));
                    vec3 up      = mix(fullUp, worldUp, uAlign);

                    vec3 worldPos = worldCenter + right * (position.x * uWidth)
                                                 + up    * ((position.y + 0.5) * uHeight);
                    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3  uColorBottom;
                uniform vec3  uColorTop;
                uniform float uIntensity;
                uniform float uPulseMul;
                uniform float uTime;
                uniform float uScrollSpeed;
                uniform float uJagged;
                uniform float uNoiseScale;
                uniform float uFlickerSpeed;
                uniform float uEnvelope;
                uniform sampler2D uTex;
                uniform float uFlipEnabled;
                uniform float uFlipCols;
                uniform float uFlipRows;
                uniform float uFlipFrame;
                varying vec2 vUv;
                ${_FX_GLSL_DECL}

                float _hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
                float _noise(vec2 p){
                    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
                    return mix(mix(_hash(i),_hash(i+vec2(1.0,0.0)),f.x),
                               mix(_hash(i+vec2(0.0,1.0)),_hash(i+vec2(1.0,1.0)),f.x), f.y);
                }
                vec2 _flipbookUV(vec2 uv, float cols, float rows, float frame){
                    float total = max(cols * rows, 1.0);
                    float f     = mod(frame, total);
                    float col   = mod(f, cols);
                    float row   = floor(f / cols);
                    vec2  cell  = vec2(1.0 / cols, 1.0 / rows);
                    vec2  origin = vec2(col * cell.x, 1.0 - (row + 1.0) * cell.y);
                    return origin + uv * cell;
                }

                void main(){
                    vec2 cuv = vUv;
                    ${_FX_GLSL_PREPASS}

                    vec2 scrolled = cuv + vec2(0.0, -uTime * uScrollSpeed);
                    float n = _noise(scrolled * uNoiseScale) * 0.6
                            + _noise(scrolled * uNoiseScale * 2.3 + 7.0) * 0.4;
                    float flicker = 0.85 + 0.15 * sin(uTime * uFlickerSpeed + cuv.x * 6.0);

                    float vertFade  = smoothstep(1.0, 0.15, cuv.y);
                    float horizFade = pow(clamp(1.0 - abs(cuv.x - 0.5) * 2.0, 0.0, 1.0), 0.6);
                    float smoothShape = vertFade * horizFade;
                    float shape = mix(smoothShape, smoothShape * n * 1.6, clamp(uJagged, 0.0, 1.0));

                    vec2 texUV = uFlipEnabled > 0.5 ? _flipbookUV(cuv, uFlipCols, uFlipRows, uFlipFrame) : cuv;
                    vec4 texSample = texture2D(uTex, texUV);
                    float texMask = texSample.a * dot(texSample.rgb, vec3(0.333));

                    vec3  col   = mix(uColorBottom, uColorTop, cuv.y) * uIntensity * uPulseMul;
                    float alpha = clamp(shape * flicker, 0.0, 1.0) * mix(1.0, texMask, 0.85) * uEnvelope;
                    float fxMask = texMask;

                    ${_FX_GLSL_MAINPASS}
                    if (alpha < 0.012) discard;
                    gl_FragColor = vec4(max(col, vec3(0.0)), clamp(alpha, 0.0, 1.0));
                }
            `,
            transparent: true,
            depthWrite:  false,
            blending:    THREE.AdditiveBlending,
            side:        THREE.DoubleSide,
        });
    }

    _buildBillboards() {
        this._billboardGeo = new THREE.PlaneGeometry(1, 1);
        this._billboards = [];
        this._rebuildBillboards(this._config.billboardCount ?? 4);
    }

    _rebuildBillboards(count) {
        this._billboards.forEach(m => { this._scene.remove(m); m.material.dispose(); });
        this._billboards = [];
        this._billboardData = [];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const mesh  = new THREE.Mesh(this._billboardGeo, this._makeBillboardMaterial(angle));
            mesh.frustumCulled = false;
            mesh.userData = this.userData;
            this._scene.add(mesh);
            this._billboards.push(mesh);
            this._billboardData.push(this._newCardSpiral(angle));
        }
    }

    // 'spiral' movement — ported from special_fx.js's AuraEffect orbs: each
    // card lives out its own 0..1 life, spiralling around (angle) and
    // rising (y) over that life, then resets to the bottom and does it
    // again — the classic "energy climbing the body" anime look, instead
    // of sitting at a fixed ring position. Reuses the existing Orbit/Float
    // speed sliders as the spiral's rotation/rise speed so no new sliders
    // were needed for it.
    _newCardSpiral(baseAngle = 0) {
        return {
            angle0:  baseAngle,
            vAngleSign: Math.random() < 0.5 ? -1 : 1,
            vAngleRand: 0.6 + Math.random() * 0.8,
            vyRand:  0.7 + Math.random() * 0.6,
            life:    Math.random(),
            maxLife: 0.8 + Math.random() * 0.9,
        };
    }

    _updateShell() {
        const c = this._config;
        this._shellMesh.visible = c.shellEnabled !== false;
        if (!this._shellMesh.visible) return;
        const radius = Math.max(0.05, (c.shellRadius ?? 12) / 10);
        const height = Math.max(0.2, (c.shellHeight ?? 15) / 10);
        this._shellMesh.position.set(
            this.position.x + (c.shellOffsetX ?? 0),
            this.position.y + (c.shellOffsetY ?? 0),
            this.position.z + (c.shellOffsetZ ?? 0),
        );
        this._shellMesh.scale.set(radius, radius * height, radius);
        this._shellMat.uniforms.uColor.value.set(c.shellColor ?? '#a78bfa');
        this._shellMat.uniforms.uIntensity.value    = Math.max(0, (c.shellIntensity ?? 60) / 40) * this._pulseMul;
        this._shellMat.uniforms.uPower.value        = Math.max(0.2, (c.shellSharpness ?? 55) / 25);
        this._shellMat.uniforms.uPulseSpeed.value   = (c.shellPulseSpeed ?? 30) / 25;
        this._shellMat.uniforms.uJagged.value       = Math.max(0, Math.min(1, (c.shellJagged ?? 0) / 100));
        this._shellMat.uniforms.uNoiseScale.value   = Math.max(0.1, (c.shellNoiseScale ?? 20) / 10);
        this._shellMat.uniforms.uFlickerSpeed.value = Math.max(0, (c.shellFlickerSpeed ?? 45) / 40);
        this._shellMat.uniforms.uTime.value         = this._time;
        this._syncShaderFxUniforms(this._shellMat);
    }

    // Position the shell can be nudged to, independent of the aura's own
    // anchor point — e.g. to sit a fire-aura's glow a bit lower than the
    // energy cards, or offset it sideways for a stylized look. Mirrors
    // the Blender "Mapping node driven by an Empty" trick described above.
    setShellOffset(x = 0, y = 0, z = 0) {
        this.setConfig({ shellOffsetX: x, shellOffsetY: y, shellOffsetZ: z });
    }
    getShellOffset() {
        const c = this._config;
        return { x: c.shellOffsetX ?? 0, y: c.shellOffsetY ?? 0, z: c.shellOffsetZ ?? 0 };
    }

    // ── Event trigger — a one-shot pulse: Shell/Billboard/Lightning
    // intensity briefly spikes then decays back to normal. Minimal, self-
    // contained "event" hook (fire it from a skill/attack activation,
    // a keyframe, wherever) rather than a full generic event-bus, since
    // that's what's actually usable today without a wider event system
    // elsewhere in the app to plug into.
    triggerPulse({ strength = 1.5, duration = 0.4 } = {}) {
        this._pulse = { t: 0, duration: Math.max(0.05, duration), strength: Math.max(0, strength) };
    }
    _updatePulse(dt) {
        if (!this._pulse) { this._pulseMul = 1; return; }
        this._pulse.t += dt;
        const p = Math.min(1, this._pulse.t / this._pulse.duration);
        const env = Math.sin((1 - p) * Math.PI * 0.5); // fast rise, eased decay back to 1
        this._pulseMul = 1 + this._pulse.strength * env;
        if (p >= 1) this._pulse = null;
    }

    _updateBillboards(dt = 0) {
        const c = this._config;
        const count = Math.max(1, Math.min(8, Math.round(c.billboardCount ?? 4)));
        if (this._billboards.length !== count) this._rebuildBillboards(count);
        const align = c.billboardAlign === 'camera' ? 0.0 : 1.0;
        const motion = c.billboardMotion || 'static';
        const doOrbit  = motion === 'orbit'  || motion === 'both';
        const doFloat  = motion === 'float'  || motion === 'both';
        const doSpiral = motion === 'spiral';
        const dragMul  = Math.max(0, Math.min(1, c.billboardDrag ?? 1));
        const gravity  = c.billboardGravity ?? 0;
        const turb     = Math.max(0, (c.billboardTurbulence ?? 0) / 100);
        const objH     = Math.max(0.1, (c.shellHeight ?? 15) / 10);
        const objR     = Math.max(0, c.billboardRadius ?? 0.22);
        const flipOn   = !!c.billboardFlipbookEnabled && ((c.billboardFlipbookCols ?? 1) > 1 || (c.billboardFlipbookRows ?? 1) > 1);
        const flipCols = Math.max(1, Math.round(c.billboardFlipbookCols ?? 4));
        const flipRows = Math.max(1, Math.round(c.billboardFlipbookRows ?? 4));
        const flipFrame = Math.floor(this._time * Math.max(0.1, c.billboardFlipbookFps ?? 12)) % Math.max(1, flipCols * flipRows);

        this._billboards.forEach((mesh, i) => {
            const u = mesh.material.uniforms;
            const d = this._billboardData[i];
            u.uRadius.value       = objR;
            u.uAlign.value        = align;
            u.uWidth.value        = Math.max(0.02, c.billboardWidth ?? 0.6);
            u.uHeight.value       = Math.max(0.05, c.billboardHeight ?? 1.8);
            u.uColorBottom.value.set(c.billboardColorBottom ?? '#ff9500');
            u.uColorTop.value.set(c.billboardColorTop ?? '#ffffff');
            u.uIntensity.value    = Math.max(0, (c.billboardIntensity ?? 150) / 100);
            u.uPulseMul.value     = this._pulseMul;
            u.uScrollSpeed.value  = c.billboardScrollSpeed ?? 0.6;
            u.uJagged.value       = Math.max(0, Math.min(1, (c.billboardJagged ?? 65) / 100));
            u.uNoiseScale.value   = Math.max(0.5, c.billboardNoiseScale ?? 8);
            u.uFlickerSpeed.value = Math.max(0, c.billboardFlickerSpeed ?? 3);
            u.uTime.value         = this._time;
            u.uFlipEnabled.value  = flipOn ? 1 : 0;
            u.uFlipCols.value     = flipCols;
            u.uFlipRows.value     = flipRows;
            u.uFlipFrame.value    = flipFrame;

            // Turbulência — small per-card noise wobble, independent of
            // whichever Movimento mode is active (same spirit as
            // particles' Turbulência force).
            if (turb > 0) {
                const seed = i * 17.13;
                u.uJitter.value.set(
                    Math.sin(this._time * 1.3 + seed) * turb * 0.3,
                    Math.sin(this._time * 1.7 + seed * 1.7) * turb * 0.2,
                    Math.cos(this._time * 1.5 + seed * 2.3) * turb * 0.3,
                );
            } else {
                u.uJitter.value.set(0, 0, 0);
            }

            if (doSpiral) {
                // Gravidade pulls the rise rate back like an ember losing
                // momentum; drag scales the whole cycle's speed down.
                const riseSpeed = Math.max(0.05, (c.billboardFloatSpeed ?? 1.2)) * dragMul - gravity * 0.05;
                d.life += (dt * Math.max(0.02, riseSpeed) * d.vyRand) / d.maxLife;
                if (d.life >= 1) Object.assign(d, this._newCardSpiral(d.angle0), { life: 0 });
                const p = d.life;
                const env = Math.sin(p * Math.PI);
                const ang = d.angle0 + d.vAngleSign * d.vAngleRand * (c.billboardOrbitSpeed ?? 0.4) * dragMul * p * d.maxLife * 6.0;
                u.uAngleOffset.value = ang;
                u.uCenter.value.copy(this.position);
                u.uCenter.value.y += -objH * 0.5 + p * d.maxLife * objH * d.vyRand;
                u.uOrbitSpeed.value  = 0; // angle already fully computed above for spiral
                u.uFloatSpeed.value  = 0;
                u.uFloatAmount.value = 0;
                u.uEnvelope.value    = env;
            } else {
                u.uAngleOffset.value = d.angle0;
                u.uCenter.value.copy(this.position);
                u.uOrbitSpeed.value   = doOrbit ? (c.billboardOrbitSpeed ?? 0.4) * dragMul : 0;
                u.uFloatSpeed.value   = doFloat ? (c.billboardFloatSpeed ?? 1.2) * dragMul : 0;
                u.uFloatAmount.value  = doFloat ? (c.billboardFloatAmount ?? 0.15) : 0;
                u.uEnvelope.value     = 1;
            }

            if (this._lastTexName !== c.billboardTexture) {
                u.uTex.value = _resolveAuraTexture(c.billboardTexture);
                this._lastTexName = c.billboardTexture;
            }
            this._syncShaderFxUniforms(mesh.material);
        });
    }

    _newLightningArc(objH = 2, objR = 0.6) {
        const angA = Math.random() * Math.PI * 2;
        const angB = angA + Math.PI * (0.25 + Math.random() * 0.9);
        const rA   = objR * (0.85 + Math.random() * 0.15);
        const rB   = objR * (0.85 + Math.random() * 0.15);
        const ySpan = objH * 0.5;
        const yMid  = objH * (0.25 + Math.random() * 0.5);
        return {
            angA, angB, rA, rB,
            yA: yMid + (Math.random() - 0.5) * ySpan,
            yB: yMid + (Math.random() - 0.5) * ySpan,
            reshuffleTimer: Math.random() * 0.20,
            reshuffleTime:  0.08 + Math.random() * 0.18,
        };
    }

    _buildLightning() {
        this._lightnings = [];
        this._lightningData = [];
        this._rebuildLightning(this._config.lightningCount ?? 8, this._config.lightningSegments ?? 8);
    }

    _rebuildLightning(count, segs = this._config.lightningSegments ?? 8) {
        this._lightnings.forEach(l => l.dispose());
        this._lightnings = [];
        this._lightningData = [];
        for (let i = 0; i < count; i++) {
            this._lightnings.push(new _LightningArc(this._scene, this._config.lightningColor ?? '#55bbff', segs));
            this._lightningData.push(this._newLightningArc());
        }
        this._lastLightningSegs = segs;
    }

    _updateLightning(dt) {
        const c = this._config;
        const count = Math.max(0, Math.min(24, Math.round(c.lightningCount ?? 8)));
        const segs  = Math.max(2, Math.min(16, Math.round(c.lightningSegments ?? 8)));
        if (this._lightnings.length !== count || this._lastLightningSegs !== segs) this._rebuildLightning(count, segs);

        if (!c.lightningEnabled || count === 0) {
            const zero = _ZERO_VEC3;
            this._lightnings.forEach(l => { l.visible = false; l.update(zero, zero, dt); });
            return;
        }

        const center = new THREE.Vector3(
            this.position.x + (c.lightningOffsetX ?? 0),
            this.position.y + (c.lightningOffsetY ?? 0),
            this.position.z + (c.lightningOffsetZ ?? 0),
        );
        const objR = Math.max(0.05, (c.lightningRadius ?? 12) / 10);
        const objH = Math.max(0.1, (c.lightningHeight ?? 15) / 10);
        const baseY = center.y - objH * 0.5;
        const speedMul = Math.max(0, (c.lightningSpeed ?? 100) / 100);
        const opacityMul = Math.max(0, (c.lightningIntensity ?? 100) / 100) * this._pulseMul;
        const jitterMul = Math.max(0, (c.lightningJitter ?? 100) / 100);
        const A = new THREE.Vector3(), B = new THREE.Vector3();

        this._lightningData.forEach((d, i) => {
            const l = this._lightnings[i];
            l.visible = true;
            l.setColor(c.lightningColor ?? '#55bbff');
            l.setOpacityScale(opacityMul);
            l.setJitter(jitterMul);
            d.reshuffleTimer -= dt * speedMul;
            if (d.reshuffleTimer <= 0) Object.assign(d, this._newLightningArc(objH, objR));
            A.set(center.x + Math.cos(d.angA) * d.rA, baseY + d.yA, center.z + Math.sin(d.angA) * d.rA);
            B.set(center.x + Math.cos(d.angB) * d.rB, baseY + d.yB, center.z + Math.sin(d.angB) * d.rB);
            l.update(A, B, dt);
        });
    }

    update(dt) {
        this._time += dt;
        this._marker.getWorldPosition(this.position);
        this._updatePulse(dt);
        this._updateShell();
        this._updateBillboards(dt);
        this._updateLightning(dt);
    }

    getWorldPosition(target) { return target.copy(this.position); }

    toJSON() {
        return { name: this.name, position: this.position.toArray(), config: { ...this._config } };
    }
    static fromJSON(scene, data) {
        const sys = new AuraSystem(scene, { ...data.config, name: data.name, id: data.id });
        if (data.position) sys._marker.position.fromArray(data.position);
        if (data.attachedToUuid) {
            // Best-effort like ParticleSystem's own restore: uuid is kept in
            // config, actual re-resolution against the reloaded scene graph
            // (if desired) is left to the caller, same as particles today.
        }
        return sys;
    }

    dispose() {
        if (this._marker.parent) this._marker.parent.remove(this._marker);
        this._scene.remove(this._shellMesh);
        this._shellMesh.geometry.dispose();
        this._shellMat.dispose();
        this._billboards.forEach(m => { this._scene.remove(m); m.material.dispose(); });
        this._billboards = [];
        this._billboardGeo.dispose();
        this._lightnings.forEach(l => l.dispose());
        this._lightnings = [];
    }
}

export class AuraLab {
    constructor(scene) {
        this._scene = scene;
        this._systems = [];
        // Lightning (Particle Labs) — same AuraSystem class/lightning code
        // as the Aura's own Lightning section, just with Shell/Billboard
        // switched off so only the arcs render. Kept in a separate list
        // from _systems so it can live directly in the normal Sistema tab
        // (like a particle system) instead of behind the Aura Labs segment.
        this._lightningSystems = [];
    }
    createAura(config = {}) {
        const sys = new AuraSystem(this._scene, config);
        this._systems.push(sys);
        window.dispatchEvent(new Event('labs-systems-changed'));
        return sys;
    }
    removeAura(sys) {
        sys.dispose();
        const i = this._systems.indexOf(sys);
        if (i >= 0) this._systems.splice(i, 1);
        window.dispatchEvent(new Event('labs-systems-changed'));
    }
    createLightning(config = {}) {
        const sys = new AuraSystem(this._scene, {
            name: 'Lightning',
            ...config,
            shellEnabled: false,
            billboardCount: 1, billboardIntensity: 0,
            lightningEnabled: true,
        });
        sys.userData.isLightningOnly = true;
        sys._marker.userData.isLightningOnly = true;
        this._lightningSystems.push(sys);
        window.dispatchEvent(new Event('labs-systems-changed'));
        return sys;
    }
    removeLightning(sys) {
        sys.dispose();
        const i = this._lightningSystems.indexOf(sys);
        if (i >= 0) this._lightningSystems.splice(i, 1);
        window.dispatchEvent(new Event('labs-systems-changed'));
    }
    getLightningSystems() { return this._lightningSystems; }
    getSystems() { return this._systems; }
    update(dt) {
        this._systems.forEach(s => s.update(dt));
        this._lightningSystems.forEach(s => s.update(dt));
    }
    clear() { [...this._systems].forEach(s => this.removeAura(s)); }
    clearLightnings() { [...this._lightningSystems].forEach(s => this.removeLightning(s)); }

    // ── .nex save/load support — mirrors ParticleLab.serializeSystems/
    // restoreSystems so index.html's save handler can fold auras into the
    // same file as particle systems instead of them being invisible to
    // "Salvar .nex" entirely. ─────────────────────────────────────────
    serializeAuras() { return this._systems.map(s => s.toJSON()); }
    restoreAuras(jsonArray = []) {
        this.clear();
        jsonArray.forEach(json => {
            try {
                const sys = AuraSystem.fromJSON(this._scene, json);
                this._systems.push(sys);
            } catch (e) { console.warn('[AuraLab] Erro ao restaurar aura:', e); }
        });
        window.dispatchEvent(new Event('labs-systems-changed'));
    }
    serializeLightnings() { return this._lightningSystems.map(s => s.toJSON()); }
    restoreLightnings(jsonArray = []) {
        this.clearLightnings();
        jsonArray.forEach(json => {
            try {
                const sys = AuraSystem.fromJSON(this._scene, json);
                sys.userData.isLightningOnly = true;
                sys._marker.userData.isLightningOnly = true;
                this._lightningSystems.push(sys);
            } catch (e) { console.warn('[AuraLab] Erro ao restaurar lightning:', e); }
        });
        window.dispatchEvent(new Event('labs-systems-changed'));
    }
}

window._AuraEngine = { AuraSystem, AuraLab };
