/* midicn-lib Service Worker · 缓存策略 v7
   ├─ HTML 文档：network-first —— 保证总能拿到最新版页面代码（修 bug 后立即生效）
   ├─ 索引/分片/脚本/样式：stale-while-revalidate —— 秒开 + 后台自更新
   ├─ MIDI 音频：cache-first —— 听过就永久缓存
   └─ 音源 (sf2/sf2.gz)：cache-first —— 30MB 只下载一次，之后秒开                     */
const V = 'midicn-v7';
const CORE = ['./', './index.html', './manifest.json', './assets/style.css',
  './download.html', './sources.html', './licenses.html', './provenance.html',
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

  /* ① HTML 文档：network-first（离线时回落缓存）—— 避免用户卡在旧版页面 */
  if (req.mode === 'navigate' || p === '/' || p.endsWith('.html')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) caches.open(V).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./')))
    );
    return;
  }

  /* ② MIDI 音频文件：cache-first（听过就永久缓存） */
  if (p.endsWith('.mid') || p.endsWith('.midi')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(V).then(c => c.put(req, res.clone()));
      return res;
    })));
    return;
  }

  /* ②-b 音源文件：cache-first（30MB 只下载一次） */
  if (p.endsWith('.sf2') || p.endsWith('.sf2.gz')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(V).then(c => c.put(req, res.clone()));
      return res;
    })));
    return;
  }

  /* ③ 索引与分片 / 脚本 / 样式：stale-while-revalidate（先给缓存，后台更新） */
  if (p.endsWith('.json') || p.endsWith('.js') || p.endsWith('.css')) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok) caches.open(V).then(c => c.put(req, res.clone())); return res; })
        .catch(() => hit);
      return hit || net;
    }));
    return;
  }
});
