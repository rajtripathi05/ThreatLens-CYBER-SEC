import { useSyncExternalStore } from "react";
import { DEFAULT_NAMING, type CampaignRecord, type NamingSettings } from "./quality";

/**
 * Browser-only persistence (localStorage). Records never leave this browser profile. Kept behind this small module so a
 * backend can replace it later without touching the pages.
 */
const KEY = "tl.campaigns.v1";
const NAMING_KEY = "tl.campaigns.naming.v1";
export const MAX_RECORDS = 5000;

let cache: CampaignRecord[] | null = null;
let naming: NamingSettings | null = null;
const listeners = new Set<() => void>();

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
function load(): CampaignRecord[] {
  if (cache) return cache;
  const raw = readJson<unknown>(KEY, []);
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
  cache = next; listeners.forEach((l) => l());
  try { localStorage.setItem(KEY, JSON.stringify(next)); return { ok: true }; }
  catch { return { ok: false, error: "Could not write to browser storage (full or blocked). Export a CSV to keep your data." }; }
}

export function newId(): string {
  return `C-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`).slice(0, 8)}`;
}

export type NewRecord = Pick<CampaignRecord, "name" | "finalUrl" | "note">;

export const campaignStore = {
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
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getNaming(): NamingSettings { return (naming ??= { ...DEFAULT_NAMING, ...readJson<Partial<NamingSettings>>(NAMING_KEY, {}) }); },
  setNaming(n: NamingSettings) {
    naming = n; listeners.forEach((l) => l());
    try { localStorage.setItem(NAMING_KEY, JSON.stringify(n)); } catch { /* storage unavailable */ }
  },
  /** Test helper: forget in-memory state so the next read hits localStorage. */
  _reset() { cache = null; naming = null; },
};

export function useCampaigns(): CampaignRecord[] {
  return useSyncExternalStore(campaignStore.subscribe, campaignStore.list, campaignStore.list);
}
export function useNaming(): NamingSettings {
  return useSyncExternalStore(campaignStore.subscribe, campaignStore.getNaming, campaignStore.getNaming);
}
