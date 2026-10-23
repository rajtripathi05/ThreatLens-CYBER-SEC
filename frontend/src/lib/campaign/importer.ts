import { parseCsv, toCsv } from "./csv";
import { dupKey, type Analyzed, type CampaignRecord } from "./quality";
import type { NewRecord } from "./store";
import { buildUtmUrl, emptyUtm, extractUtm, parseDestination, UTM_KEYS, type UtmValues } from "./utm";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_URL_LENGTH = 2000;
const URL_ALIASES = ["url", "final_url", "full_url", "tagged_url", "destination_url", "destination", "link"];
const NAME_ALIASES = ["name", "title", "label", "campaign_name"];
const NOTE_ALIASES = ["note", "notes", "comment", "comments"];

export interface RowError { line: number; message: string }
export interface ImportResult {
  records: NewRecord[];
  rejected: RowError[];
  /** File-level problem (missing column, empty file). When set, nothing is imported. */
  fatal?: string;
  warnings: string[];
  totalRows: number;
  /** Which header cells were understood, so the preview can show how the file was read. */
  columns: { recognized: { column: string; as: string }[]; ignored: string[] };
}

/** Undoes the apostrophe our own export adds in front of cells that could be read as spreadsheet formulas. */
const unescapeCell = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);

/** Splits new rows into those not yet in the library (or earlier in the same file) and exact/normalized duplicates. */
export function splitDuplicates(items: NewRecord[], existing: CampaignRecord[]): { fresh: NewRecord[]; duplicates: NewRecord[] } {
  const seen = new Set(existing.map((r) => dupKey(r.finalUrl)));
  const fresh: NewRecord[] = [], duplicates: NewRecord[] = [];
  for (const i of items) { const k = dupKey(i.finalUrl); if (seen.has(k)) duplicates.push(i); else { seen.add(k); fresh.push(i); } }
  return { fresh, duplicates };
}

const pick = (header: string[], aliases: string[]) => header.findIndex((h) => aliases.includes(h.toLowerCase().replace(/[\s-]+/g, "_")));

/**
 * Turns CSV text into campaign records. A URL column is required. If separate utm_* columns exist they are applied to the
 * URL (a cell overrides the URL's own value only when it is non-empty). Valid rows are kept; each rejected row is reported
 * with its line number in the file.
 */
export function importCampaignCsv(text: string): ImportResult {
  const out: ImportResult = { records: [], rejected: [], warnings: [], totalRows: 0, columns: { recognized: [], ignored: [] } };
  if (!text.trim()) return { ...out, fatal: "The file is empty." };
  const { header, rows, errors } = parseCsv(text);
  out.warnings.push(...errors);
  const urlCol = pick(header, URL_ALIASES);
  if (urlCol < 0) return { ...out, fatal: `No URL column found. Add a header named one of: ${URL_ALIASES.join(", ")}. Found: ${header.filter(Boolean).join(", ") || "(none)"}.` };
  const nameCol = pick(header, NAME_ALIASES), noteCol = pick(header, NOTE_ALIASES);
  const utmCols = UTM_KEYS.map((k) => header.findIndex((h) => h.toLowerCase() === k));
  out.totalRows = rows.length;
  header.forEach((h, i) => {
    if (!h) return;
    const as = i === urlCol ? "URL" : i === nameCol ? "Label" : i === noteCol ? "Note" : utmCols.includes(i) ? h.toLowerCase() : "";
    if (as) out.columns.recognized.push({ column: h, as }); else out.columns.ignored.push(h);
  });

  rows.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const raw = unescapeCell((r[urlCol] ?? "").trim());
    if (!raw) return out.rejected.push({ line, message: "URL is empty." });
    if (raw.length > MAX_URL_LENGTH) return out.rejected.push({ line, message: `URL is longer than ${MAX_URL_LENGTH} characters.` });
    const p = parseDestination(raw);
    if (!p.ok) return out.rejected.push({ line, message: p.error });
    const cols = utmCols.some((c) => c >= 0);
    let finalUrl = raw;
    if (cols) {
      const existing = extractUtm(raw)?.utm ?? emptyUtm();
      const merged: UtmValues = { ...existing };
      UTM_KEYS.forEach((k, ki) => { const v = utmCols[ki] >= 0 ? (r[utmCols[ki]] ?? "").trim() : ""; if (v) merged[k] = v; });
      finalUrl = buildUtmUrl(raw, merged).url;
    }
    out.records.push({ finalUrl, name: nameCol >= 0 ? unescapeCell((r[nameCol] ?? "").trim()).slice(0, 200) : "", note: noteCol >= 0 ? unescapeCell((r[noteCol] ?? "").trim()).slice(0, 1000) : "" });
  });
  if (out.totalRows > 0 && out.records.length === 0) out.warnings.push("No valid rows were found.");
  return out;
}

export const CLEAN_HEADER = ["name", "final_url", "base_url", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "note"];
export const cleanedCsv = (rows: Analyzed[]) =>
  toCsv(CLEAN_HEADER, rows.map((r) => [r.name, r.finalUrl, r.baseUrl, r.utm.utm_source, r.utm.utm_medium, r.utm.utm_campaign, r.utm.utm_term, r.utm.utm_content, r.note]));

export const REPORT_HEADER = ["id", "name", "final_url", "status", "issue_codes", "issues"];
export const reportCsv = (rows: Analyzed[]) =>
  toCsv(REPORT_HEADER, rows.map((r) => [r.id, r.name, r.finalUrl, r.status, r.issues.map((i) => i.code).join(";"), r.issues.map((i) => i.message).join(" | ")]));

/** Error report for rejected import rows (line number and reason only: row contents are not echoed). */
export const rejectedCsv = (rej: RowError[]) => toCsv(["line", "reason"], rej.map((r) => [r.line, r.message]));
