import type { ClassifierRun, ExperimentSet } from "./types";
import type { Row } from "./research";

/**
 * Everything the Overview, Research Lab and guided demo state about results is computed here from the
 * saved result files. Nothing in this module contains a result literal.
 */

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(a.length, 1);
const sd = (a: number[]) => (a.length < 2 ? 0 : Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1)));

// ---------------------------------------------------------------- raw vs normalised URL classifier
export interface ShortcutCell { protocol: string; raw: number; rawSd: number; stripped: number; strippedSd: number; points: number; seeds: number[]; nTest: number }
export function shortcutFinding(set: ExperimentSet | null | undefined): ShortcutCell[] {
  const runs: ClassifierRun[] = set?.metadata.runs ?? [];
  const protocols = [...new Set(runs.map((r) => r.protocol))];
  const out: ShortcutCell[] = [];
  for (const protocol of protocols) {
    const raw = runs.filter((r) => r.protocol === protocol && r.variant === "raw_url").map((r) => r.f1);
    const st = runs.filter((r) => r.protocol === protocol && r.variant !== "raw_url").map((r) => r.f1);
    if (!raw.length || !st.length) continue;
    out.push({ protocol, raw: mean(raw), rawSd: sd(raw), stripped: mean(st), strippedSd: sd(st), points: (mean(raw) - mean(st)) * 100,
      seeds: runs.filter((r) => r.protocol === protocol && r.variant === "raw_url").map((r) => r.seed),
      nTest: runs.find((r) => r.protocol === protocol && r.variant === "raw_url")?.n_test ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------- experiment presets
export interface Preset { id: string; label: string; setId: string; group: "coverage_noise" | "control_shuffled"; coverage: number; noise: number; visibility: "unlabelled"; blurb: string }
export const PRESETS: Preset[] = [
  { id: "baseline", label: "Baseline", setId: "real-ti-proxy", group: "coverage_noise", coverage: 1, noise: 0, visibility: "unlabelled", blurb: "A feed built from hosts of training-split phishing URLs, with nothing removed and no false matches. It matches only a small share of test phishing, so the ML model does most of the work." },
  { id: "missing50", label: "50% missing indicators", setId: "real-ti-proxy", group: "coverage_noise", coverage: 0.5, noise: 0, visibility: "unlabelled", blurb: "Half of that feed's indicators are deleted, so more phishing URLs get NO_MATCH." },
  { id: "noise10", label: "10% synthetic noise", setId: "real-ti-oracle", group: "coverage_noise", coverage: 1, noise: 0.1, visibility: "unlabelled", blurb: "Synthetic false matches make up 10% of the feed and are not labelled as synthetic. Noise is added to the oracle-derived feed because the same noise on the proxy feed exhausts the legitimate test URLs (see the saturation warning)." },
  { id: "shuffled", label: "Shuffled feed", setId: "real-ti-proxy", group: "control_shuffled", coverage: 1, noise: 0, visibility: "unlabelled", blurb: "Negative control: the feed's matches are randomly re-assigned to items, so a sound policy should gain nothing from them." },
  { id: "oracle", label: "Oracle upper bound", setId: "real-ti-oracle", group: "coverage_noise", coverage: 1, noise: 0, visibility: "unlabelled", blurb: "The feed is built from held-out test labels, so it is perfect wherever it has coverage. This is the best case, not independent intelligence." },
];

/** Injected false matches are drawn from the legitimate TEST URLs. If the requested count reaches that pool, every legitimate URL
 * is falsely matched and the metric saturates (e.g. FPR = 100%). Computed from run metadata using the same formula as the experiment. */
export function saturation(set: ExperimentSet | null | undefined, p: Preset): { injected: number; pool: number } | null {
  const o = set?.metadata.feed_overlap;
  if (!o || p.noise <= 0 || p.noise >= 1) return null;
  const injected = Math.round((o.feed_entries_before_degradation * p.coverage * p.noise) / (1 - p.noise));
  return injected >= o.test_legitimate ? { injected, pool: o.test_legitimate } : null;
}

export const METRIC_KEYS = ["precision", "recall", "f1", "fpr", "review_rate", "roc_auc"] as const;

/** Rows for one preset. seed === "all": the saved summary (mean and SD over seeds); otherwise that seed's saved observation. */
export function presetRows(set: ExperimentSet | null | undefined, p: Preset, seed: "all" | number): Row[] {
  if (!set) return [];
  const match = (r: Row) => r.group === p.group && Number(r.noise) === p.noise && (p.group === "control_shuffled" || (Number(r.coverage) === p.coverage && r.visibility === p.visibility));
  if (seed === "all") return (set.summary as Row[]).filter(match);
  return (set.by_run ?? []).filter((r) => Number(r.seed) === seed && match(r)).map((r) => {
    const o: Row = { ...r };
    for (const k of METRIC_KEYS) { o[`${k}_mean`] = r[k] ?? null; o[`${k}_std`] = 0; }
    return o;
  });
}

// ---------------------------------------------------------------- method comparison wording
export type Outcome = "improved" | "matched" | "worsened";
export interface Delta { metric: string; a: number | null; b: number | null; diffPoints: number | null; outcome: Outcome | null }
const TOL = 0.0005; // 0.05 percentage points

/** Compare method b against method a. For FPR lower is better. */
export function compare(rows: Row[], a: string, b: string): Delta[] {
  const get = (m: string, k: string) => { const v = rows.find((r) => r.method === m)?.[`${k}_mean`]; return typeof v === "number" ? v : null; };
  return (["f1", "fpr", "review_rate"] as const).map((metric) => {
    const x = get(a, metric), y = get(b, metric);
    if (x == null || y == null) return { metric, a: x, b: y, diffPoints: null, outcome: null };
    const d = y - x;
    const better = metric === "f1" ? d : -d;
    const outcome: Outcome | null = metric === "review_rate" ? null : Math.abs(d) <= TOL ? "matched" : better > 0 ? "improved" : "worsened";
    return { metric, a: x, b: y, diffPoints: d * 100, outcome };
  });
}
