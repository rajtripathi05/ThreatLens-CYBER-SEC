import { extractUtm, parseDestination, REQUIRED_UTM, suggestSlug, UTM_KEYS, type UtmKey } from "./utm";

/** A saved campaign URL. `finalUrl` is the full tagged URL; utm fields are always derived from it. */
export interface CampaignRecord {
  id: string;
  createdUtc: string;
  updatedUtc: string;
  name: string;
  finalUrl: string;
  note: string;
}

export type IssueCode = "invalid-url" | "missing-required" | "duplicate" | "naming-case" | "naming-chars" | "naming-variant" | "param-repeat";
export interface Issue { code: IssueCode; severity: "error" | "warn"; message: string; /** What to do about it. */ fix?: string }

export interface NamingSettings {
  /** Flag UTM values that are not lowercase. */
  requireLowercase: boolean;
  /** Flag UTM values containing anything other than letters, digits, "_", "-" or ".". */
  requireSlugChars: boolean;
}
export const DEFAULT_NAMING: NamingSettings = { requireLowercase: true, requireSlugChars: true };

export interface Analyzed extends CampaignRecord {
  utm: Record<UtmKey, string>;
  baseUrl: string;
  issues: Issue[];
  status: "ok" | "warn" | "error";
}

const normalizeName = (s: string) => s.toLowerCase().replace(/[\s_.-]+/g, "");

/** Duplicate key: same tagged URL ignoring scheme/host case, parameter order and a trailing slash. */
export function dupKey(url: string): string {
  const p = parseDestination(url);
  if (!p.ok) return url.trim();
  const u = p.url;
  const params = [...u.searchParams.entries()].map(([k, v]) => `${k.toLowerCase()}=${v}`).sort().join("&");
  return `${u.origin}${u.pathname.replace(/\/$/, "")}?${params}${u.hash}`;
}

/**
 * Campaign-tagging quality only. Nothing here says whether a URL is safe; security assessment is a separate workspace.
 */
export function analyzeRecords(records: CampaignRecord[], naming: NamingSettings = DEFAULT_NAMING): Analyzed[] {
  const counts = new Map<string, number>();
  for (const r of records) { const k = dupKey(r.finalUrl); counts.set(k, (counts.get(k) ?? 0) + 1); }

  const parsed = records.map((r) => extractUtm(r.finalUrl));
  // Spelling variants of the same value, e.g. "Facebook" / "facebook" / "face_book".
  const variants: Record<string, Map<string, Set<string>>> = { utm_source: new Map(), utm_medium: new Map(), utm_campaign: new Map() };
  for (const p of parsed) {
    if (!p) continue;
    for (const k of ["utm_source", "utm_medium", "utm_campaign"] as const) {
      const v = p.utm[k].trim(); if (!v) continue;
      const key = normalizeName(v);
      if (!variants[k].has(key)) variants[k].set(key, new Set());
      variants[k].get(key)!.add(v);
    }
  }

  return records.map((r, idx) => {
    const p = parsed[idx];
    const issues: Issue[] = [];
    const utm = p?.utm ?? ({ utm_source: "", utm_medium: "", utm_campaign: "", utm_term: "", utm_content: "" } as Record<UtmKey, string>);
    if (!p) issues.push({ code: "invalid-url", severity: "error", message: "Not a valid http(s) URL.", fix: "Start with https:// and remove spaces. Edit the URL or delete the row." });
    else {
      const missing = REQUIRED_UTM.filter((k) => !utm[k].trim());
      if (missing.length) issues.push({ code: "missing-required", severity: "error", message: `Missing ${missing.join(", ")}.`, fix: `Add ${missing.join(", ")} in UTM Studio. Source, medium and campaign are all required for consistent reporting.` });
      const keys = [...new URL(r.finalUrl.trim()).searchParams.keys()].map((k) => k.toLowerCase());
      const rep = keys.filter((k, i) => (UTM_KEYS as readonly string[]).includes(k) && keys.indexOf(k) !== i);
      if (rep.length) issues.push({ code: "param-repeat", severity: "warn", message: `Repeated parameter: ${[...new Set(rep)].join(", ")}.`, fix: "Keep one value per UTM parameter. Re-saving from UTM Studio replaces duplicates." });
      for (const k of UTM_KEYS) {
        const v = utm[k]; if (!v) continue;
        if (naming.requireLowercase && v !== v.toLowerCase()) issues.push({ code: "naming-case", severity: "warn", message: `${k} "${v}" is not lowercase.`, fix: `Use "${suggestSlug(v)}".` });
        if (naming.requireSlugChars && /[^A-Za-z0-9_.-]/.test(v)) issues.push({ code: "naming-chars", severity: "warn", message: `${k} "${v}" contains spaces or special characters.`, fix: `Use "${suggestSlug(v)}".` });
      }
      for (const k of ["utm_source", "utm_medium", "utm_campaign"] as const) {
        const set = utm[k].trim() ? variants[k].get(normalizeName(utm[k].trim())) : undefined;
        if (set && set.size > 1) issues.push({ code: "naming-variant", severity: "warn", message: `${k} has spelling variants: ${[...set].map((x) => `"${x}"`).join(", ")}.`, fix: `Pick one spelling for all of them, for example "${suggestSlug([...set][0])}".` });
      }
    }
    if ((counts.get(dupKey(r.finalUrl)) ?? 0) > 1) issues.push({ code: "duplicate", severity: "warn", message: "Duplicate of another saved URL.", fix: "Delete the extra copy, or change utm_content to tell the links apart." });
    const status: Analyzed["status"] = issues.some((i) => i.severity === "error") ? "error" : issues.length ? "warn" : "ok";
    return { ...r, utm, baseUrl: p?.base ?? r.finalUrl, issues, status };
  });
}
