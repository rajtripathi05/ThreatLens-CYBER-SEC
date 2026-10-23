export interface UrlFeature { name: string; value: string; note: string }

/** Plain string facts computed in the browser from the URL text. Nothing is fetched or resolved. These are NOT the model's inputs
 * (the model reads character n-grams); they are shown so a reader can see what a lexical rule looks at. */
export function describeUrl(raw: string): UrlFeature[] {
  let u: URL | null = null;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`); } catch { /* malformed */ }
  if (!u) return [{ name: "Parse", value: "failed", note: "The string is not a parseable URL." }];
  const host = u.hostname;
  const labels = host.split(".");
  const digits = (raw.match(/\d/g) ?? []).length;
  return [
    { name: "Scheme", value: u.protocol.replace(":", ""), note: u.protocol === "http:" ? "Plain HTTP is a weak signal only." : "HTTPS says nothing about trustworthiness." },
    { name: "Host", value: host, note: "Defanged on screen; never resolved." },
    { name: "Host labels", value: String(labels.length), note: "Dot-separated parts; many subdomains can hide the real domain." },
    { name: "Top-level label", value: labels[labels.length - 1] ?? "", note: "Last label of the host." },
    { name: "Has IP-literal host", value: /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? "yes" : "no", note: "Numeric hosts avoid a registered name." },
    { name: "Path length", value: String(u.pathname.length), note: "Characters in the path." },
    { name: "Total length", value: String(raw.length), note: "Characters in the full string." },
    { name: "Digits", value: String(digits), note: "Digit characters anywhere in the URL." },
    { name: "Hyphens in host", value: String((host.match(/-/g) ?? []).length), note: "Hyphenated hosts are common in look-alike names." },
  ];
}
