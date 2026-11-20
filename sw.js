// Offline-Cache: App funktioniert auch ohne Internet
const CACHE = "songtool-v14";
const FILES = ["./", "index.html", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "piano/A1.mp3", "piano/C2.mp3", "piano/Ds2.mp3", "piano/Fs2.mp3", "piano/A2.mp3", "piano/C3.mp3", "piano/Ds3.mp3", "piano/Fs3.mp3", "piano/A3.mp3", "piano/C4.mp3", "piano/Ds4.mp3", "piano/Fs4.mp3", "piano/A4.mp3", "piano/C5.mp3", "piano/Ds5.mp3", "piano/Fs5.mp3", "piano/A5.mp3", "piano/C6.mp3"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Netzwerk zuerst (damit Updates sofort ankommen), sonst Cache
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
