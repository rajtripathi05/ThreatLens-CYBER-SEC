import type { LocalAnalysis } from "./localAnalysis";

/**
 * Browser-only incident storage (IndexedDB). Records live in THIS browser profile only: they are not synchronised with
 * the backend and are never uploaded automatically. Only a summary is kept; raw message text is stored only on explicit opt-in.
 */
export interface LocalIncident {
  id: string;
  createdUtc: string;
  storage: "local-browser";
  inputType: "url" | "email";
  verdict: string;
  riskScore: number;
  ruleSetVersion: string;
  nUrls: number;
  firstUrl: string | null;
  ruleIds: string[];
  tiState: string;
  note: string;
  rawSaved: boolean;
  /** Present only when the user opted in. */
  raw?: string;
}

const DB_NAME = "threatlens-local";
const STORE = "incidents";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available in this browser context."));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open local storage."));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error ?? new Error("Local storage transaction failed."));
      t.onabort = () => reject(t.error ?? new Error("Local storage transaction aborted."));
    });
  } finally { db.close(); }
}

function newId(): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `L-${rnd.slice(0, 8)}`;
}

export async function saveLocalIncident(a: LocalAnalysis, opts: { note?: string; rawContent?: string | null; now?: Date } = {}): Promise<LocalIncident> {
  const keepRaw = typeof opts.rawContent === "string" && opts.rawContent.length > 0;
  const rec: LocalIncident = {
    id: newId(), createdUtc: (opts.now ?? new Date()).toISOString(), storage: "local-browser", inputType: a.inputType,
    verdict: a.verdict, riskScore: a.riskScore, ruleSetVersion: a.ruleSetVersion, nUrls: a.urls.length,
    firstUrl: a.urls[0]?.normalized ?? null, ruleIds: [...new Set([...a.findings, ...a.urls.flatMap((u) => u.findings)].map((f) => f.ruleId))],
    tiState: a.threatIntel.state, note: (opts.note ?? "").slice(0, 2000), rawSaved: keepRaw,
    ...(keepRaw ? { raw: opts.rawContent! } : {}),
  };
  await tx("readwrite", (s) => s.put(rec));
  return rec;
}

export async function listLocalIncidents(): Promise<LocalIncident[]> {
  const all = await tx<LocalIncident[]>("readonly", (s) => s.getAll());
  return all.sort((x, y) => y.createdUtc.localeCompare(x.createdUtc));
}
export async function deleteLocalIncident(id: string): Promise<void> { await tx("readwrite", (s) => s.delete(id)); }
/** Removes every locally stored incident, including any opted-in raw content. */
export async function clearLocalIncidents(): Promise<void> { await tx("readwrite", (s) => s.clear()); }
