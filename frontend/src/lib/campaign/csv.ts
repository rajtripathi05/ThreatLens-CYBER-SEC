/** Minimal RFC 4180 CSV reader/writer with spreadsheet formula-injection protection on export. */
export interface CsvParse { header: string[]; rows: string[][]; errors: string[] }

export function parseCsv(text: string): CsvParse {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  const errors: string[] = [];
  let row: string[] = [], field = "", inQ = false, quoted = false, i = 0;
  const endField = () => { row.push(field); field = ""; quoted = false; };
  const endRow = () => { endField(); if (!(row.length === 1 && row[0].trim() === "")) rows.push(row); row = []; };
  while (i < src.length) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === "" && !quoted) { inQ = true; quoted = true; i++; continue; }
    if (c === ",") { endField(); i++; continue; }
    if (c === "\r") { if (src[i + 1] === "\n") i++; endRow(); i++; continue; }
    if (c === "\n") { endRow(); i++; continue; }
    field += c; i++;
  }
  if (inQ) errors.push("The file ends inside a quoted field (unbalanced quote). Rows after the quote may be merged.");
  if (field !== "" || row.length) endRow();
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return { header, rows, errors };
}

/** Prefixes cells a spreadsheet could execute as a formula (=, +, -, @, tab, CR) with an apostrophe. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
