import { BRAND_KEYWORDS, LURE_TOKENS, SHORTENERS } from "./urlRules";
import type { UrlFeatures, ValidationError } from "./types";

export const MAX_URL_LENGTH = 4096;
const TWO_PART_SECOND_LEVELS = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
const BLOCKED_SCHEMES = /^(javascript|data|vbscript|file|mailto|tel|blob|about):/i;

export interface ParsedUrl { ok: true; url: URL; normalized: string; features: UrlFeatures }

function fail(code: ValidationError["code"], message: string): ValidationError {
  return { ok: false, code, message };
}

/** Guess the registrable domain without a public-suffix list: last two labels, or three for common two-part suffixes (example.co.uk). */
export function registrableDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && TWO_PART_SECOND_LEVELS.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * Validates and parses user text with the standard URL parser. Nothing is fetched, resolved or followed.
 * A missing scheme is assumed to be http:// for parsing only and is recorded in `schemeAssumed`.
 */
export function parseUrlInput(raw: string): ParsedUrl | ValidationError {
  const input = raw.trim();
  if (!input) return fail("empty", "Enter a URL to analyse.");
  if (input.length > MAX_URL_LENGTH) return fail("too_long", `URL is ${input.length} characters; the limit is ${MAX_URL_LENGTH}.`);
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(input)) return fail("contains_whitespace", "URLs cannot contain spaces or control characters.");
  if (BLOCKED_SCHEMES.test(input)) return fail("unsupported_scheme", "Only http and https URLs can be analysed.");
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  let url: URL;
  try { url = new URL(hasScheme ? input : `http://${input}`); } catch { return fail("unparseable", "The text is not a parseable URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fail("unsupported_scheme", `The scheme "${url.protocol.replace(":", "")}" is not supported; use http or https.`);
  if (!url.hostname) return fail("missing_host", "The URL has no host.");

  const host = url.hostname.toLowerCase();
  const isIpHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  const labels = host.split(".").filter(Boolean);
  const registrable = isIpHost ? host : registrableDomain(host);
  const regLabels = registrable.split(".").length;
  const tail = `${host}${url.pathname}${url.search}`.toLowerCase();
  let userDecoded = url.username;
  try { userDecoded = decodeURIComponent(url.username); } catch { /* keep raw */ }
  const regFirstLabel = registrable.split(".")[0];

  const features: UrlFeatures = {
    scheme: url.protocol.replace(":", ""),
    schemeAssumed: !hasScheme,
    host,
    registrable,
    labelCount: labels.length,
    subdomainDepth: isIpHost ? 0 : Math.max(0, labels.length - regLabels),
    tld: isIpHost ? "" : (labels[labels.length - 1] ?? ""),
    isIpHost,
    hasUserInfo: Boolean(url.username || url.password),
    userInfoLooksLikeHost: userDecoded.includes("."),
    port: url.port,
    hasPunycode: labels.some((l) => l.startsWith("xn--")),
    urlLength: input.length,
    hostLength: host.length,
    hostHyphens: (host.match(/-/g) ?? []).length,
    pathLength: url.pathname.length,
    queryLength: url.search.length,
    percentEncodedCount: (`${url.pathname}${url.search}`.match(/%[0-9a-f]{2}/gi) ?? []).length,
    lureTokens: LURE_TOKENS.filter((t) => tail.includes(t)),
    brandHits: isIpHost ? [] : BRAND_KEYWORDS.filter((b) => host.includes(b) && regFirstLabel !== b),
    isShortener: SHORTENERS.has(host),
  };
  return { ok: true, url, normalized: `${url.protocol}//${url.host}${url.pathname}${url.search}`, features };
}
