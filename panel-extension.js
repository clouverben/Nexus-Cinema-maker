// panel-extension.js — Botão ">" do painel direito.
//
// Troca a lista de Objetos por uma "extensão" do que estiver aberto à esquerda:
//   material  → visualizador + Especularidade / Suavidade / Emissão
//   animation → Graph Editor (modo Animação)
//   (outros)  → aviso "sem extensão"
//
// A lógica de qual extensão mostrar fica aqui (testável sem o main.js); o main.js
// só informa o contexto atual chamando sync(kind).

const TITLES = {
  material: 'Material',
  animation: 'Animação',
  none: 'Extensão',
};

export function createPanelExtension() {
  const $ = (id) => document.getElementById(id);
  const btn       = $('panelExtensionToggleBtn');
  const root      = $('panelExtension');
  const objects   = $('objectsSection');
  const title     = document.querySelector('#rightPanelHeader .rightPanelTitle');
  const sections  = {
    material:  $('panelExtensionMaterial'),
    animation: $('panelExtensionAnimation'),
    none:      $('panelExtensionEmpty'),
  };
  const objectsTitle = title ? title.textContent : 'Objetos';

  let open = false;
  let kind = null;      // 'material' | 'animation' | null

  function render() {
    if (!root) return;
    objects?.classList.toggle('hidden', open);
    root.classList.toggle('hidden', !open);
    btn?.classList.toggle('active', open);
    btn?.setAttribute('aria-pressed', String(open));
    if (title) title.textContent = open ? (TITLES[kind] || TITLES.none) : objectsTitle;
    if (!open) return;

    const shown = kind && sections[kind] ? kind : 'none';
    Object.entries(sections).forEach(([k, el]) => el?.classList.toggle('hidden', k !== shown));

    // O Graph Editor mede o próprio canvas: enquanto a extensão estava escondida
    // ele não tinha tamanho. Pede o redesenho já com o painel visível.
    if (shown === 'animation') {
      requestAnimationFrame(() => window.dispatchEvent(new Event('_animGraphRefresh')));
    }
  }

  btn?.addEventListener('click', () => { open = !open; render(); });

  return {
    /** Informa qual extensão faz sentido agora e atualiza a tela. */
    sync(nextKind) { kind = nextKind || null; render(); },
    isOpen() { return open; },
    close() { open = false; render(); },
    getKind() { return kind; },
  };
}
