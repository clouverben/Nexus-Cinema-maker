// light-shadows.js — Interruptor global das sombras projetadas pelas luzes.
//
// Quando as sombras estão "removidas":
//   • toda luz com castShadow=true é desligada (e marcada como suprimida);
//   • luzes novas, projetos carregados e "desfazer" que reativem sombra são
//     suprimidos de novo no próximo frame (ver enforceLightShadows);
//   • a configuração de cada luz (mapa, bias, raio…) NÃO é tocada — ao
//     restaurar, cada luz volta exatamente como estava.
//
// Usa castShadow=false (e não renderer.shadowMap.enabled) porque mudar o
// número de luzes com sombra faz o three.js recompilar os materiais sozinho;
// desligar o shadowMap global deixaria a última sombra "congelada" na tela.
import { app, markSceneDirty } from './scene.js';

let _enabled = true;   // true = luzes projetam sombra normalmente

export function areLightShadowsEnabled() {
  return _enabled;
}

/** A luz "quer" projetar sombra? (ignora a supressão global) */
export function lightShadowIntent(light) {
  return !!(light && (light.castShadow || light.userData?.shadowSuppressed));
}

function forEachLight(fn) {
  app.scene?.traverse((o) => { if (o.isLight && o.shadow) fn(o); });
}

/**
 * Chamada a cada frame antes de desenhar. Só custa algo enquanto as sombras
 * estão removidas; no modo normal retorna na primeira linha.
 */
export function enforceLightShadows() {
  if (_enabled) return;
  forEachLight((l) => {
    if (l.castShadow) {
      l.castShadow = false;
      l.userData.shadowSuppressed = true;
    }
  });
}

export function setLightShadowsEnabled(enabled) {
  const next = !!enabled;
  if (next === _enabled) { _syncButton(); return; }
  _enabled = next;
  if (next) {
    forEachLight((l) => {
      if (l.userData?.shadowSuppressed) {
        l.castShadow = true;
        l.userData.shadowSuppressed = false;
      }
    });
  } else {
    enforceLightShadows();
  }
  _syncButton();
  markSceneDirty();
}

/** O usuário pediu explicitamente sombra desligada nesta luz (mapa = 0). */
export function clearShadowSuppression(light) {
  if (light?.userData) light.userData.shadowSuppressed = false;
}

function _syncButton() {
  const btn = document.getElementById('lightShadowsToggle');
  if (!btn) return;
  btn.classList.toggle('active', !_enabled);
  btn.setAttribute('aria-pressed', String(!_enabled));
  const label = btn.querySelector('.lhShadowLabel');
  if (label) label.textContent = _enabled ? 'Remover sombras' : 'Restaurar sombras';
  const hint = document.getElementById('lightShadowsHint');
  if (hint) {
    hint.textContent = _enabled
      ? 'Desliga a sombra projetada por todas as luzes da cena (as configurações de cada luz são mantidas).'
      : 'Nenhuma luz projeta sombra agora. Clique para voltar ao que cada luz tinha configurado.';
  }
}

export function bindLightShadowsButton() {
  const btn = document.getElementById('lightShadowsToggle');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => setLightShadowsEnabled(!_enabled));
  }
  _syncButton();
}
