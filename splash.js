const splash = document.getElementById('splashScreen');

function hideSplash() {
  if (!splash || splash.classList.contains('done')) return;
  splash.classList.add('done');
  window.setTimeout(() => {
    if (splash) splash.style.display = 'none';
    // Menu Updates (index.html): só deve aparecer depois que a splash
    // realmente sumiu da tela, não junto com o início do fade-out.
    window.dispatchEvent(new Event('_splashHidden'));
  }, 420);
}

window.addEventListener('_nexusEngineReady', hideSplash, { once: true });
