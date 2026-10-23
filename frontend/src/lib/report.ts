import { LIMITATIONS } from "./limitations";
import type { AnalysisResponse, Origin } from "./types";
import { defang } from "./utils";

export interface ReportPreview {
  report_id: string;
  persisted: false;
  origin: Origin;
  generated_utc: string;
  analysis_created_utc: string;
  verdict: string;
  verdict_label: string;
  heuristic_score: number;
  score_semantics: string;
  input_kind: string;
  model: { kind: string; version: string | null; trained_on_synthetic: boolean | null; thresholds: Record<string, number> | null };
  threat_intel_snapshot: AnalysisResponse["ti_source"];
  indicators: { url: string; url_defanged: string; decision: string; model_score: number; ti_state: string; ti_detail: string; rationale: string;
    evidence: { kind: string; source: string; finding: string; interpretation: string; influenced_decision: boolean }[]; recommended_actions: string[] }[];
  limitations: string[];
  provenance: { source: string; note: string; experiments?: Record<string, string> };
  raw_content_stored: false;
}

/** Built in the browser from an analysis. It is a PREVIEW: nothing is persisted and no raw message content is included. */
export function buildReportPreview(a: AnalysisResponse, origin: Origin, experiments?: Record<string, string>): ReportPreview {
  return {
    report_id: `PREVIEW-${a.analysis_id.slice(0, 8)}`, persisted: false, origin,
    generated_utc: new Date().toISOString(), analysis_created_utc: a.created_utc,
    verdict: a.overall_decision, verdict_label: a.overall_label, heuristic_score: a.overall_score, score_semantics: a.score_semantics, input_kind: a.input_kind,
    model: { kind: a.model.kind, version: a.model.version ?? null, trained_on_synthetic: a.model.trained_on_synthetic ?? null, thresholds: a.model.thresholds ?? null },
    threat_intel_snapshot: a.ti_source,
    indicators: a.urls.map((u) => ({
      url: u.url, url_defanged: defang(u.url), decision: u.decision, model_score: u.ml_probability, ti_state: u.ti.state, ti_detail: u.ti.detail, rationale: u.rationale,
      evidence: u.evidence.map((e) => ({ kind: e.kind, source: e.source, finding: e.finding, interpretation: e.interpretation, influenced_decision: e.influenced_decision })),
      recommended_actions: u.suggested_actions,
    })),
    limitations: [a.scope_note, a.disclaimer, ...LIMITATIONS].filter(Boolean),
    provenance: origin === "demo-fixture"
      ? { source: "DEMO FIXTURE", note: "Precomputed with a synthetic demo model on a reserved .example name. Not a live prediction.", experiments }
      : { source: "LIVE API", note: "Scored by the connected backend. The URL was not fetched.", experiments },
    raw_content_stored: false,
  };
}
