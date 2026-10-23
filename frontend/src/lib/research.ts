import type { MethodId } from "./types";

export const METHODS: { id: MethodId; short: string; name: string; color: string; dash?: string; main: boolean }[] = [
  { id: "ml_only", short: "A", name: "A · ML only", color: "#5EB1FF", main: true },
  { id: "naive_fusion", short: "B", name: "B · Naive fusion", color: "#FF9F6B", main: true },
  { id: "reliability_aware", short: "C", name: "C · Reliability-aware", color: "#2DD4BF", main: true },
  { id: "heuristics_only", short: "H", name: "Lexical rules only", color: "#9AA8BD", dash: "5 3", main: false },
  { id: "dummy_random_prior", short: "R", name: "Random (class prior)", color: "#C4A1FF", dash: "2 3", main: false },
  { id: "dummy_always_benign", short: "0", name: "Always benign", color: "#6B7A90", dash: "2 3", main: false },
];
export const methodMeta = (id: string) => METHODS.find((m) => m.id === id);

export const METRICS: { id: string; label: string; better: "higher" | "lower" | "context"; help: string }[] = [
  { id: "f1", label: "F1", better: "higher", help: "Harmonic mean of precision and recall for the 'phishing' verdict. Items routed to review count as not flagged." },
  { id: "precision", label: "Precision", better: "higher", help: "Of URLs called phishing, the share that are phishing." },
  { id: "recall", label: "Recall", better: "higher", help: "Of phishing URLs, the share called phishing (review does not count)." },
  { id: "fpr", label: "False-positive rate", better: "lower", help: "Of legitimate URLs, the share wrongly called phishing." },
  { id: "review_rate", label: "Manual-review rate", better: "context", help: "Share of items sent to a human instead of being decided." },
  { id: "recall_incl_review", label: "Recall incl. review", better: "higher", help: "Recall when review items are treated as flagged." },
  { id: "fpr_incl_review", label: "FPR incl. review", better: "lower", help: "False-positive rate when review items are treated as flagged." },
  { id: "roc_auc", label: "ROC-AUC", better: "higher", help: "Ranking quality of each method's score (decision-threshold independent)." },
];

export const FAMILIES: { id: string; label: string; blurb: string }[] = [
  { id: "coverage_noise", label: "Missing coverage & noisy feed", blurb: "Feed loses a share of its true indicators and/or gains synthetic false matches." },
  { id: "stale", label: "Stale indicators", blurb: "A share of indicators is aged beyond the freshness limit." },
  { id: "outage", label: "Feed outage", blurb: "The feed is unreachable for a share of lookups (state UNKNOWN)." },
  { id: "control_shuffled", label: "Shuffled negative control", blurb: "Feed matches are randomly re-assigned to items. A good policy gains nothing." },
];

export type Row = Record<string, number | string | null>;
export const val = (r: Row | undefined, metric: string, stat: "mean" | "std" = "mean"): number | null => {
  const v = r?.[`${metric}_${stat}`];
  return typeof v === "number" ? v : null;
};
export const uniq = (rows: Row[], key: string): number[] =>
  [...new Set(rows.map((r) => Number(r[key])))].filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
