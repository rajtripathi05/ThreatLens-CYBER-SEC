import type { AnalysisConfig, SnapshotInfo, ThreatSnapshot, TIEntry } from "./types";

/**
 * Local threat-intelligence lookup against an OPTIONAL bundled snapshot (public/ti/snapshot.json).
 * MATCH      - exact indicator found in the snapshot.
 * NO_MATCH   - snapshot available and no exact indicator found. Says nothing about safety.
 * UNKNOWN    - no usable snapshot. The engine never invents a match or a miss.
 */

const index = new WeakMap<ThreatSnapshot, { urls: Set<string>; domains: Set<string> }>();

function canonicalUrl(s: string): string | null {
  try { const u = new URL(s); return `${u.protocol}//${u.host}${u.pathname}${u.search}`; } catch { return null; }
}

function indexOf(s: ThreatSnapshot) {
  let ix = index.get(s);
  if (!ix) {
    ix = { urls: new Set(), domains: new Set() };
    for (const i of s.indicators) {
      if (i.kind === "url") { const c = canonicalUrl(i.indicator); if (c) ix.urls.add(c); }
      else ix.domains.add(i.indicator.trim().toLowerCase());
    }
    index.set(s, ix);
  }
  return ix;
}

/** Validates untrusted JSON. Returns a snapshot or the reason it was rejected. */
export function parseSnapshot(raw: unknown): { snapshot: ThreatSnapshot } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "snapshot is not a JSON object" };
  const o = raw as Record<string, unknown>;
  if (typeof o.source !== "string" || !o.source.trim()) return { error: "snapshot has no source" };
  if (!Array.isArray(o.indicators)) return { error: "snapshot has no indicators array" };
  const indicators: ThreatSnapshot["indicators"] = [];
  for (const i of o.indicators) {
    const r = i as Record<string, unknown>;
    if (r && typeof r.indicator === "string" && (r.kind === "url" || r.kind === "domain")) indicators.push({ indicator: r.indicator, kind: r.kind });
  }
  return {
    snapshot: {
      source: o.source,
      version: typeof o.version === "string" ? o.version : null,
      retrievedUtc: typeof o.retrieved_utc === "string" ? o.retrieved_utc : null,
      note: typeof o.note === "string" ? o.note : "Point-in-time snapshot; may be incomplete or outdated.",
      indicators,
    },
  };
}

export function snapshotInfo(s: ThreatSnapshot): SnapshotInfo {
  return { source: s.source, version: s.version, retrievedUtc: s.retrievedUtc, note: s.note };
}

/** Display helper (kept out of the engine so analysis never depends on the clock). */
export function snapshotAgeDays(s: SnapshotInfo, now: Date): number | null {
  if (!s.retrievedUtc) return null;
  const t = Date.parse(s.retrievedUtc);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / 86_400_000);
}
export const STALE_AFTER_DAYS = 30;

export function lookupIndicator(cfg: AnalysisConfig, normalizedUrl: string, host: string): TIEntry {
  const s = cfg.snapshot;
  if (!s) {
    return { state: "UNKNOWN", indicator: normalizedUrl, snapshot: null,
      detail: cfg.snapshotUnavailableReason ?? "No threat-intelligence snapshot is bundled with this build, so nothing can be said either way." };
  }
  const ix = indexOf(s);
  const info = snapshotInfo(s);
  const hitUrl = ix.urls.has(normalizedUrl);
  const hitDomain = ix.domains.has(host);
  if (hitUrl || hitDomain) {
    return { state: "MATCH", indicator: hitUrl ? normalizedUrl : host, snapshot: info,
      detail: `Exact ${hitUrl ? "URL" : "domain"} match in the bundled snapshot "${s.source}". This is not a live feed.` };
  }
  return { state: "NO_MATCH", indicator: normalizedUrl, snapshot: info,
    detail: `No exact match in the bundled snapshot "${s.source}" (${s.indicators.length} indicators). Absence from a snapshot does not mean the URL is safe.` };
}

/** Loads the optional same-origin snapshot. Never throws; a missing/invalid file yields null and a reason. */
export async function loadBundledSnapshot(fetchImpl: typeof fetch = fetch, baseUrl = import.meta.env.BASE_URL ?? "/"): Promise<AnalysisConfig> {
  try {
    const res = await fetchImpl(`${baseUrl}ti/snapshot.json`, { cache: "no-cache" });
    if (!res.ok) return { snapshot: null, snapshotUnavailableReason: "No threat-intelligence snapshot is bundled with this build." };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return { snapshot: null, snapshotUnavailableReason: "No threat-intelligence snapshot is bundled with this build." };
    const parsed = parseSnapshot(await res.json());
    if ("error" in parsed) return { snapshot: null, snapshotUnavailableReason: `The bundled snapshot was rejected: ${parsed.error}.` };
    return { snapshot: parsed.snapshot };
  } catch {
    return { snapshot: null, snapshotUnavailableReason: "The bundled snapshot could not be read, so its validity cannot be established." };
  }
}
