// Service Worker: オフラインでもアプリの殻(ひとり練習・図鑑・実績・ショップ・ルール)が開けるようにする。
//
// 方針: このアプリは頻繁に更新され、クライアントJSとサーバのWebSocketプロトコルが
// 食い違うと壊れる (実際に何度か事故った)。なので「オンライン中は常に最新を取りに行き、
// 取れないときだけキャッシュで代用する」= ネットワーク優先。キャッシュファーストにはしない。
//
// バージョンを上げると古いキャッシュは activate 時に破棄される。
const CACHE_VERSION = "v1";
const CACHE_NAME = `hiragana-mahjong-${CACHE_VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./src/ui.js",
  "./src/engine.js",
  "./src/ai.js",
  "./src/achievements.js",
  "./src/collection.js",
  "./src/economy.js",
  "./src/net.js",
  "./src/rank.js",
  "./src/share.js",
  "./src/sound.js",
  "./src/storage.js",
  "./src/data/words.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;               // WebSocketのハンドシェイクやPOSTには関与しない
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 他オリジンは素通し
  if (url.pathname === "/ws") return;              // WebSocket自体はfetchに乗らないが念のため除外

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 成功したら常にキャッシュを更新しておく (次にオフラインになったときの保険)
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
