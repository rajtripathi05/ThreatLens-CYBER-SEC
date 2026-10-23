import type { AuthResult, ValidationError } from "./types";

export const MAX_EMAIL_CHARS = 2_000_000;
export const MAX_EMAIL_URLS = 25;

export interface Anchor { href: string; text: string }
export interface ParsedEmail {
  ok: true;
  hasHeaders: boolean;
  headers: Map<string, string[]>;
  text: string;
  anchors: Anchor[];
  urls: string[];
  urlsTruncated: boolean;
}

type Headers = Map<string, string[]>;

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try { return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}
function b64Bytes(s: string): Uint8Array {
  try { const bin = atob(s.replace(/\s+/g, "")); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); } catch { return new Uint8Array(); }
}
function qpBytes(s: string): Uint8Array {
  const joined = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i];
    if (c === "=" && /^[0-9a-f]{2}$/i.test(joined.slice(i + 1, i + 3))) { out.push(parseInt(joined.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(...new TextEncoder().encode(c));
  }
  return Uint8Array.from(out);
}

/** Decode RFC 2047 encoded-words (=?utf-8?B?...?=) in header values. */
export function decodeWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, cs: string, enc: string, data: string) => {
    const bytes = enc.toLowerCase() === "b" ? b64Bytes(data) : qpBytes(data.replace(/_/g, " "));
    return decodeBytes(bytes, cs);
  }).replace(/\?=\s+=\?/g, "");
}

function parseHeaderBlock(block: string): Headers {
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const h: Headers = new Map();
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    h.set(k, [...(h.get(k) ?? []), m[2].trim()]);
  }
  return h;
}

function splitHeadBody(text: string): { head: string; body: string } | null {
  const m = /\r?\n\r?\n/.exec(text);
  const head = m ? text.slice(0, m.index) : text;
  if (!/^[A-Za-z][A-Za-z0-9-]*:/.test(head)) return null;
  return { head, body: m ? text.slice(m.index + m[0].length) : "" };
}

function param(v: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(v);
  return m ? (m[1] ?? m[2] ?? "") : "";
}

function stripHtml(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

interface Collected { text: string[]; html: string[] }

function walk(headers: Headers, body: string, out: Collected, depth = 0): void {
  if (depth > 6) return;
  const ctype = (headers.get("content-type")?.[0] ?? "text/plain").toLowerCase();
  const disp = (headers.get("content-disposition")?.[0] ?? "").toLowerCase();
  if (disp.startsWith("attachment")) return;
  if (ctype.startsWith("multipart/")) {
    const boundary = param(headers.get("content-type")![0], "boundary");
    if (!boundary) return;
    const parts = body.split(`--${boundary}`).slice(1);
    for (const p of parts) {
      if (p.startsWith("--")) break;
      const hb = splitHeadBody(p.replace(/^\r?\n/, ""));
      if (hb) walk(parseHeaderBlock(hb.head), hb.body, out, depth + 1);
    }
    return;
  }
  if (!ctype.startsWith("text/")) return;
  const enc = (headers.get("content-transfer-encoding")?.[0] ?? "").toLowerCase();
  const charset = param(headers.get("content-type")?.[0] ?? "", "charset");
  const decoded = enc === "base64" ? decodeBytes(b64Bytes(body), charset)
    : enc === "quoted-printable" ? decodeBytes(qpBytes(body), charset) : body;
  (ctype.startsWith("text/html") ? out.html : out.text).push(decoded);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;
function cleanUrl(u: string): string { return u.replace(/[.,;:!?]+$/, ""); }

export function parseEmail(raw: string): ParsedEmail | ValidationError {
  if (!raw.trim()) return { ok: false, code: "empty", message: "Paste an email body or choose an .eml file." };
  if (raw.length > MAX_EMAIL_CHARS) return { ok: false, code: "too_large", message: "The message is larger than the 2 MB limit." };
  const hb = splitHeadBody(raw);
  const headers = hb ? parseHeaderBlock(hb.head) : new Map<string, string[]>();
  const looksLikeEmail = hb && (headers.has("from") || headers.has("subject") || headers.has("content-type"));
  const out: Collected = { text: [], html: [] };
  if (looksLikeEmail && hb) walk(headers, hb.body, out);
  else out.text.push(raw);

  const anchors: Anchor[] = [];
  for (const h of out.html) {
    for (const m of h.matchAll(/<a\b[^>]*?href\s*=\s*["']?([^"' >]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)) anchors.push({ href: m[1], text: stripHtml(m[2]) });
  }
  const text = [...out.text, ...out.html.map(stripHtml)].join("\n");
  const found: string[] = [];
  const add = (u: string) => { const c = cleanUrl(u); if (/^https?:\/\//i.test(c) && !found.includes(c)) found.push(c); };
  for (const a of anchors) add(a.href);
  for (const s of [...out.text, ...out.html]) for (const m of s.matchAll(URL_RE)) add(m[0]);
  return {
    ok: true, hasHeaders: Boolean(looksLikeEmail), headers, text, anchors,
    urls: found.slice(0, MAX_EMAIL_URLS), urlsTruncated: found.length > MAX_EMAIL_URLS,
  };
}

export function header(p: ParsedEmail, name: string): string {
  return decodeWords(p.headers.get(name.toLowerCase())?.[0] ?? "");
}

export interface Mailbox { display: string; address: string; domain: string }
export function parseMailbox(v: string): Mailbox {
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(v);
  const bare = /[^\s<>"',;]+@[^\s<>"',;]+/.exec(v);
  const address = (angle?.[1] ?? bare?.[0] ?? "").toLowerCase();
  const display = (angle ? v.replace(angle[0], "") : "").replace(/^["'\s]+|["'\s]+$/g, "");
  return { display, address, domain: address.split("@")[1] ?? "" };
}

function mapAuth(v: string | undefined): AuthResult {
  if (!v) return "not_present";
  const s = v.toLowerCase();
  return s === "pass" || s === "fail" || s === "softfail" || s === "neutral" || s === "none" ? s : "other";
}

/** Only reads results the headers state explicitly. Absence is reported as "not_present", never as failure. */
export function parseAuth(p: ParsedEmail): { spf: AuthResult; dkim: AuthResult; dmarc: AuthResult } {
  const ar = (p.headers.get("authentication-results") ?? []).join(" ");
  const pick = (k: string) => new RegExp(`\\b${k}\\s*=\\s*([a-z]+)`, "i").exec(ar)?.[1];
  const receivedSpf = /^\s*([a-z]+)/i.exec(p.headers.get("received-spf")?.[0] ?? "")?.[1];
  return { spf: mapAuth(pick("spf") ?? receivedSpf), dkim: mapAuth(pick("dkim")), dmarc: mapAuth(pick("dmarc")) };
}
