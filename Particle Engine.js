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
        case 'lightning':_texCache[name] = _makeStreakTex(); break;
        case 'streak':   _texCache[name] = _makeStreakTex(); break;
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
        case 'petal':    _texCache[name] = _makePetalTex(); break;
        case 'bolt':     _texCache[name] = _makeBoltTex(); break;
        case 'coin':     _texCache[name] = _makeCoinTex(); break;
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
    for(let i=0;i<10;i++){
        const x=16+Math.random()*32, y=16+Math.random()*32, r=14+Math.random()*14;
        const g=ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,'rgba(200,200,200,0.55)');
        g.addColorStop(0.6,'rgba(190,190,190,0.3)');
        g.addColorStop(1,'rgba(180,180,180,0)');
        ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    }
    return new THREE.CanvasTexture(c);
}
function _makeEmberTex() {
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    const go=ctx.createRadialGradient(32,32,0,32,32,30);
    go.addColorStop(0,'rgba(255,245,180,1)');
    go.addColorStop(0.15,'rgba(255,200,60,1)');
    go.addColorStop(0.35,'rgba(255,130,10,0.9)');
    go.addColorStop(0.55,'rgba(220,60,0,0.6)');
    go.addColorStop(0.75,'rgba(160,20,0,0.25)');
    go.addColorStop(1,'rgba(80,0,0,0)');
    ctx.fillStyle=go; ctx.fillRect(0,0,64,64);
    const gc=ctx.createRadialGradient(32,30,0,32,30,10);
    gc.addColorStop(0,'rgba(255,255,255,1)');
    gc.addColorStop(0.3,'rgba(255,250,200,0.9)');
    gc.addColorStop(0.7,'rgba(255,200,80,0.4)');
    gc.addColorStop(1,'rgba(255,140,0,0)');
    ctx.fillStyle=gc; ctx.fillRect(0,0,64,64);
    ctx.save(); ctx.translate(32,18); ctx.scale(0.6,1);
    const gt=ctx.createRadialGradient(0,0,0,0,4,12);
    gt.addColorStop(0,'rgba(255,255,220,0.8)');
    gt.addColorStop(1,'rgba(255,180,0,0)');
    ctx.fillStyle=gt; ctx.beginPath();
    ctx.moveTo(0,-12); ctx.bezierCurveTo(6,-6,6,6,0,10); ctx.bezierCurveTo(-6,6,-6,-6,0,-12);
    ctx.fill(); ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _makeStreakTex() {
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
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(5,5,22,22);
    const g=ctx.createLinearGradient(5,5,27,27);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.5,'rgba(225,225,235,0.65)');
    g.addColorStop(1,'rgba(255,255,255,1)');
    ctx.fillStyle=g; ctx.fillRect(5,5,22,22);
    return new THREE.CanvasTexture(c);
}
function _makeDiamondTex() {
    const c=document.createElement('canvas'); c.width=c.height=32;
    const ctx=c.getContext('2d');
    ctx.save(); ctx.translate(16,16); ctx.rotate(Math.PI/4);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(-9,-9,18,18);
    const g=ctx.createLinearGradient(-9,-9,9,9);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.5,'rgba(210,225,255,0.6)');
    g.addColorStop(1,'rgba(255,255,255,1)');
    ctx.fillStyle=g; ctx.fillRect(-9,-9,18,18);
    ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _makeFireballTex() {
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d');
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
    ctx.save();
    ctx.translate(32,32);
    ctx.beginPath();
    for(let i=0;i<6;i++){
        const a=i*Math.PI/3 - Math.PI/2;
        const x=Math.cos(a)*26, y=Math.sin(a)*26;
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath();
    const g=ctx.createRadialGradient(0,0,0,0,0,26);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.75,'rgba(210,210,255,0.9)');
    g.addColorStop(1,'rgba(160,160,255,0.55)');
    ctx.fillStyle=g; ctx.fill();
    ctx.lineWidth=2.5;
    ctx.strokeStyle='rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.restore();
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

function _makeFlameTex() {
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
    const c=document.createElement('canvas'); c.width=c.height=64;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,64,64);
    const g=ctx.createRadialGradient(32,32,0,32,32,30);
    g.addColorStop(0,'rgba(255,255,220,1)');
    g.addColorStop(0.25,'rgba(255,220,80,0.7)');
    g.addColorStop(1,'rgba(255,160,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
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
    ctx.beginPath(); ctx.moveTo(0,-26); ctx.lineTo(5,-12); ctx.lineTo(0,0); ctx.lineTo(-5,-12); ctx.closePath();
    const gi=ctx.createLinearGradient(0,-26,0,0);
    gi.addColorStop(0,'rgba(255,255,255,0.9)'); gi.addColorStop(1,'rgba(200,230,255,0)');
    ctx.fillStyle=gi; ctx.fill();
    ctx.restore();
    return new THREE.CanvasTexture(c);
}
function _makeElectricTex() {
    const c=document.createElement('canvas'); c.width=16; c.height=80;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,16,80);
    const gh=ctx.createRadialGradient(8,40,0,8,40,18);
    gh.addColorStop(0,'rgba(180,200,255,0.3)'); gh.addColorStop(1,'rgba(100,140,255,0)');
    ctx.fillStyle=gh; ctx.fillRect(0,0,16,80);
    const pts=[[8,2],[12,18],[4,34],[12,50],[5,64],[8,78]];
    ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.strokeStyle='rgba(220,240,255,0.95)'; ctx.lineWidth=2.5; ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,1)'; ctx.lineWidth=1; ctx.stroke();
    const gv=ctx.createLinearGradient(0,0,0,80);
    gv.addColorStop(0,'rgba(0,0,0,1)'); gv.addColorStop(0.06,'rgba(0,0,0,0)');
    gv.addColorStop(0.94,'rgba(0,0,0,0)'); gv.addColorStop(1,'rgba(0,0,0,1)');
    ctx.globalCompositeOperation='destination-out'; ctx.fillStyle=gv; ctx.fillRect(0,0,16,80);
    ctx.globalCompositeOperation='source-over';
    return new THREE.CanvasTexture(c);
}
function _buildExtrudeShape(textureName) {
    const s = 1 / 30;
    const shp = new THREE.Shape();
    switch (textureName) {
        case 'heart':
            shp.moveTo(0*s, 10*s);
            shp.bezierCurveTo(-5*s,20*s, -20*s,20*s, -20*s,10*s);
            shp.bezierCurveTo(-20*s,0*s, 0*s,-15*s, 0*s,-22*s);
            shp.bezierCurveTo(0*s,-15*s, 20*s,0*s, 20*s,10*s);
            shp.bezierCurveTo(20*s,20*s, 5*s,20*s, 0*s,10*s);
            break;
        case 'hex':
            for (let i = 0; i < 6; i++) {
                const a = i*Math.PI/3 - Math.PI/2, x = Math.cos(a)*26*s, y = -Math.sin(a)*26*s;
                if (i === 0) shp.moveTo(x,y); else shp.lineTo(x,y);
            }
            shp.closePath();
            break;
        case 'diamond': {
            const r = 9*Math.SQRT2*s;
            shp.moveTo(0,r); shp.lineTo(r,0); shp.lineTo(0,-r); shp.lineTo(-r,0); shp.closePath();
            break;
        }
        case 'square': {
            const r = 11*s;
            shp.moveTo(-r,-r); shp.lineTo(r,-r); shp.lineTo(r,r); shp.lineTo(-r,r); shp.closePath();
            break;
        }
        case 'starburst':
            for (let i = 0; i < 16; i++) {
                const a = i*Math.PI/8 - Math.PI/2, r = (i%2===0?30:10)*s;
                const x = Math.cos(a)*r, y = -Math.sin(a)*r;
                if (i === 0) shp.moveTo(x,y); else shp.lineTo(x,y);
            }
            shp.closePath();
            break;
        case 'crystal':
            shp.moveTo(0*s,30*s); shp.lineTo(12*s,8*s); shp.lineTo(16*s,-14*s);
            shp.lineTo(0*s,-30*s); shp.lineTo(-14*s,-12*s); shp.lineTo(-10*s,8*s);
            shp.closePath();
            break;
        case 'cross': {
            const hw = 3.5*s, hl = 30*s;
            shp.moveTo(hw,hl); shp.lineTo(hw,hw); shp.lineTo(hl,hw); shp.lineTo(hl,-hw);
            shp.lineTo(hw,-hw); shp.lineTo(hw,-hl); shp.lineTo(-hw,-hl); shp.lineTo(-hw,-hw);
            shp.lineTo(-hl,-hw); shp.lineTo(-hl,hw); shp.lineTo(-hw,hw); shp.lineTo(-hw,hl);
            shp.closePath();
            break;
        }
        case 'leaf':
            shp.moveTo(0*s,28*s);
            shp.bezierCurveTo(18*s,20*s, 18*s,-20*s, 0*s,-30*s);
            shp.bezierCurveTo(-18*s,-20*s, -18*s,20*s, 0*s,28*s);
            break;
        case 'petal':
            shp.moveTo(0*s,-24*s);
            shp.bezierCurveTo(17*s,-14*s, 17*s,14*s, 4*s,23*s);
            shp.lineTo(0*s,17*s); shp.lineTo(-4*s,23*s);
            shp.bezierCurveTo(-17*s,14*s, -17*s,-14*s, 0*s,-24*s);
            break;
        case 'bolt':
            shp.moveTo(2*s,30*s); shp.lineTo(-10*s,-2*s); shp.lineTo(-1*s,-2*s);
            shp.lineTo(-4*s,-30*s); shp.lineTo(12*s,6*s); shp.lineTo(2*s,6*s);
            shp.closePath();
            break;
        case 'flame':
            shp.moveTo(0*s,58*s);
            shp.bezierCurveTo(18*s,38*s, 18*s,10*s, 0*s,-4*s);
            shp.bezierCurveTo(-18*s,10*s, -18*s,38*s, 0*s,58*s);
            break;
        case 'coin': case 'orb': case 'ring':
            shp.absarc(0, 0, 26*s, 0, Math.PI*2, false);
            break;
        default:
            shp.absarc(0, 0, 0.4, 0, Math.PI*2, false);
    }
    return shp;
}

function _mod(id, label, icon, category, fields, opts = {}) {
    return {
        id, label, icon, category, fields, group: opts.group ?? null,
        desc: opts.desc ?? '',
        isActive(cfg) {
            return fields.some(f => (cfg[f.key] ?? f.default) !== f.default && f.key !== '_shapeTag');
        },
        apply(cfg, values = {}) {
            fields.forEach(f => {
                if (f.key === '_shapeTag') return;
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
             { key: 'rate',  label: 'Taxa (p/s)', min: 0, max: 300, step: 1, default: 20 },
             { key: 'emitNoiseMask', label: 'Máscara de Ruído (Textura)', min: 0, max: 1, step: 0.01, default: 0 }],
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
            onApply: c => { c.emitShape = 'cone'; }, desc: 'Nasce dentro de um cone.' }),
        _mod('shape_disc', 'Disco', '⭕', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'disc'; }, desc: 'Nasce num disco plano.' }),
        _mod('shape_ring', 'Anel', '💍', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'ring'; }, desc: 'Nasce na borda de um anel.' }),
        _mod('shape_plane', 'Plano', '▭', 'initializers',
            [{ key: 'emitRadius', label: 'Tamanho', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'plane'; }, desc: 'Nasce numa área plana.' }),
        _mod('shape_bodypoints', 'Pontos do Corpo', '🧍', 'initializers',
            [{ key: 'emitRadius', label: 'Espalhamento Local', min: 0, max: 2, step: 0.02, default: 0.08 }], { group: 'shape',
            onApply: c => { c.emitShape = 'bodypoints'; },
            desc: 'Nasce espalhado em 8 pontos de um corpo humanoide.' }),
        _mod('shape_line', 'Linha (Laser)', '⚡', 'initializers',
            [{ key: 'targetOffsetY', label: 'Comprimento', min: 0.2, max: 30, step: 0.1, default: 4 },
             { key: 'lineJitter',    label: 'Jitter', min: 0, max: 1, step: 0.01, default: 0.02 }],
            { group: 'shape', desc: 'Nasce ao longo de uma linha.',
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
        _mod('shape_box', 'Caixa', '📦', 'initializers',
            [{ key: 'emitRadius', label: 'Metade do Lado', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'box'; }, desc: 'Nasce dentro de um volume cúbico.' }),
        _mod('shape_cylinder', 'Cilindro', '🥫', 'initializers',
            [{ key: 'emitRadius', label: 'Raio', min: 0, max: 10, step: 0.05, default: 0.5 }], { group: 'shape',
            onApply: c => { c.emitShape = 'cylinder'; }, desc: 'Nasce dentro de um cilindro vertical.' }),
    ],

    operators: [
        _mod('gravity', 'Gravidade', '⬇', 'operators',
            [{ key: 'gravity', label: 'Força', min: -30, max: 30, step: 0.1, default: 0, addDefault: 9.8 }]),
        _mod('drag', 'Arrasto', '🪂', 'operators',
            [{ key: 'drag', label: 'Fator', min: 0.5, max: 1, step: 0.002, default: 1, addDefault: 0.96 }]),
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
    ],

    forces: [
        _mod('vortex_spin', 'Vórtice (Giro)', '🌪', 'forces',
            [{ key: 'spiralStrength', label: 'Força', min: -30, max: 30, step: 0.1, default: 0, addDefault: 4 }]),
        _mod('attract_repel', 'Atrair / Repelir', '🧲', 'forces',
            [{ key: 'forcePull', label: '- Repele / + Atrai', min: -20, max: 20, step: 0.05, default: 0, addDefault: 2 }]),
    ],

    renderers: [
        _mod('render_sprite', 'Sprite (Padrão)', '🖼', 'renderers',
            [{ key: 'texture',          label: 'Textura',  type: 'texture',  default: 'glow' },
             { key: 'textureCustom',    label: 'Imagem importada', type: 'hidden', default: '' },
             { key: 'textureCustomName', label: 'Nome da imagem',   type: 'hidden', default: '' },
             { key: 'blending',         label: 'Blending',  type: 'blend',    default: 'additive' },
             { key: 'lightEmission',    label: 'Emissão de Luz', min: 0, max: 1, step: 0.01, default: 0.8 }],
            { group: 'renderMode', onApply: c => { c.rendererMode = 'sprite'; },
              desc: 'Partículas billboard individuais.' }),
        _mod('render_beam', 'Feixe / Rope (Laser)', '⚡', 'renderers',
            [{ key: 'beamWidth', label: 'Largura', min: 0.01, max: 3, step: 0.01, default: 0.12 },
             { key: 'beamNoiseAmount', label: 'Crepitação (ruído)', min: 0, max: 1, step: 0.01, default: 0 },
             { key: 'beamNoiseSpeed', label: 'Velocidade da Crepitação', min: 0, max: 40, step: 0.5, default: 12 },
             { key: 'lightEmission', label: 'Emissão de Luz', min: 0, max: 1, step: 0.01, default: 0.9 }],
            { group: 'renderMode', onApply: c => { c.rendererMode = 'beam'; },
              desc: 'Conecta partículas numa fita contínua.' }),
        _mod('render_mesh', 'Objeto 3D (Malha)', '🧊', 'renderers',
            [{ key: 'texture',          label: 'Forma (mesma Textura)', type: 'texture', default: 'glow' },
             { key: 'meshMetalness', label: 'Metalicidade', min: 0, max: 1, step: 0.01, default: 0.3 },
             { key: 'meshRoughness', label: 'Rugosidade', min: 0, max: 1, step: 0.01, default: 0.5 },
             { key: 'meshEmissive', label: 'Emissão de Luz', min: 0, max: 2, step: 0.01, default: 0 }],
            { group: 'renderMode', onApply: c => { c.rendererMode = 'mesh'; },
              desc: 'Instancia um objeto 3D extrudado em cada partícula.' }),
    ],
};

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

function _findModule(category, id) {
    return MODULE_LIBRARY[category]?.find(m => m.id === id) ?? null;
}

function _inferStackFromConfig(cfg) {
    const stack = { emitters: null, initializers: [], operators: [], forces: [], renderers: null };
    stack.emitters = cfg.burst ? 'emit_burst' : 'emit_continuous';
    const shapeMap = {
        point: 'shape_point',
        sphere: 'shape_sphere',
        surface: 'shape_surface',
        cone: 'shape_cone',
        disc: 'shape_disc',
        ring: 'shape_ring',
        plane: 'shape_plane',
        line: 'shape_line',
        box: 'shape_box',
        cylinder: 'shape_cylinder',
        bodypoints: 'shape_bodypoints' // Mapeamento correto para a aura aparecer no Stack!
    };
    stack.initializers.push(shapeMap[cfg.emitShape] ?? 'shape_sphere');
    stack.initializers.push('lifetime', 'initial_speed', 'initial_size');
    if (cfg.spreadAngle !== undefined && cfg.spreadAngle !== 180) stack.initializers.push('spread_angle');
    if (cfg.rotation) stack.initializers.push('rotation_random');
    stack.operators.push('size_scale', 'opacity_fade', 'color_fade');
    MODULE_LIBRARY.operators.forEach(m => {
        if (['size_scale','opacity_fade','color_fade'].includes(m.id)) return;
        if (m.isActive(cfg)) stack.operators.push(m.id);
    });
    MODULE_LIBRARY.forces.forEach(m => { if (m.isActive(cfg)) stack.forces.push(m.id); });
    stack.renderers = cfg.rendererMode === 'beam' ? 'render_beam' : (cfg.rendererMode === 'mesh' ? 'render_mesh' : 'render_sprite');
    return stack;
}

export const PARTICLE_PRESETS = {
    magicDust: {
        label: 'Magic Dust',
        icon:  '🌟',
        category: 'magic',
        rate: 45, lifetime: [1.1, 2.6], speed: [0.3, 0.8],
        size: [0.018, 0.03], sizeOverLife: [[0,0.5],[0.3,1],[1,0]],
        color: { from: 0xcc44ff, to: 0x66ccff },
        colorOverLife: [[0,0xee55ff],[0.35,0xaa55ff],[0.7,0x6688ff],[1,0x66ccff]],
        opacity: 1, opacityOverLife: [[0,1],[0.6,1],[1,0]],
        texture: 'glow', blending: 'additive',
        emitShape: 'line', emitAngle: 30, targetOffset: { x: 0, y: 0.35, z: 0 }, lineJitter: 0.22,
        drag: 0.95, gravity: -0.5,
        rotation: true, rotSpeed: [-180, 180],
        lightEmission: 0.25,
    },
    electricAura: {
        label: 'Electric Aura',
        icon:  '⚡',
        category: 'combat',
        rate: 35, lifetime: [0.08, 0.16], speed: [0.2, 0.6],
        size: [0.02, 0.045], sizeOverLife: [[0,1],[0.5,0.6],[1,0]],
        color: { from: 0xaaddff, to: 0x2266ff },
        colorOverLife: [[0,0xeaf6ff],[0.35,0x8ecbff],[1,0x2266ff]],
        opacity: 0.9, opacityOverLife: [[0,1],[0.4,0.7],[1,0]],
        texture: 'electric', blending: 'additive',
        emitShape: 'bodypoints', emitRadius: 0.08,
        drag: 0.93, gravity: -0.5,
        lightEmission: 0.3
    }
};

class Particle {
    constructor() {
        this.pos      = new THREE.Vector3();
        this.vel      = new THREE.Vector3();
        this.acc      = new THREE.Vector3();
        this.color    = new THREE.Color();
        this.baseColor= new THREE.Color();
        this.size     = 1;
        this.opacity  = 1;
        this.life     = 1;
        this.maxLife  = 1;
        this.rotation = 0;
        this.rotSpeed = 0;
        this.alive    = false;
        this.aspect   = 1;
        this.flipFrame= 0;
        this.initialPos = new THREE.Vector3();
    }
    reset() { this.alive = false; }
}

export class ParticleSystem {
    constructor(scene, config = {}) {
        this._scene  = scene;
        this._config = Object.assign({}, PARTICLE_PRESETS.magicDust, config);
        this._particles  = [];
        this._maxParticles = Math.min(config.maxParticles || 2000, 5000);
        this._pool       = [];
        this._time       = 0;
        this._emitAccum  = 0;
        this._playing    = false;
        this._paused     = false;

        this.id = config.id || 'ps_' + Math.random().toString(36).slice(2, 7);
        this.parentId = config.parentId ?? null;
        this.name = config.name || 'ParticleSystem';
        this.position = new THREE.Vector3();
        this.userData = { isLab: true, particleSystemId: this.id };

        for (let i = 0; i < this._maxParticles; i++) this._pool.push(new Particle());

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

        const tex = _getTexture(this._config.texture || 'glow');
        this._mat = new THREE.ShaderMaterial({
            uniforms: {
                uTexture:       { value: tex },
                uLightEmission: { value: this._config.lightEmission ?? 0.8 },
                uSizeScale:     { value: 1.0 },
                uTime:          { value: 0.0 },
            },
            vertexShader: /* glsl */`
                attribute float aSize; attribute float aOpacity; attribute float aRotation; attribute float aAspect; attribute float aFrame;
                uniform float uSizeScale; varying vec3 vColor; varying float vOpacity; varying float vRot;
                void main(){
                    vColor = color; vOpacity = aOpacity; vRot = aRotation;
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = clamp(aSize * uSizeScale * (380.0 / max(-mvPos.z, 0.1)), 1.0, 512.0);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D uTexture; varying vec3 vColor; varying float vOpacity; varying float vRot;
                void main(){
                    vec2 cuv = gl_PointCoord - 0.5;
                    float s = sin(vRot), c = cos(vRot);
                    cuv = vec2(c*cuv.x - s*cuv.y, s*cuv.x + c*cuv.y) + 0.5;
                    vec4 tex = texture2D(uTexture, cuv);
                    if(tex.a < 0.015) discard;
                    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vOpacity);
                }
            `,
            blending: this._config.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
            depthWrite: false, transparent: true, vertexColors: true,
        });

        this._points = new THREE.Points(this._geo, this._mat);
        this._points.frustumCulled = false;
        this._points.userData = this.userData;
        this._scene.add(this._points);

        this._marker = new THREE.Object3D();
        this._marker.name = this.name;
        this._scene.add(this._marker);
        this.stack = _inferStackFromConfig(this._config);
    }

    addModule(category, moduleId, values = {}) {
        const mod = _findModule(category, moduleId);
        if (!mod) return false;
        mod.apply(this._config, values);
        this.setConfig(this._config);
        return true;
    }

    removeModule(category, moduleId) {
        const mod = _findModule(category, moduleId);
        if (!mod) return false;
        mod.reset(this._config);
        this.setConfig(this._config);
        return true;
    }

    hasModule(category, moduleId) {
        return true;
    }

    getStack() { return this.stack; }
    getParticleCount() { return this._particles.length; }

    setConfig(cfg) {
        Object.assign(this._config, cfg);
        if (cfg.texture !== undefined) {
            this._mat.uniforms.uTexture.value = _getTexture(cfg.texture);
        }
    }

    play()  { this._playing = true; this._paused = false; }
    pause() { this._paused = true; }
    stop()  { this._playing = false; this._particles.forEach(p => p.reset()); this._update_buffers(); }
    reset() { this.stop(); this._time = 0; }

    _spawn() {
        if (this._pool.length === 0) return;
        const p = this._pool.pop();
        const c = this._config;
        p.alive = true;
        p.maxLife = _rnd(c.lifetime[0], c.lifetime[1]);
        p.life = p.maxLife;

        const sp = new THREE.Vector3(_rnd(-0.5,0.5), _rnd(-0.5,0.5), _rnd(-0.5,0.5));
        if (c.emitShape === 'bodypoints') {
            const pts = [new THREE.Vector3(0,1.65,0), new THREE.Vector3(0,1.1,0), new THREE.Vector3(-0.35,1.35,0)];
            const pt = pts[(Math.random() * pts.length) | 0];
            p.pos.copy(this.position).add(pt).add(sp.multiplyScalar(c.emitRadius || 0.08));
        } else {
            p.pos.copy(this.position).add(sp);
        }

        const speed = _rnd(c.speed?.[0] ?? 0.5, c.speed?.[1] ?? 2);
        p.vel.set(_rnd(-1,1), _rnd(0,1), _rnd(-1,1)).normalize().multiplyScalar(speed);
        p.color.setHex(c.color?.from ?? 0xffffff);
        this._particles.push(p);
    }

    update(dt) {
        if (this._marker) this._marker.getWorldPosition(this.position);
        if (!this._playing || this._paused) return;
        this._time += dt;

        if (!this._config.burst) {
            this._emitAccum += (this._config.rate || 20) * dt;
            while (this._emitAccum >= 1 && this._particles.length < this._maxParticles) {
                this._emitAccum -= 1;
                this._spawn();
            }
        }

        const dead = [];
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const p = this._particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                p.reset();
                this._pool.push(p);
                dead.push(i);
                continue;
            }
            p.pos.addScaledVector(p.vel, dt);
            p.size = 1;
            p.opacity = p.life / p.maxLife;
        }
        dead.forEach(i => this._particles.splice(i, 1));
        this._update_buffers();
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
            this._sizes[i]      = Math.max(p.size * 40, 1);
            this._opacities[i]  = p.opacity;
        }
        this._geo.attributes.position.needsUpdate = true;
        this._geo.attributes.color.needsUpdate    = true;
        this._geo.attributes.aSize.needsUpdate    = true;
        this._geo.attributes.aOpacity.needsUpdate = true;
        this._geo.setDrawRange(0, n);
    }

    destroy() {
        this._scene.remove(this._points);
        this._scene.remove(this._marker);
        this._geo.dispose();
        this._mat.dispose();
    }
}

export class ParticleLab {
    constructor(scene) {
        this._scene = scene;
        this._systems = [];
        this._active = null;
    }
    createFromPreset(presetId) {
        const preset = PARTICLE_PRESETS[presetId] || PARTICLE_PRESETS.magicDust;
        const sys = new ParticleSystem(this._scene, preset);
        this._systems.push(sys);
        this._active = sys;
        sys.play();
        return sys;
    }
    getSystems() { return this._systems; }
    update(dt) { this._systems.forEach(s => s.update(dt)); }
}

function _rnd(a, b) { return a + Math.random() * (b - a); }

window._ParticleEngine = { ParticleSystem, ParticleLab, PARTICLE_PRESETS, MODULE_LIBRARY };
```tutorial
eof