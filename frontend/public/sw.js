/* ThreatLens AI service worker.
 * Purpose: let the static frontend reopen and run the LOCAL rule engine with no connection, after one successful online load.
 * It caches the application shell only. It never intercepts cross-origin requests (the API, fonts) or non-GET requests, never
 * touches /api or /health, and never stores user input. API responses are therefore never served stale.
 * The two placeholders below are replaced at build time by the "threatlens-sw" plugin in vite.config.ts. */
const VERSION = "__CACHE_VERSION__";
const PRECACHE = /*__PRECACHE_LIST__*/[];
const PREFIX = "threatlens-shell-";
const CACHE = PREFIX + VERSION;
const MAX_BYTES = 3 * 1024 * 1024; // do not cache anything larger than this at runtime

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of PRECACHE) {
      const res = await fetch(url, { cache: "reload" });
      if (!res.ok) throw new Error("precache failed: " + url); // abort install: never claim offline-readiness we do not have
      await cache.put(url, res);
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
    await announce();
  })());
});

async function precacheComplete() {
  const cache = await caches.open(CACHE);
  for (const url of PRECACHE) if (!(await cache.match(url))) return false;
  return PRECACHE.length > 0;
}
async function announce() {
  const ok = await precacheComplete();
  for (const c of await self.clients.matchAll()) c.postMessage({ type: "PRECACHE_DONE", ok });
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "PRECACHE_STATUS") event.waitUntil(announce());
});

function cacheable(res) {
  if (!res || !res.ok || res.type !== "basic") return false;
  if ((res.headers.get("cache-control") || "").includes("no-store")) return false;
  return Number(res.headers.get("content-length") || 0) <= MAX_BYTES;
}

const OFFLINE_HTML = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>ThreatLens offline</title>" +
  "<body style='font:16px system-ui;background:#070C18;color:#E8EEF8;padding:2rem'><h1>ThreatLens AI is offline</h1>" +
  "<p>This page was not cached yet. Reconnect and reload once; after that the app can open without a connection.</p></body>";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) (await caches.open(CACHE)).put("/index.html", res.clone());
        return res;
      } catch {
        return (await caches.match("/index.html")) || new Response(OFFLINE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/")) { // content-hashed build output: cache-first
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (cacheable(res)) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  event.respondWith((async () => { // everything else same-origin (manifest, icons, demo fixtures, optional ti snapshot): network-first
    try {
      const res = await fetch(req);
      const isHtml = (res.headers.get("content-type") || "").includes("text/html"); // SPA fallback masquerading as a missing file
      if (cacheable(res) && !isHtml) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req);
      if (hit) return hit;
      throw new Error("offline and not cached");
    }
  })());
});
