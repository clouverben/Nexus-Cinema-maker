// shaderpack.js — importador de shaderpacks Java (OptiFine / Iris) para o Nexus.
//
// O que é suportado (pipeline de PÓS-PROCESSAMENTO do shaderpack):
//   prepare*, deferred*, composite*, final  → rodam sobre a cena 3D do Nexus.
// O que NÃO é suportado: gbuffers_* / shadow (os programas que desenham os
// blocos do Minecraft). A cena do Nexus já vem iluminada pelo próprio motor; os
// buffers colortex0 (cor) e colortex2 (normais) são preenchidos pelo Nexus.
//
// Arquitetura:
//   1. readZip()        — leitor de .zip sem dependências (DecompressionStream).
//   2. ShaderPack       — árvore de arquivos, shaders.properties, opções, #include.
//   3. translate/fix    — GLSL 1.20/1.30/3.30 (desktop) → GLSL ES 3.00 (WebGL2).
//   4. PackRuntime      — WebGL2 puro: buffers colortex (ping-pong), FBOs, uniforms.
//   5. ShaderPackPass   — Pass do EffectComposer que alimenta o runtime.
//   6. manager          — estado global, opções, persistência (IndexedDB).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { app, helperRegistry, markSceneDirty } from './scene.js';

// ════════════════════════════════════════════════════════════════════════════
// 1. ZIP
// ════════════════════════════════════════════════════════════════════════════
async function _inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function readZip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo .zip inválido (diretório central não encontrado).');
  const total = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const entries = new Map();
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen)).replace(/\\/g, '/');
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.set(name, {
      read: async () => {
        const lnLen = dv.getUint16(localOff + 26, true);
        const leLen = dv.getUint16(localOff + 28, true);
        const start = localOff + 30 + lnLen + leLen;
        const raw = u8.subarray(start, start + compSize);
        if (method === 0) return raw.slice();
        if (method === 8) return _inflateRaw(raw);
        throw new Error('Compressão zip não suportada (método ' + method + ').');
      },
    });
  }
  return entries;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. SHADERPACK (arquivos, properties, opções, includes)
// ════════════════════════════════════════════════════════════════════════════
function _parseProperties(text) {
  const out = new Map();
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (/\\\s*$/.test(line) && i + 1 < lines.length) line = line.replace(/\\\s*$/, ' ') + lines[++i].trim();
    line = line.trim();
    if (!line || line[0] === '#' || line[0] === '!') continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return out;
}

const _TEXT_EXT = /\.(fsh|vsh|gsh|glsl|inc|h|properties|txt|frag|vert|lang)$/i;
const _OPT_DEFINE = /^(\s*)(\/\/\s*)?#\s*define\s+([A-Za-z_]\w*)(?:[ \t]+([^\n]*?))?\s*$/;
const _OPT_CONST = /^(\s*)const\s+(int|float|bool)\s+(\w+)\s*=\s*([^;]+);(.*)$/;

export class ShaderPack {
  constructor(name, texts, entries) {
    this.name = name;
    this.texts = texts;                 // relPath → string
    this.entries = entries;             // relPath → { read() }
    this.lower = new Map();
    for (const k of texts.keys()) this.lower.set(k.toLowerCase(), k);
    for (const k of entries.keys()) if (!this.lower.has(k.toLowerCase())) this.lower.set(k.toLowerCase(), k);
    this.props = _parseProperties(texts.get('shaders.properties') || '');
    this.lang = _parseProperties(texts.get('lang/en_US.lang') || texts.get('lang/en_us.lang') || '');
    this.warnings = [];
    this._optionsCache = null;
  }

  has(path) { return this.lower.has(path.toLowerCase()); }
  getText(path) { const k = this.lower.get(path.toLowerCase()); return k ? this.texts.get(k) : undefined; }
  async getBytes(path) { const k = this.lower.get(path.toLowerCase()); return k ? this.entries.get(k).read() : null; }

  // Procura "world0/<nome>" antes de "<nome>" (Overworld).
  findFile(name) {
    for (const p of ['world0/' + name, name]) if (this.texts.has(this.lower.get(p.toLowerCase()) || '')) return this.lower.get(p.toLowerCase());
    return null;
  }

  programNames() {
    const names = [];
    const seq = (base, max) => { names.push(base); for (let i = 1; i <= max; i++) names.push(base + i); };
    seq('prepare', 15); seq('deferred', 15); seq('composite', 15);
    names.push('final');
    return names.filter((n) => this.findFile(n + '.fsh'));
  }

  _resolveInclude(from, inc) {
    let path = inc.startsWith('/') ? inc.slice(1) : (from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '') + inc;
    const parts = [];
    for (const seg of path.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    }
    return parts.join('/');
  }

  // Expande #include (recursivo) e aplica as opções escolhidas pelo usuário.
  preprocess(path, overrides) {
    const lines = [];
    const visit = (p, depth) => {
      const real = this.lower.get(p.toLowerCase());
      const text = real ? this.texts.get(real) : undefined;
      if (text == null) { this.warnings.push('#include não encontrado: ' + p); lines.push('// #include ausente: ' + p); return; }
      if (depth > 24) { this.warnings.push('#include muito profundo: ' + p); return; }
      for (let raw of text.replace(/\r/g, '').split('\n')) {
        const m = /^\s*#\s*include\s+["<]([^">]+)[">]/.exec(raw);
        if (m) { visit(this._resolveInclude(real, m[1]), depth + 1); continue; }
        if (overrides && overrides.size) raw = this._applyOverride(raw, overrides);
        lines.push(raw);
      }
    };
    visit(path, 0);
    return lines;
  }

  _applyOverride(line, overrides) {
    let m = _OPT_DEFINE.exec(line);
    if (m && overrides.has(m[3])) {
      const ov = overrides.get(m[3]);
      const tail = /(\/\/\s*\[.*)$/.exec(m[4] || '');
      if (typeof ov === 'boolean') return ov ? `${m[1]}#define ${m[3]}` : `${m[1]}//#define ${m[3]}`;
      return `${m[1]}#define ${m[3]} ${ov}${tail ? ' ' + tail[1] : ''}`;
    }
    m = _OPT_CONST.exec(line);
    if (m && overrides.has(m[3])) return `${m[1]}const ${m[2]} ${m[3]} = ${overrides.get(m[3])};${m[5]}`;
    return line;
  }

  // Descobre as opções editáveis (#define NOME valor //[lista]) respeitando
  // shaders.properties (screen / sliders) quando existir.
  options() {
    if (this._optionsCache) return this._optionsCache;
    const found = new Map();
    for (const [path, text] of this.texts) {
      if (!/\.(fsh|vsh|glsl|inc|h)$/i.test(path)) continue;
      for (const line of text.replace(/\r/g, '').split('\n')) {
        const tail = /\/\/\s*\[([^\]]*)\]\s*$/.exec(line);
        let m = _OPT_DEFINE.exec(line);
        if (m) {
          const name = m[3];
          if (found.has(name)) continue;
          let body = (m[4] || '').replace(/\/\/.*$/, '').trim();
          const commented = !!m[2];
          if (!body) {
            if (!commented && !tail) { /* talvez seja include guard: só entra se estiver no screen */ }
            found.set(name, { name, kind: 'toggle', def: !commented, list: null, file: path, weak: !commented && !tail });
          } else {
            found.set(name, { name, kind: 'value', def: body, list: tail ? tail[1].trim().split(/\s+/) : null, file: path, weak: !tail });
          }
          continue;
        }
        m = _OPT_CONST.exec(line);
        if (m && tail && !found.has(m[3])) {
          found.set(m[3], { name: m[3], kind: 'value', def: m[4].trim(), list: tail[1].trim().split(/\s+/), file: path, weak: false, isConst: true });
        }
      }
    }
    // Ordem/grupos a partir de shaders.properties
    const ordered = [];
    const seen = new Set();
    const addScreen = (key, group) => {
      const val = this.props.get(key);
      if (!val) return;
      for (const tok of val.split(/\s+/)) {
        if (!tok || tok === '<empty>' || tok === '<profile>' || tok === '*') continue;
        if (tok.startsWith('[') && tok.endsWith(']')) { addScreen('screen.' + tok.slice(1, -1), tok.slice(1, -1)); continue; }
        const o = found.get(tok);
        if (o && !seen.has(tok) && !/^info\d*$/i.test(tok) && !/^INFORMATION$/i.test(group)) { seen.add(tok); ordered.push({ ...o, group, label: this._label(tok) }); }
      }
    };
    addScreen('screen', 'Geral');
    if (!ordered.length) {
      for (const o of found.values()) if (!o.weak) ordered.push({ ...o, group: 'Geral', label: this._label(o.name) });
    }
    for (const o of ordered) {
      const custom = this.props.get('option.' + o.name);
      if (custom && !o.list) o.list = custom.split(/\s+/);
    }
    this._optionsCache = ordered.slice(0, 400);
    return this._optionsCache;
  }

  _label(name) {
    return String(this.lang.get('option.' + name) || name.replace(/_/g, ' ')).replace(/§./g, '').trim();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. TRADUÇÃO GLSL desktop → GLSL ES 3.00
// ════════════════════════════════════════════════════════════════════════════
const _RESERVED = ['sample', 'input', 'output', 'filter', 'half', 'fixed', 'common', 'active', 'partition',
  'packed', 'resource', 'union', 'enum', 'typedef', 'template', 'this', 'goto', 'inline', 'noinline', 'public',
  'static', 'extern', 'external', 'interface', 'long', 'short', 'double', 'unsigned', 'sizeof', 'cast',
  'namespace', 'using', 'superp', 'asm', 'class', 'volatile', 'hvec2', 'hvec3', 'hvec4', 'fvec2', 'fvec3', 'fvec4',
  'dvec2', 'dvec3', 'dvec4', 'precise'];
const _RESERVED_RE = new RegExp('\\b(' + _RESERVED.join('|') + ')\\b', 'g');

const _MC_DEFINES = `#define MC_VERSION 11900
#define MC_GL_VERSION 330
#define MC_GLSL_VERSION 330
#define MC_OS_WINDOWS
#define MC_GL_RENDERER_OTHER
#define MC_GL_VENDOR_OTHER
#define MC_HAND_DEPTH 0.125
#define MC_NORMAL_MAP
#define MC_SPECULAR_MAP
#define MC_RENDER_QUALITY 1.0
#define MC_SHADOW_QUALITY 1.0
`;

const _COMMON_PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp isampler2D;
precision highp usampler2D;
precision highp samplerCube;
precision highp sampler2DArray;
`;

const _FRAG_HELPERS = `
#define texture2D texture
#define texture2DLod textureLod
#define texture2DGrad textureGrad
#define texture2DProj textureProj
#define texture2DProjLod textureProjLod
#define texelFetch2D texelFetch
vec4 textureLod(sampler2D s, vec2 c, int l) { return textureLod(s, c, float(l)); }
vec4 textureLod(sampler3D s, vec3 c, int l) { return textureLod(s, c, float(l)); }
float ncm_shadow2D_(sampler2D s, vec3 c) { return step(c.z, texture(s, c.xy).r); }
#define shadow2D(s, c) vec4(ncm_shadow2D_(s, c))
#define shadow2DLod(s, c, l) vec4(ncm_shadow2D_(s, c))
`;

const _VERT_PRELUDE_TAIL = `
layout(location = 0) in vec2 ncm_apos;
const mat4 ncm_MVP = mat4(2.0,0.0,0.0,0.0, 0.0,2.0,0.0,0.0, 0.0,0.0,1.0,0.0, -1.0,-1.0,0.0,1.0);
#define texture2D texture
#define texture2DLod textureLod
#define texelFetch2D texelFetch
`;

function _replaceLegacy(src) {
  return src
    .replace(/\bgl_TextureMatrix\s*\[\s*\d+\s*\]/g, 'mat4(1.0)')
    .replace(/\bgl_ModelViewProjectionMatrixInverse\b/g, 'inverse(ncm_MVP)')
    .replace(/\bgl_ProjectionMatrixInverse\b/g, 'inverse(ncm_MVP)')
    .replace(/\bgl_ModelViewMatrixInverse\b/g, 'mat4(1.0)')
    .replace(/\bgl_ModelViewProjectionMatrix\b/g, 'ncm_MVP')
    .replace(/\bgl_ProjectionMatrix\b/g, 'ncm_MVP')
    .replace(/\bgl_ModelViewMatrix\b/g, 'mat4(1.0)')
    .replace(/\bgl_NormalMatrix\b/g, 'mat3(1.0)')
    .replace(/\bgl_Fog\.start\b/g, '0.0').replace(/\bgl_Fog\.end\b/g, '1000.0').replace(/\bgl_Fog\.scale\b/g, '0.001')
    .replace(/\bgl_Fog\.density\b/g, '0.1').replace(/\bgl_Fog\.color\b/g, 'vec4(0.5)').replace(/\bgl_FogFragCoord\b/g, '0.0')
    .replace(/\bftransform\s*\(\s*\)/g, '(ncm_MVP * vec4(ncm_apos, 0.0, 1.0))')
    .replace(/\bgl_Vertex\b/g, 'vec4(ncm_apos, 0.0, 1.0)')
    .replace(/\bgl_MultiTexCoord0\b/g, 'vec4(ncm_apos, 0.0, 1.0)')
    .replace(/\bgl_MultiTexCoord[1-7]\b/g, 'vec4(0.0, 0.0, 0.0, 1.0)')
    .replace(/\bgl_Color\b/g, 'vec4(1.0)')
    .replace(/\bgl_Normal\b/g, 'vec3(0.0, 0.0, 1.0)')
    .replace(/\bnoperspective\b/g, '')
    .replace(/\bsampler2DShadow\b/g, 'sampler2D')
    .replace(/(\buniform\s+\w+\s+\w+(?:\s*\[[^\]]*\])?)\s*=\s*[^;]+;/g, '$1;')
    .replace(_RESERVED_RE, 'ncm_$1')
    .replace(/#\s*extension[^\n]*/g, '')
    .replace(/^\s*#\s*version[^\n]*/gm, '');
}

// Retorna { header, body:[linhas], drawList, writes:Set } para um estágio.
function translateStage(lines, stage) {
  let src = lines.join('\n');
  const info = { drawList: null, writes: new Set(), texCoords: new Set() };

  if (stage === 'frag') {
    // DRAWBUFFERS / RENDERTARGETS: posição i → colortex[lista[i]]
    const dbs = [...src.matchAll(/\/\*\s*DRAWBUFFERS\s*:\s*([0-9A-Za-z]+)\s*\*\//g)];
    const rts = [...src.matchAll(/\/\*\s*RENDERTARGETS\s*:\s*([0-9,\s]+)\*\//g)];
    if (rts.length) info.drawList = rts[rts.length - 1][1].split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 0 && n < 8);
    else if (dbs.length) info.drawList = dbs[dbs.length - 1][1].split('').map((c) => parseInt(c, 36)).filter((n) => n >= 0 && n < 8);
  }
  src = _replaceLegacy(src);

  if (stage === 'frag') {
    src = src.replace(/\bgl_FragColor\b/g, 'gl_FragData[0]');
    const own = /\bout\s+(?:highp\s+)?vec4\s+\w+/.test(src) || /\blayout\s*\([^)]*location[^)]*\)\s*out\b/.test(src);
    const ref = new Set();
    src = src.replace(/\bgl_FragData\s*\[\s*(\d+)\s*\]/g, (m, n) => { ref.add(+n); return 'ncm_out' + n; });
    if (own) {
      for (const m of src.matchAll(/location\s*=\s*(\d+)\s*\)\s*out/g)) ref.add(+m[1]);
      if (!ref.size) ref.add(0);
    }
    if (!ref.size) ref.add(0);
    info.writes = ref;
    info.ownOut = own;
    if (!info.drawList || !info.drawList.length) info.drawList = [0];
    info.texCoords = new Set([...src.matchAll(/\bgl_TexCoord\s*\[\s*(\d+)\s*\]/g)].map((m) => +m[1]));
    src = src.replace(/\bgl_TexCoord\s*\[\s*(\d+)\s*\]/g, 'ncm_TexCoord_$1');
    src = src.replace(/\bvarying\b/g, 'in').replace(/\battribute\b/g, 'in');
    let header = _COMMON_PRELUDE + _MC_DEFINES + _FRAG_HELPERS;
    if (!own) {
      const maxLoc = Math.max(...ref, info.drawList.length - 1);
      for (let i = 0; i <= Math.min(maxLoc, 7); i++) header += `layout(location = ${i}) out vec4 ncm_out${i};\n`;
    }
    for (const t of info.texCoords) header += `in vec4 ncm_TexCoord_${t};\n`;
    info.header = header;
  } else {
    info.texCoords = new Set([...src.matchAll(/\bgl_TexCoord\s*\[\s*(\d+)\s*\]/g)].map((m) => +m[1]));
    src = src.replace(/\bgl_TexCoord\s*\[\s*(\d+)\s*\]/g, 'ncm_TexCoord_$1');
    src = src.replace(/\bvarying\b/g, 'out').replace(/\battribute\b/g, 'in');
    let header = _COMMON_PRELUDE + _MC_DEFINES + _VERT_PRELUDE_TAIL;
    for (const t of info.texCoords) header += `out vec4 ncm_TexCoord_${t};\n`;
    info.header = header;
  }
  const g = _guardIfMacros(src.split('\n'));
  info.body = g.lines;
  info.header += g.header;
  return info;
}

// No GLSL ES, identificadores não definidos dentro de #if/#elif são erro (no
// desktop valem 0). Para cada #if cuja expressão usa um macro que pode não
// existir, criamos um macro temporário: ncm_t_X = X se definido, senão 0.
// Em #elif não dá para inserir linhas antes; ali só definimos 0 no cabeçalho
// quando o macro nunca é definido em lugar nenhum.
function _guardIfMacros(lines) {
  const safe = new Set(['true', 'false', 'defined']);
  for (const m of _MC_DEFINES.matchAll(/#define\s+(\w+)/g)) safe.add(m[1]);
  const everDefined = new Set();
  for (const l of lines) { const m = /^\s*#\s*(?:define|undef)\s+(\w+)/.exec(l); if (m) everDefined.add(m[1]); }
  const out = [];
  const headerZero = new Set();
  let depth = 0;
  const conv = (expr, canInsert, needed) => expr.replace(/defined\s*\(\s*\w+\s*\)|defined\s+\w+|\b[A-Za-z_]\w*\b/g, (tok) => {
    if (tok.startsWith('defined') || safe.has(tok)) return tok;
    if (canInsert) { needed.add(tok); return 'ncm_t_' + tok; }
    if (!everDefined.has(tok)) headerZero.add(tok);
    return tok;
  });
  for (const raw of lines) {
    const t = /^(\s*#\s*)(\w+)(.*)$/.exec(raw);
    if (!t) { out.push(raw); continue; }
    const dir = t[2];
    if (dir === 'define' || dir === 'undef') {
      const n = /^\s*(\w+)/.exec(t[3]);
      if (n && dir === 'define' && depth === 0) safe.add(n[1]);
      out.push(raw); continue;
    }
    if (dir === 'if' || dir === 'elif') {
      const cm = /(\/\/.*|\/\*.*)$/.exec(t[3]);
      const expr = cm ? t[3].slice(0, cm.index) : t[3];
      const needed = new Set();
      const ne = conv(expr, dir === 'if', needed);
      for (const n of needed) {
        out.push('#undef ncm_t_' + n, '#ifdef ' + n, '#define ncm_t_' + n + ' ' + n, '#else', '#define ncm_t_' + n + ' 0', '#endif');
      }
      out.push(t[1] + dir + ne + (cm ? ' ' + cm[1] : ''));
      if (dir === 'if') depth++;
      continue;
    }
    if (dir === 'ifdef' || dir === 'ifndef') depth++;
    else if (dir === 'endif') {
      if (depth === 0) { out.push('// (#endif órfão removido)'); continue; }
      depth--;
    } else if ((dir === 'else') && depth === 0) { out.push('// (#else órfão removido)'); continue; }
    out.push(raw);
  }
  let hdr = '';
  for (const n of headerZero) hdr += `#define ${n} 0\n`;
  return { lines: out, header: hdr };
}

const _DEFAULT_VSH_LINES = `
out vec4 ncm_TexCoord_0;
out vec4 ncm_TexCoord_1;
void main() {
  ncm_TexCoord_0 = vec4(ncm_apos, 0.0, 1.0);
  ncm_TexCoord_1 = vec4(ncm_apos, 0.0, 1.0);
  gl_Position = vec4(ncm_apos * 2.0 - 1.0, 0.0, 1.0);
}`.split('\n');

// Macros "mistas" (inteiro + decimal) funcionam no GLSL desktop mas não no ES:
//   #define X 4 * 0.5          →  #define X 4.0 * 0.5
//   #define Y ALT + 0.1        →  #define Y float(ALT) + 0.1
function _normalizeMacros(lines) {
  const intValued = new Set();
  const floatValued = new Set();
  const simple = (b) => /^[\s\w.()+\-*\/]+$/.test(b) && !/\w\s*\(/.test(b) && !/\de[-+]?\d/i.test(b);
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*#\s*define\s+(\w+)\s+)([^\n]*?)(\s*\/\/.*)?$/.exec(lines[i]);
    if (!m) { const c = /^\s*(?:const|uniform)\s+int\s+(\w+)/.exec(lines[i]); if (c) intValued.add(c[1]); continue; }
    if (/^\(?\s*-?\d+\s*\)?$/.test(m[3])) intValued.add(m[2]);
    else if (simple(m[3])) defs.push({ i, m, name: m[2], body: m[3] });
  }
  const floatLit = /(?<![\w])\d+\.\d*|(?<![\w])\.\d+/;
  for (let pass = 0; pass < 4; pass++) {
    for (const d of defs) {
      if (floatValued.has(d.name)) continue;
      if (floatLit.test(d.body) || [...d.body.matchAll(/\b([A-Za-z_]\w*)\b/g)].some((x) => floatValued.has(x[1]))) floatValued.add(d.name);
    }
  }
  for (const d of defs) {
    if (!floatValued.has(d.name)) continue;
    const ids = [...d.body.matchAll(/\b([A-Za-z_]\w*)\b/g)].map((x) => x[1]);
    const hasInt = /(?<![\w.])\d+(?![\w.])/.test(d.body) || ids.some((id) => intValued.has(id));
    if (!hasInt) continue;
    let nb = d.body.replace(/(?<![\w.])(\d+)(?![\w.])/g, '$1.0');
    nb = nb.replace(/\b([A-Za-z_]\w*)\b/g, (id) => (intValued.has(id) ? `float(${id})` : id));
    if (nb !== d.body) lines[d.i] = d.m[1] + nb + (d.m[4] || '');
  }
}

function _collectIntNames(lines) {
  const names = new Set();
  for (const l of lines) {
    // #define NOME <expressão aritmética simples> (sem chamadas de função)
    let m = /^\s*#\s*define\s+(\w+)\s+([^\n]*?)\s*(?:\/\/.*)?$/.exec(l);
    if (m && /^[\s\w.()+\-*\/]+$/.test(m[2]) && !/\w\s*\(/.test(m[2]) && /[0-9]|^[A-Za-z_]/.test(m[2])) { names.add(m[1]); continue; }
    if (/^\s*#/.test(l)) continue;
    for (const mm of l.matchAll(/\b(?:int|uint)\s+(\w+)\s*(?=[=;,)\[])/g)) names.add(mm[1]);
  }
  return names;
}

function _fixLine(line, intNames, mode) {
  if (/^\s*#/.test(line)) return line;
  const only = mode && mode.names;           // subconjunto de nomes a envolver (busca)
  const lits = !mode || mode.lits !== false;  // converter literais?
  let out = line;
  if (/<<|>>|[^&]&[^&]|[^|]\|[^|]|\^/.test(out) && !/\btextureSize\s*\(/.test(out)) return out;
  if (/\btextureSize\s*\(/.test(out)) {
    out = out.replace(/(\bvec2\s+\w+\s*=\s*)textureSize\(([^;]*)\)\s*;/, '$1vec2(textureSize($2));');
  }
  const noLit = /\b(texelFetch|textureSize|ivec\d|uvec\d)\b/.test(line);
  const bitOps = /<<|>>|[^&]&[^&]|[^|]\|[^|]|\^|\b\d+u\b|\buint\b/.test(line);
  const declInt = /^\s*(?:const\s+)?(?:int|uint|ivec\d|uvec\d|bool|bvec\d)\b/.test(line) || /\bfor\s*\(\s*(?:int|uint)\b/.test(line);
  if (lits && noLit) {
    // dentro de ivec2(a-1, b): operandos aritméticos viram float (o construtor aceita)
    out = out.replace(/(?<=[\w)]\s*[-+*\/]\s*)(\d+)(?![\w.\[\]])/g, '$1.0').replace(/(?<![\w.\[])(\d+)(?=\s*[-+*\/]\s*[A-Za-z_(])/g, '$1.0');
  }
  if (lits && !noLit && !bitOps) {
    if (!declInt) out = out.replace(/(?<![\w.\[])(\d+)(?![\w.\[\]])/g, '$1.0');
    else out = out.replace(/([,(]\s*)(\d+)(\s*[,)])/g, '$1$2.0$3');
  }
  for (const n of intNames) {
    if (only && !only.includes(n)) continue;
    if (!out.includes(n)) continue;
    if (new RegExp('\\b(?:float|vec\\d|mat\\d)\\s+' + n + '\\b').test(out)) continue; // declarado como float nesta linha
    out = out.replace(new RegExp('(?<!float\\(|[\\w.]|\\b(?:int|uint|float|bool|const)\\s+|\\+\\+|--)' + n + '(?![\\w(])(?!\\s*(?:\\+\\+|--|[-+*/]?=(?!=)))', 'g'), 'float(' + n + ')');
  }
  return out;
}

function _wrapGlobalInit(lines, i, hoist, serial) {
  const m = /^(\s*)((?:(?:const|highp|mediump|lowp)\s+)*)([A-Za-z_]\w*)\s+([A-Za-z_]\w*(?:\s*\[\s*\w+\s*\])?)\s*=/.exec(lines[i]);
  if (!m) return false;
  const arr = /^(\w+)\s*(\[.*)$/.exec(m[4]);
  const eq = m[0].length;
  let depth = 0, endLine = -1, endCol = -1;
  scan: for (let k = i; k < lines.length; k++) {
    const text = lines[k];
    if (k > i && /^\s*#/.test(text)) continue;
    for (let c = (k === i ? eq : 0); c < text.length; c++) {
      const ch = text[c];
      if (ch === '/' && text[c + 1] === '/') break;
      if (ch === '/' && text[c + 1] === '*') { const e = text.indexOf('*/', c + 2); if (e < 0) break; c = e + 1; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === ';' && depth <= 0) { endLine = k; endCol = c; break scan; }
    }
  }
  if (endLine < 0) return false;
  const fn = `ncm_gi_${serial}`;
  const first = lines[i];
  const nameOnly = arr ? arr[1] : m[4];
  const head = `${m[1]}${m[3]} ${m[4]}; void ${fn}() { ${nameOnly} =`;
  if (endLine === i) {
    lines[i] = head + first.slice(eq, endCol + 1) + ' }' + first.slice(endCol + 1);
  } else {
    lines[i] = head + first.slice(eq);
    const last = lines[endLine];
    lines[endLine] = last.slice(0, endCol + 1) + ' }' + last.slice(endCol + 1);
  }
  hoist.push(fn + '();');
  return true;
}

// Funções embutidas só-float chamadas com argumento int (permitido no GLSL
// desktop): envolve argumentos escalares inteiros em float(...) em TODAS as
// chamadas de `fname` do shader.
const _FLOAT_ONLY_FN = new Set(['exp', 'exp2', 'log', 'log2', 'sqrt', 'inversesqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'floor', 'ceil', 'fract', 'round', 'trunc', 'pow', 'mod', 'step', 'smoothstep', 'mix', 'normalize', 'length', 'distance', 'radians', 'degrees']);
function _wrapCallArgs(lines, fname, intNames, wrapped) {
  if (wrapped.has(fname) || !_FLOAT_ONLY_FN.has(fname)) return false;
  wrapped.add(fname);
  const re = new RegExp('(?<![\\w.])' + fname + '\\s*\\(', 'g');
  let extra = null;
  const intish = (a) => {
    const t = a.trim();
    if (!t || /float\s*\(/.test(t)) return false;
    if (!/^[\s\w+\-*\/()]+$/.test(t) || /\w\s*\(/.test(t)) return false;
    const ids = t.match(/[A-Za-z_]\w*/g) || [];
    if (/\.\d|\d\./.test(t)) return false;
    return ids.every((id) => intNames.has(id) || (extra && extra.has(id))) && (ids.length > 0 || /^\d+$/.test(t));
  };
  let any = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    extra = null;
    if (/^\s*#/.test(line)) {
      const dm = /^\s*#\s*define\s+\w+\(([^)]*)\)/.exec(line);
      if (!dm) continue;
      extra = new Set(dm[1].split(',').map((x) => x.trim()).filter(Boolean));
    }
    if (!re.test(line)) { re.lastIndex = 0; continue; }
    re.lastIndex = 0;
    let out = '', pos = 0, m;
    while ((m = re.exec(line))) {
      const open = m.index + m[0].length;
      let depth = 1, k = open;
      const args = []; let cur = open;
      for (; k < line.length && depth > 0; k++) {
        const ch = line[k];
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) { args.push([cur, k]); } }
        else if (ch === ',' && depth === 1) { args.push([cur, k]); cur = k + 1; }
      }
      if (depth !== 0) break;
      out += line.slice(pos, open);
      let p = open;
      for (const [a, b] of args) {
        const txt = line.slice(a, b);
        out += line.slice(p, a) + (intish(txt) ? ` float(${txt.trim()})` : txt);
        p = b;
      }
      pos = p;
      re.lastIndex = k;
      any = true;
    }
    if (any) { lines[li] = out + line.slice(pos); }
  }
  return any;
}

function _withHoist(lines, hoist) {
  if (!hoist.length) return lines;
  const out = lines.slice();
  const mi = out.findIndex((l) => /\bvoid\s+main\s*\(\s*(?:void)?\s*\)/.test(l));
  if (mi < 0) return out;
  for (let i = mi; i < out.length; i++) {
    const b = out[i].indexOf('{');
    if (b >= 0) { out[i] = out[i].slice(0, b + 1) + ' ' + hoist.join(' ') + ' ' + out[i].slice(b + 1); break; }
  }
  return out;
}

// Compila um estágio; ao falhar, tenta "consertar" incompatibilidades entre
// GLSL desktop e GLSL ES nas linhas com erro:
//   • conversões int→float implícitas;
//   • inicializadores globais não constantes (movidos para o início de main()).
function compileStage(gl, type, header, bodyLines) {
  const hl = header.split('\n').length - 1;
  const lines = bodyLines.slice();
  _normalizeMacros(lines);
  const intNames = _collectIntNames(lines);
  const fixed = new Map();
  const wrapped = new Set();
  const hoist = [];
  let lastLog = '';
  for (let round = 0; round < 16; round++) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, header + _withHoist(lines, hoist).join('\n'));
    gl.compileShader(sh);
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return { shader: sh, fixes: fixed.size };
    lastLog = gl.getShaderInfoLog(sh) || 'erro desconhecido';
    gl.deleteShader(sh);
    const idxs = new Map();
    for (const m of lastLog.matchAll(/ERROR:\s*\d+:(\d+):\s*([^\n]*)/g)) {
      const i = +m[1] - 1 - hl;
      if (i >= 0 && i < lines.length && (fixed.get(i) || 0) < 3) idxs.set(i, (idxs.get(i) || '') + ' ' + m[2]);
    }
    let changed = false;
    for (const [i, msg] of idxs) {
      fixed.set(i, (fixed.get(i) || 0) + 1);
      let nl = lines[i];
      if (/global variable initializers must be constant/.test(msg)) {
        if (_wrapGlobalInit(lines, i, hoist, hoist.length)) changed = true;
        continue;
      } else if (/to '(?:const )?(?:highp )?uint'/.test(msg) || /uint/.test(msg) && /const int/.test(msg)) {
        nl = nl.replace(/(?<![\w.])(\d+)(?![\w.])/g, '$1u');
      } else if (/\b(?:const|highp|mediump|lowp)?\s*int\b|ivec/.test(msg) || /no matching overloaded/.test(msg)) {
        const fm = /'(\w+)'\s*:\s*no matching overloaded function/.exec(msg);
        if (fm && _FLOAT_ONLY_FN.has(fm[1])) { if (_wrapCallArgs(lines, fm[1], intNames, wrapped)) { changed = true; nl = lines[i]; } }
        else nl = _fixLine(nl, intNames);
      }
      if (nl !== lines[i]) { lines[i] = nl; changed = true; }
    }
    if (!changed) break;
  }
  // Busca por subconjuntos: linhas teimosas (envolver TODOS os nomes int pode
  // quebrar chamadas que esperam int). Testa variantes com menos envolvimentos.
  const remaining = [];
  for (const m of lastLog.matchAll(/ERROR:\s*\d+:(\d+):/g)) { const i = +m[1] - 1 - hl; if (i >= 0 && i < lines.length && !remaining.includes(i)) remaining.push(i); }
  if (remaining.length && remaining.length <= 6) {
    const origLines = bodyLines.slice(); _normalizeMacros(origLines);
    for (const i of remaining) {
      const orig = origLines[i] ?? lines[i];
      if (/^\s*#/.test(orig)) continue;
      const cands = [...intNames].filter((n) => new RegExp('(?<![\\w.])' + n + '(?![\\w])').test(orig)).slice(0, 5);
      const variants = [];
      for (let mask = 0; mask < (1 << cands.length); mask++) {
        const names = cands.filter((_, k) => mask & (1 << k));
        for (const lits of [true, false]) variants.push({ names, lits });
      }
      variants.sort((a, b) => a.names.length - b.names.length);
      for (const v of variants.slice(0, 40)) {
        const trial = _fixLine(orig, new Set(v.names), { names: v.names, lits: v.lits });
        if (trial === lines[i]) continue;
        const keep = lines[i]; lines[i] = trial;
        const sh = gl.createShader(type);
        gl.shaderSource(sh, header + _withHoist(lines, hoist).join('\n'));
        gl.compileShader(sh);
        const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
        const log = ok ? '' : (gl.getShaderInfoLog(sh) || '');
        if (ok) return { shader: sh, fixes: fixed.size + 1 };
        gl.deleteShader(sh);
        const stillBad = [...log.matchAll(/ERROR:\s*\d+:(\d+):/g)].some((m) => +m[1] - 1 - hl === i);
        if (!stillBad) { lastLog = log; break; }
        lines[i] = keep;
      }
    }
    // última tentativa com as correções acumuladas
    const sh2 = gl.createShader(type);
    gl.shaderSource(sh2, header + _withHoist(lines, hoist).join('\n'));
    gl.compileShader(sh2);
    if (gl.getShaderParameter(sh2, gl.COMPILE_STATUS)) return { shader: sh2, fixes: fixed.size + 1 };
    lastLog = gl.getShaderInfoLog(sh2) || lastLog;
    gl.deleteShader(sh2);
  }
  const short = lastLog.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 4).join('\n');
  return { error: short || lastLog.slice(0, 400), log: lastLog, final: _withHoist(lines, hoist), hl };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. RUNTIME (WebGL2 puro)
// ════════════════════════════════════════════════════════════════════════════
const _SAMPLER_ALIAS = {
  gcolor: 'colortex0', gdepth: 'colortex1', gnormal: 'colortex2', composite: 'colortex3',
  gaux1: 'colortex4', gaux2: 'colortex5', gaux3: 'colortex6', gaux4: 'colortex7',
  gdepthtex: 'depthtex0', shadow: 'shadowtex0', watershadow: 'shadowtex1',
  shadowcolor: 'shadowcolor0',
};

const _INIT_FS = `${_COMMON_PRELUDE}
uniform sampler2D uScene; uniform sampler2D uNormal; uniform sampler2D uDepth;
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  vec3 c = max(texture(uScene, vUv).rgb, 0.0);
  o0 = vec4(pow(min(c, vec3(32.0)), vec3(1.0 / 2.2)), 1.0);
  float d = texture(uDepth, vUv).r;
  vec3 n = (d >= 0.99999) ? vec3(0.5, 0.5, 1.0) : texture(uNormal, vUv).rgb;
  o1 = vec4(n, 1.0);
}`;
const _CONVERT_FS = `${_COMMON_PRELUDE}
uniform sampler2D uTex;
in vec2 vUv;
out vec4 o;
void main() { vec4 c = texture(uTex, vUv); o = vec4(pow(max(c.rgb, 0.0), vec3(2.2)), 1.0); }`;
const _QUAD_VS = `${_COMMON_PRELUDE}
layout(location = 0) in vec2 ncm_apos;
out vec2 vUv;
void main() { vUv = ncm_apos; gl_Position = vec4(ncm_apos * 2.0 - 1.0, 0.0, 1.0); }`;

function _simpleProgram(gl, vs, fs) {
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

let _texId = 1;

export class PackRuntime {
  constructor(gl, pack, overrides) {
    this.gl = gl;
    this.pack = pack;
    this.overrides = overrides || new Map();
    this.programs = [];
    this.report = [];
    this.bufs = [];                 // index → { tex:[a,b], cur }
    this.clearFlags = new Map();
    this.fboCache = new Map();
    this.w = 0; this.h = 0;
    this.built = false;
    this.usesShadow = false;
    this.shadowDistance = 128;
    this.shadowRes = 2048;
    this.maxBuf = 0;
    this.noise = null;
    this.dummyBlack = null;
    this.dummyWhite = null;
    this.finalTex = null;
    this.outTex = null;
  }

  // ── build ────────────────────────────────────────────────────────────────
  build() {
    const gl = this.gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.initProg = this._wrapSimple(_INIT_FS, ['uScene', 'uNormal', 'uDepth']);
    this.convProg = this._wrapSimple(_CONVERT_FS, ['uTex']);

    const scan = [];
    for (const name of this.pack.programNames()) {
      const rep = { name, ok: false, error: null, fixes: 0 };
      this.report.push(rep);
      try {
        const fshPath = this.pack.findFile(name + '.fsh');
        const fLines = this.pack.preprocess(fshPath, this.overrides);
        const vshPath = this.pack.findFile(name + '.vsh');
        const vLines = vshPath ? this.pack.preprocess(vshPath, this.overrides) : null;
        scan.push(fLines.join('\n'));

        const f = translateStage(fLines, 'frag');
        const fr = compileStage(gl, gl.FRAGMENT_SHADER, f.header, f.body);
        if (fr.error) { rep.error = 'Fragment: ' + fr.error; if (/#error/.test(fr.log || fr.error)) { rep.disabled = true; rep.error = 'Desativado pelo próprio shaderpack (#error): ' + ((/#error\s*(.*)/.exec(fr.log || '') || [])[1] || '').slice(0, 120); } continue; }
        let vr;
        if (vLines) {
          const v = translateStage(vLines, 'vert');
          vr = compileStage(gl, gl.VERTEX_SHADER, v.header, v.body);
        } else {
          vr = compileStage(gl, gl.VERTEX_SHADER, _COMMON_PRELUDE + _VERT_PRELUDE_TAIL, _DEFAULT_VSH_LINES);
        }
        if (vr.error) { rep.error = 'Vertex: ' + vr.error; gl.deleteShader(fr.shader); continue; }
        const prog = gl.createProgram();
        gl.attachShader(prog, vr.shader);
        gl.attachShader(prog, fr.shader);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          rep.error = 'Link: ' + (gl.getProgramInfoLog(prog) || '').split('\n').slice(0, 3).join(' ');
          continue;
        }
        const uniforms = [];
        const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) {
          const u = gl.getActiveUniform(prog, i);
          const loc = gl.getUniformLocation(prog, u.name);
          if (loc) uniforms.push({ name: u.name.replace(/\[0\]$/, ''), type: u.type, size: u.size, loc });
        }
        const samplers = uniforms.filter((u) => u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_2D_SHADOW);
        samplers.forEach((s, idx) => { s.unit = idx; });
        // Saídas realmente ativas (DRAWBUFFERS condicionais deixam saídas mortas)
        const activeWrites = new Set();
        for (const loc of f.writes) {
          if (f.ownOut || gl.getFragDataLocation(prog, 'ncm_out' + loc) >= 0) activeWrites.add(loc);
        }
        if (!activeWrites.size) activeWrites.add(0);
        const usesShadow = samplers.some((s) => /^shadow(tex|color)?[01]?$|^watershadow$/.test(s.name));
        if (usesShadow) this.usesShadow = true;
        for (const s of samplers) {
          const idx = this._bufIndexFor(s.name);
          if (idx >= 0) this.maxBuf = Math.max(this.maxBuf, idx);
        }
        for (const b of f.drawList) this.maxBuf = Math.max(this.maxBuf, b);
        this.programs.push({
          name, prog, uniforms, samplers, drawList: f.drawList.slice(0, 8), writes: activeWrites,
        });
        rep.ok = true; rep.fixes = (fr.fixes || 0) + (vr.fixes || 0);
      } catch (e) {
        rep.error = String(e && e.message || e);
      }
    }
    const all = scan.join('\n');
    for (const m of all.matchAll(/const\s+bool\s+colortex(\d)Clear\s*=\s*(true|false)/g)) this.clearFlags.set(+m[1], m[2] === 'true');
    const sd = /const\s+float\s+shadowDistance\s*=\s*([\d.]+)/.exec(all); if (sd) this.shadowDistance = +sd[1];
    const sr = /const\s+int\s+shadowMapResolution\s*=\s*(\d+)/.exec(all); if (sr) this.shadowRes = Math.min(4096, +sr[1]);
    this.maxBuf = Math.min(7, Math.max(this.maxBuf, 2));
    this.built = true;
    this.hasWork = this.programs.length > 0;
    return this.report;
  }

  _wrapSimple(fs, samplerNames) {
    const gl = this.gl;
    const prog = _simpleProgram(gl, _QUAD_VS, fs);
    const locs = {};
    for (const n of samplerNames) locs[n] = gl.getUniformLocation(prog, n);
    return { prog, locs };
  }

  _bufIndexFor(name) {
    const a = _SAMPLER_ALIAS[name] || name;
    const m = /^colortex(\d+)$/.exec(a);
    return m ? +m[1] : -1;
  }

  // ── recursos ─────────────────────────────────────────────────────────────
  _mkTex(w, h, kind) {
    const gl = this.gl;
    const t = gl.createTexture();
    t._id = _texId++;
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (kind === 'f16') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _solid(r, g, b, a) {
    const gl = this.gl;
    const t = gl.createTexture(); t._id = _texId++;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  async loadNoise() {
    const gl = this.gl;
    const pack = this.pack;
    let tex = null;
    const cands = [pack.props.get('texture.noise'), 'textures/noise.png', 'noisetex.png', 'noise.png'].filter(Boolean);
    for (const c of cands) {
      try {
        const bytes = await pack.getBytes(c.replace(/^\//, ''));
        if (!bytes) continue;
        const bmp = await createImageBitmap(new Blob([bytes]));
        tex = gl.createTexture(); tex._id = _texId++;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        break;
      } catch { /* tenta o próximo */ }
    }
    if (!tex) {
      const N = 256, data = new Uint8Array(N * N * 4);
      let s = 1234567;
      for (let i = 0; i < data.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; data[i] = s >>> 24; }
      tex = gl.createTexture(); tex._id = _texId++;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.noise = tex;
  }

  _ensureSize(w, h) {
    if (w === this.w && h === this.h && this.bufs.length) return;
    const gl = this.gl;
    for (const b of this.bufs) if (b) { gl.deleteTexture(b.tex[0]); gl.deleteTexture(b.tex[1]); }
    if (this.finalTex) gl.deleteTexture(this.finalTex);
    if (this.outTex) gl.deleteTexture(this.outTex);
    for (const f of this.fboCache.values()) gl.deleteFramebuffer(f);
    this.fboCache.clear();
    this.bufs = [];
    this.w = w; this.h = h;
    for (let i = 0; i <= this.maxBuf; i++) this.bufs[i] = { tex: [this._mkTex(w, h, 'f16'), this._mkTex(w, h, 'f16')], cur: 0 };
    this.finalTex = this._mkTex(w, h, 'f16');
    this.outTex = this._mkTex(w, h, 'f16');
    if (!this.dummyBlack) { this.dummyBlack = this._solid(0, 0, 0, 255); this.dummyWhite = this._solid(255, 255, 255, 255); }
  }

  _fbo(textures) {
    const gl = this.gl;
    const key = textures.map((t) => (t ? t._id : 0)).join(',');
    let f = this.fboCache.get(key);
    if (f) return f;
    f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    textures.forEach((t, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t || null, 0);
    });
    this.fboCache.set(key, f);
    return f;
  }

  _resolve(name, inputs) {
    const a = _SAMPLER_ALIAS[name] || name;
    let m = /^colortex(\d+)$/.exec(a);
    if (m) { const b = this.bufs[+m[1]]; return b ? b.tex[b.cur] : this.dummyBlack; }
    if (/^depthtex[012]$/.test(a)) return inputs.depth || this.dummyWhite;
    if (/^shadowtex[01]$/.test(a)) return inputs.shadowDepth || this.dummyWhite;
    if (/^shadowcolor[01]$/.test(a)) return this.dummyWhite;
    if (a === 'noisetex') return this.noise || this.dummyBlack;
    return this.dummyBlack;
  }

  _setUniforms(p, U, inputs) {
    const gl = this.gl;
    for (const s of p.samplers) {
      gl.activeTexture(gl.TEXTURE0 + s.unit);
      gl.bindTexture(gl.TEXTURE_2D, this._resolve(s.name, inputs));
      gl.uniform1i(s.loc, s.unit);
    }
    for (const u of p.uniforms) {
      if (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_2D_SHADOW) continue;
      const v = U[u.name];
      if (v === undefined) continue;
      switch (u.type) {
        case gl.FLOAT: gl.uniform1f(u.loc, +v); break;
        case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v | 0); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.INT_VEC2: gl.uniform2iv(u.loc, v); break;
        case gl.INT_VEC3: gl.uniform3iv(u.loc, v); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
        default: break;
      }
    }
  }

  _draw() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 6); }

  // ── execução ─────────────────────────────────────────────────────────────
  // inputs: { scene, depth, normal, shadowDepth, w, h }; U: dicionário de uniforms.
  run(inputs, U) {
    const gl = this.gl;
    this._ensureSize(inputs.w, inputs.h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.w, this.h);

    // 1) Inicialização: colortex0 = cena (sRGB), colortex2 = normais; limpa o resto.
    const b0 = this.bufs[0], b2 = this.bufs[2];
    const initFbo = this._fbo([b0.tex[b0.cur], b2 ? b2.tex[b2.cur] : null]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, initFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, b2 ? gl.COLOR_ATTACHMENT1 : gl.NONE]);
    gl.useProgram(this.initProg.prog);
    const L = this.initProg.locs;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inputs.scene); gl.uniform1i(L.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, inputs.normal || this.dummyBlack); gl.uniform1i(L.uNormal, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, inputs.depth || this.dummyWhite); gl.uniform1i(L.uDepth, 2);
    this._draw();
    for (let i = 0; i < this.bufs.length; i++) {
      if (i === 0 || i === 2) continue;
      if (this.clearFlags.get(i) === false) continue;
      const b = this.bufs[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo([b.tex[b.cur]]));
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    }

    // 2) Programas (prepare → deferred → composite)
    let finalProg = null;
    for (const p of this.programs) {
      if (p.name === 'final') { finalProg = p; continue; }
      this._runProgram(p, U, inputs, null);
    }
    // 3) final → finalTex (ou usa colortex0 se não houver final)
    let srcTex;
    if (finalProg) { this._runProgram(finalProg, U, inputs, this.finalTex); srcTex = this.finalTex; }
    else { const b = this.bufs[0]; srcTex = b.tex[b.cur]; }

    // 4) Conversão para linear → outTex (o Pass copia para o composer via three)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo([this.outTex]));
    gl.viewport(0, 0, this.w, this.h);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.useProgram(this.convProg.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(this.convProg.locs.uTex, 0);
    this._draw();
    gl.bindVertexArray(null);
    gl.useProgram(null);
  }

  _runProgram(p, U, inputs, toTex) {
    const gl = this.gl;
    let attach;
    const written = [];
    if (toTex) attach = [toTex];
    else {
      attach = p.drawList.map((bi, loc) => {
        const b = this.bufs[bi];
        if (!b || !p.writes.has(loc)) return null;
        written.push(bi);
        return b.tex[1 - b.cur];
      });
    }
    // buffers escritos mas não referenciados → NONE
    const fbo = this._fbo(attach);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.drawBuffers(attach.map((t, i) => (t ? gl.COLOR_ATTACHMENT0 + i : gl.NONE)));
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(p.prog);
    this._setUniforms(p, U, inputs);
    this._draw();
    for (const bi of written) this.bufs[bi].cur ^= 1;
  }

  dispose() {
    const gl = this.gl;
    for (const b of this.bufs) if (b) { gl.deleteTexture(b.tex[0]); gl.deleteTexture(b.tex[1]); }
    for (const p of this.programs) gl.deleteProgram(p.prog);
    for (const f of this.fboCache.values()) gl.deleteFramebuffer(f);
    if (this.finalTex) gl.deleteTexture(this.finalTex);
    if (this.outTex) gl.deleteTexture(this.outTex);
    if (this.noise) gl.deleteTexture(this.noise);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    this.programs = []; this.bufs = []; this.fboCache.clear();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 5. PASS (EffectComposer)
// ════════════════════════════════════════════════════════════════════════════
const _tmpV = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();

function _findSunDirection() {
  let dir = null;
  app.scene?.traverse((o) => {
    if (dir) return;
    const l = o.userData?.isLightObject && o.userData?.lightRef;
    if (l && l.isDirectionalLight) {
      l.getWorldPosition(_tmpV);
      if (l.target) l.target.getWorldPosition(_tmpV2); else _tmpV2.set(0, 0, 0);
      dir = _tmpV.clone().sub(_tmpV2);
      if (dir.lengthSq() < 1e-6) dir = null; else dir.normalize();
    }
  });
  return dir || new THREE.Vector3(0.4, 0.7, 0.5).normalize();
}

class ShaderPackPass extends Pass {
  constructor(mgr) {
    super();
    this.mgr = mgr;
    this.needsSwap = false;
    this.enabled = true;
    this.t0 = performance.now();
    this.frame = 0;
    this.prev = { mv: new THREE.Matrix4(), proj: new THREE.Matrix4(), pos: new THREE.Vector3(), has: false };
    this._sunCache = null; this._sunAge = 999;
    this._nrmMat = new THREE.MeshNormalMaterial();
    this._depthMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this._rt = null; this._shadowRT = null; this._shadowCam = null;
    this._U = {};
    this._copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false, depthWrite: false,
    });
    this._copyQuad = new FullScreenQuad(this._copyMat);
    this._wrapTex = new THREE.Texture();
  }

  _targets(w, h) {
    if (this._rt && this._rt.width === w && this._rt.height === h) return;
    this._rt?.dispose();
    const depth = new THREE.DepthTexture(w, h);
    this._rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, depthTexture: depth });
  }

  _renderOverride(renderer, camera, target, material) {
    const hidden = [];
    const hide = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
    hide(app.gridRoot); hide(app.axesHelper); hide(app._tcHelper);
    helperRegistry.objects.forEach(hide);
    app.scene.traverse((o) => {
      if (o.isPoints || o.isLine || o.isSprite) hide(o);
      else if (o.isMesh && o.material && o.material.visible === false) hide(o);
    });
    const prevT = renderer.getRenderTarget();
    const prevO = app.scene.overrideMaterial;
    const prevBg = app.scene.background;
    const prevClear = new THREE.Color(); renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    try {
      app.scene.overrideMaterial = material;
      app.scene.background = null;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(app.scene, camera);
    } finally {
      app.scene.overrideMaterial = prevO;
      app.scene.background = prevBg;
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.setRenderTarget(prevT);
      hidden.forEach((o) => { o.visible = true; });
    }
  }

  _uniforms(camera, w, h, sunDir, rt, shadowCam) {
    const U = this._U;
    camera.updateMatrixWorld(true);
    const mv = camera.matrixWorldInverse;
    const t = (performance.now() - this.t0) / 1000;
    U.gbufferModelView = mv.elements;
    U.gbufferModelViewInverse = camera.matrixWorld.elements;
    U.gbufferProjection = camera.projectionMatrix.elements;
    U.gbufferProjectionInverse = camera.projectionMatrixInverse.elements;
    const pv = this.prev.has ? this.prev : { mv, proj: camera.projectionMatrix, pos: camera.getWorldPosition(new THREE.Vector3()) };
    U.gbufferPreviousModelView = pv.mv.elements;
    U.gbufferPreviousProjection = pv.proj.elements;
    const cp = camera.getWorldPosition(new THREE.Vector3());
    U.cameraPosition = [cp.x, cp.y, cp.z];
    U.previousCameraPosition = [pv.pos.x, pv.pos.y, pv.pos.z];
    U.eyePosition = U.cameraPosition;
    const toView = (v) => { const r = new THREE.Vector3(v[0], v[1], v[2]).transformDirection(mv).multiplyScalar(100); return [r.x, r.y, r.z]; };
    const sun = [sunDir.x, sunDir.y, sunDir.z];
    U.sunPosition = toView(sun);
    U.moonPosition = toView([-sun[0], -sun[1], -sun[2]]);
    U.upPosition = toView([0, 1, 0]);
    const day = sun[1] > 0;
    U.shadowLightPosition = day ? U.sunPosition : U.moonPosition;
    const ang = (Math.atan2(sun[1], sun[0]) / (Math.PI * 2) + 1) % 1;
    U.sunAngle = ang;
    U.shadowAngle = day ? ang : (ang + 0.5) % 1;
    U.worldTime = Math.floor(((ang * 24000) + 0) % 24000);
    U.worldDay = 0;
    U.moonPhase = 0;
    U.viewWidth = w; U.viewHeight = h; U.aspectRatio = w / h;
    U.near = camera.near; U.far = camera.far;
    U.frameTimeCounter = t;
    U.frameTime = 1 / 60;
    U.frameCounter = this.frame;
    U.rainStrength = 0; U.wetness = 0; U.thunderStrength = 0;
    U.isEyeInWater = 0; U.eyeAltitude = cp.y;
    U.screenBrightness = 1; U.blindness = 0; U.nightVision = 0; U.darknessFactor = 0; U.darknessLightFactor = 0;
    U.centerDepthSmooth = 0.995;
    U.hideGUI = 0; U.heldItemId = 0; U.heldItemId2 = 0; U.heldBlockLightValue = 0; U.heldBlockLightValue2 = 0;
    U.playerMood = 0; U.entityId = 0; U.blockEntityId = 0;
    U.entityColor = [0, 0, 0, 0];
    U.fogMode = 0; U.fogDensity = 0.1; U.fogStart = 0; U.fogEnd = 1000;
    U.pixelSize = [1 / w, 1 / h];
    const bg = app.scene?.background;
    const col = bg && bg.isColor ? bg : new THREE.Color(0.47, 0.65, 1.0);
    U.skyColor = [col.r, col.g, col.b];
    const fc = app.scene?.fog?.color || col;
    U.fogColor = [fc.r, fc.g, fc.b];
    U.skyColor = U.skyColor.map((c) => Math.pow(c, 1 / 2.2));
    U.fogColor = U.fogColor.map((c) => Math.pow(c, 1 / 2.2));
    if (shadowCam) {
      U.shadowModelView = shadowCam.matrixWorldInverse.elements;
      U.shadowModelViewInverse = shadowCam.matrixWorld.elements;
      U.shadowProjection = shadowCam.projectionMatrix.elements;
      U.shadowProjectionInverse = shadowCam.projectionMatrixInverse.elements;
    }
    // Opções numéricas do shaders.properties: constantes comuns
    return U;
  }

  render(renderer, writeBuffer, readBuffer) {
    const rt = this.mgr.ensureRuntime(renderer);
    this.needsSwap = false;
    if (!rt || !rt.hasWork || !app.scene || !app.camera) return;
    const camera = app.camera;
    const w = readBuffer.width, h = readBuffer.height;
    if (!(w > 0 && h > 0)) return;

    this._targets(w, h);
    this._renderOverride(renderer, camera, this._rt, this._nrmMat);

    let shadowDepthTex = null;
    if (this._sunAge++ > 20 || !this._sunCache) { this._sunCache = _findSunDirection(); this._sunAge = 0; }
    const sunDir = this._sunCache;
    let shadowCam = null;
    if (rt.usesShadow) {
      const d = Math.max(8, rt.shadowDistance);
      if (!this._shadowCam || this._shadowCam._d !== d) {
        this._shadowCam = new THREE.OrthographicCamera(-d, d, d, -d, 0.1, d * 4);
        this._shadowCam._d = d;
      }
      const res = rt.shadowRes;
      if (!this._shadowRT || this._shadowRT.width !== res) {
        this._shadowRT?.dispose();
        this._shadowRT = new THREE.WebGLRenderTarget(res, res, { depthBuffer: true, depthTexture: new THREE.DepthTexture(res, res) });
      }
      const center = camera.getWorldPosition(new THREE.Vector3());
      const lightDir = sunDir.y > 0 ? sunDir : sunDir.clone().negate();
      this._shadowCam.position.copy(center).addScaledVector(lightDir, d * 2);
      this._shadowCam.up.set(0, 1, 0);
      if (Math.abs(lightDir.y) > 0.99) this._shadowCam.up.set(0, 0, 1);
      this._shadowCam.lookAt(center);
      this._shadowCam.updateMatrixWorld(true);
      this._shadowCam.updateProjectionMatrix();
      this._renderOverride(renderer, this._shadowCam, this._shadowRT, this._depthMat);
      shadowCam = this._shadowCam;
    }

    const U = this._uniforms(camera, w, h, sunDir, rt, shadowCam);
    const props = renderer.properties;
    const tex = (t) => (t ? props.get(t).__webglTexture : null);
    const gl = renderer.getContext();
    if (shadowCam) shadowDepthTex = tex(this._shadowRT.depthTexture);
    let ran = false;
    try {
      rt.run({
        scene: tex(readBuffer.texture),
        depth: tex(this._rt.depthTexture),
        normal: tex(this._rt.texture),
        shadowDepth: shadowDepthTex,
        w, h,
      }, U);
      ran = true;
    } catch (e) {
      console.warn('[shaderpack] falha ao executar:', e);
      this.mgr.fail(String(e && e.message || e));
    }
    renderer.resetState();
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ran) return;
    // Copia o resultado (textura própria) para o buffer do composer via three
    // (assim o MSAA/resolve do three continua funcionando).
    const wp = props.get(this._wrapTex);
    wp.__webglTexture = rt.outTex;
    wp.__webglInit = true;
    this._copyMat.uniforms.tDiffuse.value = this._wrapTex;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    // viewport explícito = alvo inteiro (evita "janelinhas" por viewport/scissor herdado)
    const tgt = this.renderToScreen ? null : writeBuffer;
    const vw = tgt ? tgt.width : renderer.domElement.width, vh = tgt ? tgt.height : renderer.domElement.height;
    renderer.state.scissor(new THREE.Vector4(0, 0, vw, vh)); renderer.state.viewport(new THREE.Vector4(0, 0, vw, vh));
    gl.disable(gl.SCISSOR_TEST);
    this._copyQuad.render(renderer);

    this.prev.mv.copy(camera.matrixWorldInverse);
    this.prev.proj.copy(camera.projectionMatrix);
    camera.getWorldPosition(this.prev.pos);
    this.prev.has = true;
    this.frame++;
    this.needsSwap = true;
    this.mgr.touchRuntime();
  }

  dispose() {
    this._rt?.dispose(); this._shadowRT?.dispose();
    this._nrmMat.dispose(); this._depthMat.dispose();
    this._copyMat.dispose(); this._copyQuad.dispose();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 6. MANAGER (estado global, opções, persistência)
// ════════════════════════════════════════════════════════════════════════════
const mgr = {
  pack: null, name: '', enabled: false, overrides: new Map(),
  runtime: null, pass: null, error: null, listeners: new Set(), buffer: null,
  noiseLoaded: false,

  ensureRuntime(renderer) {
    if (!this.pack) return null;
    if (this.runtime) return this.runtime;
    try {
      const gl = renderer.getContext();
      const rt = new PackRuntime(gl, this.pack, this.overrides);
      rt.build();
      rt.loadNoise().then(() => { this.notify(); markSceneDirty(); });
      this.runtime = rt;
      this.error = rt.report.every((r) => !r.ok) ? 'Nenhum programa do shaderpack compilou.' : null;
      renderer.resetState();
      this.notify();
    } catch (e) {
      this.error = String(e && e.message || e);
      this.runtime = null;
    }
    return this.runtime;
  },
  touchRuntime() {},
  fail(msg) { this.error = msg; this.notify(); },
  notify() { for (const cb of this.listeners) { try { cb(getShaderPackState()); } catch { /* ignore */ } } },
  reset() {
    this.runtime?.dispose(); this.runtime = null;
  },
};

export function onShaderPackChange(cb) { mgr.listeners.add(cb); return () => mgr.listeners.delete(cb); }

export function getShaderPackState() {
  return {
    loaded: !!mgr.pack,
    name: mgr.name,
    enabled: mgr.enabled,
    error: mgr.error,
    report: mgr.runtime ? mgr.runtime.report.map((r) => ({ ...r })) : null,
    options: mgr.pack ? mgr.pack.options().map((o) => ({ ...o, value: mgr.overrides.has(o.name) ? mgr.overrides.get(o.name) : o.def })) : [],
    programs: mgr.pack ? mgr.pack.programNames() : [],
    warnings: mgr.pack ? mgr.pack.warnings.slice(0, 20) : [],
    hasGbuffers: mgr.pack ? [...mgr.pack.texts.keys()].some((k) => /gbuffers_/i.test(k)) : false,
  };
}

export function getShaderPackPass() {
  if (!mgr.enabled || !mgr.pack) return null;
  if (!mgr.pass) mgr.pass = new ShaderPackPass(mgr);
  return mgr.pass;
}

export async function loadShaderPackFromBuffer(buffer, name) {
  const entries = readZip(buffer);
  let root = null;
  for (const n of entries.keys()) {
    const i = n.indexOf('shaders/');
    if (i >= 0 && (i === 0 || n[i - 1] === '/')) {
      const p = n.slice(0, i + 8);
      if (root === null || p.length < root.length) root = p;
    }
  }
  if (root === null) throw new Error('Esta não parece ser um shaderpack Java: a pasta "shaders/" não foi encontrada dentro do .zip.');
  const texts = new Map();
  const files = new Map();
  const dec = new TextDecoder('utf-8');
  for (const [n, e] of entries) {
    if (!n.startsWith(root)) continue;
    const rel = n.slice(root.length);
    files.set(rel, e);
    if (_TEXT_EXT.test(rel)) texts.set(rel, dec.decode(await e.read()));
  }
  const pack = new ShaderPack(name, texts, files);
  if (!pack.programNames().length) {
    throw new Error('Nenhum programa composite/final encontrado nesse shaderpack. O Nexus só consegue importar os passes de pós-processamento (composite/final).');
  }
  mgr.reset();
  mgr.pack = pack;
  mgr.name = name.replace(/\.zip$/i, '');
  mgr.buffer = buffer;
  mgr.overrides = new Map();
  mgr.error = null;
  mgr.pass = null;
  return getShaderPackState();
}

// ZIP "stored" em memória (para pastas / arquivos soltos) — reaproveita o mesmo
// caminho do .zip e a persistência.
let _crcT = null;
function _crc32(u8) {
  if (!_crcT) { _crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; _crcT[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = _crcT[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function _zipFromFiles(list) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  for (const { name, file } of list) {
    const nb = enc.encode(name);
    const data = new Uint8Array(await file.arrayBuffer());
    const crc = _crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, list.length, true); end.setUint16(10, list.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return await new Blob([...parts, ...central, new Uint8Array(end.buffer)]).arrayBuffer();
}

// Aceita: um .zip, uma pasta inteira (webkitdirectory) ou vários arquivos soltos.
export async function importShaderPackFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) throw new Error('Nenhum arquivo selecionado.');
  let buf, name;
  const head = files.length === 1 ? new Uint8Array(await files[0].slice(0, 4).arrayBuffer()) : null;
  if (head && head[0] === 0x50 && head[1] === 0x4b) { buf = await files[0].arrayBuffer(); name = files[0].name; }
  else {
    const list = files.map((f) => ({ name: (f.webkitRelativePath || f.name).replace(/\\/g, '/'), file: f }));
    const top = (list[0].name.split('/')[0]) || 'shaderpack';
    name = list.some((x) => x.name.includes('/')) ? top : (files[0].name.replace(/\.[^.]+$/, '') || 'shaderpack');
    buf = await _zipFromFiles(list);
  }
  const st = await loadShaderPackFromBuffer(buf, name);
  mgr.enabled = true; await _persist(); markSceneDirty(); mgr.notify();
  return st;
}

export async function importShaderPackFile(file) {
  const buf = await file.arrayBuffer();
  const st = await loadShaderPackFromBuffer(buf, file.name);
  mgr.enabled = true;
  await _persist();
  markSceneDirty();
  mgr.notify();
  return st;
}

export function setShaderPackEnabled(on) {
  mgr.enabled = !!on && !!mgr.pack;
  _persist();
  markSceneDirty();
  mgr.notify();
}

export function setShaderPackOption(name, value) {
  if (!mgr.pack) return;
  mgr.overrides.set(name, value);
  rebuildShaderPack();
}

export function resetShaderPackOptions() {
  mgr.overrides = new Map();
  rebuildShaderPack();
}

export function rebuildShaderPack() {
  mgr.reset();
  mgr.error = null;
  _persist();
  markSceneDirty();
  mgr.notify();
}

export function removeShaderPack() {
  mgr.reset();
  mgr.pack = null; mgr.name = ''; mgr.enabled = false; mgr.buffer = null; mgr.overrides = new Map(); mgr.pass = null; mgr.error = null;
  _idb('delete');
  markSceneDirty();
  mgr.notify();
}

// ── Hook: desliga o tone mapping do renderer enquanto o shaderpack roda ──────
export function attachOutputPassHook(outputPass) {
  if (!outputPass || outputPass._ncmPackHook) return;
  outputPass._ncmPackHook = true;
  const orig = outputPass.render.bind(outputPass);
  outputPass.render = function (renderer, ...rest) {
    const active = !!(mgr.enabled && mgr.pack && mgr.runtime && mgr.runtime.hasWork);
    if (!active) return orig(renderer, ...rest);
    const tm = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    try { return orig(renderer, ...rest); } finally { renderer.toneMapping = tm; }
  };
}

// ── Persistência (IndexedDB) ─────────────────────────────────────────────────
function _idb(op, value) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('nexus-shaderpack', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
        const st = tx.objectStore('kv');
        const r = op === 'get' ? st.get('current') : op === 'put' ? st.put(value, 'current') : st.delete('current');
        r.onsuccess = () => resolve(r.result ?? null);
        r.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      };
    } catch { resolve(null); }
  });
}

async function _persist() {
  if (!mgr.pack || !mgr.buffer) return;
  await _idb('put', { name: mgr.name + '.zip', buffer: mgr.buffer, enabled: mgr.enabled, overrides: [...mgr.overrides.entries()] });
}

export async function restoreShaderPack() {
  const rec = await _idb('get');
  if (!rec || !rec.buffer) return null;
  try {
    await loadShaderPackFromBuffer(rec.buffer, rec.name || 'shaderpack.zip');
    mgr.overrides = new Map(rec.overrides || []);
    mgr.enabled = !!rec.enabled;
    mgr.notify();
    markSceneDirty();
    return getShaderPackState();
  } catch (e) {
    console.warn('[shaderpack] restauração falhou:', e);
    return null;
  }
}

// Exposto para testes (Node/Playwright)
export function buildShaderPackNow() {
  if (!mgr.pack || !app.renderer) return null;
  mgr.ensureRuntime(app.renderer);
  return getShaderPackState();
}

export function _getPack() { return mgr.pack; }
export const _internals = { translateStage, compileStage, readZip, ShaderPack, PackRuntime };
