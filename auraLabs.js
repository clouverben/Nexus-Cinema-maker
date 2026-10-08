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

// ═══════════════════════════════════════════════════════════════════════
//  LIGHTNING GUIADO POR PARTÍCULAS (Lightning solo do Particle Labs)
//
//  Cada Lightning solo tem um ParticleSystem interno e INVISÍVEL (vive numa
//  cena auxiliar, sem marker no Objects panel) que serve só de motor de
//  comportamento: cada partícula viva = um raio. Assim TODAS as abas do painel
//  esquerdo do Labs funcionam no raio, sem reescrever 60+ módulos:
//    • Emissão      → de onde cada raio nasce (os 2 extremos saem do mesmo
//                     formato de emissão), taxa/burst, vida, tamanho, cor…
//    • Comportamento→ forças/operadores movem, escalam e apagam o raio
//    • Aparência    → Sprite (fita com textura), Feixe (largura/crepitação)
//                     e Malha (tubo 3D)
//    • Shader/Estilo/Flipbook → mesmo fragment shader das partículas, com os
//                     mesmos uniforms (compartilhados por referência)
//    • Animação     → curvas de tamanho/opacidade/cor ao longo da vida
// ═══════════════════════════════════════════════════════════════════════
const _BOLT_MAX = 128;                    // raios simultâneos (partículas do motor)
const _BOLT_STRAND_MAX = 384;             // tronco + ramificações
const _BOLT_SEG_MAX = 16;
const _TUBE_MAX = _BOLT_STRAND_MAX * _BOLT_SEG_MAX;

const _bs = {
    A: new THREE.Vector3(), B: new THREE.Vector3(), AB: new THREE.Vector3(), up: new THREE.Vector3(),
    p1: new THREE.Vector3(), p2: new THREE.Vector3(), T: new THREE.Vector3(), V: new THREE.Vector3(),
    S: new THREE.Vector3(), D: new THREE.Vector3(), cam: new THREE.Vector3(0, 0, 10),
    M: new THREE.Matrix4(), Q: new THREE.Quaternion(), SC: new THREE.Vector3(), POS: new THREE.Vector3(),
    Y: new THREE.Vector3(0, 1, 0), C: new THREE.Color(),
    br: new Float32Array(5 * 3),
};

// Um raio (tronco). Guarda a linha-guia (centerline) — o Choque Elétrico lê
// _line.geometry.attributes.position para testar colisão, igual aos raios antigos.
class _Bolt {
    constructor() {
        this.visible = false;
        this.SEGS = 0;
        this._geo = new THREE.BufferGeometry();
        this._line = { geometry: this._geo };
        this._flick = 1; this._flickT = 0; this._crackleT = 0;
        this.noise = new Float32Array((_BOLT_SEG_MAX + 1) * 3);
        this._reroll();
        this._setSegs(8);
    }
    _setSegs(n) {
        if (this.SEGS === n) return;
        this.SEGS = n;
        this._geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
    }
    _reroll() { for (let i = 0; i < this.noise.length; i++) this.noise[i] = Math.random(); }
    dispose() { this._geo.dispose(); }
}

class _BoltRenderer {
    constructor(scene, driver) {
        this._scene = scene;
        this._driver = driver;
        this.bolts = [];

        const maxV = _BOLT_STRAND_MAX * (_BOLT_SEG_MAX + 1) * 2;
        this._pos = new Float32Array(maxV * 3);
        this._col = new Float32Array(maxV * 3);
        this._opa = new Float32Array(maxV);
        this._uv  = new Float32Array(maxV * 2);
        this._frm = new Float32Array(maxV);
        this._rot = new Float32Array(maxV);
        this._idx = new Uint32Array(_BOLT_STRAND_MAX * _BOLT_SEG_MAX * 6);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
        g.setAttribute('color',    new THREE.BufferAttribute(this._col, 3));
        g.setAttribute('aOpacity', new THREE.BufferAttribute(this._opa, 1));
        g.setAttribute('aUv',      new THREE.BufferAttribute(this._uv, 2));
        g.setAttribute('aFrame',   new THREE.BufferAttribute(this._frm, 1));
        g.setAttribute('aRot',     new THREE.BufferAttribute(this._rot, 1));
        g.setIndex(new THREE.BufferAttribute(this._idx, 1));
        g.setDrawRange(0, 0);
        this._geo = g;

        // Mesmos objetos de uniform do motor: textura, emissão, Shader FX (6
        // camadas), Estilo, Flipbook e uTime acompanham qualquer edição do Labs.
        const u = driver._mat.uniforms;
        const uniforms = {
            uTexture: u.uTexture, uLightEmission: u.uLightEmission, uTime: u.uTime,
            uFxData: u.uFxData, uFxColor: u.uFxColor,
            uStyleMode: u.uStyleMode, uStyleLevels: u.uStyleLevels,
            uStyleOutline: u.uStyleOutline, uStyleOutlineW: u.uStyleOutlineW,
            uFlipGrid: u.uFlipGrid,
        };
        // O fragment shader é o MESMO das partículas; só troca a fonte da UV
        // (gl_PointCoord → vUv da fita). Assim Shader FX/Estilo/Flipbook ficam
        // idênticos aos de um sistema de partículas, sem código duplicado.
        const frag = 'varying vec2 vUv;\n' + driver._mat.fragmentShader.replace(/gl_PointCoord/g, 'vUv');
        this._mat = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: /* glsl */`
                attribute float aOpacity; attribute vec2 aUv; attribute float aFrame; attribute float aRot;
                varying vec3 vColor; varying float vOpacity; varying float vRot; varying float vFrame; varying vec2 vUv;
                void main() {
                    vColor = color; vOpacity = aOpacity; vRot = aRot; vFrame = aFrame; vUv = aUv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: frag,
            blending: driver._mat.blending,
            depthWrite: false, transparent: true, vertexColors: true, side: THREE.DoubleSide,
        });
        this.mesh = new THREE.Mesh(g, this._mat);
        this.mesh.frustumCulled = false;
        this.mesh.userData = { isLab: true, isAura: true, isHelper: true };
        this.mesh.raycast = () => {};
        scene.add(this.mesh);
        this._tube = null;
    }

    _ensureTube() {
        if (this._tube) return this._tube;
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.5, emissive: 0x55bbff, emissiveIntensity: 1 });
        const t = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, false), mat, _TUBE_MAX);
        t.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        t.frustumCulled = false; t.count = 0; t.visible = false;
        t.userData = { isLab: true, isAura: true, isHelper: true };
        t.raycast = () => {};
        this._scene.add(t);
        this._tube = t;
        return t;
    }

    hideAll() {
        this.bolts.forEach(b => { b.visible = false; });
        this._geo.setDrawRange(0, 0);
        this.mesh.visible = false;
        if (this._tube) this._tube.visible = false;
    }

    // ── linha-guia em ziguezague (mesma matemática do _LightningArc) ──────
    _centerline(A, B, N, noise, jitterMul, out) {
        _bs.AB.subVectors(B, A);
        const len = _bs.AB.length();
        _bs.up.set(0, 1, 0);
        if (Math.abs(_bs.AB.y / Math.max(len, 0.001)) > 0.9) _bs.up.set(1, 0, 0);
        _bs.p1.crossVectors(_bs.AB, _bs.up).normalize();
        _bs.p2.crossVectors(_bs.AB, _bs.p1).normalize();
        const amp = (len * 0.14 + 0.03) * jitterMul;
        for (let i = 0; i <= N; i++) {
            const t = i / N, env = Math.sin(t * Math.PI);
            const d1 = (noise[i * 3] - 0.5) * 2 * amp * env;
            const d2 = (noise[i * 3 + 1] - 0.5) * 2 * amp * env;
            out[i * 3]     = A.x + _bs.AB.x * t + _bs.p1.x * d1 + _bs.p2.x * d2;
            out[i * 3 + 1] = A.y + _bs.AB.y * t + _bs.p1.y * d1 + _bs.p2.y * d2;
            out[i * 3 + 2] = A.z + _bs.AB.z * t + _bs.p1.z * d1 + _bs.p2.z * d2;
        }
        return len;
    }

    _ribbon(pts, k, width, r, g, b, op, frame, rot) {
        if (this._strands >= _BOLT_STRAND_MAX) return;
        const base = this._vOff, cam = _bs.cam;
        for (let i = 0; i < k; i++) {
            const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
            const i0 = i > 0 ? i - 1 : 0, i1 = i < k - 1 ? i + 1 : k - 1;
            _bs.T.set(pts[i1 * 3] - pts[i0 * 3], pts[i1 * 3 + 1] - pts[i0 * 3 + 1], pts[i1 * 3 + 2] - pts[i0 * 3 + 2]);
            _bs.V.set(cam.x - x, cam.y - y, cam.z - z);
            _bs.S.crossVectors(_bs.T, _bs.V);
            if (_bs.S.lengthSq() < 1e-12) _bs.S.set(1, 0, 0);
            _bs.S.normalize();
            const t = k > 1 ? i / (k - 1) : 0;
            const hw = 0.5 * width * (0.55 + 0.45 * Math.sin(Math.PI * t));
            for (let side = 0; side < 2; side++) {
                const v = base + i * 2 + side, sg = side ? 1 : -1;
                this._pos[v * 3]     = x + _bs.S.x * hw * sg;
                this._pos[v * 3 + 1] = y + _bs.S.y * hw * sg;
                this._pos[v * 3 + 2] = z + _bs.S.z * hw * sg;
                this._col[v * 3] = r; this._col[v * 3 + 1] = g; this._col[v * 3 + 2] = b;
                this._opa[v] = op; this._frm[v] = frame; this._rot[v] = rot;
                this._uv[v * 2] = t; this._uv[v * 2 + 1] = side;
            }
        }
        let io = this._iOff;
        for (let s = 0; s < k - 1; s++) {
            const a = base + s * 2, b2 = a + 1, c = a + 2, d = a + 3;
            this._idx[io++] = a; this._idx[io++] = b2; this._idx[io++] = c;
            this._idx[io++] = b2; this._idx[io++] = d; this._idx[io++] = c;
        }
        this._iOff = io; this._vOff += k * 2; this._strands++;
    }

    _tubes(pts, k, radius, r, g, b) {
        const t = this._tube;
        for (let i = 0; i < k - 1 && this._tubeN < _TUBE_MAX; i++) {
            _bs.D.set(pts[(i + 1) * 3] - pts[i * 3], pts[(i + 1) * 3 + 1] - pts[i * 3 + 1], pts[(i + 1) * 3 + 2] - pts[i * 3 + 2]);
            const len = _bs.D.length(); if (len < 1e-6) continue;
            _bs.D.multiplyScalar(1 / len);
            _bs.Q.setFromUnitVectors(_bs.Y, _bs.D);
            _bs.POS.set((pts[i * 3] + pts[(i + 1) * 3]) / 2, (pts[i * 3 + 1] + pts[(i + 1) * 3 + 1]) / 2, (pts[i * 3 + 2] + pts[(i + 1) * 3 + 2]) / 2);
            _bs.SC.set(radius, len, radius);
            _bs.M.compose(_bs.POS, _bs.Q, _bs.SC);
            t.setMatrixAt(this._tubeN, _bs.M);
            _bs.C.setRGB(r, g, b);
            t.setColorAt(this._tubeN, _bs.C);
            this._tubeN++;
        }
    }

    render({ particles, driver, cfg, dt, pulse, cam }) {
        const dc = driver._config;
        if (cam) _bs.cam.copy(cam);
        const N = Math.max(2, Math.min(_BOLT_SEG_MAX, Math.round(cfg.lightningSegments ?? 8)));
        const n = Math.min(particles.length, _BOLT_MAX);
        while (this.bolts.length < n) this.bolts.push(new _Bolt());

        // Aparência → modo de desenho
        const rm = dc.rendererMode;
        const asTube = rm === 'mesh';
        const asBeam = rm === 'beam';
        const wScale = asBeam ? Math.max(0.05, (dc.beamWidth ?? 0.12) / 0.12) : 1;
        const jitterMul = Math.max(0, (cfg.lightningJitter ?? 100) / 100) * (asBeam ? 1 + (dc.beamNoiseAmount ?? 0) * 8 : 1);
        const hz = asBeam ? Math.max(1, (dc.beamNoiseSpeed ?? 12) * 4) : 45;
        const opMul = Math.max(0, (cfg.lightningIntensity ?? 100) / 100) * pulse;
        const bright = Math.max(1, opMul);
        // Operador "Filhos (Densidade)" = ramificações. Os troncos têm prioridade:
        // o limite de fitas é dividido para que nenhum raio perca o tronco.
        const branches = Math.min(4, Math.max(0, Math.round(dc.childrenCount ?? 0)),
            n > 0 ? Math.floor((_BOLT_STRAND_MAX - n) / n) : 0);
        const legacyFlicker = !(dc.flickerAmt > 0);   // com o módulo Cintilação ligado, ele manda

        if (this._mat.blending !== driver._mat.blending) { this._mat.blending = driver._mat.blending; this._mat.needsUpdate = true; }

        this._strands = 0; this._vOff = 0; this._iOff = 0; this._tubeN = 0;
        let tube = null;
        if (asTube) {
            tube = this._ensureTube();
            tube.material.metalness = dc.meshMetalness ?? 0.3;
            tube.material.roughness = dc.meshRoughness ?? 0.5;
            tube.material.emissiveIntensity = dc.meshEmissive ?? 1;
            tube.material.emissive.set(cfg.lightningColor ?? '#55bbff');
        }

        for (let i = 0; i < n; i++) {
            const p = particles[i], b = this.bolts[i];
            if (!p.boltVec) { b.visible = false; continue; }
            b._setSegs(N);
            b._flickT -= dt; if (b._flickT <= 0) { b._flick = 0.4 + Math.random() * 0.6; b._flickT = 0.02 + Math.random() * 0.05; }
            b._crackleT -= dt; if (b._crackleT <= 0) { b._reroll(); b._crackleT = 1 / hz; }

            _bs.A.copy(p.pos);
            _bs.B.copy(p.pos).addScaledVector(p.boltVec, Math.max(0.1, p.aspect || 1));
            const arr = b._geo.attributes.position.array;
            const len = this._centerline(_bs.A, _bs.B, N, b.noise, jitterMul, arr);
            b._geo.attributes.position.needsUpdate = true;

            const op = p.opacity * opMul * (legacyFlicker ? b._flick : 1);
            b.visible = op > 0.003 && p.size > 0.0005;
            b._opacity = op;
            if (!b.visible) continue;

            const width = Math.max(0.002, p.size * wScale);
            const r = p.color.r * bright, g = p.color.g * bright, bl = p.color.b * bright;
            if (asTube) this._tubes(arr, N + 1, width * 0.5, r, g, bl);
            else this._ribbon(arr, N + 1, width, r, g, bl, op, p.flipFrame || 0, p.rotation || 0);

            // Ramificações (Operador "Filhos (Densidade)")
            for (let k = 0; k < branches; k++) {
                const f = ((p.boltSeed || 0) * 13.7 + k * 0.381) % 1;
                const idx = 1 + Math.floor(f * (N - 1));
                const ox = arr[idx * 3], oy = arr[idx * 3 + 1], oz = arr[idx * 3 + 2];
                const phi = ((p.boltSeed || 0) * 6.2832 * (k + 1) * 1.7) % 6.2832;
                _bs.D.copy(_bs.AB).normalize().multiplyScalar(0.45)
                    .addScaledVector(_bs.p1, Math.cos(phi)).addScaledVector(_bs.p2, Math.sin(phi)).normalize();
                const bl2 = len * 0.35, bamp = (bl2 * 0.14 + 0.02) * jitterMul;
                for (let j = 0; j < 5; j++) {
                    const tt = j / 4, env = Math.sin(tt * Math.PI);
                    const nz = b.noise[((k * 5 + j) % _BOLT_SEG_MAX) * 3];
                    const nz2 = b.noise[((k * 5 + j) % _BOLT_SEG_MAX) * 3 + 1];
                    _bs.br[j * 3]     = ox + _bs.D.x * bl2 * tt + (_bs.p1.x * (nz - 0.5) + _bs.p2.x * (nz2 - 0.5)) * 2 * bamp * env;
                    _bs.br[j * 3 + 1] = oy + _bs.D.y * bl2 * tt + (_bs.p1.y * (nz - 0.5) + _bs.p2.y * (nz2 - 0.5)) * 2 * bamp * env;
                    _bs.br[j * 3 + 2] = oz + _bs.D.z * bl2 * tt + (_bs.p1.z * (nz - 0.5) + _bs.p2.z * (nz2 - 0.5)) * 2 * bamp * env;
                }
                if (asTube) this._tubes(_bs.br, 5, width * 0.3, r, g, bl);
                else this._ribbon(_bs.br, 5, width * 0.6, r, g, bl, op * 0.7, p.flipFrame || 0, (p.rotation || 0) + k + 1);
            }
        }
        for (let i = n; i < this.bolts.length; i++) this.bolts[i].visible = false;

        const g = this._geo;
        g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
        g.attributes.aOpacity.needsUpdate = true; g.attributes.aUv.needsUpdate = true;
        g.attributes.aFrame.needsUpdate = true;   g.attributes.aRot.needsUpdate = true;
        g.index.needsUpdate = true;
        g.setDrawRange(0, this._iOff);
        this.mesh.visible = !asTube && this._iOff > 0;
        if (this._tube) {
            this._tube.visible = asTube && this._tubeN > 0;
            this._tube.count = this._tubeN;
            this._tube.instanceMatrix.needsUpdate = true;
            if (this._tube.instanceColor) this._tube.instanceColor.needsUpdate = true;
        }
    }

    dispose() {
        this._scene.remove(this.mesh);
        this._geo.dispose(); this._mat.dispose();
        if (this._tube) { this._scene.remove(this._tube); this._tube.geometry.dispose(); this._tube.material.dispose(); this._tube.dispose?.(); }
        this.bolts.forEach(b => b.dispose());
        this.bolts.length = 0;
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
        this._config = { ..._AURA_DEFAULTS, shaderFxStack: {}, ...config };
        // Config do motor interno (só Lightning solo) vem separada no save.
        this._driverSeed = this._config.driverConfig || null;
        delete this._config.driverConfig;
        this._driver = null; this._boltR = null; this._pulse = null;
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
        this._buildDriver();      // só cria algo no Lightning solo
        this._buildLightning();
    }

    setConfig(patch) {
        Object.assign(this._config, patch);
        if (patch.name) { this.name = patch.name; this._marker.name = patch.name; if (this._driver) this._driver.name = patch.name; }
        if (this._driver) this._applyLegacyToDriver(patch);
    }

    // ── Motor de comportamento (ParticleSystem interno) ────────────────────
    // Acesso para o painel do Labs: com ele como "sistema ativo", as abas
    // Emissão/Aparência/Comportamento/Shader/Animação/Estilo editam o raio.
    getDriver() { return this._driver || null; }

    _defaultDriverConfig() {
        const c = this._config;
        const hex = new THREE.Color(c.lightningColor ?? '#55bbff').getHex();
        const life = [0.08, 0.26];
        return {
            // Emissão: casca de um cilindro (mesma "gaiola" do raio antigo)
            emitShape: 'cylinder', emitShell: true,
            emitRadius: (c.lightningRadius ?? 12) / 10, emitHeight: (c.lightningHeight ?? 15) / 20,
            burst: false, rate: Math.max(0, c.lightningCount ?? 8) / ((life[0] + life[1]) / 2),
            lifetime: life, speed: [0, 0], size: [0.015, 0.03],
            spreadAngle: 180, rotation: false,
            // neutraliza o que vem do preset base de partículas
            gravity: 0, drag: 1, heatShimmer: 0, spiralStrength: 0, wanderStrength: 0,
            sizeOverLife: [[0, 1], [1, 1]],
            opacity: 1, opacityOverLife: [[0, 1], [0.85, 1], [1, 0]],
            color: { from: hex, to: hex }, colorOverLife: [[0, hex], [1, hex]],
            texture: 'glow', blending: 'additive', lightEmission: 1.0,
        };
    }

    _buildDriver() {
        if (!this._config.isLightningOnly) return;
        const PE = window._ParticleEngine;
        if (!PE?.ParticleSystem) return;     // engine ausente → mantém o raio legado
        this._driverScene = new THREE.Scene();   // cena auxiliar: nada do motor aparece/seleciona
        const cfg = this._driverSeed ? JSON.parse(JSON.stringify(this._driverSeed)) : this._defaultDriverConfig();
        if (cfg.direction) cfg.direction = new THREE.Vector3(cfg.direction.x, cfg.direction.y, cfg.direction.z);
        const d = new PE.ParticleSystem(this._driverScene, { ...cfg, maxParticles: _BOLT_MAX, name: this.name });
        d._headless = true;
        d.userData.isLightningDriver = true;
        d.play();
        // "Atracar a Objeto" no painel de Comportamento prende o Lightning inteiro
        d.attachTo = (o) => this.attachTo(o);
        d.detach = () => this.detach();
        d.getAttachedObject = () => this.getAttachedObject();
        d.onSpawn = (p, sp) => this._initBolt(p, sp);
        this._driver = d;
        this._boltR = new _BoltRenderer(this._scene, d);
        this._lightnings = this._boltR.bolts;
        this._burstFired = false; this._lastDriverT = 0;
    }

    // 2º extremo do raio: sorteado no MESMO formato de emissão do 1º (qualquer
    // forma da aba Emissão serve). Formas sem extensão (ponto) caem num raio de
    // alcance dado pela "Altura" do Lightning.
    _initBolt(p, sp) {
        const d = this._driver, reach = Math.max(0.1, (this._config.lightningHeight ?? 15) / 10);
        const v = p.boltVec || (p.boltVec = new THREE.Vector3());
        v.copy(d._emitPoint()).sub(sp);
        if (v.length() < reach * 0.25) {
            v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
             .multiplyScalar(reach * (0.4 + Math.random() * 0.6));
        }
        p.boltSeed = Math.random();
    }

    // Controles antigos do Lightning (Raio/Altura/Cor/Quantidade) continuam
    // valendo: escrevem nos campos equivalentes do motor.
    _applyLegacyToDriver(patch) {
        const d = this._driver, dc = {};
        if ('lightningRadius' in patch) dc.emitRadius = patch.lightningRadius / 10;
        if ('lightningHeight' in patch) dc.emitHeight = patch.lightningHeight / 20;
        if ('lightningColor' in patch) {
            const h = new THREE.Color(patch.lightningColor).getHex();
            dc.color = { ...(d._config.color || {}), from: h, to: h };
            dc.colorOverLife = (d._config.colorOverLife?.length ? d._config.colorOverLife : [[0, 0], [1, 0]]).map(([t]) => [t, h]);
        }
        if ('lightningCount' in patch) {
            const L = d._config.lifetime || [0.08, 0.26];
            dc.rate = Math.max(0, patch.lightningCount) / Math.max(0.02, (L[0] + L[1]) / 2);
        }
        if (Object.keys(dc).length) d.setConfig(dc);
    }

    // Pulso (botão "Disparar Pulso" do Labs): sobe a intensidade do Lightning por
    // um instante e volta ao normal.
    triggerPulse({ strength = 1.5, duration = 0.4 } = {}) {
        this._pulse = { strength: Math.max(0, strength), duration: Math.max(0.05, duration), t: 0 };
    }
    _pulseMul() {
        const P = this._pulse; if (!P) return 1;
        const k = 1 - P.t / P.duration;
        return 1 + (P.strength - 1) * k * k;
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
        if (this._driver) return this._driver.getShaderFXStack();
        return _FX_ORDER
            .map(mode => {
                const layer = this._config.shaderFxStack?.[mode];
                return layer ? { ...layer } : null;
            })
            .filter(Boolean);
    }
    getShaderFX(mode = null) {
        if (this._driver) return this._driver.getShaderFX(mode);
        if (mode) {
            const layer = this._config.shaderFxStack?.[mode];
            return layer ? { ...layer } : { mode, p1: 0.5, p2: 0.5, p3: 0.5, color: '#ffffff', enabled: false };
        }
        const first = this.getShaderFXStack().find(l => l.enabled);
        return first || { mode: 'none', p1: 0.5, p2: 0.5, p3: 0.5, color: '#ffffff', enabled: false };
    }
    setShaderFX(mode, values = {}) {
        if (this._driver) return this._driver.setShaderFX(mode, values);
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
        if (this._driver) return this._driver.toggleShaderFX(mode, enabled);
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
                uTime:         { value: 0 },
                uScrollSpeed:  { value: 0.6 },
                uJagged:       { value: 0.65 },
                uNoiseScale:   { value: 8.0 },
                uFlickerSpeed: { value: 3.0 },
                uTex:          { value: _resolveAuraTexture(this._config.billboardTexture) },
                // Motion — each card keeps its own uAngleOffset as a phase
                // seed, so orbit/float never look perfectly synchronized
                // across cards even though they share the same speeds.
                uOrbitSpeed:   { value: 0.0 },
                uFloatSpeed:   { value: 0.0 },
                uFloatAmount:  { value: 0.0 },
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
                varying vec2 vUv;
                void main(){
                    vUv = uv;
                    float ang = uAngleOffset + uTime * uOrbitSpeed;
                    vec3 ringOffset  = vec3(cos(ang), 0.0, sin(ang)) * uRadius;
                    vec3 worldCenter = uCenter + ringOffset;
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
                uniform float uTime;
                uniform float uScrollSpeed;
                uniform float uJagged;
                uniform float uNoiseScale;
                uniform float uFlickerSpeed;
                uniform sampler2D uTex;
                varying vec2 vUv;
                ${_FX_GLSL_DECL}

                float _hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
                float _noise(vec2 p){
                    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
                    return mix(mix(_hash(i),_hash(i+vec2(1.0,0.0)),f.x),
                               mix(_hash(i+vec2(0.0,1.0)),_hash(i+vec2(1.0,1.0)),f.x), f.y);
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

                    vec4 texSample = texture2D(uTex, cuv);
                    float texMask = texSample.a * dot(texSample.rgb, vec3(0.333));

                    vec3  col   = mix(uColorBottom, uColorTop, cuv.y) * uIntensity;
                    float alpha = clamp(shape * flicker, 0.0, 1.0) * mix(1.0, texMask, 0.85);
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
        // Lightning-avulso ("isLightningOnly") systems want Shell AND
        // Billboard off — Shell already respects shellEnabled via
        // _updateShell()'s visible toggle, but Billboard had no such gate
        // and was always (re)built/updated below, which is what made a
        // "Lightning" system still render the full flame-card aura visual.
        // billboardEnabled defaults to true for real Auras and false for
        // isLightningOnly ones, unless explicitly set in config.
        if (this._config.billboardEnabled === undefined) {
            this._config.billboardEnabled = !this._config.isLightningOnly;
        }
        this._rebuildBillboards(this._config.billboardEnabled ? (this._config.billboardCount ?? 4) : 0);
    }

    _rebuildBillboards(count) {
        this._billboards.forEach(m => { this._scene.remove(m); m.material.dispose(); });
        this._billboards = [];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const mesh  = new THREE.Mesh(this._billboardGeo, this._makeBillboardMaterial(angle));
            mesh.frustumCulled = false;
            mesh.userData = this.userData;
            this._scene.add(mesh);
            this._billboards.push(mesh);
        }
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
        this._shellMat.uniforms.uIntensity.value    = Math.max(0, (c.shellIntensity ?? 60) / 40);
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

    _updateBillboards() {
        const c = this._config;
        const enabled = c.billboardEnabled !== false;
        const count = enabled ? Math.max(1, Math.min(8, Math.round(c.billboardCount ?? 4))) : 0;
        if (this._billboards.length !== count) this._rebuildBillboards(count);
        if (!enabled) return;
        const align = c.billboardAlign === 'camera' ? 0.0 : 1.0;
        const motion = c.billboardMotion || 'static';
        const doOrbit = motion === 'orbit' || motion === 'both';
        const doFloat = motion === 'float' || motion === 'both';
        this._billboards.forEach(mesh => {
            const u = mesh.material.uniforms;
            u.uCenter.value.copy(this.position);
            u.uRadius.value       = Math.max(0, c.billboardRadius ?? 0.22);
            u.uAlign.value        = align;
            u.uWidth.value        = Math.max(0.02, c.billboardWidth ?? 0.6);
            u.uHeight.value       = Math.max(0.05, c.billboardHeight ?? 1.8);
            u.uColorBottom.value.set(c.billboardColorBottom ?? '#ff9500');
            u.uColorTop.value.set(c.billboardColorTop ?? '#ffffff');
            u.uIntensity.value    = Math.max(0, (c.billboardIntensity ?? 150) / 100);
            u.uScrollSpeed.value  = c.billboardScrollSpeed ?? 0.6;
            u.uJagged.value       = Math.max(0, Math.min(1, (c.billboardJagged ?? 65) / 100));
            u.uNoiseScale.value   = Math.max(0.5, c.billboardNoiseScale ?? 8);
            u.uFlickerSpeed.value = Math.max(0, c.billboardFlickerSpeed ?? 3);
            u.uOrbitSpeed.value   = doOrbit ? (c.billboardOrbitSpeed ?? 0.4) : 0;
            u.uFloatSpeed.value   = doFloat ? (c.billboardFloatSpeed ?? 1.2) : 0;
            u.uFloatAmount.value  = doFloat ? (c.billboardFloatAmount ?? 0.15) : 0;
            u.uTime.value         = this._time;
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
        if (this._driver) { this._lightningData = []; return; }   // raios vêm do motor
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

    _updateLightningDriven(dt) {
        const c = this._config, d = this._driver, R = this._boltR;
        if (!c.lightningEnabled) { R.hideAll(); return; }
        d._marker.position.set(
            this.position.x + (c.lightningOffsetX ?? 0),
            this.position.y + (c.lightningOffsetY ?? 0),
            this.position.z + (c.lightningOffsetZ ?? 0));
        // Emissor "Burst": dispara uma vez e de novo quando o Labs faz reset/play
        if (d._config.burst) {
            if (d._time < this._lastDriverT) this._burstFired = false;
            if (!this._burstFired && d._playing && !d._paused) { d.burst(); this._burstFired = true; }
        } else this._burstFired = false;
        this._lastDriverT = d._time;
        const speedMul = Math.max(0, (c.lightningSpeed ?? 100) / 100);
        d.update(dt * speedMul);
        R.render({
            particles: d._particles, driver: d, cfg: c, dt,
            pulse: this._pulseMul(), cam: window._app?.camera?.position,
        });
    }

    _updateLightning(dt) {
        if (this._driver) { this._updateLightningDriven(dt); return; }
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
        const opacityMul = Math.max(0, (c.lightningIntensity ?? 100) / 100);
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
        if (this._pulse) { this._pulse.t += dt; if (this._pulse.t >= this._pulse.duration) this._pulse = null; }
        this._marker.getWorldPosition(this.position);
        this._updateShell();
        this._updateBillboards();
        this._updateLightning(dt);
    }

    getWorldPosition(target) { return target.copy(this.position); }

    toJSON() {
        const json = { name: this.name, position: this.position.toArray(), config: { ...this._config } };
        // Emissão/Comportamento/Aparência/Shader/Animação/Estilo do raio
        if (this._driver) json.driver = this._driver.toJSON();
        return json;
    }
    static fromJSON(scene, data) {
        const sys = new AuraSystem(scene, { ...data.config, name: data.name, id: data.id, driverConfig: data.driver?.config });
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
        if (this._driver) {
            this._boltR?.dispose(); this._boltR = null;
            try { this._driver.destroy(); } catch (e) { console.warn('[AuraSystem] driver.destroy:', e); }
            this._driver = null; this._lightnings = [];
            return;
        }
        this._lightnings.forEach(l => l.dispose());
        this._lightnings = [];
    }
}

export class AuraLab {
    constructor(scene) {
        this._scene = scene;
        this._systems = [];
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
    // getSystems() alimenta a lista "Sistema" (Aura) do Aura Labs — exclui
    // os sistemas "Lightning avulso" (ver createLightning abaixo) pra eles
    // não aparecerem duplicados nas duas listas.
    getSystems() { return this._systems.filter(s => !s._config.isLightningOnly); }
    update(dt) { this._systems.forEach(s => s.update(dt)); }
    clear() { [...this._systems].forEach(s => this.removeAura(s)); }

    // ── Sistema de "Lightning avulso" (aba Lightning do Particle Labs, fora
    // do Aura Labs) — reaproveita 100% a mesma AuraSystem/mesmo motor de
    // raios (_buildLightning/_updateLightning) que a Aura usa, só que com
    // Shell/Billboard desligados e Lightning ligado por padrão; isLightningOnly
    // é a flag que diferencia esses sistemas dos de getSystems() acima.
    // (index.html já chamava getLightningSystems/createLightning/removeLightning
    // antes desses métodos existirem aqui — provável descompasso de versão
    // com o auraLabs.js "de verdade" do app; adicionei pra destravar.)
    createLightning(config = {}) {
        const sys = new AuraSystem(this._scene, {
            shellEnabled: false, billboardEnabled: false, lightningEnabled: true,
            ...config, isLightningOnly: true,
        });
        this._systems.push(sys);
        window.dispatchEvent(new Event('labs-systems-changed'));
        return sys;
    }
    removeLightning(sys) { this.removeAura(sys); }
    getLightningSystems() { return this._systems.filter(s => s._config.isLightningOnly); }
    // Mesmo padrão de serializeAuras/restoreAuras acima — index.html já
    // chamava esses dois também (Salvar/Carregar .nex) sem eles existirem
    // aqui. isLightningOnly vai junto no config salvo por toJSON(), então
    // fromJSON() já restaura os sistemas na lista certa sem precisar
    // resetar a flag manualmente.
    serializeLightnings() { return this.getLightningSystems().map(s => s.toJSON()); }
    restoreLightnings(jsonArray = []) {
        // Só remove os lightnings-avulsos existentes (não mexe nas Auras).
        [...this.getLightningSystems()].forEach(s => this.removeAura(s));
        jsonArray.forEach(json => {
            try {
                const sys = AuraSystem.fromJSON(this._scene, json);
                sys._config.isLightningOnly = true; // reforça, caso o json venha de uma versão antiga sem a flag
                this._systems.push(sys);
            } catch (e) { console.warn('[AuraLab] Erro ao restaurar lightning:', e); }
        });
        window.dispatchEvent(new Event('labs-systems-changed'));
    }

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
}

window._AuraEngine = { AuraSystem, AuraLab };
