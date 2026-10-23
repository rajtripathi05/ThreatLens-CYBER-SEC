// Types mirror api/models.py and the saved experiment outputs. Keep in sync.

export type Decision = "phishing" | "benign" | "review";
export type Severity = "high" | "medium" | "low";
export type TIState = "MATCH_FRESH" | "MATCH_STALE" | "SYNTHETIC_MATCH" | "NO_MATCH" | "UNKNOWN";

export interface ModelInfo {
  kind: "real_phiusiil" | "synthetic_demo" | "unavailable";
  version?: string | null;
  trained_on_synthetic?: boolean | null;
  artifact_sha256?: string | null;
  dataset_sha256?: string | null;
  thresholds?: Record<string, number> | null;
  detail: string;
}

export interface EvidenceItem {
  id: string;
  kind: "model" | "heuristic" | "threat_intel" | "email_heuristic" | "missing";
  source: string;
  finding: string;
  observed_at?: string | null;
  confidence?: number | null;
  confidence_note?: string | null;
  interpretation: string;
  link?: string | null;
  influenced_decision: boolean;
}

export interface TIResult {
  state: TIState;
  indicator: string;
  source: string;
  observed_at: string | null;
  expires_at: string | null;
  detail: string;
}

export interface Contribution { name: string; value: number; note: string }
export interface TermContribution { ngram: string; contribution: number; direction: string }

export interface UrlResult {
  url: string;
  normalized: string;
  source: string;
  decision: Decision;
  decision_label: string;
  risk_score: number;
  ml_probability: number;
  ml_top_terms: TermContribution[];
  ti: TIResult;
  contributions: Contribution[];
  rationale: string;
  evidence: EvidenceItem[];
  suggested_actions: string[];
}

export interface AnalysisResponse {
  analysis_id: string;
  created_utc: string;
  input_kind: "url" | "email";
  overall_decision: Decision;
  overall_label: string;
  overall_score: number;
  score_semantics: string;
  model: ModelInfo;
  ti_source: { loaded?: boolean; name?: string; entries?: number; collected_at?: string | null; is_demo?: boolean; consulted?: boolean; detail?: string };
  urls: UrlResult[];
  email_meta: { subject?: string; from?: string; reply_to?: string; auth?: Record<string, string>; n_attachments?: number; warnings?: string[] };
  email_evidence: EvidenceItem[];
  notes: string[];
  scope_note: string;
  disclaimer: string;
}

/** Where an analysis came from. Demo fixtures are never presented as live model output. */
export type Origin = "live" | "demo-fixture";
export interface TaggedAnalysis { origin: Origin; fixtureName?: string; data: AnalysisResponse }

export interface StatusResponse {
  api_version: string;
  uptime_seconds: number;
  model: ModelInfo;
  dataset: { phiusiil_present: boolean; sha256?: string; rows?: number; downloaded_utc?: string };
  threat_intel: { loaded: boolean; name?: string; entries: number; collected_at?: string | null; is_demo?: boolean; detail: string };
  experiments: { id: string; available: boolean; run_id: string | null; is_synthetic: boolean | null; title: string }[];
  incidents: { enabled: boolean; token_required: boolean; raw_storage_allowed: boolean; persistence_note: string };
  disclaimer: string;
}

export interface IncidentSummary {
  case_id: string;
  created_utc: string;
  input_kind: string;
  verdict: Decision;
  severity: Severity;
  status: "open" | "triaged" | "closed" | string;
  score: number;
  n_urls: number;
  raw_saved: boolean;
  model_version?: string | null;
  model_trained_on_synthetic?: boolean | null;
  first_url?: string | null;
  origin: "saved" | "demo-fixture";
}

export interface IncidentRecord extends IncidentSummary {
  verdict_label: string;
  overall_score: number;
  score_semantics: string;
  note: string;
  email_meta: AnalysisResponse["email_meta"];
  email_signals: { name: string; detail: string; severity: string }[];
  urls: {
    url: string; ml_probability: number; decision: Decision; rationale: string; ti: TIResult;
    signals: { name: string; detail: string; severity: string }[]; contributions: Contribution[];
  }[];
  evidence?: Record<string, EvidenceItem[]>;
  notes: string[];
  disclaimer: string;
  created_utc: string;
}

// ---- experiments -------------------------------------------------------------------------
export interface ExperimentSetInfo {
  id: string; kind: "ti_simulation" | "classifier"; title: string; available: boolean;
  run_id: string | null; is_synthetic: boolean | null; is_simulation: boolean | null;
  finished_utc: string | null; evidence_level: string | null; hint: string | null;
}

export type MethodId =
  | "dummy_always_benign" | "dummy_random_prior" | "heuristics_only" | "ml_only" | "naive_fusion" | "reliability_aware";

export interface SummaryRow {
  scenario_id: string; group: string; coverage: number; noise: number; visibility: "labelled" | "unlabelled";
  stale: number; outage: number; control: string; method: MethodId;
  [metric: string]: number | string | null;
}

export interface ClassifierRun {
  protocol: string; variant: string; seed: number; n_train: number; n_val: number; n_test: number;
  phishing_rate: { train: number; val: number; test: number };
  threshold_t_hi: number; tp: number; fp: number; fn: number; tn: number;
  precision: number; recall: number; f1: number; fpr: number; roc_auc: number; pr_auc: number;
  brier: number; brier_calibrated: number; ece: number; ece_isotonic_val_fit: number;
  reliability_bins: { bin: number; n: number; mean_predicted: number; observed_rate: number }[];
  roc_curve: { fpr: number[]; tpr: number[] };
  ci95: Record<"precision" | "recall" | "f1" | "fpr" | "roc_auc", [number, number]>;
  latency_ms_per_url: number; train_seconds: number;
  leakage_audit: { frac_test_host_seen_in_train: number; frac_test_near_duplicate_in_train: number; test_size: number };
}

export interface ExperimentMetadata {
  run_id: string; kind: string; is_synthetic: boolean; is_simulation?: boolean;
  evidence_level: string; finished_utc?: string; started_utc?: string; git_commit?: string;
  feed_mode?: string; feed_mode_description?: string;
  feed_overlap?: {
    feed_entries_before_degradation: number; test_phishing_with_match: number; test_phishing: number;
    test_legitimate_with_match: number; test_legitimate: number; phishing_match_rate: number; legitimate_match_rate: number;
  };
  data_provenance?: { source?: string; sha256?: string; final_rows?: number; original_rows?: number; synthetic?: boolean; phishing_rate?: number };
  versions?: Record<string, string>;
  config?: Record<string, unknown>;
  split?: { seed: number; train: number; val: number; test_used: number };
  thresholds_fit_on_validation?: Record<string, number>;
  latency_ms_per_item?: Record<string, number>;
  split_protocols?: Record<string, string>;
  threshold_policy?: string;
  preprocessing_version?: string;
  scenario_count?: number; seeds?: number[]; n_runs?: number;
  runs?: ClassifierRun[];
}

export interface ExperimentSet {
  id: string; kind: "ti_simulation" | "classifier"; title: string; metadata: ExperimentMetadata;
  summary: Record<string, number | string | null>[];
  tradeoff?: Record<string, number | null>[];
  /** Per-seed observations (simulation sets only). */
  by_run?: Record<string, number | string | null>[];
  filters?: Record<string, number[]>;
}

export interface ApiErrorBody { error: { code: string; message: string } }
