// prisma-render.js — Render em tempo real no estilo Prisma 3D.
//
// Filosofia (a mesma do Prisma 3D): o viewport É o render. Luzes, sombras e
// materiais PBR aparecem na hora, a cada frame, sem "esperar refinar" e sem
// reiniciar quando a câmera mexe. Nada de acumulação temporal.
//
// O que muda entre as qualidades é só o anti-aliasing (MSAA) do pipeline de
// pós-processamento. Sombras continuam sendo controladas por luz (painel de
// luzes), então este módulo não mexe nelas.
import { markSceneDirty } from './scene.js';

export const PRISMA_QUALITY_PRESETS = Object.freeze({
  fast:     Object.freeze({ id: 'fast',     label: 'Rápido',     msaa: 0, hint: 'Sem suavização de bordas no pós-processamento. Máxima velocidade.' }),
  balanced: Object.freeze({ id: 'balanced', label: 'Balanceado', msaa: 4, hint: 'MSAA 4x. Bom equilíbrio entre qualidade e desempenho.' }),
  high:     Object.freeze({ id: 'high',     label: 'Alto',       msaa: 8, hint: 'MSAA 8x (limitado pelo que a GPU suporta). Bordas mais limpas.' }),
});

const STORAGE_KEY = 'ncm.prismaQuality';
const DEFAULT_ID = 'balanced';

let _qualityId = DEFAULT_ID;

try {
  const saved = window.localStorage?.getItem(STORAGE_KEY);
  if (saved && PRISMA_QUALITY_PRESETS[saved]) _qualityId = saved;
} catch { /* localStorage indisponível: segue com o padrão */ }

export function getPrismaQualityId() {
  return _qualityId;
}

export function getPrismaQuality() {
  return PRISMA_QUALITY_PRESETS[_qualityId] || PRISMA_QUALITY_PRESETS[DEFAULT_ID];
}

export function setPrismaQuality(id) {
  if (!PRISMA_QUALITY_PRESETS[id]) return false;
  _qualityId = id;
  try { window.localStorage?.setItem(STORAGE_KEY, id); } catch { /* ignora */ }
  _syncHint();
  markSceneDirty();
  window.dispatchEvent(new CustomEvent('prisma-quality-changed', { detail: { id } }));
  return true;
}

function _syncHint() {
  const hint = document.getElementById('prismaQualityHint');
  if (hint) hint.textContent = getPrismaQuality().hint;
}

// Liga o <select id="prismaQualitySelect"> do painel Render.
export function bindPrismaQualityUI() {
  const select = document.getElementById('prismaQualitySelect');
  if (select && !select.dataset.prismaBound) {
    select.dataset.prismaBound = '1';
    select.value = _qualityId;
    select.addEventListener('change', () => setPrismaQuality(select.value));
  }
  _syncHint();
}
