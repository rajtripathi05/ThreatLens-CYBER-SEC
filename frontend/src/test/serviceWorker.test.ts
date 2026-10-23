import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * Executes public/sw.js in a Node VM with a fake Cache Storage. This is not a browser test, but it exercises the real
 * worker source: precaching, offline navigation fallback and the "never cache API / cross-origin / POST" guarantees.
 */
const SRC = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8")
  .replace("__CACHE_VERSION__", "test1").replace("/*__PRECACHE_LIST__*/[]", '["/","/index.html","/assets/app.js"]');

class FakeCache {
  store = new Map<string, Response>();
  async put(k: string | Request, v: Response) { this.store.set(typeof k === "string" ? new URL(k, "https://app.test").href : k.url, v); }
  async match(k: string | Request) { const r = this.store.get(typeof k === "string" ? new URL(k, "https://app.test").href : k.url); return r?.clone(); }
}

function boot(network: (u: string, init?: RequestInit) => Promise<Response>) {
  const caches = new Map<string, FakeCache>();
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const fetched: string[] = [];
  const api = {
    open: async (n: string) => { if (!caches.has(n)) caches.set(n, new FakeCache()); return caches.get(n)!; },
    keys: async () => [...caches.keys()], delete: async (n: string) => caches.delete(n),
    match: async (k: string | Request) => { for (const c of caches.values()) { const r = await c.match(k); if (r) return r; } return undefined; },
  };
  const self = {
    location: { origin: "https://app.test" }, addEventListener: (t: string, f: (e: unknown) => void) => { (listeners[t] ??= []).push(f); },
    clients: { claim: async () => {}, matchAll: async () => [] }, skipWaiting: () => {},
  };
  vm.runInNewContext(SRC, { self, caches: api, fetch: (r: string | Request, i?: RequestInit) => { const u = typeof r === "string" ? r : r.url; fetched.push(u); return network(u, i); }, URL, Response, Request, Headers, Promise, Number, console });
  const lifecycle = async (type: "install" | "activate") => {
    const waits: Promise<unknown>[] = [];
    listeners[type].forEach((l) => l({ waitUntil: (p: Promise<unknown>) => waits.push(p) }));
    await Promise.all(waits);
  };
  const request = async (url: string, o: { method?: string; mode?: string } = {}) => {
    let out: Promise<Response> | undefined;
    const req = { url, method: o.method ?? "GET", mode: o.mode ?? "cors", headers: new Headers() };
    listeners.fetch.forEach((l) => l({ request: req, respondWith: (p: Promise<Response>) => { out = p; } }));
    return out;
  };
  return { caches, lifecycle, request, fetched };
}

const page = (body = "<html>shell</html>") => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

describe("service worker", () => {
  it("precaches the shell on install and fails the install if a file cannot be fetched", async () => {
    const good = boot(async () => page());
    await good.lifecycle("install");
    expect([...good.caches.get("threatlens-shell-test1")!.store.keys()].sort()).toEqual(["https://app.test/", "https://app.test/assets/app.js", "https://app.test/index.html"]);
    const bad = boot(async (u) => (u.endsWith("app.js") ? new Response("nope", { status: 404 }) : page()));
    await expect(bad.lifecycle("install")).rejects.toThrow(/precache failed/);
  });

  it("serves the cached shell for navigations while offline", async () => {
    const net = { online: true };
    const w = boot(async () => { if (!net.online) throw new TypeError("offline"); return page("<html>online shell</html>"); });
    await w.lifecycle("install"); await w.lifecycle("activate");
    net.online = false;
    const res = await w.request("https://app.test/analyzer", { mode: "navigate" });
    expect(await (await res)!.text()).toContain("online shell");
  });

  it("falls back to a small offline page if the shell was never cached", async () => {
    const w = boot(async () => { throw new TypeError("offline"); });
    const res = await (await w.request("https://app.test/", { mode: "navigate" }))!;
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("offline");
  });

  it("serves hashed assets cache-first", async () => {
    const w = boot(async () => new Response("js", { status: 200, headers: { "content-type": "text/javascript" } }));
    await w.lifecycle("install");
    const before = w.fetched.length;
    expect(await (await (await w.request("https://app.test/assets/app.js"))!).text()).toBe("js");
    expect(w.fetched.length).toBe(before); // answered from cache, no network
  });

  it("never intercepts API, health, POST or cross-origin requests, so API results cannot be served stale", async () => {
    const w = boot(async () => page());
    await w.lifecycle("install");
    expect(await w.request("https://app.test/api/v1/analyze/url")).toBeUndefined();
    expect(await w.request("https://app.test/health")).toBeUndefined();
    expect(await w.request("https://app.test/analyze", { method: "POST" })).toBeUndefined();
    expect(await w.request("https://api.example.com/health")).toBeUndefined();
  });

  it("does not cache an HTML 'missing file' response or a failed response at runtime", async () => {
    const w = boot(async (u) => (u.includes("missing") ? new Response("x", { status: 404 }) : page("<html>spa fallback</html>")));
    await w.lifecycle("install");
    await (await w.request("https://app.test/ti/snapshot.json"));
    await (await w.request("https://app.test/missing.json"));
    const keys = [...w.caches.get("threatlens-shell-test1")!.store.keys()];
    expect(keys).not.toContain("https://app.test/ti/snapshot.json");
    expect(keys).not.toContain("https://app.test/missing.json");
  });

  it("removes caches from older versions on activate", async () => {
    const w = boot(async () => page());
    await (await w.caches.set("threatlens-shell-old", new FakeCache()));
    await w.lifecycle("install"); await w.lifecycle("activate");
    expect([...w.caches.keys()]).toEqual(["threatlens-shell-test1"]);
  });
});
