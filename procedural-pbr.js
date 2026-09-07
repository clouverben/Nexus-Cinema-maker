import * as THREE from 'three';
import { app, getSelected, ensurePhysicalMaterial, markSceneDirty } from './scene.js';

const MAPS = [
  ['map','Albedo'],
  ['normalMap','Normal'],
  ['roughnessMap','Roughness'],
  ['metalnessMap','Metalness'],
  ['aoMap','AO'],
  ['emissiveMap','Emissive'],
  ['bumpMap','Height'],
  ['alphaMap','Alpha']
];


// Perfil procedural orientado a descrição. Há 30 materiais/"comandos" base
// reconhecidos pelo gerador local, sem depender de uma API externa.
const MATERIAL_PROFILES = {
  madeira:{base:'#8b4f2b', variation:.34, grain:4.8, rough:.72, metal:0, bump:.78, warp:2.8},
  arvore:{base:'#70401f', variation:.42, grain:5.4, rough:.82, metal:0, bump:.95, warp:3.5},
  carvalho:{base:'#9a6238', variation:.3, grain:5.2, rough:.7, metal:0, bump:.72, warp:2.5},
  pinho:{base:'#d3a86a', variation:.28, grain:6.6, rough:.68, metal:0, bump:.62, warp:2.2},
  bark:{base:'#4f2b18', variation:.48, grain:7.2, rough:.92, metal:0, bump:1.15, warp:4},
  stone:{base:'#77736d', variation:.32, grain:2.1, rough:.86, metal:0, bump:.7, warp:3},
  marble:{base:'#cfc8bd', variation:.18, grain:1.2, rough:.34, metal:0, bump:.26, warp:1.6},
  granite:{base:'#5c5a56', variation:.46, grain:5.8, rough:.76, metal:.05, bump:.68, warp:2.4},
  concrete:{base:'#8c8982', variation:.27, grain:3.7, rough:.9, metal:0, bump:.55, warp:3.2},
  metal:{base:'#8c9399', variation:.13, grain:1.1, rough:.2, metal:1, bump:.12, warp:1.2},
  ferro:{base:'#6b7277', variation:.2, grain:3.2, rough:.34, metal:1, bump:.16, warp:1.4},
  ouro:{base:'#d6a73a', variation:.16, grain:2.2, rough:.18, metal:1, bump:.1, warp:1.1},
  cobre:{base:'#a85f3d', variation:.25, grain:2.8, rough:.3, metal:1, bump:.12, warp:1.2},
  copper:{base:'#a85f3d', variation:.25, grain:2.8, rough:.3, metal:1, bump:.12, warp:1.2},
  ferrugem:{base:'#7b321b', variation:.52, grain:4.4, rough:.82, metal:.72, bump:.48, warp:2.8},
  rust:{base:'#7b321b', variation:.52, grain:4.4, rough:.82, metal:.72, bump:.48, warp:2.8},
  tecido:{base:'#77706a', variation:.2, grain:12, rough:.94, metal:0, bump:.42, warp:5},
  fabric:{base:'#77706a', variation:.2, grain:12, rough:.94, metal:0, bump:.42, warp:5},
  couro:{base:'#5a2d1d', variation:.24, grain:7.5, rough:.68, metal:0, bump:.55, warp:4},
  leather:{base:'#5a2d1d', variation:.24, grain:7.5, rough:.68, metal:0, bump:.55, warp:4},
  plastico:{base:'#8ea5bb', variation:.1, grain:3, rough:.28, metal:0, bump:.08, warp:1.6},
  plastic:{base:'#8ea5bb', variation:.1, grain:3, rough:.28, metal:0, bump:.08, warp:1.6},
  borracha:{base:'#25272b', variation:.08, grain:8, rough:.9, metal:0, bump:.3, warp:2.2},
  rubber:{base:'#25272b', variation:.08, grain:8, rough:.9, metal:0, bump:.3, warp:2.2},
  ceramica:{base:'#d5d0c6', variation:.1, grain:2.4, rough:.2, metal:0, bump:.12, warp:1.1},
  ceramic:{base:'#d5d0c6', variation:.1, grain:2.4, rough:.2, metal:0, bump:.12, warp:1.1},
  argila:{base:'#8d4d36', variation:.32, grain:3.8, rough:.88, metal:0, bump:.62, warp:2.8},
  clay:{base:'#8d4d36', variation:.32, grain:3.8, rough:.88, metal:0, bump:.62, warp:2.8},
  tijolo:{base:'#8d3f28', variation:.38, grain:5, rough:.91, metal:0, bump:.82, warp:3.4},
  brick:{base:'#8d3f28', variation:.38, grain:5, rough:.91, metal:0, bump:.82, warp:3.4}
};

const MATERIAL_ALIASES = { wood:'madeira', tree:'arvore', madeira:'madeira', pedra:'stone', gold:'ouro', treebark:'bark' };
const COMMAND_COUNT = 30;

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
  const profile=MATERIAL_PROFILES[cfg.profile] || null;
  const grain=profile?.grain||1;
  const warp=profile?.warp||1;
  const gx=x*grain + Math.sin((y*warp + seed)*6.283)*0.035;
  const gy=y*warp + Math.sin((x*grain + seed*0.17)*4.7)*0.035;
  const n=fbm(gx,gy,s,d,seed);
  const n2=fbm(gx*0.35+13.1,gy*0.35-7.4,s*0.8,d,seed+71);
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
  const profile=MATERIAL_PROFILES[cfg.profile] || MATERIAL_PROFILES.madeira;
  const [br,bg,bb]=hexToRgb(profile.base);
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const u=x/(size-1), v=y/(size-1);
      const n=pattern(u,v,cfg);
      const i=(y*size+x)*4;
      if(slot==='map'){
        const fine=pattern(u*2.7+2.3,v*2.7-1.7,{...cfg,seed:(Number(cfg.seed)||0)+9,detail:(Number(cfg.detail)||3)+1,scale:(Number(cfg.scale)||5)*1.6});
        const vcol=clamp((n-.5)*(profile.variation||.2)*2 + (fine-.5)*.08, -.5, .5);
        writeRGB(data,i,br+vcol,bg+vcol*.8,bb+vcol*.55);
      } else if(slot==='normalMap'){
        const eps=1/size;
        const nx=pattern(u+eps,v,cfg)-pattern(u-eps,v,cfg);
        const ny=pattern(u,v+eps,cfg)-pattern(u,v-eps,cfg);
        const z=Math.max(0.1,1/(1+Math.abs(nx)+Math.abs(ny)));
        writeRGB(data,i,0.5+nx*strength*1.8,0.5+ny*strength*1.8,z);
      } else if(slot==='roughnessMap'){
        const r=clamp((profile.rough??.55)+(n-.5)*0.35*strength,0,1); writeRGB(data,i,r,r,r);
      } else if(slot==='metalnessMap'){
        const m=clamp((profile.metal||0) + (n-.5)*0.12*strength,0,1); writeRGB(data,i,m,m,m);
      } else if(slot==='aoMap'){
        const a=clamp(0.88-(n*0.35)*(profile.bump||.5)*strength,0,1); writeRGB(data,i,a,a,a);
      } else if(slot==='emissiveMap'){
        const e=clamp(Math.pow(Math.max(0,n-0.76)*4.2,1.35)*strength*0.5,0,1); writeRGB(data,i,e,e*0.78, e*0.55);
      } else if(slot==='bumpMap'){
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


function normalizeCommandText(text){
  return String(text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').trim();
}
function resolveProfile(text){
  const t=normalizeCommandText(text);
  if(!t || t==='padrao' || t==='default') return { name:null, profile:null, isDefault:true };
  const words=t.split(/\s+/);
  let name=null;
  for(const word of words){ const candidate=MATERIAL_PROFILES[word]?word:MATERIAL_ALIASES[word]; if(candidate && MATERIAL_PROFILES[candidate]){ name=candidate; break; } }
  return { name, profile:name?MATERIAL_PROFILES[name]:null, isDefault:false };
}
function applyDescriptionToState(text){
  const resolved=resolveProfile(text);
  if(resolved.isDefault){
    // Preserva exatamente os controles atuais:"padrão" significa o gerador original,
    // usando escala/detalhe/seed/contraste/força já definidos no painel.
    MAPS.forEach(([slot])=>{ state.mapSettings[slot].profile=null; });
    return {name:'padrão', recognized:false};
  }
  const profile=resolved.profile || MATERIAL_PROFILES.plastico;
  const textN=normalizeCommandText(text);
  const shiny=/brilhante|glossy|polido|metal|espelh/.test(textN);
  const rough=/fosco|matte|rough|rugoso|seco/.test(textN);
  const warm=/quente|warm|vermelho|red/.test(textN);
  const seed=Math.floor(Math.random()*99999);
  const baseScale=profile.grain || 5;
  for(const [slot] of MAPS){
    const cfg=state.mapSettings[slot];
    cfg.scale=baseScale;
    cfg.detail=slot==='normalMap'||slot==='bumpMap'?5:4;
    cfg.seed=seed;
    cfg.contrast=1.05 + profile.variation*.65;
    cfg.strength=slot==='normalMap'?profile.bump*1.7:1;
    cfg.profile=resolved.name || 'plastico';
    if(slot==='roughnessMap' && shiny) cfg.strength=.55;
    if(slot==='roughnessMap' && rough) cfg.strength=1.15;
    if(slot==='metalnessMap') cfg.strength=1;
    if(warm) cfg.seed += 211;
  }
  return {name:resolved.name || 'material', recognized:!!resolved.name};
}
function removeProceduralPBR(){
  const mesh=getMesh(); if(!mesh) return;
  const mat=ensurePhysicalMaterial(mesh);
  // Remove current procedural maps plus legacy procedural displacement maps.
  for(const [slot] of MAPS){
    const tex=mat[slot];
    if(tex?.userData?.ncmProceduralPBR?.generated){ tex.dispose?.(); mat[slot]=null; }
  }
  if(mat.displacementMap?.userData?.ncmProceduralPBR?.generated){
    mat.displacementMap.dispose?.();
    mat.displacementMap=null;
  }
  // Procedural Height must never deform mesh topology. Use bump mapping only.
  if('displacementScale' in mat) mat.displacementScale=0;
  if(mat.userData) delete mat.userData.ncmProceduralPBR;
  mat.needsUpdate=true;
  markSceneDirty();
  sync();
}

function generateDescription(text){
  const mesh=getMesh(); if(!mesh) return;
  applyDescriptionToState(text);
  MAPS.forEach(([slot])=>{
    ['scale','detail','seed','contrast','strength'].forEach(k=>{ const el=state.root?.querySelector(`#proc-${slot}-${k}`); if(el) el.value=state.mapSettings[slot][k]; });
  });
  MAPS.forEach(([slot])=>generate(slot,{silent:true}));
  saveMeta(mesh);
  markSceneDirty();
  sync();
}

function openPbrPrompt(){
  if(document.getElementById('pbrPromptModal')) return;
  const backdrop=document.createElement('div'); backdrop.id='pbrPromptBackdrop'; backdrop.className='pbrPromptBackdrop';
  const modal=document.createElement('div'); modal.id='pbrPromptModal'; modal.className='pbrPromptModal'; modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
  modal.innerHTML=`
    <div class="pbrPromptKicker">NEXUS ENGINE</div>
    <div class="pbrPromptHeader"><div><div class="pbrPromptTitle">Gerar Procedural PBR</div><div class="pbrPromptSubtitle">Descreva o material que deseja gerar. Ex.: <b>wood</b>, <b>ouro</b>, <b>concreto</b>.</div></div><button class="pbrPromptClose" type="button" aria-label="Cancelar">×</button></div>
    <label class="pbrPromptLabel" for="pbrPromptInput">Descrição do material</label>
    <input id="pbrPromptInput" class="pbrPromptInput" type="text" maxlength="120" autocomplete="off" spellcheck="false" placeholder="Ex.: wood, madeira envelhecida, brilhante">
    <div class="pbrPromptHint">“padrão” restaura o gerador procedural original. Comandos reconhecidos: ${COMMAND_COUNT} perfis.</div>
    <div class="pbrPromptActions"><button class="pbrPromptBtn pbrPromptCancel" type="button">Cancelar</button><button class="pbrPromptBtn pbrPromptGenerate" type="button">Gerar PBR</button></div>`;
  document.body.appendChild(backdrop); document.body.appendChild(modal);
  const close=()=>{backdrop.remove(); modal.remove();};
  backdrop.addEventListener('click',close); modal.querySelector('.pbrPromptClose').addEventListener('click',close); modal.querySelector('.pbrPromptCancel').addEventListener('click',close);
  const input=modal.querySelector('#pbrPromptInput');
  const run=()=>{ const text=input.value.trim() || 'padrão'; generateDescription(text); close(); };
  modal.querySelector('.pbrPromptGenerate').addEventListener('click',run); input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run();} if(e.key==='Escape'){e.preventDefault();close();}}); requestAnimationFrame(()=>input.focus());
}

function generate(slot, opts={}){
  const mesh=getMesh(); if(!mesh) return;
  const mat=ensurePhysicalMaterial(mesh);
  const cfg={...state.mapSettings[slot]};
  const old=mat[slot];
  if(old?.dispose) old.dispose();
  const tex=generateTexture(slot,cfg);
  tex.userData=tex.userData||{};
  tex.userData.ncmProceduralPBR={ generated:true, slot, ...cfg, size:state.size };
  // Height is deliberately implemented as bump mapping. displacementMap changes
  // vertex positions and was the cause of severe Torus Knot deformation.
  if(slot==='bumpMap'){
    mat.bumpMap=tex;
    mat.bumpScale=clamp(Number(cfg.strength)||1,0,4)*0.18;
    if(mat.displacementMap?.userData?.ncmProceduralPBR?.generated){ mat.displacementMap.dispose?.(); mat.displacementMap=null; }
    if('displacementScale' in mat) mat.displacementScale=0;
  } else {
    mat[slot]=tex;
  }
  if(slot==='aoMap' && mesh.geometry?.attributes?.uv && !mesh.geometry.attributes.uv2){ mesh.geometry.setAttribute('uv2',new THREE.BufferAttribute(mesh.geometry.attributes.uv.array.slice(),2)); }
  if(slot==='alphaMap') mat.transparent=true;
  mat.needsUpdate=true;
  saveMeta(mesh);
  markSceneDirty();
  if(!opts.silent) sync();
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
      <div class="procActionRow"><button type="button" class="uiBtn procGenerateBtn" data-generate-proc="${slot}">Gerar</button><button type="button" class="uiBtn procRemoveBtn" data-remove-proc="${slot}">Remover PBR</button></div>
    </div>
  </details>`;
}

function build(){
  if(!state.root) return;
  state.root.innerHTML=`<div class="procPbrShell">
    <div class="procPbrHint">Mapas PBR gerados por ruído procedural determinístico. Cada mapa é uma textura real aplicada ao material.</div>
    <div class="procPbrMaps">${MAPS.map(([slot,label])=>mapCard(slot,label)).join('')}</div>
  </div>`;
  state.root.querySelectorAll('[data-generate-proc]').forEach(btn=>btn.addEventListener('click',()=>openPbrPrompt()));
  state.root.querySelectorAll('[data-remove-proc]').forEach(btn=>btn.addEventListener('click',()=>removeProceduralPBR()));
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
  Object.entries(meta.maps).forEach(([rawSlot,cfg])=>{
    const slot = rawSlot === 'displacementMap' ? 'bumpMap' : rawSlot;
    if(!MAPS.some(([id])=>id===slot) || !cfg) return;
    try {
      const old=mat[slot]; if(old?.dispose) old.dispose();
      if(slot==='bumpMap' && mat.displacementMap?.dispose) mat.displacementMap.dispose();
      const tex=generateTexture(slot,cfg);
      tex.userData=tex.userData||{};
      tex.userData.ncmProceduralPBR={generated:true,slot,...cfg,size:Number(meta.size)||256};
      if(slot==='bumpMap'){
        mat.bumpMap=tex;
        mat.bumpScale=clamp(Number(cfg.strength)||1,0,4)*0.18;
        if('displacementScale' in mat) mat.displacementScale=0;
      } else mat[slot]=tex;
      if(slot==='aoMap' && mesh.geometry?.attributes?.uv && !mesh.geometry.attributes.uv2) mesh.geometry.setAttribute('uv2',new THREE.BufferAttribute(mesh.geometry.attributes.uv.array.slice(),2));
      if(slot==='alphaMap') mat.transparent=true;
    } catch(e){ console.warn('[ProceduralPBR] restore map failed',slot,e); }
  });
  if('displacementScale' in mat) mat.displacementScale=0;
  mat.needsUpdate=true;
}

export function initProceduralPBRPanel(root){
  if(state.initialized) return; state.initialized=true; state.root=root; if(!root) return; build(); window.addEventListener('scene-selection-changed',sync); sync();
}
export function syncProceduralPBRPanel(){ sync(); }
