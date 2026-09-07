import * as THREE from 'three';
import { app, getSelected, ensurePhysicalMaterial, markSceneDirty } from './scene.js';

const MAPS = [
  ['map','Albedo'],
  ['normalMap','Normal'],
  ['roughnessMap','Roughness'],
  ['metalnessMap','Metalness'],
  ['aoMap','AO'],
  ['emissiveMap','Emissive'],
  ['displacementMap','Height'],
  ['alphaMap','Alpha']
];

const state = {
  root:null,
  size:256,
  scale:5,
  detail:3,
  seed:17,
  contrast:1,
  strength:1,
  initialized:false,
  syncing:false,
  mapSettings:{}
};
MAPS.forEach(([slot]) => state.mapSettings[slot] = { scale:5, detail:3, seed:17, contrast:1, strength:1 });

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function fract(v){ return v-Math.floor(v); }
function hash(x,y,seed){ return fract(Math.sin(x*127.1+y*311.7+seed*74.3)*43758.5453123); }
function smooth(t){ return t*t*(3-2*t); }
function valueNoise(x,y,seed){
  const x0=Math.floor(x), y0=Math.floor(y), tx=smooth(x-x0), ty=smooth(y-y0);
  const a=hash(x0,y0,seed), b=hash(x0+1,y0,seed), c=hash(x0,y0+1,seed), d=hash(x0+1,y0+1,seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a,b,tx),THREE.MathUtils.lerp(c,d,tx),ty);
}
function fbm(x,y,scale,detail,seed){
  let f=0, amp=0.5, freq=Math.max(0.01,scale);
  const oct=Math.round(clamp(detail,1,7));
  for(let i=0;i<oct;i++){
    f += valueNoise(x*freq,y*freq,seed+i*19.17)*amp;
    freq *= 2; amp *= 0.5;
  }
  return f;
}
function pattern(x,y,cfg){
  const s=Math.max(0.05,Number(cfg.scale)||5);
  const d=Number(cfg.detail)||3;
  const seed=Number(cfg.seed)||0;
  const n=fbm(x,y,s,d,seed);
  const n2=fbm(x*0.35+13.1,y*0.35-7.4,s*0.8,d,seed+71);
  return clamp((n*0.72+n2*0.28-0.5)*Number(cfg.contrast||1)+0.5,0,1);
}
function hexToRgb(hex){ const c=new THREE.Color(hex||'#ffffff'); return [c.r,c.g,c.b]; }
function writeRGB(data,i,r,g,b){ data[i]=Math.round(clamp(r,0,1)*255); data[i+1]=Math.round(clamp(g,0,1)*255); data[i+2]=Math.round(clamp(b,0,1)*255); data[i+3]=255; }

function generateTexture(slot, cfg){
  const size=state.size;
  const canvas=document.createElement('canvas'); canvas.width=size; canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const img=ctx.createImageData(size,size); const data=img.data;
  const strength=clamp(Number(cfg.strength)||1,0,4);
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const u=x/(size-1), v=y/(size-1);
      const n=pattern(u,v,cfg);
      const i=(y*size+x)*4;
      if(slot==='map'){
        const fine=pattern(u*2.7+2.3,v*2.7-1.7,{...cfg,seed:(Number(cfg.seed)||0)+9,detail:(Number(cfg.detail)||3)+1,scale:(Number(cfg.scale)||5)*1.6});
        writeRGB(data,i,n*0.82+fine*0.18,n*0.86+fine*0.14,n*0.94+fine*0.06);
      } else if(slot==='normalMap'){
        const eps=1/size;
        const nx=pattern(u+eps,v,cfg)-pattern(u-eps,v,cfg);
        const ny=pattern(u,v+eps,cfg)-pattern(u,v-eps,cfg);
        const z=Math.max(0.1,1/(1+Math.abs(nx)+Math.abs(ny)));
        writeRGB(data,i,0.5+nx*strength*1.8,0.5+ny*strength*1.8,z);
      } else if(slot==='roughnessMap'){
        const r=clamp(0.12+(1-n)*0.76*strength,0,1); writeRGB(data,i,r,r,r);
      } else if(slot==='metalnessMap'){
        const m=clamp(n>0.58?(n-0.58)*2.38*strength:0,0,1); writeRGB(data,i,m,m,m);
      } else if(slot==='aoMap'){
        const a=clamp(0.45+0.55*(1-n)*strength,0,1); writeRGB(data,i,a,a,a);
      } else if(slot==='emissiveMap'){
        const e=clamp(Math.pow(Math.max(0,n-0.72)*3.57,1.35)*strength,0,1); writeRGB(data,i,e,e*0.78, e*0.55);
      } else if(slot==='displacementMap'){
        writeRGB(data,i,n,n,n);
      } else if(slot==='alphaMap'){
        const a=clamp(Math.pow(n,0.9)*strength,0,1); writeRGB(data,i,a,a,a);
      }
    }
  }
  ctx.putImageData(img,0,0);
  const tex=new THREE.CanvasTexture(canvas);
  tex.wrapS=THREE.RepeatWrapping; tex.wrapT=THREE.RepeatWrapping;
  tex.colorSpace = ['map','emissiveMap'].includes(slot) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.minFilter=THREE.LinearMipmapLinearFilter; tex.magFilter=THREE.LinearFilter; tex.anisotropy=app.renderer?.capabilities?.getMaxAnisotropy?.()||1;
  tex.needsUpdate=true;
  return tex;
}

function getMesh(){ const o=getSelected(); if(!o) return null; if(o.isMesh||o.isSkinnedMesh) return o; let m=null; o.traverse?.(c=>{if(!m&&(c.isMesh||c.isSkinnedMesh))m=c;}); return m; }
function saveMeta(mesh){
  const mat=ensurePhysicalMaterial(mesh); mat.userData=mat.userData||{};
  mat.userData.ncmProceduralPBR={ size:state.size, maps:{} };
  MAPS.forEach(([slot])=>{ if(mat[slot]?.userData?.ncmProceduralPBR) mat.userData.ncmProceduralPBR.maps[slot]=mat[slot].userData.ncmProceduralPBR; });
}

function generate(slot){
  const mesh=getMesh(); if(!mesh) return;
  const mat=ensurePhysicalMaterial(mesh);
  const cfg={...state.mapSettings[slot]};
  const old=mat[slot];
  if(old?.dispose) old.dispose();
  const tex=generateTexture(slot,cfg);
  tex.userData=tex.userData||{};
  tex.userData.ncmProceduralPBR={ generated:true, slot, ...cfg, size:state.size };
  mat[slot]=tex;
  if(slot==='aoMap' && mesh.geometry?.attributes?.uv && !mesh.geometry.attributes.uv2){ mesh.geometry.setAttribute('uv2',new THREE.BufferAttribute(mesh.geometry.attributes.uv.array.slice(),2)); }
  if(slot==='alphaMap') mat.transparent=true;
  mat.needsUpdate=true;
  saveMeta(mesh);
  markSceneDirty();
  sync();
}

function row(label,input){ return `<div class="controlRow"><div class="controlLabel">${label}</div>${input}</div>`; }
function mapCard(slot,label){
  const id='proc-'+slot;
  return `<details class="procPbrMap" data-proc-map="${slot}">
    <summary><span class="procPbrMapName">${label}</span><span class="procPbrStatus" id="${id}-status">—</span></summary>
    <div class="procPbrBody">
      ${row('Escala',`<input type="number" id="${id}-scale" min="0.05" max="40" step="0.05" value="5">`)}
      ${row('Detalhe',`<input type="number" id="${id}-detail" min="1" max="7" step="1" value="3">`)}
      ${row('Seed',`<input type="number" id="${id}-seed" min="0" max="99999" step="1" value="17">`)}
      ${row('Contraste',`<input type="number" id="${id}-contrast" min="0" max="4" step="0.01" value="1">`)}
      ${row('Força',`<input type="number" id="${id}-strength" min="0" max="4" step="0.01" value="1">`)}
      <button type="button" class="uiBtn procGenerateBtn" data-generate-proc="${slot}">Gerar proceduralmente</button>
    </div>
  </details>`;
}

function build(){
  if(!state.root) return;
  state.root.innerHTML=`<div class="procPbrShell">
    <div class="procPbrHint">Mapas PBR gerados por ruído procedural determinístico. Cada mapa é uma textura real aplicada ao material.</div>
    <div class="procPbrMaps">${MAPS.map(([slot,label])=>mapCard(slot,label)).join('')}</div>
  </div>`;
  state.root.querySelectorAll('[data-generate-proc]').forEach(btn=>btn.addEventListener('click',()=>generate(btn.dataset.generateProc)));
  MAPS.forEach(([slot])=>{
    ['scale','detail','seed','contrast','strength'].forEach(k=>{
      const el=state.root.querySelector(`#proc-${slot}-${k}`);
      el?.addEventListener('input',()=>{ state.mapSettings[slot][k]=Number(el.value); });
    });
  });
}
function sync(){
  const mesh=getMesh();
  MAPS.forEach(([slot])=>{
    const has=!!mesh?.material?.[slot];
    const el=state.root?.querySelector(`#proc-${slot}-status`);
    if(el) el.textContent=has?'gerado/aplicado':'vazio';
  });
}
export function getProceduralPBRState(){
  return { size:state.size, maps:JSON.parse(JSON.stringify(state.mapSettings)) };
}
export function applyProceduralPBRState(saved){
  if(!saved||typeof saved!=='object') return;
  state.size=Number(saved.size)||256;
  Object.entries(saved.maps||{}).forEach(([slot,cfg])=>{ if(state.mapSettings[slot]) Object.assign(state.mapSettings[slot],cfg); });
}
export function applyProceduralPBRToMaterial(mesh, meta){
  if(!mesh?.material || !meta?.maps) return;
  const mat=ensurePhysicalMaterial(mesh);
  Object.entries(meta.maps).forEach(([slot,cfg])=>{
    if(!MAPS.some(([id])=>id===slot) || !cfg) return;
    try { const old=mat[slot]; if(old?.dispose) old.dispose(); const tex=generateTexture(slot,cfg); tex.userData=tex.userData||{}; tex.userData.ncmProceduralPBR={generated:true,slot,...cfg,size:Number(meta.size)||256}; mat[slot]=tex; if(slot==='aoMap' && mesh.geometry?.attributes?.uv && !mesh.geometry.attributes.uv2) mesh.geometry.setAttribute('uv2',new THREE.BufferAttribute(mesh.geometry.attributes.uv.array.slice(),2)); if(slot==='alphaMap') mat.transparent=true; } catch(e){ console.warn('[ProceduralPBR] restore map failed',slot,e); }
  });
  mat.needsUpdate=true;
}

export function initProceduralPBRPanel(root){
  if(state.initialized) return; state.initialized=true; state.root=root; if(!root) return; build(); window.addEventListener('scene-selection-changed',sync); sync();
}
export function syncProceduralPBRPanel(){ sync(); }
