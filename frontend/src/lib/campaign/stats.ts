import type { Analyzed, IssueCode } from "./quality";

export interface Tally { value: string; count: number }
export interface OverviewStats {
  total: number;
  uniqueCampaigns: number;
  /** Has source, medium and campaign and parses as a URL (naming warnings do not count against this). */
  validRequired: number;
  withIssues: number;
  clean: number;
  duplicates: number;
  sources: Tally[];
  mediums: Tally[];
  issueCounts: { code: IssueCode; count: number }[];
  recent: Analyzed[];
}

function tally(values: string[]): Tally[] {
  const m = new Map<string, number>();
  for (const v of values) { const k = v.trim(); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Everything the overview shows is computed from the records passed in. No placeholders, no performance numbers. */
export function computeStats(rows: Analyzed[]): OverviewStats {
  const codes = new Map<IssueCode, number>();
  for (const r of rows) for (const c of new Set(r.issues.map((i) => i.code))) codes.set(c, (codes.get(c) ?? 0) + 1);
  return {
    total: rows.length,
    uniqueCampaigns: new Set(rows.map((r) => r.utm.utm_campaign.trim().toLowerCase()).filter(Boolean)).size,
    validRequired: rows.filter((r) => !r.issues.some((i) => i.code === "invalid-url" || i.code === "missing-required")).length,
    withIssues: rows.filter((r) => r.status !== "ok").length,
    clean: rows.filter((r) => r.status === "ok").length,
    duplicates: codes.get("duplicate") ?? 0,
    sources: tally(rows.map((r) => r.utm.utm_source)),
    mediums: tally(rows.map((r) => r.utm.utm_medium)),
    issueCounts: [...codes.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    recent: [...rows].sort((a, b) => b.updatedUtc.localeCompare(a.updatedUtc)).slice(0, 6),
  };
}

export const ISSUE_LABEL: Record<IssueCode, string> = {
  "invalid-url": "Invalid URL", "missing-required": "Missing UTM", duplicate: "Duplicate", "naming-case": "Not lowercase",
  "naming-chars": "Special characters", "naming-variant": "Spelling variants", "param-repeat": "Repeated parameter",
};
