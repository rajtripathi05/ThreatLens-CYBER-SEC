/** UTM URL construction and validation. Pure functions: URLs are parsed as text and never fetched. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export const REQUIRED_UTM: readonly UtmKey[] = ["utm_source", "utm_medium", "utm_campaign"];

export type UtmValues = Record<UtmKey, string>;
export const emptyUtm = (): UtmValues => ({ utm_source: "", utm_medium: "", utm_campaign: "", utm_term: "", utm_content: "" });

export type ParsedDestination = { ok: true; url: URL } | { ok: false; error: string };

/** Accepts only http(s) URLs. A bare "example.com/x" is rejected rather than guessed at. */
export function parseDestination(raw: string): ParsedDestination {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Enter a destination URL." };
  if (/\s/.test(s)) return { ok: false, error: "The URL contains spaces. Encode them as %20." };
  if (!/^https?:\/\//i.test(s)) return { ok: false, error: "Start the URL with http:// or https://." };
  try {
    const url = new URL(s);
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost")) return { ok: false, error: "The URL needs a valid host name." };
    return { ok: true, url };
  } catch { return { ok: false, error: "This is not a valid URL." }; }
}

/** Encodes one query component (spaces become %20, never "+", so the result is unambiguous). */
const enc = (v: string) => encodeURIComponent(v.trim());

export function safeDecode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

/**
 * Appends UTM parameters to the destination. Existing non-UTM query parameters (kept byte-for-byte) and the fragment are
 * preserved; existing utm_* parameters are replaced by the values given, and blank values remove them.
 */
export function buildUtmUrl(destination: string, values: Partial<UtmValues>): { url: string; error?: string } {
  const p = parseDestination(destination);
  if (!p.ok) return { url: "", error: p.error };
  const u = p.url;
  const kept = u.search.replace(/^\?/, "").split("&").filter((pair) => {
    if (!pair) return false;
    const k = safeDecode(pair.split("=")[0]).toLowerCase();
    return !(UTM_KEYS as readonly string[]).includes(k);
  });
  const added = UTM_KEYS.filter((k) => (values[k] ?? "").trim() !== "").map((k) => `${k}=${enc(values[k]!)}`);
  const query = [...kept, ...added].join("&");
  const hash = u.hash === "#" ? "" : u.hash;
  return { url: `${u.origin}${u.pathname}${query ? `?${query}` : ""}${hash}` };
}

/** The destination with utm_* parameters removed (other query parameters and the fragment untouched). */
export function stripUtm(raw: string): string {
  return buildUtmUrl(raw, {}).url || raw.trim();
}

/** Reads utm_* values out of an existing URL (case-insensitive keys, last value wins). */
export function extractUtm(raw: string): { utm: UtmValues; base: string; hasUtmParams: boolean } | null {
  const p = parseDestination(raw);
  if (!p.ok) return null;
  const utm = emptyUtm();
  let has = false;
  p.url.searchParams.forEach((v, k) => {
    const key = k.toLowerCase() as UtmKey;
    if ((UTM_KEYS as readonly string[]).includes(key)) { utm[key] = v; has = true; }
  });
  return { utm, base: stripUtm(raw), hasUtmParams: has };
}

export function missingRequired(values: Partial<UtmValues>): UtmKey[] {
  return REQUIRED_UTM.filter((k) => !(values[k] ?? "").trim());
}
