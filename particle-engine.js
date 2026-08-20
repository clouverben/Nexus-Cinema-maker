// ==================== particle-engine.js ====================
// Nexus Engine — Roblox-inspired GPU-style particle system.
// Supports: Emit shapes, color-over-lifetime, size-over-lifetime,
//           velocity, acceleration, drag, rotation, texture sheets,
//           trails, light emission, collision, sub-emitters.
// Inspired by Roblox ParticleEmitter, Blox Fruits VFX, King Legacy, STBB.

import * as THREE from 'three';
import { makeGlowSprite, makeSparkleSprite, makeRingSprite } from './shader.js';

// ─── Texture library ─────────────────────────────────────────────────────────
const _texCache = {};

function _applyTextureDefaults(tex) {
    if (!tex) return tex;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

function _loadTextureFromSource(src) {
    if (!src) return null;
    if (_texCache[src]) return _texCache[src];
    const loader = new THREE.TextureLoader();
    const tex = _applyTextureDefaults(loader.load(src, t => {
        if (t) {
            _applyTextureDefaults(t);
            t.needsUpdate = true;
        }
    }));
    _texCache[src] = tex;
    return tex;
}

function _getTexture(name) {
    if (!name) return _getTexture('glow');
    if (typeof name === 'string' && /^(data:image\/(?:png|jpeg|jpg|webp|gif|bmp|svg\+xml)|blob:|https?:|\/)/i.test(name)) {
        return _loadTextureFromSource(name) || makeGlowSprite(0xffffff, 64);
    }
    if (_texCache[name]) return _texCache[name];
    switch (name) {
        case 'glow':     _texCache[name] = makeGlowSprite(0xffffff, 64); break;
        case 'sparkle':  _texCache[name] = makeSparkleSprite(64); break;
        case 'ring':     _texCache[name] = makeRingSprite(0.4, 64); break;
        case 'soft':     _texCache[name] = _makeSoftCircle(); break;
        case 'smoke':    _texCache[name] = _makeSmokeTex(); break;
        case 'ember':    _texCache[name] = _makeEmberTex(); break;
        case 'lightning':_texCache[name] = _makeLightningTex(); break;
        case 'square':   _texCache[name] = _makeSquareTex(); break;
        case 'diamond':  _texCache[name] = _makeDiamondTex(); break;
        case 'fireball': _texCache[name] = _makeFireballTex(); break;
        case 'hex':      _texCache[name] = _makeHexTex(); break;
        case 'heart':    _texCache[name] = _makeHeartTex(); break;
        case 'flame':    _texCache[name] = _makeFlameTex(); break;
        case 'plasma':   _texCache[name] = _makePlasmaTex(); break;
        case 'starburst':_texCache[name] = _makeStarburstTex(); break;
        case 'crystal':  _texCache[name] = _makeCrystalTex(); break;
        case 'electric': _texCache[name] = _makeElectricTex(); break;
        case 'cloud':    _texCache[name] = _makeCloudTex(); break;
        case 'comet':    _texCache[name] = _makeCometTex(); break;
        case 'orb':      _texCache[name] = _makeOrbTex(); break;
        case 'cross':    _texCache[name] = _makeCrossTex(); break;
        case 'leaf':     _texCache[name] = _makeLeafTex(); break;
        default:         _texCache[name] = makeGlowSprite(0xffffff, 64);
    }
    return _texCache[name];
}

function _makeSoftCircle() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.5,'rgba(255,255,255,0.6)'); g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(c);
}
function _makeSmokeTex() {
    const c = document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d');
    for(let i=0;i<12;i++){
        const x=20+Math.random()*24, y=20+Math.random()*24, r=8+Math.random()*12;
        const g=ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,'rgba(180,180,180,0.25)'); g.addColorStop(1,'rgba(180,180,180,0)');
        ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    }
    return new THREE.CanvasTexture(c);
}
function _makeEmberTex() {
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    // Outer amber glow
    const go=ctx.createRadialGradient(32,32,0,32,32,30);
    go.addColorStop(0,'rgba(255,245,180,1)');
    go.addColorStop(0.15,'rgba(255,200,60,1)');
    go.addColorStop(0.35,'rgba(255,130,10,0.9)');
    go.addColorStop(0.55,'rgba(220,60,0,0.6)');
    go.addColorStop(0.75,'rgba(160,20,0,0.25)');
    go.addColorStop(1,'rgba(80,0,0,0)');
    ctx.fillStyle=go; ctx.fillRect(0,0,64,64);
    // Bright core white-hot center
    const gc=ctx.createRadialGradient(32,30,0,32,30,10);
    gc.addColorStop(0,'rgba(255,255,255,1)');
    gc.addColorStop(0.3,'rgba(255,250,200,0.9)');
    gc.addColorStop(0.7,'rgba(255,200,80,0.4)');
    gc.addColorStop(1,'rgba(255,140,0,0)');
    ctx.fillStyle=gc; ctx.fillRect(0,0,64,64);
    // Teardrop shape up top for flame-like ember
    ctx.save(); ctx.translate(32,18); ctx.scale(0.6,1);
    const gt=ctx.createRadialGradient(0,0,0,0,4,12);
    gt.addColorStop(0,'rgba(255,255,220,0.8)');
    gt.addColorStop(1,'rgba(255,180,0,0)');
    ctx.fillStyle=gt; ctx.beginPath();
    ctx.moveTo(0,-12); ctx.bezierCurveTo(6,-6,6,6,0,10); ctx.bezierCurveTo(-6,6,-6,-6,0,-12);
    ctx.fill(); ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _makeLightningTex() {
    const c=document.createElement('canvas'); c.width=8; c.height=64;
    const ctx=c.getContext('2d');
    const g=ctx.createLinearGradient(4,0,4,64);
    g.addColorStop(0,'rgba(200,220,255,0)'); g.addColorStop(0.5,'rgba(200,220,255,1)'); g.addColorStop(1,'rgba(200,220,255,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,8,64);
    return new THREE.CanvasTexture(c);
}
function _makeSquareTex() {
    const c=document.createElement('canvas'); c.width=c.height=32;
    const ctx=c.getContext('2d');
    const g=ctx.createRadialGradient(16,16,2,16,16,16);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.7,'rgba(255,255,255,0.6)'); g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g; ctx.fillRect(2,2,28,28);
    return new THREE.CanvasTexture(c);
}
function _makeDiamondTex() {
    const c=document.createElement('canvas'); c.width=c.height=32;
    const ctx=c.getContext('2d');
    ctx.save(); ctx.translate(16,16); ctx.rotate(Math.PI/4);
    const g=ctx.createRadialGradient(0,0,0,0,0,12);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g; ctx.fillRect(-10,-10,20,20); ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _makeFireballTex() {
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d');
    // Core
    const g=ctx.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(255,255,220,1)');
    g.addColorStop(0.2,'rgba(255,180,20,0.95)');
    g.addColorStop(0.5,'rgba(255,60,0,0.7)');
    g.addColorStop(0.8,'rgba(180,20,0,0.3)');
    g.addColorStop(1,'rgba(80,0,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(c);
}
function _makeHexTex() {
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d');
    ctx.clearRect(0,0,64,64);
    ctx.translate(32,32);
    ctx.beginPath();
    for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.lineTo(Math.cos(a)*28,Math.sin(a)*28);}
    ctx.closePath();
    const g=ctx.createRadialGradient(0,0,0,0,0,28);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.7,'rgba(200,200,255,0.5)');
    g.addColorStop(1,'rgba(100,100,255,0)');
    ctx.fillStyle=g; ctx.fill();
    return new THREE.CanvasTexture(c);
}
function _makeHeartTex() {
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    ctx.translate(32,36); ctx.scale(1.1,1.1);
    ctx.beginPath();
    ctx.moveTo(0,-10);
    ctx.bezierCurveTo(-5,-20,-20,-20,-20,-10);
    ctx.bezierCurveTo(-20,0,0,15,0,22);
    ctx.bezierCurveTo(0,15,20,0,20,-10);
    ctx.bezierCurveTo(20,-20,5,-20,0,-10);
    const g=ctx.createRadialGradient(0,0,0,0,6,22);
    g.addColorStop(0,'rgba(255,200,220,1)');
    g.addColorStop(0.6,'rgba(255,80,120,0.8)');
    g.addColorStop(1,'rgba(200,0,60,0)');
    ctx.fillStyle=g; ctx.fill();
    return new THREE.CanvasTexture(c);
}


// ─── STBB-inspired extended textures ─────────────────────────────────────────
function _makeFlameTex() {
    // Tall teardrop flame tongue, bright core → orange edge
    const c=document.createElement('canvas'); c.width=48; c.height=80;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,48,80);
    ctx.save(); ctx.translate(24,60);
    ctx.beginPath();
    ctx.moveTo(0,-58); ctx.bezierCurveTo(18,-38,18,-10,0,4); ctx.bezierCurveTo(-18,-10,-18,-38,0,-58);
    const g=ctx.createLinearGradient(0,-58,0,4);
    g.addColorStop(0,'rgba(255,255,220,1)');
    g.addColorStop(0.25,'rgba(255,200,60,0.95)');
    g.addColorStop(0.55,'rgba(255,80,10,0.8)');
    g.addColorStop(0.85,'rgba(180,20,0,0.35)');
    g.addColorStop(1,'rgba(80,0,0,0)');
    ctx.fillStyle=g; ctx.fill();
    // inner hot core
    ctx.beginPath(); ctx.moveTo(0,-54); ctx.bezierCurveTo(7,-36,7,-14,0,-2); ctx.bezierCurveTo(-7,-14,-7,-36,0,-54);
    const gc=ctx.createLinearGradient(0,-54,0,-2);
    gc.addColorStop(0,'rgba(255,255,255,0.95)');
    gc.addColorStop(0.5,'rgba(255,240,180,0.6)');
    gc.addColorStop(1,'rgba(255,180,60,0)');
    ctx.fillStyle=gc; ctx.fill();
    ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _makePlasmaTex() {
    // Pulsing electric plasma ball — bright center, colored electric rings
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    const g=ctx.createRadialGradient(32,32,0,32,32,30);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.12,'rgba(200,180,255,1)');
    g.addColorStop(0.3,'rgba(120,60,255,0.9)');
    g.addColorStop(0.55,'rgba(60,0,200,0.5)');
    g.addColorStop(0.8,'rgba(20,0,120,0.2)');
    g.addColorStop(1,'rgba(0,0,60,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    // electric arcs
    for(let i=0;i<6;i++){
        const a=i*Math.PI/3, r1=8, r2=26+Math.random()*6;
        ctx.beginPath();
        ctx.moveTo(32+Math.cos(a)*r1,32+Math.sin(a)*r1);
        const mx=32+Math.cos(a+0.4)*(r1+r2)*0.5+(_rndS()*6), my=32+Math.sin(a+0.4)*(r1+r2)*0.5+(_rndS()*6);
        ctx.quadraticCurveTo(mx,my,32+Math.cos(a)*r2,32+Math.sin(a)*r2);
        ctx.strokeStyle='rgba(200,160,255,0.7)'; ctx.lineWidth=1; ctx.stroke();
    }
    return new THREE.CanvasTexture(c);
}
function _makeStarburstTex() {
    // 8-point starburst with glow, STBB power-up style
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    // glow base
    const g=ctx.createRadialGradient(32,32,0,32,32,30);
    g.addColorStop(0,'rgba(255,255,220,1)');
    g.addColorStop(0.25,'rgba(255,220,80,0.7)');
    g.addColorStop(1,'rgba(255,160,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    // spikes
    const pts=8;
    ctx.save(); ctx.translate(32,32);
    ctx.beginPath();
    for(let i=0;i<pts*2;i++){
        const a=i*Math.PI/pts - Math.PI/2;
        const r=i%2===0?30:10;
        i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
    }
    ctx.closePath();
    const gs=ctx.createRadialGradient(0,0,0,0,0,30);
    gs.addColorStop(0,'rgba(255,255,255,1)');
    gs.addColorStop(0.5,'rgba(255,240,100,0.85)');
    gs.addColorStop(1,'rgba(255,180,0,0)');
    ctx.fillStyle=gs; ctx.fill();
    ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _rndS() { return Math.random()*2-1; }
function _makeCrystalTex() {
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    ctx.save(); ctx.translate(32,32);
    ctx.beginPath(); ctx.moveTo(0,-30); ctx.lineTo(12,-8); ctx.lineTo(16,14); ctx.lineTo(0,30); ctx.lineTo(-14,12); ctx.lineTo(-10,-8); ctx.closePath();
    const gf=ctx.createLinearGradient(-16,-30,16,30);
    gf.addColorStop(0,'rgba(200,240,255,0.95)');
    gf.addColorStop(0.4,'rgba(160,210,255,0.85)');
    gf.addColorStop(0.75,'rgba(100,180,255,0.55)');
    gf.addColorStop(1,'rgba(60,120,220,0)');
    ctx.fillStyle=gf; ctx.fill();
    // inner glint
    ctx.beginPath(); ctx.moveTo(0,-26); ctx.lineTo(5,-12); ctx.lineTo(0,0); ctx.lineTo(-5,-12); ctx.closePath();
    const gi=ctx.createLinearGradient(0,-26,0,0);
    gi.addColorStop(0,'rgba(255,255,255,0.9)'); gi.addColorStop(1,'rgba(200,230,255,0)');
    ctx.fillStyle=gi; ctx.fill();
    ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _makeElectricTex() {
    // Jagged electric bolt — bright white-blue zigzag
    const c=document.createElement('canvas'); c.width=16; c.height=80;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,16,80);
    // glow halo
    const gh=ctx.createRadialGradient(8,40,0,8,40,18);
    gh.addColorStop(0,'rgba(180,200,255,0.3)'); gh.addColorStop(1,'rgba(100,140,255,0)');
    ctx.fillStyle=gh; ctx.fillRect(0,0,16,80);
    // bolt
    const pts=[[8,2],[12,18],[4,34],[12,50],[5,64],[8,78]];
    ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.strokeStyle='rgba(220,240,255,0.95)'; ctx.lineWidth=2.5; ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,1)'; ctx.lineWidth=1; ctx.stroke();
    // fade top/bottom
    const gv=ctx.createLinearGradient(0,0,0,80);
    gv.addColorStop(0,'rgba(0,0,0,1)'); gv.addColorStop(0.06,'rgba(0,0,0,0)');
    gv.addColorStop(0.94,'rgba(0,0,0,0)'); gv.addColorStop(1,'rgba(0,0,0,1)');
    ctx.globalCompositeOperation='destination-out'; ctx.fillStyle=gv; ctx.fillRect(0,0,16,80);
    ctx.globalCompositeOperation='source-over';
    return new THREE.CanvasTexture(c);
}
function _makeCloudTex() {
    // Soft volumetric cloud puff — multi-layered bumps
    const c=document.createElement('canvas'); c.width=c.height=80;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,80,80);
    const puffs=[[40,44,28],[28,48,18],[54,48,16],[40,36,20],[22,52,12],[58,52,12]];
    puffs.forEach(([x,y,r])=>{
        const g=ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,'rgba(230,235,245,0.55)');
        g.addColorStop(0.5,'rgba(200,210,230,0.3)');
        g.addColorStop(1,'rgba(180,190,220,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    });
    return new THREE.CanvasTexture(c);
}
function _makeCometTex() {
    // Comet — bright head with long tail fade
    const c=document.createElement('canvas'); c.width=24; c.height=80;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,24,80);
    // tail
    const gt=ctx.createLinearGradient(12,80,12,20);
    gt.addColorStop(0,'rgba(255,255,255,0)');
    gt.addColorStop(0.7,'rgba(200,220,255,0.4)');
    gt.addColorStop(1,'rgba(255,255,255,0.9)');
    ctx.fillStyle=gt;
    ctx.beginPath(); ctx.moveTo(12,80); ctx.lineTo(4,20); ctx.lineTo(20,20); ctx.closePath(); ctx.fill();
    // head
    const gh=ctx.createRadialGradient(12,12,0,12,12,12);
    gh.addColorStop(0,'rgba(255,255,255,1)');
    gh.addColorStop(0.3,'rgba(200,230,255,0.95)');
    gh.addColorStop(0.7,'rgba(120,180,255,0.5)');
    gh.addColorStop(1,'rgba(60,100,255,0)');
    ctx.fillStyle=gh; ctx.beginPath(); ctx.arc(12,12,12,0,Math.PI*2); ctx.fill();
    return new THREE.CanvasTexture(c);
}
function _makeOrbTex() {
    // Glowing energy orb with inner rings
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    const g=ctx.createRadialGradient(32,32,0,32,32,30);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.15,'rgba(200,240,255,1)');
    g.addColorStop(0.35,'rgba(80,160,255,0.8)');
    g.addColorStop(0.6,'rgba(40,80,200,0.4)');
    g.addColorStop(1,'rgba(0,20,100,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    // rings
    [14,20,26].forEach((r,i)=>{
        ctx.beginPath(); ctx.arc(32,32,r,0,Math.PI*2);
        ctx.strokeStyle=`rgba(180,220,255,${0.35-i*0.08})`; ctx.lineWidth=1; ctx.stroke();
    });
    return new THREE.CanvasTexture(c);
}
function _makeCrossTex() {
    // Sharp cross / plus shape — good for energy hits and magic
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    ctx.save(); ctx.translate(32,32);
    const w=7,h=30;
    // glow behind
    const g=ctx.createRadialGradient(0,0,0,0,0,28);
    g.addColorStop(0,'rgba(255,255,255,0.5)'); g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g; ctx.fillRect(-28,-28,56,56);
    // vertical bar
    ctx.fillStyle='rgba(255,255,255,0.95)';
    ctx.fillRect(-w/2,-h,w,h*2);
    // horizontal bar
    ctx.fillRect(-h,-w/2,h*2,w);
    // center bright dot
    ctx.fillStyle='rgba(255,255,255,1)';
    ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill();
    ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _makeLeafTex() {
    // Organic leaf — elongated with vein
    const c=document.createElement('canvas'); c.width=40; c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,40,64);
    ctx.save(); ctx.translate(20,32);
    ctx.beginPath();
    ctx.moveTo(0,-28); ctx.bezierCurveTo(18,-20,18,20,0,30); ctx.bezierCurveTo(-18,20,-18,-20,0,-28);
    const g=ctx.createRadialGradient(0,0,0,0,0,30);
    g.addColorStop(0,'rgba(180,255,160,0.9)');
    g.addColorStop(0.5,'rgba(80,200,60,0.7)');
    g.addColorStop(1,'rgba(30,120,20,0)');
    ctx.fillStyle=g; ctx.fill();
    // vein
    ctx.beginPath(); ctx.moveTo(0,-26); ctx.lineTo(0,28);
    ctx.strokeStyle='rgba(150,255,120,0.5)'; ctx.lineWidth=1; ctx.stroke();
    ctx.restore();
    return new THREE.CanvasTexture(c);
}

// ═══════════════════════════════════════════════════════════════════════════
//  MODULE_LIBRARY — SFM-style modular building blocks.
//
//  Inspired by the real Source Filmmaker Particle Editor: instead of one
//  fixed set of always-on sliders, a particle system is built by ADDING
//  named modules from 5 categories (Emitters, Initializers, Operators,
//  Forces, Renderers) — each module governs one or more of the underlying
//  physics fields the engine already simulates (see ParticleSystem.update).
//  This is a thin, purely-declarative translation layer: it does not
//  duplicate any physics, it just describes which flat _config field(s)
//  each named module reads/writes, plus UI metadata to auto-generate
//  sliders. `group` marks mutually-exclusive single-select categories
//  (an emitter is EITHER continuous OR burst, a particle spawns from
//  exactly ONE shape, a system renders with exactly ONE renderer) —
//  matching how SFM itself works.
// ═══════════════════════════════════════════════════════════════════════════
function _mod(id, label, icon, category, fields, opts = {}) {
    return {
        id, label, icon, category, fields, group: opts.group ?? null,
        desc: opts.desc ?? '',
        // Generic, field-driven isActive/apply/reset — works for every
        // module without bespoke code. Each field carries `default` (the
        // neutral/"off" value used for reset + for detecting whether a
        // scanned config already has this module active) and an optional
        // `addDefault` (a sensible, VISIBLE starting value used the moment
        // the user clicks "Add" — many fields are neutral at 0, so without
        // this a freshly-added module would look like it did nothing).
        isActive(cfg) {
            return fields.some(f => (cfg[f.key] ?? f.default) !== f.default && f.key !== '_shapeTag');
        },
        apply(cfg, values = {}) {
            fields.forEach(f => {
                if (f.key === '_shapeTag') return; // marker field, not a real config key
                if (values[f.key] !== undefined) cfg[f.key] = values[f.key];
                else cfg[f.key] = f.addDefault !== undefined ? f.addDefault : f.default;
            });
            if (opts.onApply) opts.onApply(cfg, values);
        },
        reset(cfg) {
            fields.forEach(f => { if (f.key !== '_shapeTag') cfg[f.key] = f.default; });
            if (opts.onReset) opts.onReset(cfg);
        },
    };
}

export const MODULE_LIBRARY = {
    emitters: [
        _mod('emit_continuous', 'Contínuo', '💧', 'emitters',
            [{ key: 'burst', label: 'Burst', default: false, type: 'hidden' },
             { key: 'rate',  label: 'Taxa (p/s)', min: 0, max: 300, step: 1, default: 20 }],
            { group: 'emitMode', desc: 'Emite partículas continuamente a uma taxa fixa.',
              onApply: (cfg) => { cfg.burst = false; } }),
        _mod('emit_burst', 'Burst (Único)', '💥', 'emitters',
            [{ key: 'burst', label: 'Burst', default: true, type: 'hidden' },
             { key: 'burstCount', label: 'Quantidade', min: 1, max: 500, step: 1, default: 50 }],
            { group: 'emitMode', desc: 'Dispara todas as partículas de uma vez.',
              onApply: (cfg) => { cfg.burst = true; } }),
    ],

    initializers: [
        _mod('shape_point', 'Ponto', '•', 'initializers',
            [{ key: '_shapeTag', default: 'point' }], { group: 'shape',
            onApply: c => { c.emitShape = 'point'; }, desc: 'Todas as partículas nascem no mesmo ponto.' }),
        _mod('shape_sphere', 'Esfera', '⚫', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'sphere'; }, desc: 'Nasce dentro de uma esfera.' }),
        _mod('shape_surface', 'Superfície da Esfera', '🔵', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'surface'; }, desc: 'Nasce só na casca da esfera.' }),
        _mod('shape_cone', 'Cone', '🔺', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'cone'; }, desc: 'Nasce dentro de um cone — ótimo para fogo/fumaça.' }),
        _mod('shape_disc', 'Disco', '⭕', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'disc'; }, desc: 'Nasce num disco plano.' }),
        _mod('shape_ring', 'Anel', '💍', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'ring'; }, desc: 'Nasce na borda de um anel.' }),
        _mod('shape_plane', 'Plano', '▭', 'initializers',
            [{ key: 'emitRadius', label: 'Tamanho', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'plane'; }, desc: 'Nasce numa área plana — bom p/ chuva.' }),
        _mod('shape_line', 'Linha (Laser)', '⚡', 'initializers',
            [{ key: 'targetOffsetY', label: 'Comprimento', min: 0.2, max: 30, step: 0.1, default: 4 },
             { key: 'lineJitter',    label: 'Jitter', min: 0, max: 1, step: 0.01, default: 0.02 }],
            { group: 'shape', desc: 'Nasce ao longo de uma linha — a base de lasers e feixes.',
              onApply: (c, v) => { c.emitShape = 'line'; c.targetOffset = { x: 0, y: v.targetOffsetY ?? 4, z: 0 }; } }),
        _mod('lifetime', 'Tempo de Vida', '⏱', 'initializers',
            [{ key: 'lifetime0', label: 'Mín (s)', min: 0.05, max: 30, step: 0.05, default: 1 },
             { key: 'lifetime1', label: 'Máx (s)', min: 0.05, max: 30, step: 0.05, default: 2 }],
            { onApply: (c, v) => { c.lifetime = [v.lifetime0 ?? 1, v.lifetime1 ?? 2]; } }),
        _mod('initial_speed', 'Velocidade Inicial', '🚀', 'initializers',
            [{ key: 'speed0', label: 'Mín', min: 0, max: 40, step: 0.05, default: 0.5 },
             { key: 'speed1', label: 'Máx', min: 0, max: 40, step: 0.05, default: 2 }],
            { onApply: (c, v) => { c.speed = [v.speed0 ?? 0.5, v.speed1 ?? 2]; } }),
        _mod('initial_size', 'Tamanho Inicial', '📏', 'initializers',
            [{ key: 'size0', label: 'Mín', min: 0.01, max: 8, step: 0.01, default: 0.08 },
             { key: 'size1', label: 'Máx', min: 0.01, max: 8, step: 0.01, default: 0.2 }],
            { onApply: (c, v) => { c.size = [v.size0 ?? 0.08, v.size1 ?? 0.2]; } }),
        _mod('spread_angle', 'Ângulo de Espalhamento', '📐', 'initializers',
            [{ key: 'spreadAngle', label: 'Ângulo (°)', min: 0, max: 360, step: 1, default: 30 }]),
        _mod('rotation_random', 'Rotação Aleatória', '🔄', 'initializers',
            [{ key: 'rotation', label: 'Ativo', default: true, type: 'hidden' },
             { key: 'rotSpeed0', label: 'Vel. Mín (°/s)', min: -720, max: 720, step: 5, default: -90 },
             { key: 'rotSpeed1', label: 'Vel. Máx (°/s)', min: -720, max: 720, step: 5, default: 90 }],
            { onApply: (c, v) => { c.rotation = true; c.rotSpeed = [v.rotSpeed0 ?? -90, v.rotSpeed1 ?? 90]; },
              onReset: c => { c.rotation = false; } }),
        _mod('color_variance', 'Variação de Cor', '🎨', 'initializers',
            [{ key: 'colorVariance', label: 'Matiz', min: 0, max: 1, step: 0.01, default: 0 },
             { key: 'brightnessVariance', label: 'Brilho', min: 0, max: 1, step: 0.01, default: 0 }]),
        _mod('elongation', 'Elongação', '🥖', 'initializers',
            [{ key: 'elongation', label: 'Razão', min: 0.1, max: 10, step: 0.05, default: 1 }]),
        _mod('birth_burst', 'Impulso de Nascimento', '💫', 'initializers',
            [{ key: 'birthBurst', label: 'Força', min: 0, max: 20, step: 0.05, default: 0 }]),
        _mod('scatter_birth', 'Espalhar ao Nascer', '🎲', 'initializers',
            [{ key: 'scatterBirth', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0 }]),
        // ── Page 2 "Shape" — genuinely new shapes/refinements, not a
        // re-skin of the 8 shapes above (kept in the same 'shape' group
        // so they're still mutually exclusive with them, exactly like SFM).
        _mod('shape_box', 'Caixa', '📦', 'initializers',
            [{ key: 'emitRadius', label: 'Metade do Lado', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'box'; }, desc: 'Nasce dentro de um volume cúbico (estilo Roblox "Box").' }),
        _mod('shape_cylinder', 'Cilindro', '🥫', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'cylinder'; }, desc: 'Nasce dentro de um cilindro vertical.' }),
        _mod('shape_direction', 'Direção de Emissão', '➡', 'initializers',
            [{ key: 'shapeDirection', label: 'Direção', type: 'seg', default: 'default',
               options: [['default','Padrão'],['outward','Fora'],['inward','Dentro'],['random','Aleatório']] }],
            { desc: 'Usa o próprio formato do emissor para apontar a velocidade inicial — "Fora" vira explosão, "Dentro" vira implosão.' }),
        _mod('shape_arc', 'Arco Parcial', '📐', 'initializers',
            [{ key: 'shapeArc', label: 'Arco (°)', min: 0, max: 360, step: 1, default: 360 }],
            { desc: 'Restringe Anel/Disco/Cone/Cilindro a uma fatia em vez do círculo completo.' }),
    ],

    operators: [
        _mod('gravity', 'Gravidade', '⬇', 'operators',
            [{ key: 'gravity', label: 'Força', min: -30, max: 30, step: 0.1, default: 0, addDefault: 9.8 }]),
        _mod('gravity_x', 'Gravidade Lateral', '➡', 'operators',
            [{ key: 'gravityX', label: 'Força', min: -30, max: 30, step: 0.1, default: 0, addDefault: 3 }]),
        _mod('drag', 'Arrasto', '🪂', 'operators',
            [{ key: 'drag', label: 'Fator', min: 0.5, max: 1, step: 0.002, default: 1, addDefault: 0.96 }]),
        _mod('wind', 'Vento', '🌬', 'operators',
            [{ key: 'windX', label: 'X', min: -20, max: 20, step: 0.05, default: 0, addDefault: 1.5 },
             { key: 'windZ', label: 'Z', min: -20, max: 20, step: 0.05, default: 0, addDefault: 0 }]),
        _mod('size_scale', 'Escala de Tamanho', '📈', 'operators',
            [{ key: 'sizeCurveMode', label: 'Curva', type: 'curve-size', default: 'grow' }],
            { onApply: (c, v) => { c.sizeOverLife = SIZE_CURVES[v.sizeCurveMode ?? 'grow']; } }),
        _mod('opacity_fade', 'Fade de Opacidade', '👻', 'operators',
            [{ key: 'opacityCurveMode', label: 'Curva', type: 'curve-opacity', default: 'fade' }],
            { onApply: (c, v) => { c.opacityOverLife = OPACITY_CURVES[v.opacityCurveMode ?? 'fade']; } }),
        _mod('color_fade', 'Cor ao Longo da Vida', '🌈', 'operators',
            [{ key: 'colorStart', label: 'Início', type: 'color', default: 0xff6600 },
             { key: 'colorMid',   label: 'Meio',   type: 'color', default: 0xffaa00 },
             { key: 'colorEnd',   label: 'Fim',    type: 'color', default: 0xffff00 }],
            { onApply: (c, v) => {
                const s = v.colorStart ?? 0xff6600, m = v.colorMid ?? 0xffaa00, e = v.colorEnd ?? 0xffff00;
                c.color = { from: s, to: e };
                c.colorOverLife = [[0, s], [0.5, m], [1, e]];
            } }),
        _mod('fade_in', 'Fade-In', '🌅', 'operators',
            [{ key: 'fadeInTime', label: 'Duração (s)', min: 0, max: 5, step: 0.01, default: 0, addDefault: 0.3 }]),
        _mod('taper_age', 'Encolher com a Idade', '📉', 'operators',
            [{ key: 'taperByAge', label: 'Força', min: 0, max: 1, step: 0.01, default: 0, addDefault: 0.5 }]),
        _mod('spin', 'Torque de Rotação', '🌀', 'operators',
            [{ key: 'spinTorque', label: 'Força', min: -50, max: 50, step: 0.1, default: 0, addDefault: 15 }]),
        _mod('flicker', 'Cintilação', '✨', 'operators',
            [{ key: 'flickerAmt',  label: 'Quantidade', min: 0, max: 1, step: 0.01, default: 0, addDefault: 0.4 },
             { key: 'flickerFreq', label: 'Frequência', min: 0.5, max: 60, step: 0.5, default: 8 }]),
        _mod('pulse', 'Pulso', '💓', 'operators',
            [{ key: 'pulseAmt',  label: 'Quantidade', min: 0, max: 2, step: 0.01, default: 0, addDefault: 0.3 },
             { key: 'pulseFreq', label: 'Frequência', min: 0.1, max: 60, step: 0.1, default: 4 }]),
        _mod('size_jitter', 'Jitter de Tamanho', '🔀', 'operators',
            [{ key: 'sizeJitter', label: 'Quantidade', min: 0, max: 2, step: 0.01, default: 0, addDefault: 0.25 }]),
        _mod('damping', 'Amortecimento', '🛑', 'operators',
            [{ key: 'damping', label: 'Força', min: 0, max: 10, step: 0.02, default: 0, addDefault: 0.5 }]),
        _mod('max_speed', 'Velocidade Máxima', '🏁', 'operators',
            [{ key: 'maxSpeed', label: 'Limite', min: 0, max: 100, step: 0.1, default: 0, addDefault: 5 }]),
        _mod('opacity_erosion', 'Erosão por Velocidade', '💨', 'operators',
            [{ key: 'opacityErosion', label: 'Força', min: 0, max: 10, step: 0.02, default: 0, addDefault: 0.3 }]),
        _mod('color_temp', 'Temperatura de Cor', '🌡', 'operators',
            [{ key: 'colorTemp', label: '- Frio / + Quente', min: -1, max: 1, step: 0.02, default: 0, addDefault: 0.4 }]),
        _mod('scale_dist', 'Escala por Distância', '📡', 'operators',
            [{ key: 'scaleByDist', label: 'Força', min: -10, max: 10, step: 0.02, default: 0, addDefault: 0.3 }]),
        _mod('vel_stretch', 'Esticar por Velocidade', '☄', 'operators',
            [{ key: 'velStretch', label: 'Força', min: 0, max: 20, step: 0.05, default: 0, addDefault: 1.5 }],
            { desc: 'Estica partículas na direção do movimento — cometas, faíscas.' }),
        _mod('heat_shimmer', 'Tremulação de Calor', '🔥', 'operators',
            [{ key: 'heatShimmer', label: 'Força', min: 0, max: 5, step: 0.01, default: 0, addDefault: 0.15 }]),
        _mod('spark_intensity', 'Intensidade de Faísca', '⚡', 'operators',
            [{ key: 'sparkIntensity', label: 'Força', min: 0, max: 20, step: 0.05, default: 0, addDefault: 2 }]),
        _mod('bounce_ground', 'Quicar no Chão', '⛹', 'operators',
            [{ key: 'bounceY', label: 'Elasticidade', min: 0, max: 1, step: 0.01, default: 0, addDefault: 0.5 }]),
        _mod('wall_bounce', 'Quicar nas Paredes', '📦', 'operators',
            [{ key: 'wallBounce', label: 'Elasticidade', min: 0, max: 1, step: 0.01, default: 0, addDefault: 0.6 },
             { key: 'wallSize',   label: 'Tamanho da Caixa', min: 0.1, max: 30, step: 0.1, default: 3 }]),
        // ── Page 2 "Emitter" — timing window + sub-emission on death ────
        _mod('emit_timing', 'Temporização', '⏱', 'operators',
            [{ key: 'emitDelay',    label: 'Atraso Inicial (s)', min: 0, max: 60, step: 1, default: 0 },
             { key: 'emitDuration', label: 'Duração (s, 0=infinito)', min: 0, max: 300, step: 1, default: 0 }],
            { desc: 'Controla quando a emissão contínua começa e por quanto tempo dura.' }),
        _mod('emit_on_death', 'Emitir ao Morrer', '💥', 'operators',
            [{ key: 'emitOnDeathCount', label: 'Partículas por morte', min: 0, max: 20, step: 1, default: 0, addDefault: 3 }],
            { desc: 'Ao morrer, cada partícula gera N partículas em cada subpartícula (aba Hierarquia) na posição da morte — ex: rastro que termina em explosão.' }),
        // ── Page 2 "Motion" — genuinely new: existing forces above never
        // reference the emitter's OWN motion, only the particle's.
        _mod('velocity_inheritance', 'Herança de Velocidade', '🧲', 'operators',
            [{ key: 'velocityInheritance', label: 'Herança (%)', min: 0, max: 1, step: 0.01, default: 0, addDefault: 0.5 }],
            { desc: 'Partículas novas herdam parte da velocidade atual do próprio emissor — essencial quando ele está Atracado a um objeto em movimento.' }),
        // ── Page 2 "Appearance" — sprite-sheet / flipbook animation ──────
        _mod('flipbook', 'Sprite Sheet / Flipbook', '🎞', 'operators',
            [{ key: 'flipbookEnabled',     label: 'Ativo', default: false, type: 'hidden' },
             { key: 'flipbookCols',        label: 'Colunas', min: 1, max: 16, step: 1, default: 1, addDefault: 4 },
             { key: 'flipbookRows',        label: 'Linhas', min: 1, max: 16, step: 1, default: 1, addDefault: 4 },
             { key: 'flipbookLoops',       label: 'Repetições na Vida', min: 1, max: 20, step: 1, default: 1 },
             { key: 'flipbookRandomStart', label: 'Início Aleatório', type: 'seg', default: false,
               options: [[false,'Não'],[true,'Sim']] }],
            { onApply: c => { c.flipbookEnabled = true; }, onReset: c => { c.flipbookEnabled = false; },
              desc: 'Anima a textura como uma grade de quadros (use com uma imagem importada) — respeita a vida da partícula.' }),
        // ── Gatilho de Evento — não altera nenhum campo físico; dispara um
        // CustomEvent do navegador ('ncm-particle-event') no nascimento, na
        // morte, ou numa % configurável da vida de cada partícula, para que
        // código externo (áudio, VFX, scripts, integrações) possa reagir ao
        // ciclo de vida do sistema sem acoplamento com o motor de partículas.
        // Ver ParticleSystem._fireEventTrigger() e os pontos de disparo em
        // _spawn() / update() mais abaixo neste arquivo.
        _mod('event_trigger', 'Gatilho de Evento', '🔔', 'operators',
            [{ key: 'eventTriggerEnabled', label: 'Ativo', default: false, type: 'hidden' },
             { key: 'eventTriggerMode', label: 'Disparar em', type: 'seg', default: 'death',
               options: [['birth','Nascimento'], ['age','% da Vida'], ['death','Morte']] },
             { key: 'eventTriggerAge', label: 'Ponto da Vida (%)', min: 0, max: 1, step: 0.01, default: 0.5 }],
            { onApply: c => { c.eventTriggerEnabled = true; }, onReset: c => { c.eventTriggerEnabled = false; },
              desc: 'Dispara um evento JavaScript ("ncm-particle-event") no nascimento, na morte ou numa % específica da vida de cada partícula — use para sincronizar som, VFX externos ou scripts com o ciclo de vida das partículas.' }),
    ],

    forces: [
        _mod('vortex_spin', 'Vórtice (Giro)', '🌪', 'forces',
            [{ key: 'spiralStrength', label: 'Força', min: -30, max: 30, step: 0.1, default: 0, addDefault: 4 }]),
        _mod('vortex_height', 'Vórtice (Altura)', '🧬', 'forces',
            [{ key: 'vortexHeight', label: 'Força', min: -20, max: 20, step: 0.05, default: 0, addDefault: 2 }]),
        _mod('attract_repel', 'Atrair / Repelir', '🧲', 'forces',
            [{ key: 'forcePull', label: '- Repele / + Atrai', min: -20, max: 20, step: 0.05, default: 0, addDefault: 2 }]),
        _mod('radial_force', 'Força Radial', '💥', 'forces',
            [{ key: 'radialForce', label: '- Colapsa / + Expande', min: -30, max: 30, step: 0.05, default: 0, addDefault: 3 }]),
        _mod('curl_noise', 'Ruído Curl', '🌊', 'forces',
            [{ key: 'curlStrength', label: 'Força', min: -20, max: 20, step: 0.05, default: 0, addDefault: 3 },
             { key: 'curlFreq',     label: 'Frequência', min: 0.1, max: 20, step: 0.1, default: 1 }]),
        _mod('wave_motion', 'Movimento de Onda', '〰', 'forces',
            [{ key: 'waveAmt',  label: 'Quantidade', min: 0, max: 10, step: 0.05, default: 0, addDefault: 0.5 },
             { key: 'waveFreq', label: 'Frequência', min: 0.1, max: 30, step: 0.1, default: 2 }]),
        _mod('orbit', 'Órbita', '🪐', 'forces',
            [{ key: 'orbitSpeed', label: 'Velocidade', min: 0, max: 50, step: 0.1, default: 0, addDefault: 3 }]),
        _mod('turbulence', 'Turbulência', '🌫', 'forces',
            [{ key: 'wanderStrength', label: 'Força', min: 0, max: 5, step: 0.01, default: 0, addDefault: 0.15 },
             { key: 'noiseScale',     label: 'Escala de Ruído', min: 0, max: 10, step: 0.02, default: 0, addDefault: 0 }]),
    ],

    renderers: [
        _mod('render_sprite', 'Sprite (Padrão)', '🖼', 'renderers',
            [{ key: 'texture',          label: 'Textura',  type: 'texture',  default: 'glow' },
             { key: 'textureCustom',    label: 'Imagem importada', type: 'hidden', default: '' },
             { key: 'textureCustomName', label: 'Nome da imagem',   type: 'hidden', default: '' },
             { key: 'blending',         label: 'Blending',  type: 'blend',    default: 'additive' },
             { key: 'lightEmission',    label: 'Emissão de Luz', min: 0, max: 1, step: 0.01, default: 0.8 }],
            { group: 'renderMode', onApply: c => { c.rendererMode = 'sprite'; },
              desc: 'Partículas billboard individuais — o modo mais comum.' }),
        _mod('render_beam', 'Feixe / Rope (Laser)', '⚡', 'renderers',
            [{ key: 'beamWidth', label: 'Largura', min: 0.01, max: 3, step: 0.01, default: 0.12 },
             { key: 'lightEmission', label: 'Emissão de Luz', min: 0, max: 1, step: 0.01, default: 0.9 }],
            { group: 'renderMode', onApply: c => { c.rendererMode = 'beam'; },
              desc: 'Conecta partículas numa fita contínua — lasers, raios, chicotes de energia. Combine com o Iniciador "Linha".' }),
    ],
};

// Curve presets shared with the UI's simple curve buttons
const SIZE_CURVES = {
    grow:   [[0,0.3],[0.5,1],[1,0.8]],
    shrink: [[0,1],[1,0.1]],
    peak:   [[0,0],[0.3,1],[0.7,1],[1,0]],
    flat:   [[0,1],[1,1]],
};
const OPACITY_CURVES = {
    fade:    [[0,0],[0.12,1],[0.75,1],[1,0]],
    fadein:  [[0,0],[0.4,1],[1,1]],
    fadeout: [[0,1],[0.6,1],[1,0]],
    flat:    [[0,1],[1,1]],
};

/** Look up a module definition by category + id */
function _findModule(category, id) {
    return MODULE_LIBRARY[category]?.find(m => m.id === id) ?? null;
}

/** Scan a flat config object and return which modules are "active"
 *  (i.e. their governing fields differ from default) — used to populate
 *  the Stack UI automatically for presets and loaded .nex files without
 *  needing hand-authored stack metadata on every preset. */
function _inferStackFromConfig(cfg) {
    const stack = { emitters: null, initializers: [], operators: [], forces: [], renderers: null };
    // Emitter (single-select by cfg.burst)
    stack.emitters = cfg.burst ? 'emit_burst' : 'emit_continuous';
    // Shape initializer (single-select by cfg.emitShape)
    const shapeMap = { point:'shape_point', sphere:'shape_sphere', surface:'shape_surface',
        cone:'shape_cone', disc:'shape_disc', ring:'shape_ring', plane:'shape_plane', line:'shape_line',
        box:'shape_box', cylinder:'shape_cylinder' };
    stack.initializers.push(shapeMap[cfg.emitShape] ?? 'shape_sphere');
    // Always-relevant initializers
    stack.initializers.push('lifetime', 'initial_speed', 'initial_size');
    if (cfg.spreadAngle !== undefined && cfg.spreadAngle !== 180) stack.initializers.push('spread_angle');
    if (cfg.rotation) stack.initializers.push('rotation_random');
    if (cfg.colorVariance || cfg.brightnessVariance) stack.initializers.push('color_variance');
    if (cfg.elongation && cfg.elongation !== 1) stack.initializers.push('elongation');
    if (cfg.birthBurst) stack.initializers.push('birth_burst');
    if (cfg.scatterBirth) stack.initializers.push('scatter_birth');
    if (cfg.shapeDirection && cfg.shapeDirection !== 'default') stack.initializers.push('shape_direction');
    if (cfg.shapeArc !== undefined && cfg.shapeArc !== 360) stack.initializers.push('shape_arc');
    // Operators — always show the curve-based ones since virtually every preset uses them
    stack.operators.push('size_scale', 'opacity_fade', 'color_fade');
    MODULE_LIBRARY.operators.forEach(m => {
        if (['size_scale','opacity_fade','color_fade'].includes(m.id)) return;
        if (m.isActive(cfg)) stack.operators.push(m.id);
    });
    // Forces
    MODULE_LIBRARY.forces.forEach(m => { if (m.isActive(cfg)) stack.forces.push(m.id); });
    // Renderer (single-select)
    stack.renderers = cfg.rendererMode === 'beam' ? 'render_beam' : 'render_sprite';
    return stack;
}

export const PARTICLE_PRESETS = {
    // ── Atmosphere / Map ────────────────────────────────────────
    fireflies: {
        label: 'Fireflies',
        icon:  '✨',
        category: 'atmosphere',
        rate: 4, lifetime: [3, 6], speed: [0.05, 0.2],
        size: [0.08, 0.12], sizeOverLife: [[0,0],[0.2,1],[0.8,1],[1,0]],
        color: { from: 0x88ffaa, to: 0xffffff },
        colorOverLife: [[0,0x88ffaa],[0.5,0xaaffcc],[1,0xffffff]],
        opacity: 0.9, opacityOverLife: [[0,0],[0.15,1],[0.85,1],[1,0]],
        texture: 'glow', blending: 'additive',
        emitShape: 'sphere', emitRadius: 2,
        drag: 0.98, gravity: 0,
        localVelocity: false,
        wanderStrength: 0.05,
    },

    magicDust: {
        label: 'Magic Dust',
        icon:  '🌟',
        category: 'magic',
        rate: 20, lifetime: [1.2, 2.4], speed: [0.3, 0.8],
        size: [0.06, 0.14], sizeOverLife: [[0,0.5],[0.3,1],[1,0]],
        color: { from: 0xcc44ff, to: 0x4488ff },
        colorOverLife: [[0,0xee44ff],[0.5,0x8844ff],[1,0x4488ff]],
        opacity: 1, opacityOverLife: [[0,0],[0.1,1],[0.7,1],[1,0]],
        texture: 'sparkle', blending: 'additive',
        emitShape: 'cone', emitAngle: 30, emitRadius: 0.3,
        drag: 0.95, gravity: -0.02,
        rotation: true, rotSpeed: [-180, 180],
    },

    sakura: {
        label: 'Sakura Petals',
        icon:  '🌸',
        category: 'atmosphere',
        rate: 6, lifetime: [4, 8], speed: [0.1, 0.3],
        size: [0.12, 0.25], sizeOverLife: [[0,0],[0.2,1],[0.9,1],[1,0]],
        color: { from: 0xffaacc, to: 0xffeeff },
        colorOverLife: [[0,0xffbbdd],[0.5,0xffccee],[1,0xfff0ff]],
        opacity: 0.85, opacityOverLife: [[0,0],[0.2,0.85],[0.8,0.85],[1,0]],
        texture: 'diamond', blending: 'normal',
        emitShape: 'sphere', emitRadius: 1.5,
        drag: 0.97, gravity: 0.04,
        rotation: true, rotSpeed: [-60, 60],
        wanderStrength: 0.08,
    },

    energyAura: {
        label: 'Energy Aura',
        icon:  '⚡',
        category: 'magic',
        rate: 30, lifetime: [0.4, 0.8], speed: [0.5, 1.5],
        size: [0.05, 0.12], sizeOverLife: [[0,1],[0.5,0.6],[1,0]],
        color: { from: 0x00ccff, to: 0xffffff },
        colorOverLife: [[0,0x00ccff],[0.4,0x88ddff],[1,0xffffff]],
        opacity: 0.9, opacityOverLife: [[0,0.5],[0.2,1],[0.8,0.6],[1,0]],
        texture: 'glow', blending: 'additive',
        emitShape: 'surface', emitRadius: 0.6,
        drag: 0.92, gravity: -0.3,
    },

    // ── Combat / Roblox game style ───────────────────────────────
    devilFruitAura: {
        label: 'Devil Fruit Aura',
        icon:  '🔥',
        category: 'combat',
        rate: 40, lifetime: [0.5, 1.2], speed: [1, 2.5],
        size: [0.08, 0.2], sizeOverLife: [[0,0.3],[0.2,1],[0.7,0.8],[1,0]],
        color: { from: 0xff4400, to: 0xffaa00 },
        colorOverLife: [[0,0xff2200],[0.3,0xff6600],[0.7,0xffaa00],[1,0xffee88]],
        opacity: 0.95, opacityOverLife: [[0,0],[0.1,1],[0.7,1],[1,0]],
        texture: 'ember', blending: 'additive',
        emitShape: 'sphere', emitRadius: 0.5,
        drag: 0.94, gravity: -0.5,
    },

    swordSlash: {
        label: 'Sword Slash',
        icon:  '⚔️',
        category: 'combat',
        burst: true, burstCount: 60,
        lifetime: [0.3, 0.6], speed: [3, 6],
        size: [0.06, 0.15], sizeOverLife: [[0,1],[0.5,0.5],[1,0]],
        color: { from: 0xffffff, to: 0x88ccff },
        colorOverLife: [[0,0xffffff],[0.3,0xaaddff],[1,0x4488cc]],
        opacity: 1, opacityOverLife: [[0,0.8],[0.3,1],[1,0]],
        texture: 'sparkle', blending: 'additive',
        emitShape: 'disc', emitRadius: 0.8,
        drag: 0.88, gravity: 0,
    },

    poisonCloud: {
        label: 'Poison Cloud',
        icon:  '☠️',
        category: 'combat',
        rate: 15, lifetime: [2, 4], speed: [0.1, 0.4],
        size: [0.3, 0.7], sizeOverLife: [[0,0],[0.3,1],[0.9,1.2],[1,0]],
        color: { from: 0x44ff44, to: 0x226622 },
        colorOverLife: [[0,0x44ff44],[0.4,0x88ff44],[0.8,0x336633],[1,0x224422]],
        opacity: 0.6, opacityOverLife: [[0,0],[0.2,0.6],[0.8,0.5],[1,0]],
        texture: 'smoke', blending: 'normal',
        emitShape: 'sphere', emitRadius: 0.4,
        drag: 0.99, gravity: -0.05,
        wanderStrength: 0.04,
    },

    lightningStrike: {
        label: 'Lightning Strike',
        icon:  '🌩️',
        category: 'combat',
        burst: true, burstCount: 80,
        lifetime: [0.15, 0.45], speed: [2, 5],
        size: [0.05, 0.1], sizeOverLife: [[0,1],[0.4,0.7],[1,0]],
        color: { from: 0xaaccff, to: 0xffffff },
        colorOverLife: [[0,0x8899ff],[0.3,0xaaddff],[1,0xffffff]],
        opacity: 1, opacityOverLife: [[0,1],[0.5,0.8],[1,0]],
        texture: 'glow', blending: 'additive',
        emitShape: 'sphere', emitRadius: 0.2,
        drag: 0.85, gravity: 0.8,
    },

    // ── Elemental ────────────────────────────────────────────────
    iceShard: {
        label: 'Ice Shards',
        icon:  '❄️',
        category: 'elemental',
        rate: 25, lifetime: [0.8, 1.6], speed: [0.5, 2],
        size: [0.07, 0.15], sizeOverLife: [[0,1],[0.6,0.8],[1,0]],
        color: { from: 0xaaeeff, to: 0xffffff },
        colorOverLife: [[0,0x88ccff],[0.5,0xcceeFF],[1,0xffffff]],
        opacity: 0.9, opacityOverLife: [[0,0.5],[0.1,1],[0.8,0.9],[1,0]],
        texture: 'diamond', blending: 'additive',
        emitShape: 'sphere', emitRadius: 0.4,
        drag: 0.93, gravity: 0.2,
        rotation: true, rotSpeed: [-90, 90],
    },

    darkEnergy: {
        label: 'Dark Energy',
        icon:  '🌑',
        category: 'elemental',
        rate: 25, lifetime: [0.8, 1.8], speed: [0.3, 1.2],
        size: [0.1, 0.22], sizeOverLife: [[0,0],[0.2,1],[0.7,0.8],[1,0]],
        color: { from: 0x440088, to: 0x000011 },
        colorOverLife: [[0,0x880088],[0.4,0x440066],[0.8,0x220033],[1,0x000011]],
        opacity: 0.85, opacityOverLife: [[0,0],[0.15,0.85],[0.8,0.7],[1,0]],
        texture: 'smoke', blending: 'normal',
        emitShape: 'sphere', emitRadius: 0.5,
        drag: 0.97, gravity: -0.1,
    },

    goldCoins: {
        label: 'Gold Coins',
        icon:  '💰',
        category: 'magic',
        burst: true, burstCount: 30,
        lifetime: [1.5, 2.5], speed: [1, 3],
        size: [0.1, 0.2], sizeOverLife: [[0,0.5],[0.2,1],[0.8,1],[1,0.3]],
        color: { from: 0xffcc00, to: 0xff8800 },
        colorOverLife: [[0,0xffdd00],[0.4,0xffaa00],[1,0xff8800]],
        opacity: 1, opacityOverLife: [[0,0],[0.1,1],[0.7,1],[1,0]],
        texture: 'ring', blending: 'additive',
        emitShape: 'sphere', emitRadius: 0.3,
        drag: 0.92, gravity: 0.4,
        rotation: true, rotSpeed: [-180, 180],
    },

    // ── Atmosphere ──────────────────────────────────────────────
    rain: {
        label: 'Rain',
        icon:  '🌧️',
        category: 'atmosphere',
        rate: 80, lifetime: [0.8, 1.6], speed: [3, 5],
        size: [0.03, 0.06], sizeOverLife: [[0,1],[1,1]],
        color: { from: 0x8899cc, to: 0xaabbdd },
        colorOverLife: [[0,0x8899cc],[1,0x99aacc]],
        opacity: 0.6, opacityOverLife: [[0,0.6],[0.8,0.6],[1,0]],
        texture: 'lightning', blending: 'normal',
        emitShape: 'plane', emitRadius: 3,
        drag: 1.0, gravity: 0.8,
        direction: new THREE.Vector3(0.1, -1, 0),
    },

    snow: {
        label: 'Snow',
        icon:  '❄️',
        category: 'atmosphere',
        rate: 30, lifetime: [4, 8], speed: [0.1, 0.4],
        size: [0.05, 0.12], sizeOverLife: [[0,0],[0.2,1],[0.8,1],[1,0]],
        color: { from: 0xeeeeff, to: 0xffffff },
        colorOverLife: [[0,0xddeeff],[0.5,0xeeeeff],[1,0xffffff]],
        opacity: 0.8, opacityOverLife: [[0,0],[0.2,0.8],[0.8,0.8],[1,0]],
        texture: 'soft', blending: 'normal',
        emitShape: 'plane', emitRadius: 4,
        drag: 0.99, gravity: 0.05,
        wanderStrength: 0.06,
    },

    bubbles: {
        label: 'Bubbles',
        icon:  '🫧',
        category: 'atmosphere',
        rate: 8, lifetime: [2, 4], speed: [0.1, 0.4],
        size: [0.1, 0.3], sizeOverLife: [[0,0],[0.2,1],[0.85,1],[1,1.2]],
        color: { from: 0x88ddff, to: 0xffffff },
        colorOverLife: [[0,0x88ccff],[0.5,0xaaddff],[1,0xffffff]],
        opacity: 0.5, opacityOverLife: [[0,0],[0.2,0.5],[0.8,0.5],[1,0]],
        texture: 'ring', blending: 'additive',
        emitShape: 'sphere', emitRadius: 0.5,
        drag: 0.99, gravity: -0.08,
    },

    // ── Fire / Smoke (custom creation) ──────────────────────────
    fire: {
        label: 'Fire',
        icon:  '🔥',
        category: 'elemental',
        rate: 50, lifetime: [0.6, 1.4], speed: [1.5, 4],
        size: [0.12, 0.32], sizeOverLife: [[0,0.5],[0.3,1],[0.7,0.9],[1,0]],
        color: { from: 0xffff80, to: 0xff2200 },
        colorOverLife: [[0,0xffff80],[0.25,0xffaa00],[0.6,0xff4400],[0.85,0xcc1100],[1,0x330000]],
        opacity: 1, opacityOverLife: [[0,0],[0.08,0.9],[0.6,0.7],[1,0]],
        texture: 'fireball', blending: 'additive',
        emitShape: 'disc', emitRadius: 0.25,
        drag: 0.95, gravity: -1.8,
        wanderStrength: 0.04,
        lightEmission: 1.0,
    },
    smoke: {
        label: 'Smoke',
        icon:  '💨',
        category: 'atmosphere',
        rate: 12, lifetime: [3, 7], speed: [0.3, 1],
        size: [0.3, 0.8], sizeOverLife: [[0,0.2],[0.3,1],[0.8,1.4],[1,1.6]],
        color: { from: 0x555566, to: 0x999aaa },
        colorOverLife: [[0,0x444455],[0.4,0x777788],[0.8,0x999aaa],[1,0xbbbbcc]],
        opacity: 0.55, opacityOverLife: [[0,0],[0.15,0.55],[0.7,0.45],[1,0]],
        texture: 'smoke', blending: 'normal',
        emitShape: 'disc', emitRadius: 0.2,
        drag: 0.99, gravity: -0.15,
        wanderStrength: 0.06,
        lightEmission: 0,
    },
    campfire: {
        label: 'Campfire',
        icon:  '🏕️',
        category: 'elemental',
        rate: 35, lifetime: [0.7, 1.8], speed: [1, 3],
        size: [0.08, 0.22], sizeOverLife: [[0,0.4],[0.3,1],[0.7,0.7],[1,0]],
        color: { from: 0xffffff, to: 0xff3300 },
        colorOverLife: [[0,0xfff0a0],[0.2,0xffcc00],[0.5,0xff6600],[0.8,0xff2200],[1,0x440000]],
        opacity: 0.9, opacityOverLife: [[0,0],[0.1,0.9],[0.6,0.7],[1,0]],
        texture: 'ember', blending: 'additive',
        emitShape: 'disc', emitRadius: 0.18,
        drag: 0.94, gravity: -2.2,
        wanderStrength: 0.05,
        lightEmission: 1.0,
    },
    waterfall: {
        label: 'Waterfall',
        icon:  '💧',
        category: 'atmosphere',
        rate: 60, lifetime: [1.2, 2.4], speed: [2, 5],
        size: [0.04, 0.1], sizeOverLife: [[0,0.6],[0.5,1],[1,0.4]],
        color: { from: 0xaaddff, to: 0x88bbff },
        colorOverLife: [[0,0xaaddff],[0.5,0x99ccff],[1,0x88bbff]],
        opacity: 0.7, opacityOverLife: [[0,0.5],[0.2,0.7],[0.8,0.6],[1,0]],
        texture: 'soft', blending: 'normal',
        emitShape: 'disc', emitRadius: 0.4,
        drag: 0.99, gravity: 0.8,
        direction: null,
        lightEmission: 0.2,
    },
    explosion: {
        label: 'Explosion',
        icon:  '💥',
        category: 'combat',
        burst: true, burstCount: 120,
        lifetime: [0.4, 1.2], speed: [3, 10],
        size: [0.1, 0.4], sizeOverLife: [[0,0.5],[0.2,1],[0.6,0.8],[1,0]],
        color: { from: 0xffffff, to: 0xff2200 },
        colorOverLife: [[0,0xffffff],[0.15,0xffff80],[0.3,0xffaa00],[0.55,0xff4400],[0.8,0xcc1100],[1,0x220000]],
        opacity: 0.95, opacityOverLife: [[0,0.95],[0.4,0.8],[0.75,0.4],[1,0]],
        texture: 'fireball', blending: 'additive',
        emitShape: 'sphere', emitRadius: 0.1,
        drag: 0.88, gravity: 0.3,
        lightEmission: 1.0,
    },
    confetti: {
        label: 'Confetti',
        icon:  '🎊',
        category: 'atmosphere',
        rate: 30, lifetime: [2.5, 5], speed: [2, 6],
        size: [0.08, 0.18], sizeOverLife: [[0,0.6],[0.4,1],[0.9,0.8],[1,0.3]],
        color: { from: 0xff4488, to: 0x44ffaa },
        colorOverLife: [[0,0xff4488],[0.25,0xffcc00],[0.5,0x44ffaa],[0.75,0x44aaff],[1,0xcc44ff]],
        opacity: 1, opacityOverLife: [[0,0],[0.1,1],[0.8,0.9],[1,0]],
        texture: 'square', blending: 'normal',
        emitShape: 'cone', emitAngle: 60, emitRadius: 0.3,
        drag: 0.97, gravity: 0.2,
        rotation: true, rotSpeed: [-360, 360],
        lightEmission: 0.2,
    },
    heartburst: {
        label: 'Hearts',
        icon:  '💕',
        category: 'magic',
        burst: true, burstCount: 25,
        lifetime: [1.5, 3], speed: [1.5, 4],
        size: [0.1, 0.22], sizeOverLife: [[0,0],[0.2,1],[0.8,0.9],[1,0.3]],
        color: { from: 0xff88aa, to: 0xff2266 },
        colorOverLife: [[0,0xff88cc],[0.4,0xff4488],[1,0xff2266]],
        opacity: 1, opacityOverLife: [[0,0],[0.15,1],[0.7,1],[1,0]],
        texture: 'heart', blending: 'additive',
        emitShape: 'sphere', emitRadius: 0.3,
        drag: 0.95, gravity: -0.3,
        rotation: true, rotSpeed: [-60, 60],
        lightEmission: 0.7,
    },
    trail: {
        label: 'Speed Trail',
        icon:  '🚀',
        category: 'magic',
        rate: 80, lifetime: [0.2, 0.5], speed: [0.1, 0.4],
        size: [0.04, 0.12], sizeOverLife: [[0,1],[0.5,0.5],[1,0]],
        color: { from: 0xffffff, to: 0x4488ff },
        colorOverLife: [[0,0xffffff],[0.3,0x88ccff],[0.7,0x4488ff],[1,0x0022aa]],
        opacity: 0.9, opacityOverLife: [[0,0.9],[0.4,0.6],[1,0]],
        texture: 'soft', blending: 'additive',
        emitShape: 'sphere', emitRadius: 0.05,
        drag: 0.9, gravity: 0,
        lightEmission: 0.8,
    },
    hexaura: {
        label: 'Hex Aura',
        icon:  '🔷',
        category: 'magic',
        rate: 25, lifetime: [1, 2.5], speed: [0.5, 1.5],
        size: [0.1, 0.25], sizeOverLife: [[0,0],[0.3,1],[0.7,0.9],[1,0]],
        color: { from: 0x00ffff, to: 0x0044ff },
        colorOverLife: [[0,0x00ffff],[0.5,0x4488ff],[1,0x0022cc]],
        opacity: 0.85, opacityOverLife: [[0,0],[0.2,0.85],[0.8,0.7],[1,0]],
        texture: 'hex', blending: 'additive',
        emitShape: 'ring', emitRadius: 0.7,
        drag: 0.97, gravity: -0.1,
        rotation: true, rotSpeed: [-90, 90],
        lightEmission: 1.0,
    },

    // ── Portal / Warp ────────────────────────────────────────────
    portalVortex: {
        label: 'Portal Vortex',
        icon:  '🌀',
        category: 'magic',
        rate: 50, lifetime: [0.6, 1.2], speed: [1, 2],
        size: [0.06, 0.14], sizeOverLife: [[0,0.3],[0.3,1],[0.8,0.5],[1,0]],
        color: { from: 0x4400cc, to: 0x00ccff },
        colorOverLife: [[0,0x4400ff],[0.3,0x8800ff],[0.6,0x00aaff],[1,0x00ffff]],
        opacity: 0.95, opacityOverLife: [[0,0],[0.1,0.95],[0.7,0.8],[1,0]],
        texture: 'glow', blending: 'additive',
        emitShape: 'ring', emitRadius: 0.8,
        drag: 0.92, gravity: 0,
        orbitSpeed: 2.5,
    },

    starfield: {
        label: 'Starfield',
        icon:  '⭐',
        category: 'atmosphere',
        rate: 3, lifetime: [3, 6], speed: [0.05, 0.2],
        size: [0.05, 0.15], sizeOverLife: [[0,0],[0.2,1],[0.8,1],[1,0]],
        color: { from: 0xffffff, to: 0xffeeaa },
        colorOverLife: [[0,0xffffff],[0.5,0xffeeaa],[1,0xff8800]],
        opacity: 1, opacityOverLife: [[0,0],[0.1,1],[0.85,1],[1,0]],
        texture: 'sparkle', blending: 'additive',
        emitShape: 'sphere', emitRadius: 3,
        drag: 1.0, gravity: 0,
    },

    // ── NEW: Laser / Beam / Rope renderer showcase ──────────────
    laserBeam: {
        label: 'Laser Beam',
        icon:  '⚡',
        category: 'combat',
        rate: 60, lifetime: [0.15, 0.25], speed: [0, 0],
        size: [0.06, 0.1], sizeOverLife: [[0,1],[1,1]],
        color: { from: 0xff2244, to: 0xff2244 },
        colorOverLife: [[0,0xffaacc],[0.5,0xff2244],[1,0xaa0022]],
        opacity: 1, opacityOverLife: [[0,1],[0.7,1],[1,0]],
        texture: 'glow', blending: 'additive', lightEmission: 1,
        emitShape: 'line', targetOffset: { x: 0, y: 0, z: 6 }, lineJitter: 0.03,
        drag: 1, gravity: 0,
        rendererMode: 'beam', beamWidth: 0.1,
    },

    electricArc: {
        label: 'Electric Arc',
        icon:  '🌩',
        category: 'combat',
        rate: 80, lifetime: [0.1, 0.2], speed: [0, 0.3],
        size: [0.05, 0.09], sizeOverLife: [[0,1],[1,0.6]],
        color: { from: 0x8ecbff, to: 0xffffff },
        colorOverLife: [[0,0xffffff],[0.4,0x8ecbff],[1,0x3355ff]],
        opacity: 1, opacityOverLife: [[0,1],[0.8,1],[1,0]],
        texture: 'electric', blending: 'additive', lightEmission: 1,
        emitShape: 'line', targetOffset: { x: 0, y: 0, z: 4 }, lineJitter: 0.12,
        drag: 0.9, gravity: 0,
        curlStrength: 8, curlFreq: 6,
        rendererMode: 'beam', beamWidth: 0.06,
    },

    // ── NEW: Water splash (ground-impact, complements Waterfall) ─
    waterSplash: {
        label: 'Water Splash',
        icon:  '💦',
        category: 'elemental',
        rate: 40, lifetime: [0.5, 1.1], speed: [1.5, 4],
        size: [0.04, 0.09], sizeOverLife: [[0,1],[1,0.3]],
        color: { from: 0xaeeaff, to: 0x3a8fcf },
        colorOverLife: [[0,0xdff5ff],[0.5,0xaeeaff],[1,0x3a8fcf]],
        opacity: 0.85, opacityOverLife: [[0,1],[0.7,0.7],[1,0]],
        texture: 'soft', blending: 'normal',
        emitShape: 'cone', emitRadius: 0.3, spreadAngle: 60,
        drag: 0.94, gravity: 14,
        bounceY: 0.35, wallBounce: 0, wallSize: 3,
    },
};

// ─── Particle class ───────────────────────────────────────────────────────────
class Particle {
    constructor() {
        this.pos      = new THREE.Vector3();
        this.vel      = new THREE.Vector3();
        this.acc      = new THREE.Vector3();
        this.color    = new THREE.Color();
        this.baseColor= new THREE.Color();  // pre-variance color
        this.size     = 1;
        this.opacity  = 1;
        this.life     = 1;
        this.maxLife  = 1;
        this.rotation = 0;
        this.rotSpeed = 0;
        this.alive    = false;
        this.orbitAngle = 0;
        this.orbitRadius= 0;
        // shape sculpt
        this.aspect       = 1;     // elongation per-particle
        this.flickerPhase = 0;     // random phase offset for flicker
        this.pulsePhase   = 0;     // random phase offset for pulse
        this.wavePhase    = 0;     // wave motion phase
        this.colorHueOff  = 0;     // per-particle hue offset
        this.brightnessOff= 0;     // per-particle brightness offset
        this.initialPos   = new THREE.Vector3(); // for force pull calculation
        this.flipFrame    = 0;      // current sprite-sheet/flipbook frame index
        this._eventFired  = false;  // Gatilho de Evento (Operators): guards the
                                     // '% da Vida' mode so it only fires once per particle
    }
    reset() { this.alive = false; this._eventFired = false; }
}

// ─── ParticleSystem class ─────────────────────────────────────────────────────
// ── Shader FX library (Particle Labs "Shader" tab) ────────────────────────
// A curated set of fragment-shader effects layered onto the particle sprite
// shader (see the uFx* uniforms in ParticleSystem below). `params` names
// what each of the 3 generic uFxParam1-3 sliders means for that mode ('—'
// = unused for that mode, hidden in the UI). Icons reuse the same <symbol>
// sprite as the module/preset icons above.
export const SHADER_FX_MODES = { none: 0, rim: 1, dissolve: 2, rainbow: 3, wave: 4, pulse: 5, chromatic: 6 };
export const SHADER_FX_LIBRARY = {
  none:      { label: 'Nenhum',              icon: 'pi-circle-outline', params: ['—', '—', '—'] },
  rim:       { label: 'Brilho de Borda',     icon: 'pi-ring',      params: ['Intensidade', 'Nitidez', '—'],          color: true },
  dissolve:  { label: 'Dissolução',          icon: 'pi-sparkle',   params: ['Quantidade', 'Escala do Ruído', '—'],   color: true },
  rainbow:   { label: 'Ciclo Arco-íris',     icon: 'pi-rainbow',   params: ['Fase', 'Saturação', 'Velocidade'] },
  wave:      { label: 'Distorção de Onda',   icon: 'pi-wave',      params: ['Amplitude', 'Frequência', 'Velocidade'] },
  pulse:     { label: 'Pulso',               icon: 'pi-heartbeat', params: ['Intensidade', 'Contraste', 'Velocidade'] },
  chromatic: { label: 'Aberração Cromática', icon: 'pi-bolt',      params: ['Deslocamento', '—', 'Velocidade'] },
};

const SHADER_FX_ORDER = Object.keys(SHADER_FX_LIBRARY).filter(mode => mode !== 'none');
const SHADER_FX_SLOT_COUNT = SHADER_FX_ORDER.length;

function _normalizeShaderFxEntry(mode, fx = {}) {
  if (!mode || mode === 'none' || !SHADER_FX_LIBRARY[mode]) return null;
  return {
    mode,
    p1: Number.isFinite(Number(fx.p1)) ? Number(fx.p1) : 0.5,
    p2: Number.isFinite(Number(fx.p2)) ? Number(fx.p2) : 0.5,
    p3: Number.isFinite(Number(fx.p3)) ? Number(fx.p3) : 0.5,
    color: fx.color ?? '#ffffff',
    enabled: fx.enabled !== false,
  };
}

function _normalizeShaderFxStackInput(stackInput = {}) {
  const out = {};
  if (!stackInput) return out;

  if (Array.isArray(stackInput)) {
    stackInput.forEach(entry => {
      if (!entry?.mode || entry.mode === 'none') return;
      const normalized = _normalizeShaderFxEntry(entry.mode, entry);
      if (normalized) out[entry.mode] = normalized;
    });
    return out;
  }

  if (stackInput.mode) {
    const normalized = _normalizeShaderFxEntry(stackInput.mode, stackInput);
    if (normalized) out[stackInput.mode] = normalized;
    return out;
  }

  Object.entries(stackInput).forEach(([mode, fx]) => {
    const normalized = _normalizeShaderFxEntry(mode, fx || {});
    if (normalized) out[mode] = normalized;
  });
  return out;
}

// ─── Shared GLSL: Style shading + flipbook UV ──────────────────────────────
// Used by BOTH particle renderers (the default point-sprite pipeline and the
// oriented-quad pipeline used for the "Velocity"/"World" orientation modes)
// so Toon/Anime/Soft/Unlit and sprite-sheet animation look identical no
// matter which orientation mode is active.
const NCM_PARTICLE_STYLE_GLSL = /* glsl */`
    // Remaps a 0..1 quad-local uv into a single cell of a cols×rows sprite
    // sheet using vFrame (current frame index, computed CPU-side from the
    // particle's life so it naturally respects lifetime/looping).
    vec2 ncmFlipbookUV(vec2 uv, vec2 grid, float frame) {
        float cols = max(grid.x, 1.0);
        float rows = max(grid.y, 1.0);
        if (cols < 1.5 && rows < 1.5) return uv;
        float total = cols * rows;
        float f  = mod(floor(frame + 0.5), max(total, 1.0));
        float cx = mod(f, cols);
        float ry = floor(f / cols);
        vec2 cell = vec2(1.0 / cols, 1.0 / rows);
        return vec2((cx + uv.x) * cell.x, 1.0 - (ry + 1.0 - uv.y) * cell.y);
    }

    // Style pass — mutates color/alpha in place for Toon/Anime (hard
    // silhouette + posterized bands + ink outline) and Soft/Unlit. Normal
    // and Additive need no fragment-level change (Additive is a blending
    // mode switch applied on the material itself).
    void ncmApplyStyle(inout vec3 col, inout float alpha, int mode, float levels, vec3 outlineColor, float outlineW) {
        if (mode == 1 || mode == 2) { // toon / anime
            float lv = max(levels, 2.0);
            float hardA = step(0.5, alpha);
            float band  = smoothstep(0.5 - outlineW, 0.5, alpha) - smoothstep(0.5, 0.5 + outlineW, alpha);
            vec3 posterized = floor(col * lv) / max(lv - 1.0, 1.0);
            col = (mode == 2) ? mix(posterized, posterized * 1.22, 0.55) : posterized; // anime: extra punch
            col = mix(col, outlineColor, clamp(band, 0.0, 1.0));
            alpha = hardA;
        } else if (mode == 4) { // soft
            alpha = smoothstep(0.0, 0.82, alpha);
        }
        // mode 0 normal / 3 additive / 5 unlit: color+alpha pass through unchanged here
    }
`;

let _particleSystemIdSeed = 0;
function _genParticleSystemId() {
    _particleSystemIdSeed = (_particleSystemIdSeed + 1) >>> 0;
    return `ps_${Date.now().toString(36)}_${_particleSystemIdSeed.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}


export class ParticleSystem {
    constructor(scene, config = {}) {
        this._scene  = scene;
        this._config = Object.assign({}, PARTICLE_PRESETS.magicDust, config);
        this._config.shaderFxStack = _normalizeShaderFxStackInput(this._config.shaderFxStack ?? this._config.shaderFx);
        delete this._config.shaderFx;
        this._particles  = [];
        this._maxParticles = Math.min(config.maxParticles || 2000, 5000);
        this._pool       = [];
        this._time       = 0;
        this._emitAccum  = 0;
        this._playing    = false;
        this._paused     = false;

        this.id = config.id || _genParticleSystemId();
        this.parentId = config.parentId ?? null;
        this.localPosition = config.localPosition
            ? new THREE.Vector3(config.localPosition.x, config.localPosition.y, config.localPosition.z)
            : null;
        this._parentSystem = null;
        this._childSystems = new Set();

        this.name = config.name || 'ParticleSystem';
        this.position = new THREE.Vector3();
        this.userData = { particleType: 'custom', isCustomParticle: true, isLab: true, particleSystemId: this.id };

        // Build pool
        for (let i = 0; i < this._maxParticles; i++) this._pool.push(new Particle());

        // Three.js geometry + points
        this._geo       = new THREE.BufferGeometry();
        this._positions = new Float32Array(this._maxParticles * 3);
        this._colors    = new Float32Array(this._maxParticles * 3);
        this._sizes     = new Float32Array(this._maxParticles);
        this._opacities = new Float32Array(this._maxParticles);
        this._rotations = new Float32Array(this._maxParticles);
        this._aspects   = new Float32Array(this._maxParticles).fill(1);
        this._frames    = new Float32Array(this._maxParticles);

        this._geo.setAttribute('position',  new THREE.BufferAttribute(this._positions, 3));
        this._geo.setAttribute('color',     new THREE.BufferAttribute(this._colors,    3));
        this._geo.setAttribute('aSize',     new THREE.BufferAttribute(this._sizes,     1));
        this._geo.setAttribute('aOpacity',  new THREE.BufferAttribute(this._opacities, 1));
        this._geo.setAttribute('aRotation', new THREE.BufferAttribute(this._rotations, 1));
        this._geo.setAttribute('aAspect',   new THREE.BufferAttribute(this._aspects,   1));
        this._geo.setAttribute('aFrame',    new THREE.BufferAttribute(this._frames,    1));
        this._geo.setDrawRange(0, 0);

        const cfg    = this._config;
        const texName= cfg.texture || 'glow';
        const tex    = _getTexture(texName);
        const blendMode = cfg.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
        const lightEm = cfg.lightEmission ?? 0.8;

        this._mat = new THREE.ShaderMaterial({
            uniforms: {
                uTexture:       { value: tex },
                uLightEmission: { value: lightEm },
                uSizeScale:     { value: 1.0 },
                uTime:          { value: 0.0 },
                // Shader FX stack (Particle Labs "Shader" tab):
                // up to 6 layers can be enabled at once.
                uFxData:        { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0.5, 0.5, 0.5)) },
                uFxColor:       { value: Array.from({ length: 6 }, () => new THREE.Color(0xffffff)) },
                // ── Style (Particle Labs Page 2 "Style" tab) ──────────────
                // 0 normal, 1 toon, 2 anime, 3 additive, 4 soft, 5 unlit
                uStyleMode:     { value: 0 },
                uStyleLevels:   { value: 4 },
                uStyleOutline:  { value: new THREE.Color(0x0b0b14) },
                uStyleOutlineW: { value: 0.16 },
                // ── Sprite-sheet / flipbook (Particle Labs Page 2 "Appearance") ──
                uFlipGrid:      { value: new THREE.Vector2(1, 1) },
            },
            vertexShader: /* glsl */`
                attribute float aSize;
                attribute float aOpacity;
                attribute float aRotation;
                attribute float aAspect;
                attribute float aFrame;
                uniform float uSizeScale;
                varying vec3  vColor;
                varying float vOpacity;
                varying float vRot;
                varying float vFrame;
                void main(){
                    vColor   = color;
                    vOpacity = aOpacity;
                    vRot     = aRotation;
                    vFrame   = aFrame;
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    float dist = -mvPos.z;
                    gl_PointSize = clamp(aSize * uSizeScale * (380.0 / max(dist, 0.1)), 1.0, 512.0);
                    gl_Position  = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: /* glsl */`
                #define FX_LAYER_COUNT 6
                uniform sampler2D uTexture;
                uniform float uLightEmission;
                uniform float uTime;
                uniform vec4  uFxData[FX_LAYER_COUNT];
                uniform vec3  uFxColor[FX_LAYER_COUNT];
                uniform int   uStyleMode;
                uniform float uStyleLevels;
                uniform vec3  uStyleOutline;
                uniform float uStyleOutlineW;
                uniform vec2  uFlipGrid;
                varying vec3  vColor;
                varying float vOpacity;
                varying float vRot;
                varying float vFrame;

                ${NCM_PARTICLE_STYLE_GLSL}

                float fxHash(vec2 p){ p=fract(p*vec2(234.34,435.345)); p+=dot(p,p+34.23); return fract(p.x*p.y); }
                float fxNoise(vec2 p){
                    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
                    float a=fxHash(i), b=fxHash(i+vec2(1.0,0.0)), c=fxHash(i+vec2(0.0,1.0)), d=fxHash(i+vec2(1.0,1.0));
                    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
                }
                vec3 fxHueShift(vec3 col, float hue){
                    const vec3 k = vec3(0.57735);
                    float cosA = cos(hue), sinA = sin(hue);
                    return col*cosA + cross(k,col)*sinA + k*dot(k,col)*(1.0-cosA);
                }

                void main(){
                    vec2 cuv = gl_PointCoord - 0.5;
                    float s = sin(vRot), c = cos(vRot);
                    cuv = vec2(c*cuv.x - s*cuv.y, s*cuv.x + c*cuv.y) + 0.5;

                    vec2 uv = cuv;
                    for (int i = 0; i < FX_LAYER_COUNT; i++) {
                        float mode = uFxData[i].x;
                        if (mode > 3.5 && mode < 4.5) {
                            float p1 = uFxData[i].y;
                            float p2 = uFxData[i].z;
                            float p3 = uFxData[i].w;
                            float amp  = p1 * 0.15;
                            float freq = 4.0 + p2 * 16.0;
                            float spd  = p3 * 4.0;
                            uv += vec2(sin(uv.y * freq + uTime * spd), cos(uv.x * freq + uTime * spd)) * amp;
                        }
                    }

                    uv = ncmFlipbookUV(uv, uFlipGrid, vFrame);
                    vec4 tex = texture2D(uTexture, clamp(uv, 0.001, 0.999));

                    for (int i = 0; i < FX_LAYER_COUNT; i++) {
                        float mode = uFxData[i].x;
                        if (mode < 0.5) continue;
                        float p1 = uFxData[i].y;
                        float p2 = uFxData[i].z;
                        float p3 = uFxData[i].w;
                        if (mode > 5.5 && mode < 6.5) {
                            float off = p1 * 0.06;
                            float ang = uTime * p3 * 2.0;
                            vec2 dir = vec2(cos(ang), sin(ang)) * off;
                            float r = texture2D(uTexture, clamp(uv + dir, 0.001, 0.999)).r;
                            float b = texture2D(uTexture, clamp(uv - dir, 0.001, 0.999)).b;
                            tex = vec4(r, tex.g, b, tex.a);
                        }
                    }

                    if(tex.a < 0.015) discard;
                    float colorLum = dot(vColor, vec3(0.299, 0.587, 0.114));
                    float blackBoost = (1.0 - smoothstep(0.0, 0.06, colorLum)) * 0.28;
                    vec3 col = mix(vColor, vColor * tex.rgb + tex.rgb * 0.08, colorLum);
                    col += tex.rgb * blackBoost;
                    col = mix(col, col * (1.0 + uLightEmission * 1.8), uLightEmission);
                    float alpha = tex.a * vOpacity;

                    for (int i = 0; i < FX_LAYER_COUNT; i++) {
                        float mode = uFxData[i].x;
                        if (mode < 0.5) continue;
                        float p1 = uFxData[i].y;
                        float p2 = uFxData[i].z;
                        float p3 = uFxData[i].w;
                        vec3 fxColor = uFxColor[i];

                        if (mode > 0.5 && mode < 1.5) {
                            float d = length(cuv - 0.5) * 2.0;
                            float rim = smoothstep(0.4 + (1.0 - p2) * 0.3, 1.0, d) * p1;
                            col += fxColor * rim * 1.5;
                            alpha = max(alpha, rim * p1 * tex.a);
                        } else if (mode > 1.5 && mode < 2.5) {
                            float n = fxNoise(cuv * (4.0 + p2 * 20.0) + vRot);
                            float threshold = p1;
                            if (n < threshold) discard;
                            float edge = smoothstep(threshold, threshold + 0.12, n);
                            col = mix(fxColor * 2.0, col, edge);
                        } else if (mode > 2.5 && mode < 3.5) {
                            float hue = uTime * p3 * 2.0 + vRot * 6.2832 + p1 * 6.2832;
                            col = fxHueShift(col, hue);
                            col = mix(col, col * (1.0 + p2), 0.6);
                        } else if (mode > 4.5 && mode < 5.5) {
                            float p = 0.5 + 0.5 * sin(uTime * (1.0 + p3 * 8.0));
                            col *= mix(1.0, 1.0 + p1 * 1.5, p);
                            alpha *= mix(1.0, 1.0 - p2 * 0.5, 1.0 - p);
                        }
                    }

                    ncmApplyStyle(col, alpha, uStyleMode, uStyleLevels, uStyleOutline, uStyleOutlineW);
                    gl_FragColor = vec4(max(col, vec3(0.0)), clamp(alpha, 0.0, 1.0));
                }
            `,
            blending:       blendMode,
            depthWrite:     false,
            transparent:    true,
            vertexColors:   true,
        });

        this._points = new THREE.Points(this._geo, this._mat);
        this._points.frustumCulled = false;
        this._points.userData = this.userData;
        this._scene.add(this._points);
        this._syncShaderFxUniforms();

        // ── Beam/Rope renderer (SFM's "render_rope" — connects particles in
        // spawn order into a continuous stretched ribbon) — used for lasers,
        // lightning, energy trails. Built lazily, only visible when
        // `_config.rendererMode === 'beam'`. Independent geometry/material
        // from the sprite renderer above; the two are mutually exclusive.
        const beamGeo = new THREE.BufferGeometry();
        const beamMaxVerts = this._maxParticles * 2; // 2 verts per particle (ribbon strip)
        this._beamPositions = new Float32Array(beamMaxVerts * 3);
        this._beamColors    = new Float32Array(beamMaxVerts * 3);
        this._beamAlphas    = new Float32Array(beamMaxVerts);
        beamGeo.setAttribute('position', new THREE.BufferAttribute(this._beamPositions, 3));
        beamGeo.setAttribute('color',    new THREE.BufferAttribute(this._beamColors, 3));
        beamGeo.setAttribute('aOpacity', new THREE.BufferAttribute(this._beamAlphas, 1));
        beamGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(this._maxParticles * 6), 1));
        beamGeo.setDrawRange(0, 0);
        this._beamMat = new THREE.ShaderMaterial({
            uniforms: { uLightEmission: { value: 0.8 } },
            vertexShader: /* glsl */`
                attribute float aOpacity;
                varying vec3 vColor; varying float vOpacity;
                void main() {
                    vColor = color; vOpacity = aOpacity;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform float uLightEmission;
                varying vec3 vColor; varying float vOpacity;
                void main() {
                    vec3 col = vColor * (1.0 + uLightEmission * 1.6);
                    gl_FragColor = vec4(col, vOpacity);
                }
            `,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            vertexColors: true,
            side: THREE.DoubleSide,
        });
        this._beamMesh = new THREE.Mesh(beamGeo, this._beamMat);
        this._beamMesh.frustumCulled = false;
        this._beamMesh.visible = false;
        this._beamMesh.userData = this.userData;
        this._scene.add(this._beamMesh);

        // ── Oriented Quad renderer (Style "Velocity" / "World" orientation) ──
        // The default Billboard mode keeps using the THREE.Points pipeline
        // above completely untouched — GL point sprites are camera-facing
        // by hardware definition, so Billboard needs no extra geometry at
        // all and pays zero extra cost. Velocity/World need real per-
        // particle quad geometry with a computed basis, since a point
        // sprite has no orientation control whatsoever. Built once here,
        // only *populated* per frame — same allocate-once discipline as
        // the sprite/beam buffers above. Shares uTexture/uLightEmission/
        // uSizeScale/uTime/uStyle*/uFlipGrid uniform *objects* with the
        // sprite material so both pipelines always agree without any
        // manual sync code.
        {
            const oqGeo = new THREE.BufferGeometry();
            const mp = this._maxParticles;
            this._oqPositions = new Float32Array(mp * 4 * 3);
            this._oqColors    = new Float32Array(mp * 4 * 3);
            this._oqCorner    = new Float32Array(mp * 4 * 2);
            this._oqSize      = new Float32Array(mp * 4);
            this._oqOpacity   = new Float32Array(mp * 4);
            this._oqRotation  = new Float32Array(mp * 4);
            this._oqAspect    = new Float32Array(mp * 4).fill(1);
            this._oqFrame     = new Float32Array(mp * 4);
            this._oqVel       = new Float32Array(mp * 4 * 3);
            const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
            for (let i = 0; i < mp; i++) {
                for (let k = 0; k < 4; k++) {
                    this._oqCorner[(i * 4 + k) * 2]     = CORNERS[k * 2];
                    this._oqCorner[(i * 4 + k) * 2 + 1] = CORNERS[k * 2 + 1];
                }
            }
            const oqIndex = new Uint32Array(mp * 6);
            for (let i = 0; i < mp; i++) {
                const v = i * 4, o = i * 6;
                oqIndex[o] = v; oqIndex[o + 1] = v + 1; oqIndex[o + 2] = v + 2;
                oqIndex[o + 3] = v; oqIndex[o + 4] = v + 2; oqIndex[o + 5] = v + 3;
            }
            oqGeo.setAttribute('position',  new THREE.BufferAttribute(this._oqPositions, 3));
            oqGeo.setAttribute('color',     new THREE.BufferAttribute(this._oqColors, 3));
            oqGeo.setAttribute('aCorner',   new THREE.BufferAttribute(this._oqCorner, 2));
            oqGeo.setAttribute('aSize',     new THREE.BufferAttribute(this._oqSize, 1));
            oqGeo.setAttribute('aOpacity',  new THREE.BufferAttribute(this._oqOpacity, 1));
            oqGeo.setAttribute('aRotation', new THREE.BufferAttribute(this._oqRotation, 1));
            oqGeo.setAttribute('aAspect',   new THREE.BufferAttribute(this._oqAspect, 1));
            oqGeo.setAttribute('aFrame',    new THREE.BufferAttribute(this._oqFrame, 1));
            oqGeo.setAttribute('aVel',      new THREE.BufferAttribute(this._oqVel, 3));
            oqGeo.setIndex(new THREE.BufferAttribute(oqIndex, 1));
            oqGeo.setDrawRange(0, 0);

            this._oqMat = new THREE.ShaderMaterial({
                uniforms: {
                    uTexture:        this._mat.uniforms.uTexture,
                    uLightEmission:  this._mat.uniforms.uLightEmission,
                    uSizeScale:      this._mat.uniforms.uSizeScale,
                    uTime:           this._mat.uniforms.uTime,
                    uStyleMode:      this._mat.uniforms.uStyleMode,
                    uStyleLevels:    this._mat.uniforms.uStyleLevels,
                    uStyleOutline:   this._mat.uniforms.uStyleOutline,
                    uStyleOutlineW:  this._mat.uniforms.uStyleOutlineW,
                    uFlipGrid:       this._mat.uniforms.uFlipGrid,
                    uOrientMode:     { value: 1 },      // 1=velocity, 2=world
                    uViewportHeight: { value: 900 },
                },
                vertexShader: /* glsl */`
                    attribute vec2  aCorner;
                    attribute float aSize;
                    attribute float aOpacity;
                    attribute float aRotation;
                    attribute float aAspect;
                    attribute float aFrame;
                    attribute vec3  aVel;
                    uniform float uSizeScale;
                    uniform int   uOrientMode;
                    uniform float uViewportHeight;
                    varying vec3  vColor;
                    varying float vOpacity;
                    varying vec2  vUv;
                    varying float vFrame;
                    void main(){
                        vColor   = color;
                        vOpacity = aOpacity;
                        vFrame   = aFrame;

                        float s = sin(aRotation), c = cos(aRotation);
                        vec2 corner = vec2(c*aCorner.x - s*aCorner.y, s*aCorner.x + c*aCorner.y);
                        vUv = aCorner * 0.5 + 0.5;

                        vec3 right, up;
                        if (uOrientMode == 1) {
                            // Velocity: long axis follows motion, width axis
                            // is perpendicular to both motion and the view
                            // direction so it reads correctly from any angle.
                            vec3 toCam  = normalize(cameraPosition - position);
                            vec3 velDir = length(aVel) > 0.0001 ? normalize(aVel) : vec3(0.0, 1.0, 0.0);
                            right = cross(velDir, toCam);
                            if (length(right) < 0.0001) right = cross(velDir, vec3(0.0, 0.0, 1.0));
                            right = normalize(right);
                            up = velDir;
                        } else {
                            // World: fixed orientation in world space —
                            // never turns to face the camera at all.
                            right = vec3(1.0, 0.0, 0.0);
                            up    = vec3(0.0, 0.0, 1.0);
                        }

                        vec4  mvPos = modelViewMatrix * vec4(position, 1.0);
                        float dist  = max(-mvPos.z, 0.1);
                        // Same apparent-pixel-size formula as the billboard
                        // (point-sprite) pipeline, then converted back into a
                        // world-space half-width via the projection matrix's
                        // Y-scale so both renderers read as the same size.
                        float px = clamp(aSize * uSizeScale * (380.0 / dist), 1.0, 512.0);
                        float worldPerPixel = (2.0 * dist) / max(projectionMatrix[1][1] * uViewportHeight, 0.0001);
                        float halfW = px * worldPerPixel * 0.5;
                        float lenScale = (uOrientMode == 1) ? max(aAspect, 1.0) : 1.0;

                        vec3 offset = right * corner.x * halfW + up * corner.y * halfW * lenScale;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + offset, 1.0);
                    }
                `,
                fragmentShader: /* glsl */`
                    uniform sampler2D uTexture;
                    uniform float uLightEmission;
                    uniform int   uStyleMode;
                    uniform float uStyleLevels;
                    uniform vec3  uStyleOutline;
                    uniform float uStyleOutlineW;
                    uniform vec2  uFlipGrid;
                    varying vec3  vColor;
                    varying float vOpacity;
                    varying vec2  vUv;
                    varying float vFrame;

                    ${NCM_PARTICLE_STYLE_GLSL}

                    void main(){
                        vec2 uv = ncmFlipbookUV(vUv, uFlipGrid, vFrame);
                        vec4 tex = texture2D(uTexture, clamp(uv, 0.001, 0.999));
                        if (tex.a < 0.015) discard;
                        float colorLum = dot(vColor, vec3(0.299, 0.587, 0.114));
                        float blackBoost = (1.0 - smoothstep(0.0, 0.06, colorLum)) * 0.28;
                        vec3 col = mix(vColor, vColor * tex.rgb + tex.rgb * 0.08, colorLum);
                        col += tex.rgb * blackBoost;
                        col = mix(col, col * (1.0 + uLightEmission * 1.8), uLightEmission);
                        float alpha = tex.a * vOpacity;
                        ncmApplyStyle(col, alpha, uStyleMode, uStyleLevels, uStyleOutline, uStyleOutlineW);
                        gl_FragColor = vec4(max(col, vec3(0.0)), clamp(alpha, 0.0, 1.0));
                    }
                `,
                blending:    blendMode,
                depthWrite:  false,
                transparent: true,
                vertexColors: true,
                side: THREE.DoubleSide,
            });
            this._oqMesh = new THREE.Mesh(oqGeo, this._oqMat);
            this._oqMesh.frustumCulled = false;
            this._oqMesh.visible = false;
            this._oqMesh.userData = this.userData;
            this._scene.add(this._oqMesh);
        }

        // ── Aura Shell (Style "Aura: Shell" mode) ─────────────────────────
        // A companion glow mesh, independent from the particle sprites
        // entirely — a Fresnel/rim shader on a sphere wrapped around the
        // emitter's current position (so it automatically rides along with
        // attachTo()/hierarchy just like the crosshair marker does). This
        // is the "shell" aura approach; the alternative "particles" aura
        // approach reuses the existing ring/orbit/vortex stack modules
        // instead (no new geometry needed for that one). Pre-allocated and
        // simply toggled/updated — never rebuilt — matching every other
        // renderer in this class.
        {
            const shellGeo = new THREE.SphereGeometry(1, 24, 16);
            this._auraMat = new THREE.ShaderMaterial({
                uniforms: {
                    uColor:       { value: new THREE.Color(0xa78bfa) },
                    uIntensity:   { value: 1.4 },
                    uPower:       { value: 2.2 },
                    uTime:        { value: 0 },
                    uPulseSpeed:  { value: 1.2 },
                    // ── Anime/Roblox "flame shell" upgrade (Page 2 "Aura") ──
                    // Roblox/SFM stylized ki auras are almost never a perfectly
                    // smooth glow — the silhouette is broken up into a jagged,
                    // rising flame edge (hand-drawn-looking VFX sheets in SFM;
                    // scrolling noise/beam rigs in Roblox devforum tutorials).
                    // uJagged mixes the ORIGINAL smooth Fresnel glow (0, exact
                    // legacy behaviour — every existing saved aura defaults
                    // here) with a noise-cut flame silhouette (1). uNoiseScale/
                    // uFlickerSpeed control the grain and upward scroll speed
                    // of that noise so it reads as rising ki rather than static.
                    uJagged:      { value: 0.0 },
                    uNoiseScale:  { value: 2.0 },
                    uFlickerSpeed:{ value: 1.2 },
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

                    // Cheap 3D value noise (hash-based, no texture lookup) —
                    // sampled along the shell's own normal so it stays stable
                    // on the surface, scrolled over time for a rising flicker.
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
                        float fres  = pow(1.0 - clamp(dot(normalize(vViewDir), normalize(vNormalW)), 0.0, 1.0), uPower);
                        float pulse = uPulseSpeed > 0.0 ? (0.78 + 0.22 * sin(uTime * uPulseSpeed)) : 1.0;

                        // Jagged flame mask: 1.0 = old smooth disc (byte-for-byte
                        // identical output to the pre-Aura-tab shader whenever
                        // uJagged is 0), lower where noise "eats into" the rim.
                        vec3  noiseCoord = vNormalW * max(uNoiseScale, 0.001) + vec3(0.0, -uTime * uFlickerSpeed, 0.0);
                        float flame  = _noise(noiseCoord) * 0.7 + _noise(noiseCoord * 2.3 + 11.0) * 0.3;
                        float shaped = mix(1.0, flame * 1.7, clamp(uJagged, 0.0, 1.0));

                        vec3  col   = uColor * fres * uIntensity * pulse;
                        float alpha = clamp(fres * pulse * shaped, 0.0, 1.0);
                        gl_FragColor = vec4(col, alpha);
                    }
                `,
                transparent: true,
                depthWrite:  false,
                blending:    THREE.AdditiveBlending,
                side:        THREE.DoubleSide,
            });
            this._auraShell = new THREE.Mesh(shellGeo, this._auraMat);
            this._auraShell.frustumCulled = false;
            this._auraShell.visible = false;
            this._auraShell.userData = { isLab: true, isHelper: true };
            this._scene.add(this._auraShell);
        }

        // ── Emitter marker ─────────────────────────────────────────────────
        // A named Object3D added to the scene so it appears in the hierarchy.
        // TransformControls attaches to this; ParticleLab.update() syncs
        // sys.position from _marker.position every frame, so moving the
        // marker in the viewport moves the spawn point (existing particles
        // in world-space are unaffected — only new spawns move).
        this._marker = new THREE.Object3D();
        this._marker.name = this.name;
        this._marker.userData = {
            isLab:           true,
            isLabMarker:     true,
            isHelper:        false,  // must appear in hierarchy
            labSystemRef:    this,
            particleSystemId: this.id,
        };

        // Small visible crosshair so the emitter origin is visible in the viewport
        const crossGeo = new THREE.BufferGeometry();
        const s = 0.18;
        crossGeo.setAttribute('position', new THREE.Float32BufferAttribute([
            -s,0,0, s,0,0,   0,-s,0, 0,s,0,   0,0,-s, 0,0,s
        ], 3));
        const crossMat = new THREE.LineBasicMaterial({
            color: 0xa78bfa,
            transparent: true,
            opacity: 0.8,
            depthTest: false,
        });
        const crossLines = new THREE.LineSegments(crossGeo, crossMat);
        crossLines.userData.isHelper = true;  // excluded from hierarchy
        crossLines.renderOrder = 999;
        this._marker.add(crossLines);
        this._scene.add(this._marker);

        // Sub-emitters support
        this._subEmitters = [];

        // ── SFM-style module stack ─────────────────────────────────────────
        this.stack = { emitters: 'emit_continuous', initializers: [], operators: [], forces: [], renderers: 'render_sprite' };
        this._moduleValues = {}; // moduleId → last-applied field values, for re-populating UI sliders
        this._syncStackFromConfig(); // reflect whatever initial config was passed in

        if (cfg.shaderFx) this.setShaderFX(cfg.shaderFx);

        // Push the fully-merged initial config through the same setConfig()
        // path used for live edits, so Style/Orientation/Aura/Flipbook (and
        // everything else config-driven) are correct immediately — matters
        // most right after fromJSON()/restoreSystems(), i.e. project load
        // and undo/redo, so restored particles look right on the very
        // first frame instead of only after the next manual tweak.
        this.setConfig(this._config);
    }

    // ── SFM-style module stack ──────────────────────────────────────────
    // The stack is the source of truth for "what's been added" — the UI
    // reads it to render the Stack panel. Adding/removing a module writes
    // its governing field(s) into `this._config` via setConfig(), which the
    // existing physics loop already reads every frame — no separate code
    // path needed for simulation, this is purely an additive UI layer.
    addModule(category, moduleId, values = {}) {
        const mod = _findModule(category, moduleId);
        if (!mod) return false;
        const list = category === 'emitters' ? null
                   : category === 'renderers' ? null
                   : this.stack[category];

        if (mod.group) {
            // Single-select group (shape / emitMode / renderMode): remove
            // any other module from the same group first.
            if (category === 'emitters')       this.stack.emitters  = moduleId;
            else if (category === 'renderers') this.stack.renderers = moduleId;
            else {
                const groupSiblings = MODULE_LIBRARY[category].filter(m => m.group === mod.group).map(m => m.id);
                this.stack[category] = this.stack[category].filter(id => !groupSiblings.includes(id));
                this.stack[category].push(moduleId);
            }
        } else if (list && !list.includes(moduleId)) {
            list.push(moduleId);
        }

        mod.apply(this._config, values);
        this.setConfig(this._config); // ★ fix: was setConfig({}), which checked the empty
                                       // parameter's .texture/.blending/.lightEmission (always
                                       // undefined) instead of the just-applied values on
                                       // this._config — so the renderer's material/shader
                                       // uniforms never actually updated, even though the
                                       // data itself was set correctly.
        this._moduleValues[moduleId] = { ...values };
        return true;
    }

    removeModule(category, moduleId) {
        const mod = _findModule(category, moduleId);
        if (!mod) return false;
        if (category === 'emitters' || category === 'renderers') return false; // can't remove the only slot, just switch it
        const idx = this.stack[category].indexOf(moduleId);
        if (idx >= 0) this.stack[category].splice(idx, 1);
        mod.reset(this._config);
        delete this._moduleValues[moduleId];
        this.setConfig(this._config); // ★ same fix as addModule() above
        return true;
    }

    hasModule(category, moduleId) {
        if (category === 'emitters')  return this.stack.emitters === moduleId;
        if (category === 'renderers') return this.stack.renderers === moduleId;
        return this.stack[category]?.includes(moduleId) ?? false;
    }

    getStack() { return this.stack; }

    /** Live count of currently-alive particles — used by the "Visualizar
     *  Partícula" fullscreen counter (spec #11), updated every frame from
     *  the same array update()/​_update_buffers() already maintain. */
    getParticleCount() { return this._particles.length; }

    /** Current UI-facing values for a module's fields, read live from _config */
    getModuleValues(category, moduleId) {
        const mod = _findModule(category, moduleId);
        if (!mod) return {};
        const out = {};
        mod.fields.forEach(f => {
            if (f.key === '_shapeTag') return;
            // Fields that write into compound config (lifetime0/1 etc.) need
            // a light reverse-mapping; most fields are 1:1 with _config.
            if (f.key === 'lifetime0') out[f.key] = this._config.lifetime?.[0] ?? f.default;
            else if (f.key === 'lifetime1') out[f.key] = this._config.lifetime?.[1] ?? f.default;
            else if (f.key === 'speed0') out[f.key] = this._config.speed?.[0] ?? f.default;
            else if (f.key === 'speed1') out[f.key] = this._config.speed?.[1] ?? f.default;
            else if (f.key === 'size0') out[f.key] = this._config.size?.[0] ?? f.default;
            else if (f.key === 'size1') out[f.key] = this._config.size?.[1] ?? f.default;
            else if (f.key === 'rotSpeed0') out[f.key] = this._config.rotSpeed?.[0] ?? f.default;
            else if (f.key === 'rotSpeed1') out[f.key] = this._config.rotSpeed?.[1] ?? f.default;
            else if (f.key === 'targetOffsetY') out[f.key] = this._config.targetOffset?.y ?? f.default;
            else if (f.key === 'colorStart') out[f.key] = this._config.colorOverLife?.[0]?.[1] ?? f.default;
            else if (f.key === 'colorMid')   out[f.key] = this._config.colorOverLife?.[1]?.[1] ?? f.default;
            else if (f.key === 'colorEnd')   out[f.key] = this._config.colorOverLife?.[this._config.colorOverLife.length-1]?.[1] ?? f.default;
            else if (f.key === 'texture')    out[f.key] = this._config.texture ?? f.default;
            else if (f.key === 'textureCustom') out[f.key] = this._config.textureCustom ?? f.default;
            else if (f.key === 'textureCustomName') out[f.key] = this._config.textureCustomName ?? f.default;
            else out[f.key] = this._config[f.key] ?? f.default;
        });
        return out;
    }

    /** Rebuild stack from the current flat _config — used after loading a
     *  preset or a .nex file, so the Stack UI reflects what's really set. */
    _syncStackFromConfig() {
        this.stack = _inferStackFromConfig(this._config);
    }

    // ── Config ───────────────────────────────────────────────────
    setConfig(cfg) {
        Object.assign(this._config, cfg);
        if (cfg.name !== undefined) {
            this.name = cfg.name;
            if (this._marker) this._marker.name = cfg.name;
        }
        if (cfg.texture !== undefined || cfg.textureCustom !== undefined) {
            const texSource = this._config.texture === 'custom' && this._config.textureCustom
                ? this._config.textureCustom
                : this._config.texture;
            this._mat.uniforms.uTexture.value = _getTexture(texSource);
        }
        if (cfg.blending !== undefined) {
            this._mat.blending = cfg.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
            this._mat.needsUpdate = true;
        }
        if (cfg.lightEmission !== undefined && this._mat.uniforms.uLightEmission) {
            this._mat.uniforms.uLightEmission.value = cfg.lightEmission;
            if (this._beamMat?.uniforms.uLightEmission) this._beamMat.uniforms.uLightEmission.value = cfg.lightEmission;
        }

        // ── Style (Page 2 "Style" tab) ─────────────────────────────────
        // Modes: 0 normal, 1 toon, 2 anime, 3 additive, 4 soft, 5 unlit.
        // 'additive'/'unlit' also adjust blending/emission the same way
        // the existing `blending`/`lightEmission` fields already do, so
        // Style stays a convenience layer on top of those, not a parallel
        // system — switching Style back to 'normal' never gets "stuck"
        // because it simply stops overriding blending/emission each time.
        if (cfg.styleMode !== undefined) {
            const STYLE_IDS = { normal: 0, toon: 1, anime: 2, additive: 3, soft: 4, unlit: 5 };
            const mode = STYLE_IDS[cfg.styleMode] ?? 0;
            if (this._mat.uniforms.uStyleMode) this._mat.uniforms.uStyleMode.value = mode;
            const styleBlend = cfg.styleMode === 'additive' ? THREE.AdditiveBlending
                              : THREE.NormalBlending;
            if (cfg.styleMode === 'additive' || cfg.blending === undefined) {
                // Only Style:'additive' forces the blend mode; every other
                // Style respects whichever `blending` field the Renderer
                // module already set (so Style never fights that control).
                if (cfg.styleMode === 'additive') { this._mat.blending = styleBlend; this._mat.needsUpdate = true; }
            }
            if (this._mat.uniforms.uLightEmission) {
                if (cfg.styleMode === 'unlit') this._mat.uniforms.uLightEmission.value = 0;
                else if (cfg.lightEmission === undefined) this._mat.uniforms.uLightEmission.value = this._config.lightEmission ?? 0.8;
            }
        }
        if (cfg.styleLevels !== undefined && this._mat.uniforms.uStyleLevels) {
            this._mat.uniforms.uStyleLevels.value = Math.max(2, Math.round(cfg.styleLevels));
        }
        if (cfg.styleOutlineColor !== undefined && this._mat.uniforms.uStyleOutline) {
            this._mat.uniforms.uStyleOutline.value.set(cfg.styleOutlineColor);
        }
        if (cfg.styleOutlineWidth !== undefined && this._mat.uniforms.uStyleOutlineW) {
            this._mat.uniforms.uStyleOutlineW.value = Math.max(0.02, Math.min(0.5, cfg.styleOutlineWidth / 100));
        }
        // ── Flipbook grid (Page 2 "Appearance") ────────────────────────
        if ((cfg.flipbookCols !== undefined || cfg.flipbookRows !== undefined) && this._mat.uniforms.uFlipGrid) {
            this._mat.uniforms.uFlipGrid.value.set(
                Math.max(1, Math.round(this._config.flipbookCols ?? 1)),
                Math.max(1, Math.round(this._config.flipbookRows ?? 1)),
            );
        }
        // ── Aura (Page 2 "Aura" — Shell/Combo approach reacts immediately
        //    even while paused; the Particles-only approach just reuses the
        //    normal module stack and needs no special handling here) ─────
        if (cfg.auraMode !== undefined || cfg.auraShellColor !== undefined || cfg.auraShellIntensity !== undefined
            || cfg.auraShellRadius !== undefined || cfg.auraShellHeight !== undefined
            || cfg.auraShellSharpness !== undefined || cfg.auraShellPulseSpeed !== undefined
            || cfg.auraShellJagged !== undefined || cfg.auraShellNoiseScale !== undefined
            || cfg.auraShellFlickerSpeed !== undefined) {
            this._update_aura_shell();
        }

        const hasShaderStack = Object.prototype.hasOwnProperty.call(cfg, 'shaderFxStack');
        const hasShaderFx = Object.prototype.hasOwnProperty.call(cfg, 'shaderFx');
        if (hasShaderStack || hasShaderFx) {
            if (hasShaderStack) {
                this._config.shaderFxStack = _normalizeShaderFxStackInput(cfg.shaderFxStack);
            } else if (hasShaderFx) {
                this._config.shaderFxStack = _normalizeShaderFxStackInput(
                    cfg.shaderFx && cfg.shaderFx.mode
                        ? { [cfg.shaderFx.mode]: cfg.shaderFx }
                        : cfg.shaderFx
                );
            }
            delete this._config.shaderFx;
            this._syncShaderFxUniforms();
        }
        // elongation is applied per-particle in update() via aAspect
    }

    // ── Shader FX (Particle Labs "Shader" tab) ────────────────────────────
    // Multiple independent procedural overlays can be enabled together.
    // Each mode keeps its own parameters and can be toggled on/off without
    // replacing the others.
    // Makes this system's emitter position follow a scene object every
    // frame (see the sync at the top of update() below), instead of staying
    // fixed at its own marker position. Forces like orbit/attract that read
    // this.position keep working exactly as before, just around a moving
    // point. Not yet restored automatically on project reload (best-effort
    // uuid is kept in config for future use, but re-resolving it against the
    // reloaded scene graph isn't wired up).
    attachTo(object3D) {
        if (!object3D?.isObject3D) {
            this.detach();
            return;
        }
        if (this._parentSystem) this.clearParentSystem(true);

        const worldPos = new THREE.Vector3();
        this.getWorldPosition(worldPos);

        this._attachedTo = object3D;
        this._config.attachedToUuid = object3D.uuid;
        this._config.attachedToName = object3D.name || (object3D.userData?.isBoneMarker && 'Osso') || 'Objeto';

        this._setMarkerParent(object3D, null, true);
        if (object3D.worldToLocal) {
            const local = worldPos.clone();
            object3D.worldToLocal(local);
            this._marker.position.copy(local);
        }
        this.getWorldPosition(this.position);
    }
    detach() {
        if (!this._attachedTo && !this._marker?.parent) {
            this._config.attachedToUuid = null;
            this._config.attachedToName = null;
            return;
        }

        const worldPos = new THREE.Vector3();
        this.getWorldPosition(worldPos);

        this._attachedTo = null;
        this._config.attachedToUuid = null;
        this._config.attachedToName = null;

        this._setMarkerParent(null, null, true);
        this._marker.position.copy(worldPos);
        this.getWorldPosition(this.position);
    }
    getAttachedObject() { return this._attachedTo || null; }

    getWorldPosition(target = new THREE.Vector3()) {
        if (!this._marker) return target.set(this.position.x, this.position.y, this.position.z);
        return this._marker.getWorldPosition(target);
    }

    _setMarkerParent(parentObject3D = null, localPosition = null, preserveWorld = true) {
        if (!this._marker) return;
        const worldPos = new THREE.Vector3();
        if (preserveWorld) this._marker.getWorldPosition(worldPos);

        if (this._marker.parent) this._marker.parent.remove(this._marker);

        const targetParent = parentObject3D || this._scene;
        targetParent.add(this._marker);

        if (localPosition) {
            this._marker.position.copy(localPosition);
        } else if (preserveWorld) {
            const local = worldPos.clone();
            if (targetParent !== this._scene && targetParent?.worldToLocal) {
                targetParent.worldToLocal(local);
            }
            this._marker.position.copy(local);
        } else {
            this._marker.position.set(0, 0, 0);
        }
    }

    setParentSystem(parentSystem = null, localPosition = null, preserveWorld = true) {
        if (this._parentSystem === parentSystem && parentSystem && preserveWorld && !localPosition) {
            if (parentSystem._childSystems) parentSystem._childSystems.add(this);
            return;
        }

        if (this._parentSystem && this._parentSystem._childSystems) {
            this._parentSystem._childSystems.delete(this);
        }

        this._parentSystem = parentSystem || null;
        this.parentId = parentSystem?.id ?? null;

        if (this._attachedTo) {
            // Hierarchy and Attach are mutually exclusive for a single system.
            this.detach();
        }

        const nextLocal = localPosition
            ? new THREE.Vector3(localPosition.x, localPosition.y, localPosition.z)
            : null;

        if (this._marker) {
            this._setMarkerParent(parentSystem?._marker || null, nextLocal, preserveWorld);
            this.getWorldPosition(this.position);
            if (this.parentId) {
                this.localPosition = this._marker.position.clone();
            } else {
                this.localPosition = null;
            }
        } else {
            this.localPosition = nextLocal;
        }

        this._config.parentId = this.parentId;
        this._config.localPosition = this.localPosition
            ? { x: this.localPosition.x, y: this.localPosition.y, z: this.localPosition.z }
            : null;

        if (parentSystem && parentSystem._childSystems) parentSystem._childSystems.add(this);
    }

    clearParentSystem(preserveWorld = true) {
        this.setParentSystem(null, null, preserveWorld);
    }

    getParentSystem() { return this._parentSystem || null; }
    getChildrenSystems() { return Array.from(this._childSystems || []); }

    _syncShaderFxUniforms() {
        const uniforms = this._mat?.uniforms;
        if (!uniforms?.uFxData?.value || !uniforms?.uFxColor?.value) return;

        const stack = this._config.shaderFxStack || {};
        SHADER_FX_ORDER.forEach((mode, idx) => {
            const layer = stack[mode];
            const data = uniforms.uFxData.value[idx];
            const color = uniforms.uFxColor.value[idx];
            if (layer?.enabled && data) {
                data.set(SHADER_FX_MODES[mode] ?? 0, layer.p1 ?? 0.5, layer.p2 ?? 0.5, layer.p3 ?? 0.5);
                if (color?.set) color.set(layer.color ?? '#ffffff');
            } else if (data) {
                data.set(0, 0.5, 0.5, 0.5);
                if (color?.set) color.set('#ffffff');
            }
        });
    }

    getShaderFXStack() {
        return SHADER_FX_ORDER
            .map(mode => {
                const layer = this._config.shaderFxStack?.[mode];
                return layer ? { ...layer } : null;
            })
            .filter(Boolean);
    }

    getShaderFX(mode = null) {
        if (mode) {
            const layer = this._config.shaderFxStack?.[mode];
            return layer
                ? { ...layer }
                : { mode, p1: 0.5, p2: 0.5, p3: 0.5, color: '#ffffff', enabled: false };
        }
        const first = this.getShaderFXStack().find(layer => layer.enabled);
        return first || { mode: 'none', p1: 0.5, p2: 0.5, p3: 0.5, color: '#ffffff', enabled: false };
    }

    setShaderFX(mode, values = {}) {
        if (mode && typeof mode === 'object') {
            const fx = mode;
            if (fx.mode) return this.setShaderFX(fx.mode, fx);
            return;
        }
        if (!mode || mode === 'none' || !SHADER_FX_LIBRARY[mode]) return;
        const stack = { ...(this._config.shaderFxStack || {}) };
        const next = _normalizeShaderFxEntry(mode, { ...(stack[mode] || {}), ...values, enabled: true });
        if (!next) return;
        stack[mode] = next;
        this.setConfig({ shaderFxStack: stack });
    }

    toggleShaderFX(mode, enabled = true) {
        if (!mode || mode === 'none' || !SHADER_FX_LIBRARY[mode]) return;
        const stack = { ...(this._config.shaderFxStack || {}) };
        const current = stack[mode] || _normalizeShaderFxEntry(mode, {});
        stack[mode] = { ...current, enabled: !!enabled };
        this.setConfig({ shaderFxStack: stack });
    }

    // ── Render scale (compensates DPR/resolution during image capture) ───
    setRenderScale(scale) {
        if (this._mat.uniforms.uSizeScale) {
            this._mat.uniforms.uSizeScale.value = Math.max(scale, 0.01);
        }
    }

    // ── Controls ─────────────────────────────────────────────────
    play()  { this._playing = true;  this._paused = false; }
    pause() { this._paused  = true; }
    stop()  { this._playing = false; this._particles.forEach(p => p.reset()); this._emitAccum = 0; this._update_buffers(); }
    reset() { this.stop(); this._time = 0; }

    // ── Spawn single particle ─────────────────────────────────────
    _spawn(originOverride = null) {
        if (this._pool.length === 0) return;
        const p  = this._pool.pop();
        const c  = this._config;

        p.alive   = true;
        p.maxLife = _rnd(c.lifetime[0], c.lifetime[1]);
        p.life    = p.maxLife;

        // Emit shape
        const sp     = this._emitPoint();
        const origin = originOverride || this.position;
        p.pos.copy(origin).add(sp);

        // Velocity
        const speed = _rnd(c.speed[0], c.speed[1]);
        // Shape Direction (Page 2 "Shape"): when set, the initial velocity
        // direction comes from the emission-shape offset itself (outward
        // from / inward toward the emitter) instead of the cone spread
        // below — e.g. a sphere shape becomes a true "explosion" (outward)
        // or "implosion" (inward). 'default' / unset preserves the exact
        // pre-existing spreadAngle/direction behaviour.
        const shapeDir = c.shapeDirection;
        if (shapeDir && shapeDir !== 'default' && sp.lengthSq() > 1e-6) {
            const base = sp.clone().normalize();
            if (shapeDir === 'inward') base.multiplyScalar(-1);
            else if (shapeDir === 'random' && Math.random() < 0.5) base.multiplyScalar(-1);
            p.vel.copy(base).multiplyScalar(speed);
        } else if (c.direction) {
            p.vel.copy(c.direction).multiplyScalar(speed).add(
                new THREE.Vector3(_rnd(-0.3,0.3),_rnd(-0.3,0.3),_rnd(-0.3,0.3))
            );
        } else {
            // spreadAngle: 0=laser beam, 180=all directions
            const spread = ((c.spreadAngle ?? 180) * Math.PI) / 180;
            if (spread >= Math.PI) {
                p.vel.set(_rnd(-1,1),_rnd(-1,1),_rnd(-1,1)).normalize().multiplyScalar(speed);
            } else {
                // Emit in cone around +Y axis then apply spread
                const theta = _rnd(0, spread * 0.5);
                const phi   = _rnd(0, Math.PI * 2);
                p.vel.set(
                    Math.sin(theta) * Math.cos(phi),
                    Math.cos(theta),
                    Math.sin(theta) * Math.sin(phi)
                ).normalize().multiplyScalar(speed);
            }
        }

        // Velocity Inheritance (Page 2 "Motion"): a moving/attached emitter
        // passes a fraction of its own current velocity on to every new
        // particle — 0% (default) is byte-for-byte the old behaviour.
        const inherit = c.velocityInheritance ?? 0;
        if (inherit > 0 && this._emitterVelocity) {
            p.vel.addScaledVector(this._emitterVelocity, inherit);
        }

        p.rotation = _rnd(0, Math.PI*2);
        p.rotSpeed = c.rotation ? _rnd(c.rotSpeed?.[0]??-90, c.rotSpeed?.[1]??90) * Math.PI/180 : 0;

        // Orbit
        if (c.orbitSpeed) {
            p.orbitAngle  = _rnd(0, Math.PI*2);
            p.orbitRadius = _rnd(c.emitRadius * 0.8, c.emitRadius);
        }

        // Shape sculpt — per-particle random offsets
        p.flickerPhase  = Math.random() * Math.PI * 2;
        p.pulsePhase    = Math.random() * Math.PI * 2;
        p.wavePhase     = Math.random() * Math.PI * 2;
        p.colorHueOff   = _rnd(-0.5, 0.5) * (c.colorVariance ?? 0);
        p.brightnessOff = _rnd(0, 1)      * (c.brightnessVariance ?? 0);
        p.aspect        = c.elongation ?? 1;
        p.initialPos.copy(p.pos);

        // birthBurst: extra velocity kick at spawn
        if (c.birthBurst > 0) {
            const dir = p.vel.length() > 0
                ? p.vel.clone().normalize()
                : new THREE.Vector3(_rnd(-1,1),_rnd(-1,1),_rnd(-1,1)).normalize();
            p.vel.addScaledVector(dir, c.birthBurst);
        }
        // scatterBirth: extra random displacement at spawn
        if (c.scatterBirth > 0) {
            p.pos.x += _rnd(-c.scatterBirth, c.scatterBirth);
            p.pos.y += _rnd(-c.scatterBirth, c.scatterBirth);
            p.pos.z += _rnd(-c.scatterBirth, c.scatterBirth);
        }

        // Color (will be evaluated each frame via colorOverLife)
        p.color.setHex(c.color?.from ?? 0xffffff);
        p.baseColor.copy(p.color);

        p._eventFired = false;
        // Gatilho de Evento (Operators): "Nascimento" fires the instant the
        // particle is born, before it's pushed into the live list.
        if (c.eventTriggerEnabled && c.eventTriggerMode === 'birth') {
            this._fireEventTrigger('birth', p);
        }

        this._particles.push(p);
    }

    // ── Gatilho de Evento (Operators) — dispatches a window CustomEvent so
    // external code (audio cues, chained VFX, timeline scripts, etc.) can
    // react to a particle's lifecycle without reaching into engine internals.
    // `mode` is 'birth' | 'age' | 'death'; detail.position is a plain
    // {x,y,z} snapshot (not a live THREE.Vector3 reference).
    _fireEventTrigger(mode, p) {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
        window.dispatchEvent(new CustomEvent('ncm-particle-event', {
            detail: {
                system: this.name,
                mode,
                position: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
                time: this._time,
            },
        }));
    }

    // ── Emit shape helpers ────────────────────────────────────────
    _emitPoint() {
        const c   = this._config;
        const r   = c.emitRadius || 0.5;
        const v   = new THREE.Vector3();
        // Partial-arc (Page 2 "Shape"): restricts angle-based shapes to a
        // wedge instead of the full circle. 360° (default) = old behaviour.
        const arcRad = ((c.shapeArc ?? 360) * Math.PI) / 180;
        switch (c.emitShape) {
            case 'sphere':
                v.set(_rnd(-1,1),_rnd(-1,1),_rnd(-1,1)).normalize().multiplyScalar(_rnd(0,r));
                break;
            case 'surface':
                v.set(_rnd(-1,1),_rnd(-1,1),_rnd(-1,1)).normalize().multiplyScalar(r);
                break;
            case 'cone': {
                const ang = _rnd(0, arcRad);
                const rad = _rnd(0, r);
                const h   = _rnd(0, r*2);
                v.set(Math.cos(ang)*rad, h, Math.sin(ang)*rad);
                break;
            }
            case 'disc': {
                const ang = _rnd(0, arcRad);
                const rad = _rnd(0, r);
                v.set(Math.cos(ang)*rad, 0, Math.sin(ang)*rad);
                break;
            }
            case 'ring': {
                const ang = _rnd(0, arcRad);
                v.set(Math.cos(ang)*r, 0, Math.sin(ang)*r);
                break;
            }
            case 'plane':
                v.set(_rnd(-r,r), 0, _rnd(-r,r));
                break;
            case 'box':
                // Roblox-style Box shape — a solid cuboid volume; emitRadius
                // is reused as the half-extent on every axis (kept a single
                // slider so it drops in next to the other shapes with no
                // extra fields to wire through save/load).
                v.set(_rnd(-r,r), _rnd(-r,r), _rnd(-r,r));
                break;
            case 'cylinder': {
                const ang = _rnd(0, arcRad);
                const rad = _rnd(0, r);
                v.set(Math.cos(ang)*rad, _rnd(-r,r), Math.sin(ang)*rad);
                break;
            }
            case 'line': {
                // Laser/beam: spawn uniformly between origin and targetOffset
                // (a point relative to this.position). Small jitter keeps it
                // from looking like a perfectly straight row of identical dots.
                const target = c.targetOffset ?? { x: 0, y: 3, z: 0 };
                const t = Math.random();
                v.set(target.x * t, target.y * t, target.z * t);
                const jitter = c.lineJitter ?? 0.02;
                if (jitter > 0) {
                    v.x += _rnd(-jitter, jitter);
                    v.y += _rnd(-jitter, jitter);
                    v.z += _rnd(-jitter, jitter);
                }
                break;
            }
            case 'point':
            default:
                break;
        }
        return v;
    }

    // ── Main update ───────────────────────────────────────────────
    update(dt) {
        if (this._attachedTo && !this._attachedTo.parent) {
            // target was removed from the scene — stop tracking it rather
            // than reading a stale/disconnected transform
            this.detach();
        }
        if (this._marker) this._marker.getWorldPosition(this.position);

        // Emitter's own velocity, tracked every frame regardless of play
        // state — used by Velocity Inheritance so a moving/attached
        // emitter can pass motion on to freshly spawned particles.
        if (!this._prevEmitterPos) this._prevEmitterPos = this.position.clone();
        if (!this._emitterVelocity) this._emitterVelocity = new THREE.Vector3();
        if (dt > 0) {
            this._emitterVelocity.copy(this.position).sub(this._prevEmitterPos).divideScalar(dt);
        }
        this._prevEmitterPos.copy(this.position);

        if (!this._playing || this._paused) return;
        this._time += dt;
        const c = this._config;
        const T = this._time;
        if (this._mat.uniforms.uTime) this._mat.uniforms.uTime.value = T;

        // Emit Delay / Duration (Page 2 "Emitter"): an optional time window
        // for continuous emission. Both default to 0 = no delay, no cutoff,
        // i.e. byte-for-byte the previous always-on behaviour.
        const emitDelay    = c.emitDelay    ?? 0;
        const emitDuration = c.emitDuration ?? 0;
        const withinEmitWindow = this._time >= emitDelay &&
            (emitDuration <= 0 || this._time <= emitDelay + emitDuration);

        if (!c.burst && withinEmitWindow) {
            this._emitAccum += (c.rate || 10) * dt;
            while (this._emitAccum >= 1 && this._particles.length < this._maxParticles) {
                this._emitAccum -= 1;
                this._spawn();
            }
        }

        const drag        = c.drag              ?? 0.96;
        const gravity     = c.gravity           ?? 0;
        const wander      = c.wanderStrength    ?? 0;
        const orbit       = c.orbitSpeed        ?? 0;
        const flickerAmt  = c.flickerAmt        ?? 0;
        const flickerFreq = c.flickerFreq       ?? 8;
        const pulseAmt    = c.pulseAmt          ?? 0;
        const pulseFreq   = c.pulseFreq         ?? 4;
        const spiralStr   = c.spiralStrength    ?? 0;
        const forcePull   = c.forcePull         ?? 0;
        const waveAmt     = c.waveAmt           ?? 0;
        const waveFreq    = c.waveFreq          ?? 2;
        const elongation  = c.elongation        ?? 1;
        const velStretch  = c.velStretch        ?? 0;
        const colorVar    = c.colorVariance     ?? 0;
        const brightVar   = c.brightnessVariance?? 0;
        const noiseScale  = c.noiseScale        ?? 0;
        const bounceY     = c.bounceY           ?? 0;
        const sizeJitter  = c.sizeJitter        ?? 0;
        const spinTorque  = c.spinTorque        ?? 0;
        // ── 10 new shape params ───────────────────────────────────────
        const windX         = c.windX           ?? 0;   // constant lateral force X
        const windZ         = c.windZ           ?? 0;   // constant lateral force Z
        const gravityX      = c.gravityX        ?? 0;   // horizontal gravity (sideways)
        const radialForce   = c.radialForce     ?? 0;   // +expand / -collapse from spawn
        const heatShimmer   = c.heatShimmer     ?? 0;   // per-frame pos jitter (fire shimmer)
        const maxSpeed      = c.maxSpeed        ?? 0;   // velocity cap (0 = off)
        const sparkIntensity= c.sparkIntensity  ?? 0;   // random vel kick each frame
        const damping       = c.damping         ?? 0;   // velocity^2 drag (heavier slowdown)
        const colorTemp     = c.colorTemp       ?? 0;   // -1=cool blue, +1=warm orange tint
        const opacityErosion= c.opacityErosion  ?? 0;   // opacity *= 1 - speed * factor
        // ── 10 more new shape params ─────────────────────────────────
        const curlStrength  = c.curlStrength    ?? 0;   // curl noise rotation
        const curlFreq      = c.curlFreq        ?? 1;   // frequency of curl noise
        const vortexHeight  = c.vortexHeight    ?? 0;   // vertical spiral component
        const taperByAge    = c.taperByAge      ?? 0;   // size *= (1 - t * taper)
        const scaleByDist   = c.scaleByDist     ?? 0;   // size *= 1 + dist * factor
        const wallBounce    = c.wallBounce      ?? 0;   // elasticity on wall bounce
        const wallSize      = c.wallSize        ?? 3;   // bounding box half-size
        const birthBurst    = c.birthBurst      ?? 0;   // extra speed on spawn
        const fadeInTime    = c.fadeInTime      ?? 0;   // seconds to fade in from 0
        const scatterBirth  = c.scatterBirth    ?? 0;   // extra spawn scatter radius

        const dead = [];
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const p = this._particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                // Emit on Death (Page 2 "Emitter"): spawns particles from
                // every child system (Hierarchy tab) at the death position —
                // e.g. a rocket's trail system dies into its explosion child.
                if (c.emitOnDeathCount > 0 && this._childSystems && this._childSystems.size) {
                    this._childSystems.forEach(child => {
                        for (let k = 0; k < c.emitOnDeathCount; k++) child._spawn(p.pos);
                    });
                }
                // Gatilho de Evento (Operators): "Morte" fires right before
                // the particle is returned to the pool.
                if (c.eventTriggerEnabled && c.eventTriggerMode === 'death') {
                    this._fireEventTrigger('death', p);
                }
                p.reset();
                this._pool.push(p);
                dead.push(i);
                continue;
            }

            const t = 1 - p.life / p.maxLife;

            // Gatilho de Evento (Operators): "% da Vida" fires once, the
            // first frame the particle's normalized age crosses the
            // configured threshold (p._eventFired guards against repeats).
            if (c.eventTriggerEnabled && c.eventTriggerMode === 'age' && !p._eventFired &&
                t >= (c.eventTriggerAge ?? 0.5)) {
                p._eventFired = true;
                this._fireEventTrigger('age', p);
            }

            if (orbit > 0) {
                p.orbitAngle += orbit * dt;
                p.pos.x = this.position.x + Math.cos(p.orbitAngle) * p.orbitRadius;
                p.pos.z = this.position.z + Math.sin(p.orbitAngle) * p.orbitRadius;
                p.pos.y += p.vel.y * dt;
            } else {
                if (wander > 0) {
                    p.vel.x += _rnd(-wander, wander);
                    p.vel.y += _rnd(-wander, wander);
                    p.vel.z += _rnd(-wander, wander);
                }
                if (noiseScale > 0) {
                    const ns = noiseScale * 0.4;
                    p.vel.x += Math.sin(T * 3.1 + p.flickerPhase) * ns;
                    p.vel.y += Math.cos(T * 2.7 + p.pulsePhase)   * ns * 0.5;
                    p.vel.z += Math.sin(T * 2.3 + p.wavePhase)    * ns;
                }
                if (spiralStr !== 0) {
                    const dx = p.pos.x - this.position.x;
                    const dz = p.pos.z - this.position.z;
                    p.vel.x += -dz * spiralStr * dt;
                    p.vel.z +=  dx * spiralStr * dt;
                }
                if (forcePull !== 0) {
                    p.vel.x += (this.position.x - p.pos.x) * forcePull * dt;
                    p.vel.y += (this.position.y - p.pos.y) * forcePull * dt;
                    p.vel.z += (this.position.z - p.pos.z) * forcePull * dt;
                }
                if (waveAmt > 0) {
                    p.wavePhase += waveFreq * dt;
                    p.pos.x += Math.sin(p.wavePhase) * waveAmt * dt;
                }
                p.vel.multiplyScalar(drag);
                p.vel.y -= gravity * dt;
                // New forces
                if (windX    !== 0) p.vel.x += windX  * dt;
                if (windZ    !== 0) p.vel.z += windZ  * dt;
                if (gravityX !== 0) p.vel.x -= gravityX * dt;
                if (radialForce !== 0) {
                    const rx = p.pos.x - p.initialPos.x;
                    const ry = p.pos.y - p.initialPos.y;
                    const rz = p.pos.z - p.initialPos.z;
                    const rd = Math.sqrt(rx*rx+ry*ry+rz*rz) || 0.001;
                    p.vel.x += (rx/rd) * radialForce * dt;
                    p.vel.y += (ry/rd) * radialForce * dt;
                    p.vel.z += (rz/rd) * radialForce * dt;
                }
                if (sparkIntensity > 0 && Math.random() < sparkIntensity * dt * 10) {
                    p.vel.x += _rnd(-sparkIntensity, sparkIntensity);
                    p.vel.y += _rnd(-sparkIntensity, sparkIntensity);
                    p.vel.z += _rnd(-sparkIntensity, sparkIntensity);
                }
                if (damping > 0) {
                    const spd2 = p.vel.lengthSq();
                    if (spd2 > 0) p.vel.multiplyScalar(1 / (1 + spd2 * damping * dt));
                }
                if (maxSpeed > 0) {
                    const spd = p.vel.length();
                    if (spd > maxSpeed) p.vel.multiplyScalar(maxSpeed / spd);
                }
                if (heatShimmer > 0) {
                    p.pos.x += _rnd(-heatShimmer, heatShimmer) * dt;
                    p.pos.z += _rnd(-heatShimmer, heatShimmer) * dt;
                }
                p.pos.addScaledVector(p.vel, dt);
                if (bounceY > 0 && p.pos.y < 0 && p.vel.y < 0) {
                    p.pos.y = 0;
                    p.vel.y = -p.vel.y * bounceY;
                }
                // Wall bounce (cube boundary)
                if (wallBounce > 0 && wallSize > 0) {
                    const ox = this.position.x, oy = this.position.y, oz = this.position.z;
                    if (p.pos.x >  ox + wallSize) { p.pos.x =  ox + wallSize; p.vel.x = -Math.abs(p.vel.x) * wallBounce; }
                    if (p.pos.x <  ox - wallSize) { p.pos.x =  ox - wallSize; p.vel.x =  Math.abs(p.vel.x) * wallBounce; }
                    if (p.pos.y >  oy + wallSize) { p.pos.y =  oy + wallSize; p.vel.y = -Math.abs(p.vel.y) * wallBounce; }
                    if (p.pos.y <  oy - wallSize) { p.pos.y =  oy - wallSize; p.vel.y =  Math.abs(p.vel.y) * wallBounce; }
                    if (p.pos.z >  oz + wallSize) { p.pos.z =  oz + wallSize; p.vel.z = -Math.abs(p.vel.z) * wallBounce; }
                    if (p.pos.z <  oz - wallSize) { p.pos.z =  oz - wallSize; p.vel.z =  Math.abs(p.vel.z) * wallBounce; }
                }
                // Curl noise (rotation field around Y axis)
                if (curlStrength !== 0) {
                    const cx = p.pos.x - this.position.x;
                    const cz = p.pos.z - this.position.z;
                    const ang = Math.atan2(cz, cx) + T * curlFreq;
                    p.vel.x += Math.cos(ang + Math.PI * 0.5) * curlStrength * dt;
                    p.vel.z += Math.sin(ang + Math.PI * 0.5) * curlStrength * dt;
                }
                // Vortex vertical spiral
                if (vortexHeight !== 0) {
                    const dx = p.pos.x - this.position.x;
                    const dz = p.pos.z - this.position.z;
                    const r  = Math.sqrt(dx*dx + dz*dz);
                    if (r > 0.01) p.vel.y += (vortexHeight - (p.pos.y - this.position.y)) * 0.3 * dt;
                }
            }

            if (spinTorque !== 0) p.rotSpeed += spinTorque * dt;
            p.rotation += p.rotSpeed * dt;

            let sz = this._evalCurve(c.sizeOverLife, t) * _rnd(c.size[0], c.size[1]);
            let op = this._evalCurve(c.opacityOverLife, t) * (c.opacity ?? 1);
            this._evalColor(p, t);

            // Rotation Over Lifetime (Page 2 "Animation" curve editor) —
            // when present, this curve is the authoritative rotation for
            // the particle (overrides continuous rotSpeed spin below it so
            // the two never fight); absent (default/null) = old behaviour.
            if (c.rotationOverLife && c.rotationOverLife.length) {
                p.rotation = this._evalCurve(c.rotationOverLife, t) * Math.PI / 180;
            }

            // Sprite-sheet / Flipbook (Page 2 "Appearance") — frame index
            // is driven by lifetime progress `t` so it naturally respects
            // the particle's own lifetime and loops cleanly, independent
            // of the shared system clock.
            if (c.flipbookEnabled && ((c.flipbookCols ?? 1) > 1 || (c.flipbookRows ?? 1) > 1)) {
                const fCols  = Math.max(1, Math.round(c.flipbookCols ?? 1));
                const fRows  = Math.max(1, Math.round(c.flipbookRows ?? 1));
                const fTotal = fCols * fRows;
                const fLoops = Math.max(1, Math.round(c.flipbookLoops ?? 1));
                const start  = c.flipbookRandomStart ? p.flickerPhase / (Math.PI * 2) : 0;
                const phase  = (t * fLoops + start) % 1;
                p.flipFrame  = Math.min(fTotal - 1, Math.floor(phase * fTotal));
            } else {
                p.flipFrame = 0;
            }

            if (pulseAmt > 0)
                sz *= 1 + Math.sin(T * pulseFreq * Math.PI * 2 + p.pulsePhase) * pulseAmt;
            if (sizeJitter > 0)
                sz *= 1 + _rnd(-sizeJitter, sizeJitter);
            if (flickerAmt > 0) {
                const flick = 0.5 + 0.5 * Math.sin(T * flickerFreq * Math.PI * 2 + p.flickerPhase);
                op *= 1 - flickerAmt + flickerAmt * flick;
            }

            let asp = elongation;
            if (velStretch > 0) {
                const spd = p.vel.length();
                asp = elongation + spd * velStretch;
                if (spd > 0.001) p.rotation = Math.atan2(p.vel.x, p.vel.y);
            }
            p.aspect = Math.max(0.1, asp);

            if (colorVar > 0 || brightVar > 0) {
                const hsl = { h: 0, s: 0, l: 0 };
                p.color.getHSL(hsl);
                p.color.setHSL(
                    (hsl.h + p.colorHueOff * colorVar + 1) % 1,
                    Math.min(1, hsl.s),
                    Math.min(1, hsl.l + p.brightnessOff * brightVar)
                );
            }
            // Color temperature shift
            if (colorTemp !== 0) {
                if (colorTemp > 0) {
                    // warm: boost R, reduce B
                    p.color.r = Math.min(1, p.color.r + colorTemp * 0.25);
                    p.color.b = Math.max(0, p.color.b - colorTemp * 0.18);
                } else {
                    // cool: boost B, reduce R
                    p.color.b = Math.min(1, p.color.b - colorTemp * 0.25);
                    p.color.r = Math.max(0, p.color.r + colorTemp * 0.18);
                }
            }
            // Opacity erosion by speed
            if (opacityErosion > 0) {
                const spd = p.vel.length();
                op *= Math.max(0, 1 - spd * opacityErosion);
            }
            // Taper by age: size shrinks toward end of life
            if (taperByAge > 0) sz *= Math.max(0.01, 1 - t * taperByAge);
            // Scale by distance from emitter
            if (scaleByDist !== 0) {
                const dist = p.pos.distanceTo(this.position);
                sz *= Math.max(0.01, 1 + dist * scaleByDist * 0.1);
            }
            // Fade-in: opacity ramps from 0 during first fadeInTime seconds
            if (fadeInTime > 0) {
                const age = p.maxLife - p.life;
                if (age < fadeInTime) op *= age / fadeInTime;
            }

            p.size    = sz;
            p.opacity = Math.max(0, Math.min(1, op));
        }

        dead.sort((a,b) => b-a).forEach(i => this._particles.splice(i, 1));
        this._update_buffers();
    }

    _evalCurve(curve, t) {
        if (!curve || curve.length === 0) return 1;
        if (t <= curve[0][0]) return curve[0][1];
        if (t >= curve[curve.length-1][0]) return curve[curve.length-1][1];
        for (let i = 0; i < curve.length-1; i++) {
            if (t >= curve[i][0] && t <= curve[i+1][0]) {
                const alpha = (t - curve[i][0]) / (curve[i+1][0] - curve[i][0]);
                return curve[i][1] + alpha * (curve[i+1][1] - curve[i][1]);
            }
        }
        return 1;
    }

    _evalColor(p, t) {
        const col = this._config.colorOverLife;
        if (!col || col.length === 0) { p.color.setHex(this._config.color?.from ?? 0xffffff); return; }
        if (t <= col[0][0])            { p.color.setHex(col[0][1]); return; }
        if (t >= col[col.length-1][0]) { p.color.setHex(col[col.length-1][1]); return; }
        for (let i = 0; i < col.length-1; i++) {
            if (t >= col[i][0] && t <= col[i+1][0]) {
                const alpha = (t - col[i][0]) / (col[i+1][0] - col[i][0]);
                const ca = new THREE.Color(col[i][1]), cb = new THREE.Color(col[i+1][1]);
                p.color.lerpColors(ca, cb, alpha);
                return;
            }
        }
    }

    _update_buffers() {
        const n = this._particles.length;
        for (let i = 0; i < n; i++) {
            const p = this._particles[i];
            this._positions[i*3]   = p.pos.x;
            this._positions[i*3+1] = p.pos.y;
            this._positions[i*3+2] = p.pos.z;
            this._colors[i*3]   = p.color.r;
            this._colors[i*3+1] = p.color.g;
            this._colors[i*3+2] = p.color.b;
            this._sizes[i]      = Math.max(p.size * 80, 0.5);
            this._opacities[i]  = Math.max(0, Math.min(1, p.opacity));
            this._rotations[i]  = p.rotation || 0;
            this._aspects[i]    = p.aspect   || 1;
            this._frames[i]     = p.flipFrame || 0;
        }
        this._geo.attributes.position.needsUpdate  = true;
        this._geo.attributes.color.needsUpdate     = true;
        this._geo.attributes.aSize.needsUpdate     = true;
        this._geo.attributes.aOpacity.needsUpdate  = true;
        this._geo.attributes.aRotation.needsUpdate = true;
        this._geo.attributes.aAspect.needsUpdate   = true;
        this._geo.attributes.aFrame.needsUpdate    = true;
        this._geo.setDrawRange(0, n);

        const isBeam = this._config.rendererMode === 'beam';
        this._points.visible   = !isBeam;
        this._beamMesh.visible = isBeam && n >= 2;
        if (isBeam) this._update_beam_geometry(n);

        // Must run AFTER the beam-visibility block above so Velocity/World
        // orientation correctly gets the final say over _points.visible.
        this._update_oriented_geometry(n);
        this._update_aura_shell();
    }

    // ── Beam/Rope geometry — connects particles in spawn order into a
    // camera-facing ribbon (ported concept: SFM's "render_rope"). Particles
    // are stored oldest→newest as they age out from the front, so walking
    // the array in order naturally traces the beam's path.
    _update_beam_geometry(n) {
        const width = (this._config.beamWidth ?? 0.12) * 0.5;
        // Build a simple perpendicular offset using the segment tangent
        // crossed with world-up — good enough for billboarding without
        // needing the live camera reference (matches how the sprite size
        // already ignores exact camera roll).
        const up = new THREE.Vector3(0, 1, 0);
        let vertCount = 0, idxCount = 0;
        const idxAttr = this._beamMesh.geometry.index;
        const idxArr  = idxAttr.array;

        for (let i = 0; i < n; i++) {
            const p = this._particles[i];
            let tangent;
            if (i < n - 1) tangent = this._particles[i+1].pos.clone().sub(p.pos);
            else if (i > 0) tangent = p.pos.clone().sub(this._particles[i-1].pos);
            else tangent = new THREE.Vector3(0, 0, 1);
            if (tangent.lengthSq() < 1e-6) tangent.set(0, 0, 1);
            tangent.normalize();

            let perp = new THREE.Vector3().crossVectors(tangent, up);
            if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
            perp.normalize().multiplyScalar(width * (p.size || 1));

            const vi = vertCount * 3;
            this._beamPositions[vi]     = p.pos.x - perp.x;
            this._beamPositions[vi + 1] = p.pos.y - perp.y;
            this._beamPositions[vi + 2] = p.pos.z - perp.z;
            this._beamPositions[vi + 3] = p.pos.x + perp.x;
            this._beamPositions[vi + 4] = p.pos.y + perp.y;
            this._beamPositions[vi + 5] = p.pos.z + perp.z;

            this._beamColors[vi]     = this._beamColors[vi + 3] = p.color.r;
            this._beamColors[vi + 1] = this._beamColors[vi + 4] = p.color.g;
            this._beamColors[vi + 2] = this._beamColors[vi + 5] = p.color.b;
            this._beamAlphas[vertCount]     = p.opacity;
            this._beamAlphas[vertCount + 1] = p.opacity;

            if (i < n - 1) {
                const a = vertCount, b = vertCount + 1, c = vertCount + 2, d = vertCount + 3;
                idxArr[idxCount++] = a; idxArr[idxCount++] = b; idxArr[idxCount++] = c;
                idxArr[idxCount++] = b; idxArr[idxCount++] = d; idxArr[idxCount++] = c;
            }
            vertCount += 2;
        }

        const g = this._beamMesh.geometry;
        g.attributes.position.needsUpdate = true;
        g.attributes.color.needsUpdate    = true;
        g.attributes.aOpacity.needsUpdate = true;
        idxAttr.needsUpdate = true;
        g.setDrawRange(0, idxCount);
        g.computeBoundingSphere();
    }

    // ── Oriented Quad geometry (Velocity / World orientation) ────────
    // No-op (and near-zero cost) unless orientationMode is actually set
    // to something other than the default 'billboard'.
    _update_oriented_geometry(n) {
        const active = !!this._config.orientationMode
            && this._config.orientationMode !== 'billboard'
            && this._config.rendererMode !== 'beam';
        if (this._oqMesh) this._oqMesh.visible = active && n > 0;
        if (!active) return;
        if (this._points) this._points.visible = false; // oriented quads replace the point-sprite pipeline while active

        for (let i = 0; i < n; i++) {
            const p  = this._particles[i];
            const v4 = i * 4;
            for (let k = 0; k < 4; k++) {
                const idx = v4 + k, vi = idx * 3;
                this._oqPositions[vi] = p.pos.x; this._oqPositions[vi+1] = p.pos.y; this._oqPositions[vi+2] = p.pos.z;
                this._oqColors[vi]    = p.color.r; this._oqColors[vi+1] = p.color.g; this._oqColors[vi+2] = p.color.b;
                this._oqVel[vi]       = p.vel.x; this._oqVel[vi+1] = p.vel.y; this._oqVel[vi+2] = p.vel.z;
                this._oqSize[idx]     = Math.max(p.size * 80, 0.5);
                this._oqOpacity[idx]  = Math.max(0, Math.min(1, p.opacity));
                this._oqRotation[idx] = p.rotation || 0;
                this._oqAspect[idx]   = p.aspect   || 1;
                this._oqFrame[idx]    = p.flipFrame|| 0;
            }
        }
        const g = this._oqMesh.geometry;
        g.attributes.position.needsUpdate  = true;
        g.attributes.color.needsUpdate     = true;
        g.attributes.aSize.needsUpdate     = true;
        g.attributes.aOpacity.needsUpdate  = true;
        g.attributes.aRotation.needsUpdate = true;
        g.attributes.aAspect.needsUpdate   = true;
        g.attributes.aFrame.needsUpdate    = true;
        g.attributes.aVel.needsUpdate      = true;
        g.setDrawRange(0, n * 6);
        this._oqMat.uniforms.uOrientMode.value     = this._config.orientationMode === 'world' ? 2 : 1;
        this._oqMat.uniforms.uViewportHeight.value = window._app?.renderer?.domElement?.height || window.innerHeight || 900;
    }

    // ── Aura Shell (Page 2 "Aura" — Shell/Combo approach) ─────────────
    _update_aura_shell() {
        const c = this._config;
        const on = c.auraMode === 'shell' || c.auraMode === 'combo';
        if (this._auraShell) this._auraShell.visible = on;
        if (!on) return;
        const radius = Math.max(0.05, (c.auraShellRadius ?? 12) / 10);
        const height = Math.max(0.2, (c.auraShellHeight ?? 15) / 10);
        this._auraShell.position.copy(this.position);
        this._auraShell.scale.set(radius, radius * height, radius);
        this._auraMat.uniforms.uColor.value.set(c.auraShellColor ?? '#a78bfa');
        this._auraMat.uniforms.uIntensity.value  = Math.max(0, (c.auraShellIntensity ?? 60) / 40);
        this._auraMat.uniforms.uPower.value      = Math.max(0.2, (c.auraShellSharpness ?? 55) / 25);
        this._auraMat.uniforms.uPulseSpeed.value = (c.auraShellPulseSpeed ?? 30) / 25;
        // Flame jaggedness (Page 2 "Aura") — all three default to the
        // neutral/legacy values, so old saves with no auraShellJagged key
        // at all still render as a perfectly smooth glow, byte-for-byte.
        this._auraMat.uniforms.uJagged.value       = Math.max(0, Math.min(1, (c.auraShellJagged ?? 0) / 100));
        this._auraMat.uniforms.uNoiseScale.value   = Math.max(0.1, (c.auraShellNoiseScale ?? 20) / 10);
        this._auraMat.uniforms.uFlickerSpeed.value = Math.max(0, (c.auraShellFlickerSpeed ?? 45) / 40);
        this._auraMat.uniforms.uTime.value       = this._time;
    }

    // ── Burst emit ────────────────────────────────────────────────
    burst(count) {
        const n = Math.min(count ?? this._config.burstCount ?? 50, this._maxParticles - this._particles.length);
        for (let i = 0; i < n; i++) this._spawn();
    }

    // ── Serialise / Deserialise ───────────────────────────────────
    toJSON() {
        const worldPos = new THREE.Vector3();
        this.getWorldPosition(worldPos);
        const localPos = this.parentId && this._marker
            ? { x: this._marker.position.x, y: this._marker.position.y, z: this._marker.position.z }
            : null;

        return {
            id: this.id,
            parentId: this.parentId ?? null,
            localPosition: localPos,
            name:   this.name,
            config: JSON.parse(JSON.stringify(this._config, (k,v) => v instanceof THREE.Vector3 ? {x:v.x,y:v.y,z:v.z} : v)),
            position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
            maxParticles: this._maxParticles,
        };
    }

    static fromJSON(scene, json) {
        const cfg = JSON.parse(JSON.stringify(json.config || {}));
        if (cfg.direction) {
            cfg.direction = new THREE.Vector3(cfg.direction.x, cfg.direction.y, cfg.direction.z);
        }
        const sys = new ParticleSystem(scene, {
            ...cfg,
            id: json.id,
            parentId: json.parentId ?? null,
            localPosition: json.localPosition ?? null,
            maxParticles: json.maxParticles,
            name: json.name,
        });
        if (json.position) {
            sys.position.set(json.position.x, json.position.y, json.position.z);
            if (sys._marker) sys._marker.position.copy(sys.position);
        }
        return sys;
    }

    // ── Destroy ───────────────────────────────────────────────────
    destroy() {
        if (this._parentSystem && this._parentSystem._childSystems) {
            this._parentSystem._childSystems.delete(this);
        }
        const children = Array.from(this._childSystems || []);
        children.forEach(child => child.clearParentSystem(true));
        this._childSystems.clear?.();

        this._scene.remove(this._points);
        this._scene.remove(this._beamMesh);
        this._beamMesh.geometry?.dispose();
        this._beamMat?.dispose();
        if (this._oqMesh) {
            this._scene.remove(this._oqMesh);
            this._oqMesh.geometry?.dispose();
            this._oqMat?.dispose();
        }
        if (this._auraShell) {
            this._scene.remove(this._auraShell);
            this._auraShell.geometry?.dispose();
            this._auraMat?.dispose();
        }
        if (this._marker) {
            this._marker.children.forEach(c => {
                c.geometry?.dispose();
                c.material?.dispose();
            });
            this._marker.parent?.remove(this._marker);
            this._scene.remove(this._marker);
            this._marker = null;
        }
        this._geo.dispose();
        this._mat.dispose();
        this._particles = [];
        this._pool = [];
    }
}

// ─── ParticleLab manager ──────────────────────────────────────────────────────
export class ParticleLab {
    constructor(scene) {
        this._scene   = scene;
        this._systems = [];
        this._active  = null;
        this._running = false;
    }

    _registerSystem(sys) {
        if (!sys) return null;
        if (!this._systems.includes(sys)) this._systems.push(sys);
        this._active = sys;
        return sys;
    }

    createFromPreset(presetId, position = new THREE.Vector3(0, 1, 0)) {
        const preset = PARTICLE_PRESETS[presetId];
        if (!preset) return null;
        const sys = new ParticleSystem(this._scene, { ...preset, name: preset.label });
        sys.position.copy(position);
        if (sys._marker) sys._marker.position.copy(position);
        this._registerSystem(sys);
        if (preset.burst) { sys.play(); sys.burst(); } else sys.play();
        return sys;
    }

    createBlank(name = 'New Particle', position = new THREE.Vector3(0, 1, 0)) {
        const sys = new ParticleSystem(this._scene, { name });
        sys.position.copy(position);
        if (sys._marker) sys._marker.position.copy(position);
        this._registerSystem(sys);
        return sys;
    }

    createChildBlank(parentSystem, name = 'Subpartícula', localPosition = new THREE.Vector3(0, 1, 0)) {
        if (!parentSystem) return null;
        const sys = new ParticleSystem(this._scene, {
            name,
            parentId: parentSystem.id,
            localPosition: { x: localPosition.x, y: localPosition.y, z: localPosition.z },
        });
        sys.setParentSystem(parentSystem, localPosition, false);
        this._registerSystem(sys);
        return sys;
    }

    createChildFromPreset(parentSystem, presetId, localPosition = new THREE.Vector3(0, 1, 0)) {
        if (!parentSystem) return null;
        const preset = PARTICLE_PRESETS[presetId];
        if (!preset) return null;
        const sys = new ParticleSystem(this._scene, {
            ...preset,
            name: preset.label,
            parentId: parentSystem.id,
            localPosition: { x: localPosition.x, y: localPosition.y, z: localPosition.z },
        });
        sys.setParentSystem(parentSystem, localPosition, false);
        this._registerSystem(sys);
        if (preset.burst) { sys.play(); sys.burst(); } else sys.play();
        return sys;
    }

    setActive(sys) { this._active = sys; }
    getActive()    { return this._active; }
    getSystems()   { return this._systems; }
    getTotalParticleCount() { return this._systems.reduce((sum, s) => sum + s.getParticleCount(), 0); }

    removeSystem(sys) {
        const idx = this._systems.indexOf(sys);
        if (idx >= 0) this._systems.splice(idx, 1);
        if (sys?.getChildrenSystems?.().length) {
            sys.getChildrenSystems().forEach(child => child.clearParentSystem(true));
        }
        if (this._active === sys) this._active = this._systems[0] ?? null;
        sys.destroy();
    }

    clearAll() {
        this._systems.forEach(s => s.destroy());
        this._systems = [];
        this._active  = null;
    }

    /** Serialize all current systems — used by the main project save flow
     *  (config.js's _serialize()), separate from the Labs panel's own
     *  standalone "Salvar .nex" file export. */
    serializeSystems() {
        return this._systems.map(s => s.toJSON());
    }

    /** Clears existing systems and rebuilds from a plain array of the JSON
     *  shape produced by serializeSystems() — used when loading a project
     *  (new project = empty array = same as clearAll()). */
    restoreSystems(jsonArray = []) {
        this.clearAll();
        const byId = new Map();
        jsonArray.forEach(json => {
            try {
                const sys = ParticleSystem.fromJSON(this._scene, json);
                this._systems.push(sys);
                if (sys.id) byId.set(sys.id, sys);
            } catch (e) { console.warn('[ParticleLab] Erro ao restaurar sistema:', e); }
        });

        this._systems.forEach(sys => {
            if (!sys.parentId) return;
            const parent = byId.get(sys.parentId);
            if (parent) {
                const lp = sys.localPosition || (sys._marker
                    ? sys._marker.position.clone()
                    : new THREE.Vector3());
                sys.setParentSystem(parent, lp, false);
            } else {
                sys.clearParentSystem(false);
            }
        });

        this._systems.forEach(sys => sys.play());
        this._active = this._systems[0] ?? null;
        window.dispatchEvent(new Event('labs-systems-changed'));
    }

    update(dt) {
        this._systems.forEach(s => {
            s.update(dt);
        });
    }

    // ── Set render scale on all systems (used by image capture) ─────────
    setRenderScale(scale) {
        this._systems.forEach(s => s.setRenderScale(scale));
    }

    // ── .nex payload builder ─────────────────────────────────────────────
    _buildPayload() {
        return {
            version:   '1.0',
            format:    'nex',
            type:      'particle_lab',
            timestamp: new Date().toISOString(),
            systems:   this._systems.map(s => s.toJSON()),
        };
    }

    // ── Save to localStorage as .nex (base64) ────────────────────────────
    async save(key = 'nexus_particle_lab') {
        try {
            if (!window._nexEncodeNex) throw new Error('_nexEncodeNex não disponível');
            const bytes = await window._nexEncodeNex(this._buildPayload());
            // Converte Uint8Array para base64 para armazenar no localStorage
            let bin = '';
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            localStorage.setItem(key, btoa(bin));
            return true;
        } catch (e) {
            // Fallback: salva como JSON simples se .nex falhar
            try {
                localStorage.setItem(key + '_fb', JSON.stringify(this._buildPayload()));
                return true;
            } catch (_) { return false; }
        }
    }

    // ── Load from localStorage (.nex base64 or JSON fallback) ────────────
    async load(key = 'nexus_particle_lab') {
        try {
            let data = null;
            const raw = localStorage.getItem(key);
            if (raw) {
                if (window._nexDecodeNex) {
                    try {
                        const bin   = atob(raw);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        data = await window._nexDecodeNex(bytes.buffer);
                    } catch (_) { data = null; }
                }
            }
            // Fallback JSON
            if (!data) {
                const fb = localStorage.getItem(key + '_fb');
                if (fb) data = JSON.parse(fb);
            }
            if (!data?.systems?.length) return false;

            this.clearAll();
            const byId = new Map();
            data.systems.forEach(json => {
                const sys = ParticleSystem.fromJSON(this._scene, json);
                this._systems.push(sys);
                if (sys.id) byId.set(sys.id, sys);
            });
            this._systems.forEach(sys => {
                if (!sys.parentId) return;
                const parent = byId.get(sys.parentId);
                if (parent) {
                    const lp = sys.localPosition || (sys._marker ? sys._marker.position.clone() : new THREE.Vector3());
                    sys.setParentSystem(parent, lp, false);
                } else {
                    sys.clearParentSystem(false);
                }
            });
            this._systems.forEach(sys => sys.play());
            this._active = this._systems[0] ?? null;
            return true;
        } catch (e) { return false; }
    }

    // ── Export as downloadable .nex file ─────────────────────────────────
    async exportNex(filename = 'particles.nex') {
        try {
            if (!window._nexEncodeNex) throw new Error('_nexEncodeNex não disponível');
            const bytes = await window._nexEncodeNex(this._buildPayload());
            const blob  = new Blob([bytes], { type: 'application/x-nexus-project' });
            const url   = URL.createObjectURL(blob);
            const a     = document.createElement('a');
            a.href      = url;
            a.download  = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 10000);
            return true;
        } catch (e) { return false; }
    }

    // ── Import from .nex File object ─────────────────────────────────────
    async importNex(file) {
        try {
            if (!window._nexDecodeNex) throw new Error('_nexDecodeNex não disponível');
            const buffer = await file.arrayBuffer();
            const data   = await window._nexDecodeNex(buffer);
            if (!data?.systems?.length) throw new Error('Arquivo .nex não contém partículas');

            this.clearAll();
            data.systems.forEach(json => {
                const sys = ParticleSystem.fromJSON(this._scene, json);
                this._systems.push(sys);
                sys.play();
            });
            this._active = this._systems[0] ?? null;
            return true;
        } catch (e) {
            return { error: e.message };
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _rnd(a, b) { return a + Math.random() * (b - a); }

// ─── Expose globally ─────────────────────────────────────────────────────────
window._ParticleEngine = { ParticleSystem, ParticleLab, PARTICLE_PRESETS, MODULE_LIBRARY, SHADER_FX_LIBRARY, SHADER_FX_MODES, _getTexture };
