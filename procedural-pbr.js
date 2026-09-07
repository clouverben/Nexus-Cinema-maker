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
const DEFAULT_PROFILE = {base:'#8ea5bb',variation:.20,grain:1,rough:.55,metal:0,bump:.5,warp:1};
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
MAPS.forEach(([slot]) => state.mapSettings[slot] = { scale:5, detail:3, seed:17, contrast:1, strength:1, profile:null, blend:null, appearance:null });

const labState = {
  previewEnabled: true,
  sharedSeed: 17,
  lockSeed: true,
  materialA: 'wood',
  materialB: 'rust',
  mix: 0,
  maskScale: 3,
  maskDetail: 3,
  maskContrast: 1
};

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
  const scaleValue=Number(cfg.scale);
  const s=Math.max(0.05,Number.isFinite(scaleValue)?scaleValue:5);
  const detailValue=Number(cfg.detail);
  const d=Number.isFinite(detailValue)?detailValue:3;
  const seedValue=Number(cfg.seed);
  const seed=Number.isFinite(seedValue)?seedValue:0;
  const blend=cfg.blend && cfg.blend.a ? cfg.blend : null;
  const pa=MATERIAL_PROFILES[blend?.a || cfg.profile] || DEFAULT_PROFILE;
  const pb=MATERIAL_PROFILES[blend?.b] || pa;
  const mix=blend ? clamp(Number(blend.mix ?? 0),0,1) : 0;
  const grain=THREE.MathUtils.lerp(pa.grain||1,pb.grain||1,mix);
  const warp=THREE.MathUtils.lerp(pa.warp||1,pb.warp||1,mix);
  const gx=x*grain + Math.sin((y*warp + seed)*6.283)*0.035;
  const gy=y*warp + Math.sin((x*grain + seed*0.17)*4.7)*0.035;
  const n=fbm(gx,gy,s,d,seed);
  const n2=fbm(gx*0.35+13.1,gy*0.35-7.4,s*0.8,d,seed+71);
  return clamp((n*0.72+n2*0.28-0.5)*(Number.isFinite(Number(cfg.contrast))?Number(cfg.contrast):1)+0.5,0,1);
}
function hexToRgb(hex){ const c=new THREE.Color(hex||'#ffffff'); return [c.r,c.g,c.b]; }
function writeRGB(data,i,r,g,b){ data[i]=Math.round(clamp(r,0,1)*255); data[i+1]=Math.round(clamp(g,0,1)*255); data[i+2]=Math.round(clamp(b,0,1)*255); data[i+3]=255; }

function resolveMaterialDescription(text){
  const raw=String(text||'').trim();
  const resolved=resolveProfile(raw);
  const pairs=[...raw.matchAll(/(\d+(?:\.\d+)?)\s*%?\s*([\p{L}\p{N}_-]+)/gu)];
  const names=[];
  for(const m of pairs){
    const r=resolveProfile(m[2]); if(r.profile) names.push({name:r.name,weight:Math.max(0,Number(m[1]))});
  }
  const plus=[...raw.split(/\s*(?:\+|\band\b|\be\b)\s*/i)].map(v=>v.trim()).filter(Boolean);
  const plusResolved=plus.map(v=>resolveProfile(v)).filter(v=>v.profile);
  let a=resolved.name, b=null, mix=0;
  if(names.length>=2){ a=names[0].name; b=names[1].name; const wa=names[0].weight, wb=names[1].weight; mix=(wa+wb)>0 ? wb/(wa+wb) : .5; }
  else if(plusResolved.length>=2){ a=plusResolved[0].name; b=plusResolved[1].name; mix=.5; }
  if(!a) return {recognized:false};
  const appearance=[];
  const lower=raw.toLowerCase();
  if(/\b(dark|escuro|scuro|sombre|dunkel|暗)\b/.test(lower)) appearance.push('dark');
  if(/\b(light|claro|clair|hell|明)\b/.test(lower)) appearance.push('light');
  if(/\b(wet|molhado|mouille|nass|molhado)\b/.test(lower)) appearance.push('wet');
  if(/\b(polished|polido|brilhante|poli|brillant|poliert)\b/.test(lower)) appearance.push('polished');
  if(/\b(rough|áspero|aspero|rugueux|rau)\b/.test(lower)) appearance.push('rough');
  if(/\b(old|velho|envelhecido|vieux|alt)\b/.test(lower)) appearance.push('old');
  if(/\b(dirty|sujo|sale|schmutzig)\b/.test(lower)) appearance.push('dirty');
  return {recognized:true,name:a,b,mix,appearance};
}

function sampleColorProfile(cfg){
  const blend=cfg.blend && cfg.blend.a ? cfg.blend : null;
  const a=MATERIAL_PROFILES[blend?.a || cfg.profile] || DEFAULT_PROFILE;
  const b=MATERIAL_PROFILES[blend?.b] || a;
  const mix=blend ? clamp(Number(blend.mix ?? 0),0,1) : 0;
  const ca=new THREE.Color(a.base), cb=new THREE.Color(b.base);
  const c=ca.clone().lerp(cb,mix);
  const variation=THREE.MathUtils.lerp(a.variation??.2,b.variation??.2,mix);
  const rough=THREE.MathUtils.lerp(a.rough??.55,b.rough??.55,mix);
  const metal=THREE.MathUtils.lerp(a.metal??0,b.metal??0,mix);
  const bump=THREE.MathUtils.lerp(a.bump??.5,b.bump??.5,mix);
  return {base:[c.r,c.g,c.b],variation,rough,metal,bump};
}

function maskValue(u,v,cfg){
  const c=cfg.blendMask || {};
  const sc=Math.max(.05,Number(c.scale)||labState.maskScale);
  const detail=Number.isFinite(Number(c.detail))?Number(c.detail):labState.maskDetail;
  const seed=Number.isFinite(Number(cfg.seed))?Number(cfg.seed):0;
  const n=fbm(u,v,sc,detail,seed+173.77);
  const contrast=Math.max(0,Number(c.contrast)||labState.maskContrast);
  return clamp((n-.5)*contrast+.5,0,1);
}

function applyAppearance(rgb, appearance){
  let [r,g,b]=rgb;
  for(const a of appearance||[]) {
    if(a==='dark'){ r*=.62; g*=.62; b*=.62; }
    else if(a==='light'){ r=clamp(r*1.25,0,1); g=clamp(g*1.25,0,1); b=clamp(b*1.25,0,1); }
    else if(a==='wet'||a==='polished'){ r=Math.min(1,r*1.03); g=Math.min(1,g*1.03); b=Math.min(1,b*1.03); }
    else if(a==='old'||a==='dirty'){ r*=.82; g*=.82; b*=.78; }
    else if(a==='rough'){ r*=.97; g*=.97; b*=.97; }
  }
  return [r,g,b];
}

function generateTexture(slot, cfg){
  const size=state.size;
  const canvas=document.createElement('canvas'); canvas.width=size; canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const img=ctx.createImageData(size,size); const data=img.data;
  const strengthValue=Number(cfg.strength);
  const strength=clamp(Number.isFinite(strengthValue)?strengthValue:1,0,4);
  const profile=sampleColorProfile(cfg);
  let [br,bg,bb]=profile.base;
  const appearance=cfg.appearance || [];
  [br,bg,bb]=applyAppearance([br,bg,bb],appearance);
  const blend=cfg.blend && cfg.blend.a ? cfg.blend : null;
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const u=x/(size-1), v=y/(size-1);
      const n=pattern(u,v,cfg);
      const i=(y*size+x)*4;
      if(slot==='map'){
        const fine=pattern(u*2.7+2.3,v*2.7-1.7,{...cfg,seed:(Number(cfg.seed)||0)+9,detail:(Number(cfg.detail)||3)+1,scale:(Number(cfg.scale)||5)*1.6});
        const blendMask=blend ? maskValue(u,v,cfg) : 0;
        const vcol=clamp((n-.5)*(profile.variation||.2)*2 + (fine-.5)*.08, -.5, .5);
        if(blend){
          const p2=MATERIAL_PROFILES[blend.b] || DEFAULT_PROFILE;
          const c2=applyAppearance(hexToRgb(p2.base),appearance);
          const mix=clamp(blendMask*(Number(blend.mix ?? 0)),0,1);
          const rr=THREE.MathUtils.lerp(br,c2[0],mix)+vcol;
          const gg=THREE.MathUtils.lerp(bg,c2[1],mix)+vcol*.8;
          const bb2=THREE.MathUtils.lerp(bb,c2[2],mix)+vcol*.55;
          writeRGB(data,i,rr,gg,bb2); continue;
        }
        writeRGB(data,i,br+vcol,bg+vcol*.8,bb+vcol*.55);
      } else if(slot==='normalMap'){
        const eps=1/size;
        const nx=pattern(u+eps,v,cfg)-pattern(u-eps,v,cfg);
        const ny=pattern(u,v+eps,cfg)-pattern(u,v-eps,cfg);
        const z=Math.max(0.1,1/(1+Math.abs(nx)+Math.abs(ny)));
        writeRGB(data,i,0.5+nx*strength*1.8,0.5+ny*strength*1.8,z);
      } else if(slot==='roughnessMap'){
        let r=clamp((profile.rough??.55)+(n-.5)*0.35*strength,0,1);
        if(blend){ const p2=MATERIAL_PROFILES[blend.b]||DEFAULT_PROFILE; const m=maskValue(u,v,cfg)*Number(blend.mix||0); r=THREE.MathUtils.lerp(r,clamp((p2.rough??.55)+(n-.5)*0.35*strength,0,1),m); }
        writeRGB(data,i,r,r,r);
      } else if(slot==='metalnessMap'){
        let m=clamp((profile.metal||0) + (n-.5)*0.12*strength,0,1);
        if(blend){ const p2=MATERIAL_PROFILES[blend.b]||DEFAULT_PROFILE; m=THREE.MathUtils.lerp(m,p2.metal||0,maskValue(u,v,cfg)*Number(blend.mix||0)); }
        writeRGB(data,i,m,m,m);
      } else if(slot==='aoMap'){
        let a=clamp(0.88-(n*0.35)*(profile.bump||.5)*strength,0,1);
        if(blend){ const p2=MATERIAL_PROFILES[blend.b]||DEFAULT_PROFILE; const bbv=clamp(0.88-(n*0.35)*(p2.bump||.5)*strength,0,1); a=THREE.MathUtils.lerp(a,bbv,maskValue(u,v,cfg)*Number(blend.mix||0)); }
        writeRGB(data,i,a,a,a);
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
  const raw=String(text||'').trim();
  if(!raw || /^(padrao|padrão|default|standard)$/i.test(raw)){
    if(targetSlot && state.mapSettings[targetSlot]) { state.mapSettings[targetSlot].profile=null; state.mapSettings[targetSlot].blend=null; state.mapSettings[targetSlot].appearance=null; }
    return {name:'padrão',recognized:false};
  }
  const resolved=resolveMaterialDescription(raw);
  if(!resolved.recognized) return {name:null,recognized:false};
  const slots=targetSlot && state.mapSettings[targetSlot] ? [targetSlot] : MAPS.map(([slot])=>slot);
  for(const slot of slots){
    const cfg=state.mapSettings[slot];
    cfg.profile=resolved.name;
    cfg.blend=resolved.b ? {a:resolved.name,b:resolved.b,mix:resolved.mix} : null;
    cfg.appearance=resolved.appearance?.length ? [...resolved.appearance] : null;
    cfg.blendMask={scale:labState.maskScale,detail:labState.maskDetail,contrast:labState.maskContrast};
    if(labState.lockSeed) cfg.seed=labState.sharedSeed;
  }
  return {name:resolved.b ? `${resolved.name} + ${resolved.b}` : resolved.name,recognized:true};
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

function openPbrPrompt(targetSlot,mode='map'){
  if(document.getElementById('pbrPromptModal')) return;
  const backdrop=document.createElement('div'); backdrop.id='pbrPromptBackdrop'; backdrop.className='pbrPromptBackdrop';
  const modal=document.createElement('div'); modal.id='pbrPromptModal'; modal.className='pbrPromptModal'; modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
  const title=mode==='blend'?'Misturar materiais':mode==='describe'?'Descrever material':'Gerar Procedural PBR';
  const placeholder=mode==='blend'?'Ex.: 70% concrete + 30% rust':mode==='describe'?'Ex.: dark old oak wood, polished metal':'Ex.: wood, madeira envelhecida, brilhante';
  modal.innerHTML=`
    <div class="pbrPromptKicker">NEXUS ENGINE</div>
    <div class="pbrPromptHeader"><div><div class="pbrPromptTitle">${title}</div><div class="pbrPromptSubtitle">Use linguagem natural. A descrição escolhe o perfil; Scale, Detail, Seed, Contrast e Strength permanecem manuais.</div></div><button class="pbrPromptClose" type="button" aria-label="Cancelar">×</button></div>
    <label class="pbrPromptLabel" for="pbrPromptInput">Descrição do material</label>
    <input id="pbrPromptInput" class="pbrPromptInput" type="text" maxlength="160" autocomplete="off" spellcheck="false" placeholder="${placeholder}">
    <div class="pbrPromptHint">Misturas aceitam percentuais (ex.: 70% madeira + 30% ferrugem). A máscara procedural usa os controles de máscara do Material Lab.</div>
    <div class="pbrPromptActions"><button class="pbrPromptBtn pbrPromptCancel" type="button">Cancelar</button><button class="pbrPromptBtn pbrPromptGenerate" type="button">Aplicar</button></div>`;
  document.body.appendChild(backdrop); document.body.appendChild(modal);
  const close=()=>{backdrop.remove(); modal.remove();};
  backdrop.addEventListener('click',close); modal.querySelector('.pbrPromptClose').addEventListener('click',close); modal.querySelector('.pbrPromptCancel').addEventListener('click',close);
  const input=modal.querySelector('#pbrPromptInput');
  const run=()=>{ const text=input.value.trim() || 'padrão'; if(mode==='blend' && !/[%+]|\band\b|\be\b/i.test(text)) { console.warn('[NCM PBR] Blend precisa de dois materiais.'); return; } generateDescription(text,targetSlot); close(); };
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
    <div class="procPbrHint">Gerador PBR procedural determinístico. O perfil define o material; os controles abaixo continuam sob seu controle.</div>
    <div class="procPbrLab">
      <div class="procLabHeader"><div><div class="procLabTitle">Material Lab</div><div class="procLabSub">Preview 3D + descrição natural + mistura procedural</div></div><label class="procLabToggle"><span>Preview</span><input id="procLabPreview" type="checkbox" checked></label></div>
      <canvas id="procPbrPreview" class="procPbrPreview" width="480" height="260"></canvas>
      <div class="procLabGrid">
        ${row('Seed global',`<input type="number" id="procSharedSeed" min="0" max="99999" step="1" value="17">`)}
        <label class="procLabCheck"><span>Usar o mesmo Seed em todos os mapas</span><input id="procLockSeed" type="checkbox" checked></label>
        ${row('Máscara · Escala',`<input type="number" id="procMaskScale" min="0.05" max="30" step="0.05" value="3">`)}
        ${row('Máscara · Detalhe',`<input type="number" id="procMaskDetail" min="1" max="7" step="1" value="3">`)}
        ${row('Máscara · Contraste',`<input type="number" id="procMaskContrast" min="0" max="4" step="0.01" value="1">`)}
      </div>
      <div class="procLabActions"><button type="button" class="uiBtn procDescribeBtn">Descrever material</button><button type="button" class="uiBtn procBlendBtn">Misturar materiais</button><button type="button" class="uiBtn procGeneratePreviewBtn">Atualizar preview</button></div>
    </div>
    <div class="procPbrMaps">${MAPS.map(([slot,label])=>mapCard(slot,label)).join('')}</div>
  </div>`;
  const updateLab=()=>{
    labState.previewEnabled=!!state.root.querySelector('#procLabPreview')?.checked;
    labState.sharedSeed=Number(state.root.querySelector('#procSharedSeed')?.value)||0;
    labState.lockSeed=!!state.root.querySelector('#procLockSeed')?.checked;
    labState.maskScale=Number(state.root.querySelector('#procMaskScale')?.value)||3;
    labState.maskDetail=Number(state.root.querySelector('#procMaskDetail')?.value)||3;
    labState.maskContrast=Number(state.root.querySelector('#procMaskContrast')?.value)||1;
    if(labState.lockSeed) MAPS.forEach(([slot])=>state.mapSettings[slot].seed=labState.sharedSeed);
    updatePreview();
  };
  ['procLabPreview','procSharedSeed','procLockSeed','procMaskScale','procMaskDetail','procMaskContrast'].forEach(id=>state.root.querySelector('#'+id)?.addEventListener('input',updateLab));
  state.root.querySelector('.procDescribeBtn')?.addEventListener('click',()=>openPbrPrompt(null,'describe'));
  state.root.querySelector('.procBlendBtn')?.addEventListener('click',()=>openPbrPrompt(null,'blend'));
  state.root.querySelector('.procGeneratePreviewBtn')?.addEventListener('click',updatePreview);
  state.root.querySelectorAll('[data-generate-proc]').forEach(btn=>btn.addEventListener('click',()=>openPbrPrompt(btn.dataset.generateProc,'map')));
  state.root.querySelectorAll('[data-remove-proc]').forEach(btn=>btn.addEventListener('click',()=>removeProceduralPBR()));
  MAPS.forEach(([slot])=>{
    ['scale','detail','seed','contrast','strength'].forEach(k=>{
      const el=state.root.querySelector(`#proc-${slot}-${k}`);
      el?.addEventListener('input',()=>{ state.mapSettings[slot][k]=Number(el.value); if(k==='seed'&&labState.lockSeed){ labState.sharedSeed=Number(el.value)||0; MAPS.forEach(([s])=>state.mapSettings[s].seed=labState.sharedSeed); sync(); } updatePreview(); });
    });
  });
  sync();
  updatePreview();
}

let previewRenderer=null, previewScene=null, previewCamera=null, previewMesh=null, previewFrame=0;
function ensurePreview(){
  const canvas=state.root?.querySelector('#procPbrPreview'); if(!canvas || !labState.previewEnabled) return null;
  if(previewRenderer) return canvas;
  try{
    previewRenderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true}); previewRenderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5)); previewRenderer.setSize(480,260,false);
    previewScene=new THREE.Scene(); previewScene.background=new THREE.Color(0x0b0d12);
    previewCamera=new THREE.PerspectiveCamera(35,480/260,.1,100); previewCamera.position.set(0,0,4.8);
    const hemi=new THREE.HemisphereLight(0xffffff,0x20242b,1.8), key=new THREE.DirectionalLight(0xffffff,2.6); key.position.set(2,3,4);
    previewScene.add(hemi,key);
    previewMesh=new THREE.Mesh(new THREE.SphereGeometry(1.25,64,64),new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.55,metalness:.05})); previewScene.add(previewMesh);
    const loop=()=>{ previewFrame=requestAnimationFrame(loop); if(previewMesh&&labState.previewEnabled){ previewMesh.rotation.y+=.007; previewMesh.rotation.x+=.002; previewRenderer.render(previewScene,previewCamera); } }; loop();
  }catch(e){ console.warn('[NCM PBR] preview init failed',e); return null; }
  return canvas;
}
function previewCfg(){
  const first=state.mapSettings.map || state.mapSettings.normalMap;
  return first;
}
function updatePreview(){
  if(!state.root || !labState.previewEnabled) return;
  ensurePreview();
  if(!previewMesh) return;
  const cfg={...(previewCfg()||{})};
  if(!cfg.profile) cfg.profile='wood';
  try{
    const mat=previewMesh.material;
    const albedo=generateTexture('map',cfg);
    const normal=generateTexture('normalMap',cfg);
    const rough=generateTexture('roughnessMap',cfg);
    const metal=generateTexture('metalnessMap',cfg);
    for(const t of [mat.map,mat.normalMap,mat.roughnessMap,mat.metalnessMap]) t?.dispose?.();
    mat.map=albedo; mat.normalMap=normal; mat.roughnessMap=rough; mat.metalnessMap=metal;
    mat.roughness=1; mat.metalness=0; mat.needsUpdate=true;
  }catch(e){ console.warn('[NCM PBR] preview update failed',e); }
}
function sync(){
  const mesh=getMesh();
  MAPS.forEach(([slot])=>{
    const has=!!mesh?.material?.[slot];
    const el=state.root?.querySelector(`#proc-${slot}-status`);
    if(el) el.textContent=state.mapSettings[slot].blend ? 'misturado' : (has?'gerado/aplicado':'vazio');
    ['scale','detail','seed','contrast','strength'].forEach(k=>{ const input=state.root?.querySelector(`#proc-${slot}-${k}`); if(input && document.activeElement!==input) input.value=state.mapSettings[slot][k]; });
  });
  const set=(id,v)=>{ const el=state.root?.querySelector('#'+id); if(el && document.activeElement!==el) el.value=v; };
  set('procSharedSeed',labState.sharedSeed); set('procMaskScale',labState.maskScale); set('procMaskDetail',labState.maskDetail); set('procMaskContrast',labState.maskContrast);
  const lock=state.root?.querySelector('#procLockSeed'); if(lock) lock.checked=!!labState.lockSeed;
}
export function getProceduralPBRState(){
  return { size:state.size, maps:JSON.parse(JSON.stringify(state.mapSettings)), lab:JSON.parse(JSON.stringify(labState)) };
}
export function applyProceduralPBRState(saved){
  if(!saved||typeof saved!=='object') return;
  state.size=Number(saved.size)||256;
  Object.entries(saved.maps||{}).forEach(([slot,cfg])=>{ if(state.mapSettings[slot]) Object.assign(state.mapSettings[slot],cfg); });
  if(saved.lab && typeof saved.lab==='object') Object.assign(labState,saved.lab);
  if(labState.lockSeed) MAPS.forEach(([slot])=>state.mapSettings[slot].seed=labState.sharedSeed);
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
