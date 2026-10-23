import { useSyncExternalStore } from "react";
import { demoSeed } from "./demoData";
import { DEFAULT_NAMING, type CampaignRecord, type NamingSettings } from "./quality";

export const MAX_RECORDS = 5000;
const NAMING_KEY = "tl.campaigns.naming.v1";
const LIVE_KEY = "tl.campaigns.v1";
const DEMO_KEY = "tl.campaigns.demo.v1";

function readJson<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
/** Coerces one stored value into a well-formed record, or null. Tolerates missing fields from older/edited storage. */
function normalize(x: unknown): CampaignRecord | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id || typeof r.finalUrl !== "string" || !r.finalUrl) return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const now = new Date().toISOString();
  return {
    id: r.id.slice(0, 64), finalUrl: r.finalUrl.slice(0, 4000), name: str(r.name, 200), note: str(r.note, 1000),
    createdUtc: str(r.createdUtc, 40) || now, updatedUtc: str(r.updatedUtc, 40) || str(r.createdUtc, 40) || now,
  };
}

export function newId(): string {
  return `C-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`).slice(0, 8)}`;
}

export type NewRecord = Pick<CampaignRecord, "name" | "finalUrl" | "note">;
/** One CSV import, kept so the overview can show recent imports. Counts only: no row contents. */
export interface ImportLogEntry { at: string; file: string; imported: number; rejected: number; skippedDuplicates: number }
const IMPORT_LOG_MAX = 10;

/**
 * Browser-only persistence (localStorage). Records never leave this browser profile. Each store has its own storage key, so the
 * demo workspace can never read, overwrite or inflate the user's real records.
 */
export function createCampaignStore(key: string, opts: { seed?: () => CampaignRecord[] } = {}) {
  const importKey = `${key}.imports`;
  let cache: CampaignRecord[] | null = null;
  let log: ImportLogEntry[] | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  function load(): CampaignRecord[] {
    if (cache) return cache;
    let stored: string | null = null;
    try { stored = localStorage.getItem(key); } catch { /* storage unavailable */ }
    // The seed is applied only when nothing has ever been stored; an emptied demo stays empty until it is explicitly reset.
    const raw: unknown = stored == null ? (opts.seed?.() ?? []) : readJson<unknown>(key, []);
    const seen = new Set<string>();
    const out: CampaignRecord[] = [];
    if (Array.isArray(raw)) for (const x of raw) {
      const r = normalize(x);
      if (r && !seen.has(r.id) && out.length < MAX_RECORDS) { seen.add(r.id); out.push(r); }
    }
    cache = out;
    return cache;
  }
  function persist(next: CampaignRecord[]): { ok: boolean; error?: string } {
    cache = next; emit();
    try { localStorage.setItem(key, JSON.stringify(next)); return { ok: true }; }
    catch { return { ok: false, error: "Could not write to browser storage (full or blocked). Export a CSV to keep your data." }; }
  }
  const store = {
    key,
    list: load,
    add(items: NewRecord[], now = new Date()) {
      const room = Math.max(0, MAX_RECORDS - load().length);
      const iso = now.toISOString();
      const used = new Set(load().map((r) => r.id));
      const added: CampaignRecord[] = items.slice(0, room).map((i) => {
        let id = newId();
        while (used.has(id)) id = newId();
        used.add(id);
        return { ...i, id, createdUtc: iso, updatedUtc: iso };
      });
      const res = persist([...load(), ...added]);
      return { ...res, added, dropped: items.length - added.length };
    },
    update(id: string, patch: Partial<NewRecord>, now = new Date()) {
      return persist(load().map((r) => (r.id === id ? { ...r, ...patch, updatedUtc: now.toISOString() } : r)));
    },
    remove(ids: string[]) { const s = new Set(ids); return persist(load().filter((r) => !s.has(r.id))); },
    clear() { return persist([]); },
    /** Restores the seed (demo store only). Never touches any other store. */
    reset() {
      log = [];
      try { localStorage.removeItem(importKey); } catch { /* storage unavailable */ }
      return persist(opts.seed?.() ?? []);
    },
    imports(): ImportLogEntry[] { return (log ??= readJson<ImportLogEntry[]>(importKey, []).filter((e) => e && typeof e.at === "string").slice(0, IMPORT_LOG_MAX)); },
    logImport(e: ImportLogEntry) {
      log = [e, ...store.imports()].slice(0, IMPORT_LOG_MAX); emit();
      try { localStorage.setItem(importKey, JSON.stringify(log)); } catch { /* the log is best-effort */ }
    },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    /** Test helper: forget in-memory state so the next read hits localStorage. */
    _reset() { cache = null; log = null; naming = null; },
  };
  return store;
}
export type CampaignStore = ReturnType<typeof createCampaignStore>;

let naming: NamingSettings | null = null;
const namingListeners = new Set<() => void>();

/** The user's real library. */
export const campaignStore = createCampaignStore(LIVE_KEY);
/** Sample workspace for the guided demo (separate key, seeded from fictional fixtures). */
export const demoStore = createCampaignStore(DEMO_KEY, { seed: demoSeed });

export const namingStore = {
  get(): NamingSettings { return (naming ??= { ...DEFAULT_NAMING, ...readJson<Partial<NamingSettings>>(NAMING_KEY, {}) }); },
  set(n: NamingSettings) {
    naming = n; namingListeners.forEach((l) => l());
    try { localStorage.setItem(NAMING_KEY, JSON.stringify(n)); } catch { /* storage unavailable */ }
  },
  subscribe(l: () => void) { namingListeners.add(l); return () => { namingListeners.delete(l); }; },
};

export function useCampaigns(store: CampaignStore = campaignStore): CampaignRecord[] {
  return useSyncExternalStore(store.subscribe, store.list, store.list);
}
export function useImportLog(store: CampaignStore = campaignStore): ImportLogEntry[] {
  return useSyncExternalStore(store.subscribe, store.imports, store.imports);
}
export function useNaming(): NamingSettings {
  return useSyncExternalStore(namingStore.subscribe, namingStore.get, namingStore.get);
}
