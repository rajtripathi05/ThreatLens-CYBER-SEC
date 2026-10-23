import type { Finding, RuleDef, UrlFeatures } from "./types";

/** Documented URL rules. Every score contribution in a URL analysis maps to exactly one entry here. */
export const URL_RULES: Record<string, RuleDef> = {
  "U-IP-HOST": { id: "U-IP-HOST", title: "Host is an IP address", weight: 25,
    description: "The host is a numeric IP literal instead of a registered name.",
    limitation: "Legitimate devices, routers and test servers use IP hosts. Weak on its own." },
  "U-USERINFO": { id: "U-USERINFO", title: "URL contains user-information (user@host)", weight: 20,
    description: "Text before an '@' in the authority is ignored for routing but can imitate a trusted name.",
    limitation: "Old-style credentials in URLs are rare but not always malicious." },
  "U-USERINFO-HOSTLIKE": { id: "U-USERINFO-HOSTLIKE", title: "User-information looks like a domain name", weight: 15,
    description: "The part before '@' contains a dot, e.g. https://bank.com@other.example, a classic disguise.",
    limitation: "Only applies together with U-USERINFO." },
  "U-PUNYCODE": { id: "U-PUNYCODE", title: "Internationalised (punycode) host label", weight: 15,
    description: "A host label starts with 'xn--', meaning non-ASCII characters that may imitate Latin letters.",
    limitation: "Many legitimate sites use internationalised domain names." },
  "U-BRAND-LOOKALIKE": { id: "U-BRAND-LOOKALIKE", title: "Well-known brand name inside an unrelated domain", weight: 20,
    description: "A brand keyword appears in the host, but the registrable domain is not simply that brand.",
    limitation: "Uses a short fixed keyword list and a naive registrable-domain guess. Cannot verify who owns a domain." },
  "U-SHORTENER": { id: "U-SHORTENER", title: "Known URL-shortener host", weight: 10,
    description: "The destination is hidden behind a redirect service. The destination was not followed.",
    limitation: "Shorteners are widely used legitimately." },
  "U-SUSPICIOUS-TLD": { id: "U-SUSPICIOUS-TLD", title: "Top-level domain over-represented in abuse reports", weight: 6,
    description: "The TLD belongs to a small fixed list often cited in abuse statistics.",
    limitation: "A population-level signal; says nothing about an individual domain." },
  "U-SUBDOMAIN-DEPTH": { id: "U-SUBDOMAIN-DEPTH", title: "Deeply nested subdomains", weight: 8,
    description: "Four or more labels sit in front of the registrable domain, which can push the real domain out of view.",
    limitation: "Registrable domain is guessed from the last two labels (three for common two-part suffixes); CDNs and clouds nest deeply." },
  "U-NONSTD-PORT": { id: "U-NONSTD-PORT", title: "Non-standard port", weight: 5,
    description: "An explicit port other than the scheme default is present.",
    limitation: "Development and internal services use other ports." },
  "U-LONG-URL": { id: "U-LONG-URL", title: "Unusually long URL", weight: 5,
    description: "The URL is 120 characters or longer.",
    limitation: "Tracking parameters make long URLs common. Weak on its own." },
  "U-LONG-HOST": { id: "U-LONG-HOST", title: "Unusually long hostname", weight: 5,
    description: "The hostname is 40 characters or longer.",
    limitation: "Weak on its own." },
  "U-HYPHEN-HOST": { id: "U-HYPHEN-HOST", title: "Many hyphens in hostname", weight: 4,
    description: "Four or more hyphens in the host, common in look-alike names.",
    limitation: "Weak on its own." },
  "U-LURE-TOKENS": { id: "U-LURE-TOKENS", title: "Several credential-lure words in the URL", weight: 8,
    description: "Two or more distinct words such as login, verify, secure, account, password appear in the host, path or query.",
    limitation: "Genuine sign-in pages contain these words." },
  "U-ENCODING-HEAVY": { id: "U-ENCODING-HEAVY", title: "Heavy percent-encoding", weight: 5,
    description: "Five or more percent-encoded sequences, which can hide readable text.",
    limitation: "Non-English paths and form data are encoded legitimately." },
  "U-HTTP-SCHEME": { id: "U-HTTP-SCHEME", title: "Explicit plain-HTTP scheme", weight: 3,
    description: "The URL was supplied with http://. This is a very weak signal; HTTPS does not imply trustworthiness either.",
    limitation: "Not applied when the scheme was assumed because none was typed." },
  "U-TI-MATCH": { id: "U-TI-MATCH", title: "Exact match in bundled threat-intelligence snapshot", weight: 70,
    description: "The URL or its host exactly equals an indicator in the bundled snapshot.",
    limitation: "The snapshot is a point-in-time file, may be outdated or incomplete, and is not a live feed." },
};

export const BRAND_KEYWORDS = ["paypal", "microsoft", "office365", "outlook", "apple", "icloud", "google", "gmail", "amazon", "netflix",
  "facebook", "instagram", "linkedin", "dropbox", "docusign", "dhl", "fedex", "usps", "chase", "wellsfargo", "bankofamerica", "coinbase", "binance"];
export const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at"]);
export const SUSPICIOUS_TLDS = new Set(["zip", "mov", "top", "xyz", "click", "gq", "tk", "ml", "cf", "ga", "work", "rest", "country", "icu"]);
export const LURE_TOKENS = ["login", "signin", "verify", "account", "update", "secure", "password", "confirm", "banking", "wallet", "billing"];

function f(rule: RuleDef, observed: string): Finding {
  return { ruleId: rule.id, title: rule.title, weight: rule.weight, observed, explanation: rule.description };
}

/** Pure function of the features: same features, same findings, same order. */
export function evaluateUrlRules(x: UrlFeatures): Finding[] {
  const R = URL_RULES;
  const out: Finding[] = [];
  if (x.isIpHost) out.push(f(R["U-IP-HOST"], `host = ${x.host}`));
  if (x.hasUserInfo) {
    out.push(f(R["U-USERINFO"], "authority contains '@'"));
    if (x.userInfoLooksLikeHost) out.push(f(R["U-USERINFO-HOSTLIKE"], "user-information contains a dot"));
  }
  if (x.hasPunycode) out.push(f(R["U-PUNYCODE"], `host = ${x.host}`));
  if (x.brandHits.length) out.push(f(R["U-BRAND-LOOKALIKE"], `brand keyword(s) ${x.brandHits.join(", ")} in host ${x.host}; registrable domain ${x.registrable}`));
  if (x.isShortener) out.push(f(R["U-SHORTENER"], `host = ${x.host}`));
  if (!x.isIpHost && SUSPICIOUS_TLDS.has(x.tld)) out.push(f(R["U-SUSPICIOUS-TLD"], `tld = .${x.tld}`));
  if (!x.isIpHost && x.subdomainDepth >= 4) out.push(f(R["U-SUBDOMAIN-DEPTH"], `${x.subdomainDepth} subdomain labels`));
  if (x.port) out.push(f(R["U-NONSTD-PORT"], `port = ${x.port}`));
  if (x.urlLength >= 120) out.push(f(R["U-LONG-URL"], `${x.urlLength} characters`));
  if (x.hostLength >= 40) out.push(f(R["U-LONG-HOST"], `${x.hostLength} characters`));
  if (x.hostHyphens >= 4) out.push(f(R["U-HYPHEN-HOST"], `${x.hostHyphens} hyphens`));
  if (x.lureTokens.length >= 2) out.push(f(R["U-LURE-TOKENS"], `words: ${x.lureTokens.join(", ")}`));
  if (x.percentEncodedCount >= 5) out.push(f(R["U-ENCODING-HEAVY"], `${x.percentEncodedCount} encoded sequences`));
  if (x.scheme === "http" && !x.schemeAssumed) out.push(f(R["U-HTTP-SCHEME"], "scheme = http"));
  return out;
}
