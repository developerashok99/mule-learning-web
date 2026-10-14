import type { APIRoute } from "astro";

/**
 * Service worker: makes visited pages, styles, scripts and slide images available offline.
 * Audio and video are never cached (large files, range requests); they always stream from the network.
 */
const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
const version = Date.now().toString(36);

const sw = `
const BASE = ${JSON.stringify(base)};
const VERSION = ${JSON.stringify(version)};
const PAGES = "pages-" + VERSION, STATIC = "static-" + VERSION, IMAGES = "images-v1";
const MAX_IMAGES = 400;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll([BASE, BASE + "404.html"]).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![PAGES, STATIC, IMAGES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  if (req.headers.has("range") || /\\.(mp3|mp4|m4a|webm|ogg|wav)$/i.test(url.pathname)) return;

  if (req.mode === "navigate") {
    // network first, so content updates show immediately; cached copy when offline
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match(BASE + "404.html"))));
    return;
  }
  if (url.pathname.startsWith(BASE + "_astro/") || url.pathname.startsWith(BASE + "icons/")) {
    // hashed build assets never change: cache first
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.pathname.startsWith(BASE + "notes-assets/")) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(IMAGES).then((c) => c.put(req, copy)).then(() => trim(IMAGES, MAX_IMAGES)); }
      return res;
    })));
  }
});
`;

export const GET: APIRoute = () => new Response(sw, { headers: { "Content-Type": "text/javascript" } });
