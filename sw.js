// Service worker: app abre offline e reaproveita o que já foi visto.
const VERSAO = "rj-v1";
const BASE = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "img/icon-192.png",
  "fonts/Anton-latin.woff2", "fonts/Archivo-latin.woff2"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO && k !== "rj-dados" && k !== "rj-fotos").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const p = u.pathname;
  if (p.includes("/img/f/") || p.includes("/fonts/")) {           // fotos e fontes: cache primeiro
    e.respondWith(caches.open("rj-fotos").then(async c => (await c.match(e.request)) ||
      fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (p.includes("/data/")) {                                // dados: rede primeiro, cache se offline
    e.respondWith(caches.open("rj-dados").then(c => fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
      .catch(() => c.match(e.request, { ignoreSearch: p.endsWith("index.json") }))));
  } else {                                                          // app: rede primeiro
    e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(VERSAO).then(c => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
  }
});
