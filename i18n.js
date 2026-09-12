/* Nexus Engine — stable application i18n
 *
 * This intentionally does not translate the DOM by treating the currently
 * displayed language as the source. Every live node keeps an immutable source
 * string, so changing language or rebuilding a panel can never turn English
 * into the new Portuguese source by accident.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'ncm_app_language_v2';
  const LEGACY_KEY = 'ncm_app_language_v1';
  const BASE = 'pt';
  const CACHE_KEY = 'ncm_i18n_cache_v2';
  const SOURCE_PROP = '__ncmI18nSource';
  const translatedProp = '__ncmI18nTranslated';
  const ATTRS = ['placeholder', 'title', 'aria-label', 'aria-description', 'alt'];
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','SELECT','OPTION','CODE','PRE']);
  const CACHE = loadCache();
  let currentLang = '';
  let generation = 0;
  let applying = false;
  let applyTimer = null;
  let pending = new Set();
  let flushTimer = null;

  // High-frequency UI terms. These are local so English works even when the
  // APK has no network. Other languages fall back to the same persistent
  // translation cache / online translator.
  const EN = {
    'Adicionar':'Add','Importar modelo':'Import model','Formas geométricas':'Geometric shapes',
    'Cubo':'Cube','Esfera':'Sphere','Cilindro':'Cylinder','Cone':'Cone','Plano':'Plane',
    'Cápsula':'Capsule','Icosaedro':'Icosahedron','Octaedro':'Octahedron','Tetraedro':'Tetrahedron',
    'Dodecaedro':'Dodecahedron','Torus Knot':'Torus Knot','Anel':'Ring','Círculo':'Circle',
    'Prisma triangular':'Triangular prism','Pirâmide':'Pyramid','Material':'Material','Luzes':'Lights',
    'Render':'Render','Camera':'Camera','Iluminação':'Lighting','Ponto':'Point','Solar':'Sun',
    'Área':'Area','Rim Light':'Rim Light','Cor':'Color','Intensidade':'Intensity','Alcance':'Range',
    'Sombra':'Shadow','Renderização':'Rendering','Modo':'Mode','Avançado':'Advanced','Pós-proc.':'Post-process',
    'Bloom':'Bloom','Motor de render':'Render engine','Padrão':'Default','GPU':'GPU','Layers de saída':'Output layers',
    'Normais':'Normals','Profundidade':'Depth','Wireframe':'Wireframe','Clay':'Clay','Outline':'Outline',
    'Strength':'Strength','Glow':'Glow','Thickness':'Thickness','Film Grain':'Film Grain','Bokeh':'Bokeh',
    'Foco':'Focus','Abertura':'Aperture','Exposure':'Exposure','Contrast':'Contrast','Saturation':'Saturation',
    'Vignette':'Vignette','Curva':'Curve','Nenhum':'None','Linear':'Linear','Espaço de Cor':'Color Space',
    'Configurações':'Settings','Config':'Config','Projetos':'Projects','Projeto':'Project','Novo projeto':'New project',
    'Atualizar':'Refresh','Abrir editor':'Open editor','Idioma':'Language','Idioma do aplicativo':'App language',
    'Português (padrão)':'Portuguese (default)','Tamanho do app':'App size','Largura (px)':'Width (px)','Altura (px)':'Height (px)',
    'Tamanho normal':'Normal size','Aplicar':'Apply','Cancelar':'Cancel','Ativar':'Enable','Entrar':'Enter',
    'Animar':'Animate','Labs':'Labs','Render Pass':'Render Pass','Adicionar à render final':'Add to final render',
    'Procedural PBR':'Procedural PBR','Albedo':'Albedo','Normal':'Normal','Roughness':'Roughness','Metalness':'Metalness',
    'AO':'AO','Emissive':'Emissive','Height':'Height','Alpha':'Alpha','Gerar':'Generate','Remover PBR':'Remove PBR',
    'padrão':'default','Começar domínio':'Start domain','Desenhando…':'Drawing…','Mostrar Grid':'Show Grid',
    'Mostrar Axes Helper':'Show Axes Helper','Contorno de seleção':'Selection outline','MusicBox':'MusicBox',
    'Adicionar MP3':'Add MP3','Tocar':'Play','Parar':'Stop','Repetir':'Loop','Volume':'Volume',
    'Salvar':'Save','Excluir':'Delete','Duplicar':'Duplicate','Renomear':'Rename','Fechar':'Close',
    'Objeto':'Object','Objetos':'Objects','Informações':'Information','Selecione um objeto na cena':'Select an object in the scene',
    'Cena vazia.':'Empty scene.','Selecione uma luz na cena para editar propriedades':'Select a light in the scene to edit properties',
    'Carregando…':'Loading…','Seus projetos':'Your projects','Continue de onde parou ou comece uma nova cena.':'Continue where you left off or start a new scene.',
    'Novo projeto':'New project','Projetos salvos neste dispositivo':'Projects saved on this device','NEXUS ENGINE · CINEMA MAKER':'NEXUS ENGINE · CINEMA MAKER',
    'Configurar Path':'Configure Path','ADD PANEL':'ADD PANEL','MATERIAL PANEL':'MATERIAL PANEL','LIGHTS PANEL':'LIGHTS PANEL','RENDER PANEL':'RENDER PANEL',
    'Adicionar':'Add','Import model':'Import model','Importar .glb / .gltf / .zip':'Import .glb / .gltf / .zip','Formas geométricas':'Geometric shapes',
    'Iluminação':'Lighting','Luz selecionada':'Selected light','Mapa (px)':'Map (px)','Bias':'Bias','Raio blur':'Blur radius','Câm. Near':'Camera Near','Câm. Far':'Camera Far',
    'Renderização':'Rendering','Modo Render':'Render Mode','Pós-proc.':'Post-process','Ray Tracing (Screen-Space)':'Ray Tracing (Screen-Space)',
    'SSAO Raio':'SSAO Radius','SSAO Intens.':'SSAO Intensity','SSAO Samples':'SSAO Samples','SSAO Bias':'SSAO Bias','SSR Intens.':'SSR Intensity','SSR Steps':'SSR Steps',
    'GI Intens.':'GI Intensity','GI Bounce':'GI Bounce','Amostras Alvo':'Target Samples','Min. Samples':'Min. Samples','Filter Glossy':'Filter Glossy',
    'Render Scale':'Render Scale','Low-Res Preview':'Low-Res Preview','Preview em baixa res. durante movimento de câmera':'Low-res preview while moving the camera',
    'Qualidade automática para celular':'Automatic mobile quality','FPS alvo':'Target FPS','Scale mín.':'Min. Scale','Scale máx.':'Max. Scale','Bounces mín.':'Min. Bounces','Bounces máx.':'Max. Bounces',
    'Reiniciar acumulação':'Reset accumulation','Amostras':'Samples','Motor':'Engine','Layers':'Layers','Pre Render':'Pre Render','Final Render':'Final Render',
    'profundidade de campo física.':'physical depth of field.','sombras':'shadows','Iluminação':'Lighting','Efeitos':'Effects',
    'Resolution & Export':'Resolution & Export','Editor Quality':'Editor Quality','Render Quality':'Render Quality','Format':'Format','Watermark':'Watermark','Render (PNG)':'Render (PNG)',
    'Câmeras':'Cameras','Câmera Principal (Viewport)':'Main Camera (Viewport)','Clip Próximo':'Near Clip','Clip Distante':'Far Clip','Câmeras na Cena':'Cameras in Scene',
    'Adicionar Câmera':'Add Camera','Nenhuma câmera na cena.':'No cameras in scene.','Performance':'Performance','Profiler em tempo real':'Real-time profiler',
    'FPS, frame time, geometria, draw calls e carga da cena.':'FPS, frame time, geometry, draw calls and scene load.','POV da Câmera Selecionada':'Selected Camera POV',
    'Emissão':'Emission','Aparência':'Appearance','Comportamento':'Behavior','Shader':'Shader','Animação':'Animation','Estilo':'Style',
    'Biblioteca de Animações':'Animation Library','Adicionar ao objeto':'Add to object','Clonar':'Clone','Apagar':'Delete','Agrupar':'Group',
    'Sistema':'System','Stack':'Stack','Hier.':'Hierarchy','Sistemas de Partículas':'Particle Systems','Sistemas de Lightning':'Lighting Systems','Sistemas de Aura':'Aura Systems',
    'Limpar Tudo':'Clear All','Nova Partícula':'New Particle','Presets':'Presets','Salvar .nex':'Save .nex','Carregar .nex':'Load .nex','Selecione um sistema':'Select a system',
    'Hierarquia':'Hierarchy','Selecionado':'Selected','Abrir Stack':'Open Stack','Virar raiz':'Make root','Ossos':'Bones','Configurações':'Settings',
    'Objeto':'Object','Mesh':'Mesh','Transformação':'Transform','Pos':'Pos','Rot':'Rot','Scl':'Scale','Geometria (apenas Mesh)':'Geometry (Mesh only)',
    'Vértices':'Vertices','Triângulos':'Triangles','Material (apenas Mesh)':'Material (Mesh only)','Tipo':'Type','Tamanho do app':'App size',
    'Largura (px)':'Width (px)','Altura (px)':'Height (px)','Tamanho normal':'Normal size','Aplicar':'Apply','Idioma':'Language','Idioma do aplicativo':'App language',
    'Descreva o material que deseja gerar. Ex.:':'Describe the material you want to generate. Example:','Descrição do material':'Material description',
    'Gerar Procedural PBR':'Generate Procedural PBR','Gerar PBR':'Generate PBR','Cancelar':'Cancel','Nenhum MP3 carregado':'No MP3 loaded',
    'Adicionar à render final':'Add to final render','Gerar':'Generate','Remover PBR':'Remove PBR','Mapas PBR gerados por ruído procedural determinístico. Cada mapa é uma textura real aplicada ao material.':'PBR maps generated by deterministic procedural noise. Each map is a real texture applied to the material.',
    'Escala':'Scale','Detalhe':'Detail','Contraste':'Contrast','Força':'Strength','gerado/aplicado':'generated/applied','vazio':'empty',
    '“padrão” restaura o gerador procedural original. Comandos reconhecidos: 30 perfis.':'“default” restores the original procedural generator. Recognized commands: 30 profiles.',
    'Motor de render':'Render engine','Camada':'Layer','Adicionar à render final':'Add to final render','Render Pass':'Render Pass',
    'Selecione um objeto na cena para configurar o bloom individual.':'Select an object in the scene to configure individual bloom.',
    'Ativar modo animação?':'Enable animation mode?','Entrar no Particle Labs?':'Enter Particle Labs?','Entrar no Labs':'Enter Labs',
    'Editor de partículas modular — laser, fogo, água e mais':'Modular particle editor — laser, fire, water and more'
  };

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch { return {}; }
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(CACHE)); } catch {}
  }
  function normalizeLang(lang) { return String(lang || '').trim(); }
  function sourceForNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return '';
    if (typeof node[SOURCE_PROP] === 'string') return node[SOURCE_PROP];
    const value = node.nodeValue || '';
    // Preserve whitespace outside the actual source text.
    const m = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = (m?.[2] || value).trim();
    node[SOURCE_PROP] = core;
    node.__ncmI18nPrefix = m?.[1] || '';
    node.__ncmI18nSuffix = m?.[3] || '';
    return core;
  }
  function isTranslatableText(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) return false;
    if (parent.closest('[data-ncm-no-i18n],svg,#cfgLangSelect,#launcherLangSelect')) return false;
    const text = (node.nodeValue || '').trim();
    if (!text || /^[\d\s.,:%+\-×✓↺—•]+$/.test(text)) return false;
    return true;
  }
  function textNodes(root = document.body) {
    const out=[];
    if (!root) return out;
    const walker=document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n=walker.nextNode())) if (isTranslatableText(n)) out.push(n);
    return out;
  }
  function localEnglish(src) {
    if (Object.prototype.hasOwnProperty.call(EN, src)) return EN[src];
    // Handle simple composite labels without translating object/user names.
    if (/^Adicionar\s+/.test(src)) return src.replace(/^Adicionar\s+/, 'Add ');
    if (/^Selecion(e|ar)\s+/.test(src)) return src.replace(/^Selecion(e|ar)\s+/, 'Select ');
    return null;
  }
  async function translate(src, lang) {
    if (!src || !lang) return src;
    if (lang === 'en') {
      const local = localEnglish(src); if (local) return local;
    }
    const key = `${lang}|${src}`;
    if (Object.prototype.hasOwnProperty.call(CACHE, key)) return CACHE[key];
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${BASE}&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(src)}`;
      const res = await fetch(url, { cache:'force-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const result = (data[0] || []).map(x => x[0]).join('').trim();
      CACHE[key] = result || src;
      saveCache();
      return CACHE[key];
    } catch { return src; }
  }
  async function translateNode(node, lang, gen) {
    if (!isTranslatableText(node) || gen !== generation) return;
    const src=sourceForNode(node); if (!src) return;
    const result=await translate(src, lang);
    if (gen !== generation || !node.isConnected) return;
    node.nodeValue=(node.__ncmI18nPrefix||'') + result + (node.__ncmI18nSuffix||'');
    node[translatedProp]=lang;
  }
  async function translateAttr(el, attr, lang, gen) {
    if (!el?.hasAttribute?.(attr) || el.closest?.('[data-ncm-no-i18n]')) return;
    const value=el.getAttribute(attr); if (!value?.trim()) return;
    const prop=`__ncmI18nAttr_${attr.replace(/[^a-z0-9]/gi,'_')}`;
    if (!el[prop]) el[prop]=value;
    const src=el[prop];
    const result=await translate(src, lang);
    if (gen===generation && el.isConnected) el.setAttribute(attr, result);
  }
  function collect(root=document.body) {
    return { nodes:textNodes(root), elements:[...root.querySelectorAll?.('*') || []] };
  }
  async function applyLanguage(lang, opts={}) {
    lang=normalizeLang(lang);
    generation++;
    const gen=generation;
    currentLang=lang;
    applying=true;
    const {nodes,elements}=collect(document.body);
    // Reset every source first. This makes switching EN -> PT -> EN deterministic.
    for (const node of nodes) {
      const src=sourceForNode(node);
      if (src) node.nodeValue=(node.__ncmI18nPrefix||'') + src + (node.__ncmI18nSuffix||'');
    }
    for (const el of elements) {
      for (const attr of ATTRS) {
        const prop=`__ncmI18nAttr_${attr.replace(/[^a-z0-9]/gi,'_')}`;
        if (el[prop]) el.setAttribute(attr, el[prop]);
      }
    }
    if (!lang) { applying=false; updateSelectors(''); return; }
    const batch=8;
    for (let i=0;i<nodes.length && gen===generation;i+=batch) {
      await Promise.all(nodes.slice(i,i+batch).map(n=>translateNode(n,lang,gen)));
      if (gen!==generation) break;
    }
    for (const el of elements) {
      if (gen!==generation) break;
      await Promise.all(ATTRS.map(a=>translateAttr(el,a,lang,gen)));
    }
    applying=false;
    updateSelectors(lang);
  }
  function updateSelectors(lang) {
    for (const id of ['cfgLangSelect','launcherLangSelect']) {
      const el=document.getElementById(id); if (el) el.value=lang || '';
    }
  }
  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer=setTimeout(() => {
      const saved=localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY) || '';
      if (saved !== currentLang) applyLanguage(saved,{silent:true});
      else flushPending();
    }, 220);
  }
  async function flushPending() {
    if (!currentLang || applying || !pending.size) return;
    const list=[...pending]; pending.clear();
    const gen=generation;
    for (const item of list) {
      if (item?.nodeType === Node.TEXT_NODE) {
        await translateNode(item,currentLang,gen);
      } else if (item?.nodeType === Node.ELEMENT_NODE) {
        textNodes(item).forEach(n => pending.add(n));
        await Promise.all(ATTRS.map(a=>translateAttr(item,a,currentLang,gen)));
      }
    }
    if (pending.size && gen===generation) {
      const more=[...pending]; pending.clear();
      await Promise.all(more.map(n=>translateNode(n,currentLang,gen)));
    }
  }
  const observer=new MutationObserver(mutations=>{
    // Never ignore mutations merely because an application is in progress.
    // Rebuilt panels can be inserted during the async translation pass.
    for (const m of mutations) {
      if (m.type==='characterData') {
        if (isTranslatableText(m.target) && !m.target[translatedProp]) pending.add(m.target);
      } else if (m.type==='attributes') {
        if (m.target?.nodeType===Node.ELEMENT_NODE && ATTRS.includes(m.attributeName)) pending.add(m.target);
      } else {
        m.addedNodes.forEach(n=>{
          if (n.nodeType===Node.TEXT_NODE) { if (isTranslatableText(n)) pending.add(n); }
          else if (n.nodeType===Node.ELEMENT_NODE) {
            textNodes(n).forEach(x=>pending.add(x));
            pending.add(n);
          }
        });
      }
    }
    if (pending.size) {
      clearTimeout(flushTimer);
      flushTimer=setTimeout(()=>flushPending(),120);
    }
  });

  function init() {
    const saved=localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY) || '';
    try { localStorage.setItem(STORAGE_KEY,saved); } catch {}
    updateSelectors(saved);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
    // Initial application after static DOM exists.
    setTimeout(()=>applyLanguage(saved,{silent:true}),100);

    document.addEventListener('change', e=>{
      const el=e.target;
      if (el?.id !== 'cfgLangSelect' && el?.id !== 'launcherLangSelect') return;
      const lang=normalizeLang(el.value);
      try { localStorage.setItem(STORAGE_KEY,lang); localStorage.setItem(LEGACY_KEY,lang); } catch {}
      applyLanguage(lang);
    });
    document.addEventListener('visibilitychange',()=>{
      if (document.visibilityState==='visible') scheduleApply();
    });
    window.addEventListener('pageshow',scheduleApply);
    window.addEventListener('ncm-editor-visible',scheduleApply);
    window.ncmApplyLanguage=(lang,opts={})=>{
      try { localStorage.setItem(STORAGE_KEY,normalizeLang(lang)); localStorage.setItem(LEGACY_KEY,normalizeLang(lang)); } catch {}
      return applyLanguage(lang,opts);
    };
    window.ncmGetLanguage=()=>currentLang;
    window.ncmT=async(text,lang=currentLang)=>translate(String(text||''),normalizeLang(lang));
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
