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
  wood:{base:'#8b4f2b',variation:.34,grain:4.8,rough:.72,metal:0,bump:.78,warp:2.8},
  oak:{base:'#9a6238',variation:.30,grain:5.2,rough:.70,metal:0,bump:.72,warp:2.5},
  pine:{base:'#d3a86a',variation:.28,grain:6.6,rough:.68,metal:0,bump:.62,warp:2.2},
  bark:{base:'#4f2b18',variation:.48,grain:7.2,rough:.92,metal:0,bump:1.15,warp:4},
  stone:{base:'#77736d',variation:.32,grain:2.1,rough:.86,metal:0,bump:.70,warp:3},
  rock:{base:'#5f5b55',variation:.46,grain:3.5,rough:.89,metal:0,bump:.92,warp:3.2},
  marble:{base:'#cfc8bd',variation:.18,grain:1.2,rough:.34,metal:0,bump:.26,warp:1.6},
  granite:{base:'#5c5a56',variation:.46,grain:5.8,rough:.76,metal:.05,bump:.68,warp:2.4},
  concrete:{base:'#8c8982',variation:.27,grain:3.7,rough:.90,metal:0,bump:.55,warp:3.2},
  brick:{base:'#8d3f28',variation:.38,grain:5,rough:.91,metal:0,bump:.82,warp:3.4},
  metal:{base:'#8c9399',variation:.13,grain:1.1,rough:.20,metal:1,bump:.12,warp:1.2},
  iron:{base:'#656b70',variation:.20,grain:3.0,rough:.42,metal:1,bump:.16,warp:1.5},
  steel:{base:'#a4adb4',variation:.10,grain:1.5,rough:.22,metal:1,bump:.10,warp:1.1},
  gold:{base:'#d6a73a',variation:.16,grain:2.2,rough:.18,metal:1,bump:.10,warp:1.1},
  silver:{base:'#bfc5c9',variation:.12,grain:1.4,rough:.16,metal:1,bump:.08,warp:1.0},
  copper:{base:'#a85f3d',variation:.25,grain:2.8,rough:.30,metal:1,bump:.12,warp:1.2},
  rust:{base:'#7b321b',variation:.52,grain:4.4,rough:.82,metal:.72,bump:.48,warp:2.8},
  glass:{base:'#a8c6d6',variation:.08,grain:1.4,rough:.08,metal:0,bump:.05,warp:1},
  ice:{base:'#b9d9ee',variation:.15,grain:2.2,rough:.12,metal:0,bump:.20,warp:1.8},
  snow:{base:'#e8edf2',variation:.10,grain:4.8,rough:.95,metal:0,bump:.42,warp:3.4},
  sand:{base:'#c9ad78',variation:.34,grain:9.0,rough:.96,metal:0,bump:.58,warp:7},
  dirt:{base:'#5a402b',variation:.48,grain:5.0,rough:.96,metal:0,bump:.75,warp:4},
  mud:{base:'#4a3629',variation:.42,grain:4.0,rough:.88,metal:0,bump:.62,warp:3},
  leather:{base:'#5a2d1d',variation:.24,grain:7.5,rough:.68,metal:0,bump:.55,warp:4},
  fabric:{base:'#77706a',variation:.20,grain:12,rough:.94,metal:0,bump:.42,warp:5},
  rubber:{base:'#25272b',variation:.08,grain:8,rough:.90,metal:0,bump:.30,warp:2.2},
  plastic:{base:'#8ea5bb',variation:.10,grain:3,rough:.28,metal:0,bump:.08,warp:1.6},
  ceramic:{base:'#d5d0c6',variation:.10,grain:2.4,rough:.20,metal:0,bump:.12,warp:1.1},
  clay:{base:'#8d4d36',variation:.32,grain:3.8,rough:.88,metal:0,bump:.62,warp:2.8},
  lava:{base:'#55170f',variation:.56,grain:2.7,rough:.48,metal:0,bump:.65,warp:2.0}
};

const MATERIAL_ALIASES = {
  // Portuguese
  madeira:'wood', arvore:'bark', carvalho:'oak', pinho:'pine', casca:'bark',
  pedra:'stone', rocha:'rock', marmore:'marble', granito:'granite', concreto:'concrete', tijolo:'brick',
  metal:'metal', ferro:'iron', aco:'steel', ouro:'gold', prata:'silver', cobre:'copper',
  ferrugem:'rust', vidro:'glass', gelo:'ice', neve:'snow', areia:'sand', terra:'dirt', lama:'mud',
  couro:'leather', tecido:'fabric', borracha:'rubber', plastico:'plastic', ceramica:'ceramic', argila:'clay', lava:'lava',
  // English
  wood:'wood', tree:'bark', oak:'oak', pine:'pine', bark:'bark', stone:'stone', rock:'rock', marble:'marble', granite:'granite',
  concrete:'concrete', brick:'brick', metal:'metal', iron:'iron', steel:'steel', gold:'gold', silver:'silver', copper:'copper',
  rust:'rust', glass:'glass', ice:'ice', snow:'snow', sand:'sand', dirt:'dirt', mud:'mud', leather:'leather', fabric:'fabric',
  rubber:'rubber', plastic:'plastic', ceramic:'ceramic', clay:'clay', lava:'lava',
  // Spanish
  madera:'wood', arbol:'bark', roble:'oak', pino:'pine', corteza:'bark', piedra:'stone', roca:'rock', marmol:'marble', hormigon:'concrete', ladrillo:'brick',
  hierro:'iron', acero:'steel', oro:'gold', plata:'silver', cobre:'copper', oxido:'rust', vidrio:'glass', hielo:'ice', nieve:'snow', arena:'sand',
  suciedad:'dirt', barro:'mud', cuero:'leather', tela:'fabric', caucho:'rubber', plastico:'plastic', ceramica:'ceramic', arcilla:'clay', lava:'lava',
  // French
  bois:'wood', arbre:'bark', chene:'oak', pin:'pine', pierre:'stone', roche:'rock', marbre:'marble', beton:'concrete', brique:'brick',
  fer:'iron', acier:'steel', or:'gold', argent:'silver', rouille:'rust', verre:'glass', glace:'ice', neige:'snow', sable:'sand', terre:'dirt', boue:'mud',
  cuir:'leather', tissu:'fabric', caoutchouc:'rubber', plastique:'plastic', ceramique:'ceramic', argile:'clay', lave:'lava',
  // German
  holz:'wood', baum:'bark', eiche:'oak', kiefer:'pine', rinde:'bark', stein:'stone', felsen:'rock', marmor:'marble', granit:'granite', beton:'concrete', ziegel:'brick',
  eisen:'iron', stahl:'steel', gold:'gold', silber:'silver', kupfer:'copper', rost:'rust', glas:'glass', eis:'ice', schnee:'snow', sand:'sand', erde:'dirt', schlamm:'mud',
  leder:'leather', stoff:'fabric', gummi:'rubber', kunststoff:'plastic', keramik:'ceramic', ton:'clay', lava:'lava',
  // Japanese common labels
  '木':'wood','木材':'wood','樫':'oak','松':'pine','樹皮':'bark','石':'stone','岩':'rock','大理石':'marble','花崗岩':'granite','コンクリート':'concrete','レンガ':'brick',
  '金属':'metal','鉄':'iron','鋼':'steel','金':'gold','銀':'silver','銅':'copper','錆':'rust','ガラス':'glass','氷':'ice','雪':'snow','砂':'sand','土':'dirt','泥':'mud',
  '革':'leather','布':'fabric','ゴム':'rubber','プラスチック':'plastic','陶器':'ceramic','粘土':'clay','溶岩':'lava'
};
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
function ensurePbrBaseState(mat){
  if(!mat) return;
  mat.userData=mat.userData||{};
  const p=mat.userData.ncmProceduralPBR;
  if(!p?.baseMaterial){
    mat.userData.ncmProceduralPBR={
      ...(p||{}),
      baseMaterial:{
        transparent:!!mat.transparent,
        opacity:typeof mat.opacity==='number'?mat.opacity:1,
        alphaTest:typeof mat.alphaTest==='number'?mat.alphaTest:0,
        depthWrite:typeof mat.depthWrite==='boolean'?mat.depthWrite:true,
        depthTest:typeof mat.depthTest==='boolean'?mat.depthTest:true,
        blending:typeof mat.blending==='number'?mat.blending:THREE.NormalBlending,
        premultipliedAlpha:!!mat.premultipliedAlpha
      }
    };
  }
}

function restorePbrBaseState(mat){
  const base=mat?.userData?.ncmProceduralPBR?.baseMaterial;
  if(!mat||!base) return;
  mat.transparent=!!base.transparent;
  mat.opacity=Number.isFinite(base.opacity)?base.opacity:1;
  mat.alphaTest=Number.isFinite(base.alphaTest)?base.alphaTest:0;
  mat.depthWrite=typeof base.depthWrite==='boolean'?base.depthWrite:true;
  mat.depthTest=typeof base.depthTest==='boolean'?base.depthTest:true;
  if(typeof base.blending==='number') mat.blending=base.blending;
  mat.premultipliedAlpha=!!base.premultipliedAlpha;
}

function saveMeta(mesh){
  const mat=ensurePhysicalMaterial(mesh); mat.userData=mat.userData||{};
  const previous=mat.userData.ncmProceduralPBR||{};
  mat.userData.ncmProceduralPBR={
    size:state.size,
    maps:{},
    baseMaterial:previous.baseMaterial||{
      transparent:!!mat.transparent,
      opacity:typeof mat.opacity==='number'?mat.opacity:1,
      alphaTest:typeof mat.alphaTest==='number'?mat.alphaTest:0,
      depthWrite:typeof mat.depthWrite==='boolean'?mat.depthWrite:true,
      depthTest:typeof mat.depthTest==='boolean'?mat.depthTest:true,
      blending:typeof mat.blending==='number'?mat.blending:THREE.NormalBlending,
      premultipliedAlpha:!!mat.premultipliedAlpha
    }
  };
  MAPS.forEach(([slot])=>{ if(mat[slot]?.userData?.ncmProceduralPBR) mat.userData.ncmProceduralPBR.maps[slot]=mat[slot].userData.ncmProceduralPBR; });
}


function normalizeCommandText(text){
  return String(text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').trim();
}
function resolveProfile(text){
  const raw=String(text||'').trim().toLowerCase();
  const t=normalizeCommandText(raw);
  if(!t || t==='padrao' || t==='default' || t==='standard') return { name:null, profile:null, isDefault:true };
  // Japanese and other Unicode commands are checked before ASCII normalization.
  for(const [alias,canonical] of Object.entries(MATERIAL_ALIASES)){
    if(raw.includes(alias.toLowerCase()) && MATERIAL_PROFILES[canonical]) return { name:canonical, profile:MATERIAL_PROFILES[canonical], isDefault:false };
  }
  const words=t.split(/\s+/).filter(Boolean);
  // Prefer a direct command, then aliases contained in a natural-language prompt.
  for(const token of words){
    const canonical=MATERIAL_PROFILES[token]?token:MATERIAL_ALIASES[token];
    if(canonical && MATERIAL_PROFILES[canonical]) return { name:canonical, profile:MATERIAL_PROFILES[canonical], isDefault:false };
  }
  const pairs=Object.entries(MATERIAL_ALIASES).sort((a,b)=>b[0].length-a[0].length);
  for(const [alias,canonical] of pairs){
    const n=normalizeCommandText(alias);
    if(n && ((' '+t+' ').includes(' '+n+' ') || t===n) && MATERIAL_PROFILES[canonical]) return { name:canonical, profile:MATERIAL_PROFILES[canonical], isDefault:false };
  }
  return { name:null, profile:null, isDefault:false };
}
function applyDescriptionToState(text, targetSlot=null){
  const resolved=resolveProfile(text);
  if(resolved.isDefault){
    // Preserva exatamente os controles atuais:"padrão" significa o gerador original,
    // usando escala/detalhe/seed/contraste/força já definidos no painel.
    if(targetSlot && state.mapSettings[targetSlot]) state.mapSettings[targetSlot].profile=null;
    return {name:'padrão', recognized:false};
  }
  if(!resolved.profile) return {name:null, recognized:false};
  const profile=resolved.profile;
  const textN=normalizeCommandText(text);
  const shiny=/brilhante|glossy|polido|metal|espelh/.test(textN);
  const rough=/fosco|matte|rough|rugoso|seco/.test(textN);
  const warm=/quente|warm|vermelho|red/.test(textN);
  const seed=Math.floor(Math.random()*99999);
  const baseScale=profile.grain || 5;
  const slots=targetSlot && state.mapSettings[targetSlot] ? [targetSlot] : MAPS.map(([slot])=>slot);
  for(const slot of slots){
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
  ensurePbrBaseState(mat);
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
  restorePbrBaseState(mat);
  if(mat.userData) delete mat.userData.ncmProceduralPBR;
  mat.needsUpdate=true;
  markSceneDirty();
  sync();
}

function generateDescription(text, targetSlot){
  const mesh=getMesh(); if(!mesh || !targetSlot) return;
  const result=applyDescriptionToState(text, targetSlot);
  if(!result.recognized && result.name!== 'padrão') { console.warn('[NCM PBR] Material prompt não reconhecido:', text); return; }
  ['scale','detail','seed','contrast','strength'].forEach(k=>{
    const el=state.root?.querySelector(`#proc-${targetSlot}-${k}`);
    if(el) el.value=state.mapSettings[targetSlot][k];
  });
  // Generate ONLY the map whose button opened the prompt. Other PBR maps are untouched.
  generate(targetSlot,{silent:true});
  saveMeta(mesh);
  markSceneDirty();
  sync();
}

function openPbrPrompt(targetSlot){
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
  const run=()=>{ const text=input.value.trim() || 'padrão'; generateDescription(text,targetSlot); close(); };
  modal.querySelector('.pbrPromptGenerate').addEventListener('click',run); input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run();} if(e.key==='Escape'){e.preventDefault();close();}}); requestAnimationFrame(()=>input.focus());
}

function generate(slot, opts={}){
  const mesh=getMesh(); if(!mesh) return;
  const mat=ensurePhysicalMaterial(mesh);
  ensurePbrBaseState(mat);
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
  // A procedural alpha map must not unexpectedly turn the whole material transparent.
  // Transparency is restored/controlled by the material's own alpha settings.
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
  state.root.querySelectorAll('[data-generate-proc]').forEach(btn=>btn.addEventListener('click',()=>openPbrPrompt(btn.dataset.generateProc)));
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
  if(meta.baseMaterial && !mat.userData?.ncmProceduralPBR?.baseMaterial){
    mat.userData=mat.userData||{};
    mat.userData.ncmProceduralPBR={...(mat.userData.ncmProceduralPBR||{}),baseMaterial:{...meta.baseMaterial}};
  }
  ensurePbrBaseState(mat);
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
      // Do not enable transparency merely because an alpha texture exists.
    } catch(e){ console.warn('[ProceduralPBR] restore map failed',slot,e); }
  });
  if('displacementScale' in mat) mat.displacementScale=0;
  // Projects created by the old all-maps generator may contain an alpha map
  // without the original material alpha state. Treat those legacy materials as opaque.
  if(!meta.baseMaterial){
    mat.transparent=false;
    mat.opacity=1;
    mat.alphaTest=0;
  }
  mat.needsUpdate=true;
}

export function initProceduralPBRPanel(root){
  if(state.initialized) return; state.initialized=true; state.root=root; if(!root) return; build(); window.addEventListener('scene-selection-changed',sync); sync();
}
export function syncProceduralPBRPanel(){ sync(); }
