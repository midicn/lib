/* midicn-lib Service Worker · 缓存策略 */
const V = 'midicn-v4';
const CORE = ['./', './index.html', './manifest.json', './assets/style.css',
  './download.html', './sources.html', './licenses.html',
  './vendor/Tone.js', './vendor/Midi.js', './soundfont/engine/js-synthesizer.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;

  /* MIDI 音频文件：cache-first（听过就永久缓存） */
  if (p.endsWith('.mid') || p.endsWith('.midi')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(V).then(c => c.put(req, res.clone()));
      return res;
    })));
    return;
  }
  /* 索引与分片：stale-while-revalidate（先给缓存，后台更新） */
  if (p.endsWith('.json') || p.endsWith('.js') || p.endsWith('.css') || p === '/' || p.endsWith('.html')) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok) caches.open(V).then(c => c.put(req, res.clone())); return res; })
        .catch(() => hit);
      return hit || net;
    }));
    return;
  }
});
