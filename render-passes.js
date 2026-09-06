import { markSceneDirty } from './scene.js';

// Render Pass / AOV configuration.  The controls are intentionally stored as
// plain JSON-compatible values so they can travel inside the .nex project.
const PASS_DEFS = [
  { id:'final', name:'FINAL', fields:[
    ['enabled','Ativo','checkbox',true],['exposure','Exposição','number',1],['contrast','Contraste','number',1],['saturation','Saturação','number',1],['gamma','Gamma','number',1],['opacity','Opacidade','number',1],['denoise','Denoise','number',0],['sharpen','Sharpen','number',0],['clamp','Clamp','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'beauty', name:'BEAUTY', fields:[
    ['exposure','Exposição','number',1],['contrast','Contraste','number',1],['saturation','Saturação','number',1],['gamma','Gamma','number',1],['highlight','Highlights','number',1],['shadow','Shadows','number',1],['whitePoint','White Point','number',1],['blackPoint','Black Point','number',0],['clamp','Clamp','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'depth', name:'DEPTH', fields:[
    ['near','Near','number',0.1],['far','Far','number',100],['range','Range','number',1],['invert','Inverter','checkbox',false],['normalize','Normalizar','checkbox',true],['focusAssist','Focus Assist','number',0],['blur','Blur','number',0],['contrast','Contraste','number',1],['opacity','Opacidade','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'normal', name:'NORMAL', fields:[
    ['space','Espaço','select',['World','View','Camera']],['normalize','Normalizar','checkbox',true],['invertX','Inverter X','checkbox',false],['invertY','Inverter Y','checkbox',false],['strength','Força','number',1],['contrast','Contraste','number',1],['roughnessInfluence','Roughness Influence','number',0],['opacity','Opacidade','number',1],['background','Fundo','color','#000000'],['export','Exportar','checkbox',true]
  ]},
  { id:'ao', name:'AO', fields:[
    ['radius','Raio','number',1],['intensity','Intensidade','number',1],['bias','Bias','number',0.02],['distance','Distância','number',5],['power','Power','number',1],['contrast','Contraste','number',1],['blur','Blur','number',0],['samples','Samples','number',16],['opacity','Opacidade','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'shadow', name:'SHADOW', fields:[
    ['strength','Força','number',1],['softness','Suavidade','number',0.5],['bias','Bias','number',0.005],['contact','Contact','number',1],['distance','Distância','number',20],['contrast','Contraste','number',1],['tint','Tint','color','#000000'],['opacity','Opacidade','number',1],['blur','Blur','number',0],['export','Exportar','checkbox',true]
  ]},
  { id:'emission', name:'EMISSION', fields:[
    ['strength','Força','number',1],['threshold','Threshold','number',0],['softness','Suavidade','number',0],['bloom','Bloom Contribution','number',1],['exposure','Exposição','number',1],['contrast','Contraste','number',1],['saturation','Saturação','number',1],['clamp','Clamp','number',1],['opacity','Opacidade','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'specular', name:'SPECULAR', fields:[
    ['strength','Força','number',1],['roughnessInfluence','Roughness Influence','number',1],['fresnel','Fresnel','number',1],['ior','IOR','number',1.5],['contrast','Contraste','number',1],['exposure','Exposição','number',1],['threshold','Threshold','number',0],['clamp','Clamp','number',1],['opacity','Opacidade','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'reflection', name:'REFLECTION', fields:[
    ['strength','Força','number',1],['roughness','Roughness','number',0.5],['blur','Blur','number',0],['fresnel','Fresnel','number',1],['maxDistance','Max Distance','number',50],['contrast','Contraste','number',1],['exposure','Exposição','number',1],['tint','Tint','color','#ffffff'],['opacity','Opacidade','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'diffuse', name:'DIFFUSE', fields:[
    ['strength','Força','number',1],['wrap','Wrap','number',0],['roughness','Roughness','number',1],['contrast','Contraste','number',1],['exposure','Exposição','number',1],['saturation','Saturação','number',1],['shadowContribution','Shadow Contribution','number',1],['aoContribution','AO Contribution','number',1],['opacity','Opacidade','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'objectId', name:'OBJECT ID', fields:[
    ['idMode','ID Mode','select',['Object UUID','Object Index','Material Index']],['channel','Canal','select',['RGB','R','G','B','A']],['encoding','Encoding','select',['Raw','Normalized','Hex']],['background','Fundo','color','#000000'],['outline','Outline','number',0],['thickness','Thickness','number',1],['contrast','Contraste','number',1],['invert','Inverter','checkbox',false],['opacity','Opacidade','number',1],['export','Exportar','checkbox',true]
  ]},
  { id:'motionVector', name:'MOTION VECTOR', fields:[
    ['scale','Scale','number',1],['blur','Blur','number',0],['threshold','Threshold','number',0],['clamp','Clamp','number',1],['maxVelocity','Max Velocity','number',1],['minVelocity','Min Velocity','number',0],['exposure','Exposição','number',1],['contrast','Contraste','number',1],['opacity','Opacidade','number',1],['export','Exportar','checkbox',true]
  ]}
];

const state = {};
for (const def of PASS_DEFS) {
  state[def.id] = {};
  for (const [key,,type,defaultValue] of def.fields) state[def.id][key] = defaultValue;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function fieldHTML(passId, field) {
  const [key,label,type,defaultValue] = field;
  const id = `rp-${passId}-${key}`;
  if (type === 'checkbox') {
    return `<label class="rpField rpCheck"><span>${esc(label)}</span><input id="${id}" type="checkbox" ${defaultValue ? 'checked' : ''}></label>`;
  }
  if (type === 'color') {
    return `<label class="rpField"><span>${esc(label)}</span><input id="${id}" type="color" value="${esc(defaultValue)}"></label>`;
  }
  if (type === 'select') {
    return `<label class="rpField"><span>${esc(label)}</span><select id="${id}">${defaultValue.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>`;
  }
  return `<label class="rpField"><span>${esc(label)}</span><input id="${id}" type="number" value="${defaultValue}" step="0.01"></label>`;
}

function renderUI() {
  const host = document.getElementById('renderPassCategory');
  if (!host) return;
  host.innerHTML = `
    <div class="rpCategoryHeader">
      <div class="rpCategoryTitle"><span class="rpCatDot"></span><span>Render Pass</span><span class="rpCount">${PASS_DEFS.length}</span></div>
      <div class="rpCategoryHint">AOVs / passes de saída</div>
    </div>
    <div class="rpList">
      ${PASS_DEFS.map((def, i) => `
        <details class="rpSubcategory" ${i === 0 ? 'open' : ''}>
          <summary>
            <span class="rpChevron">›</span>
            <span class="rpPassName">${esc(def.name)}</span>
            <span class="rpParamCount">10</span>
          </summary>
          <div class="rpGrid">${def.fields.map(f => fieldHTML(def.id, f)).join('')}</div>
        </details>
      `).join('')}
    </div>`;

  for (const def of PASS_DEFS) {
    for (const [key,,type] of def.fields) {
      const el = document.getElementById(`rp-${def.id}-${key}`);
      if (!el) continue;
      const value = state[def.id][key];
      if (type === 'checkbox') el.checked = !!value;
      else el.value = value;
      el.addEventListener('input', () => updateField(def.id, key, type, el));
      el.addEventListener('change', () => updateField(def.id, key, type, el));
    }
  }
}

function updateField(passId, key, type, el) {
  let value;
  if (type === 'checkbox') value = !!el.checked;
  else if (type === 'number') {
    const n = Number(el.value);
    value = Number.isFinite(n) ? n : 0;
  } else value = el.value;
  state[passId][key] = value;
  markSceneDirty();
  window.dispatchEvent(new CustomEvent('render-pass-changed', { detail: { passId, key, value } }));
}

export function getRenderPassState() {
  return JSON.parse(JSON.stringify(state));
}

export function applyRenderPassState(saved) {
  if (!saved || typeof saved !== 'object') return;
  for (const def of PASS_DEFS) {
    if (!saved[def.id] || typeof saved[def.id] !== 'object') continue;
    for (const [key,,type] of def.fields) {
      if (!(key in saved[def.id])) continue;
      const value = saved[def.id][key];
      if (type === 'checkbox') state[def.id][key] = !!value;
      else if (type === 'number') state[def.id][key] = Number.isFinite(Number(value)) ? Number(value) : state[def.id][key];
      else state[def.id][key] = String(value);
    }
  }
  renderUI();
}

export function getRenderPassDefinitions() {
  return PASS_DEFS.map(d => ({ id:d.id, name:d.name, settings:d.fields.map(f => f[0]) }));
}

window.addEventListener('DOMContentLoaded', () => {
  renderUI();
});
