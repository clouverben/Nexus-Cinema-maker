const splash = document.getElementById('splashScreen');

function hideSplash() {
  if (!splash || splash.classList.contains('done')) return;
  splash.classList.add('done');
  window.setTimeout(() => {
    if (splash) splash.style.display = 'none';
  }, 420);
}

window.addEventListener('_nexusEngineReady', hideSplash, { once: true });
