/* Service worker: dopo la prima visita l'app si apre anche senza connessione.
   Strategia "rete prima, cache come ripiego": con internet carica sempre la versione più recente
   (così pagina, stili e programma restano della stessa versione); senza internet, o se la rete
   non risponde entro 3 secondi, usa la copia salvata. */
const CACHE = 'guardiano-v10';
const ASSETS = ['./', 'index.html', 'style.css', 'qr.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'vendor/jsqr.js'];
const NETWORK_TIMEOUT = 3000;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(new Request(a, { cache: 'reload' })).catch(() => {})))) // un file assente non blocca l'installazione
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // 'no-cache': controlla sempre col server (se non è cambiato risponde subito "304") invece di fidarsi della cache del browser
    const fresh = fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    fresh.catch(() => {}); // evita errori non gestiti se la rete cade dopo il timeout
    try {
      return await Promise.race([fresh, new Promise((_, no) => setTimeout(no, NETWORK_TIMEOUT))]);
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match('index.html')) || fresh;
    }
  })());
});
