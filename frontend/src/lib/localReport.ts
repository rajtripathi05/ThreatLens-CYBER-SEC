import { LIMITATIONS } from "./limitations";
import type { LocalAnalysis } from "./localAnalysis";
import { defang } from "./utils";

export interface LocalReport {
  report_kind: "threatlens-local-heuristic-report";
  mode: "LOCAL_RULE_BASED";
  /** Always false: this report comes from the user's own input, never a bundled fixture. */
  demo_fixture: false;
  generated_utc: string;
  rule_set_version: string;
  input_type: string;
  verdict: string;
  heuristic_risk_score: number;
  score_semantics: string;
  not_a_validated_ml_prediction: true;
  threat_intelligence: { state: string; detail: string; snapshot: unknown };
  findings: { rule_id: string; title: string; weight: number; observed: string; explanation: string }[];
  urls: { url_defanged: string; verdict: string; score: number; threat_intel_state: string; rule_ids: string[] }[];
  email?: { subject: string; from: string; reply_to: string; auth: Record<string, string> };
  evidence: LocalAnalysis["evidence"];
  recommended_actions: string[];
  limitations: string[];
  raw_content_included: false;
}

/** Built entirely in the browser. `now` is metadata only and never influences the analysis. */
export function buildLocalReport(a: LocalAnalysis, now: Date = new Date()): LocalReport {
  return {
    report_kind: "threatlens-local-heuristic-report", mode: a.mode, demo_fixture: false, generated_utc: now.toISOString(),
    rule_set_version: a.ruleSetVersion, input_type: a.inputType, verdict: a.verdict, heuristic_risk_score: a.riskScore, score_semantics: a.scoreSemantics,
    not_a_validated_ml_prediction: true,
    threat_intelligence: { state: a.threatIntel.state, detail: a.threatIntel.detail, snapshot: a.threatIntel.snapshot },
    findings: a.findings.map((f) => ({ rule_id: f.ruleId, title: f.title, weight: f.weight, observed: f.observed, explanation: f.explanation })),
    urls: a.urls.map((u) => ({ url_defanged: defang(u.normalized), verdict: u.verdict, score: u.score, threat_intel_state: u.ti.state, rule_ids: u.findings.map((f) => f.ruleId) })),
    ...(a.email ? { email: { subject: a.email.subject, from: a.email.from, reply_to: a.email.replyTo, auth: a.email.auth } } : {}),
    evidence: a.evidence, recommended_actions: a.recommendedActions, limitations: [...a.limitations, ...LIMITATIONS],
    raw_content_included: false,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Self-contained, print-friendly HTML (use the browser's Print > Save as PDF). No scripts, no external resources. */
export function buildLocalReportHtml(r: LocalReport): string {
  const li = (xs: string[]) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ThreatLens local heuristic report</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.4rem}h2{font-size:1.05rem;margin-top:1.6rem;border-bottom:1px solid #ccc}
.banner{border:2px solid #b45309;background:#fffbeb;padding:.6rem .8rem;font-weight:600}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.3rem .5rem;text-align:left;vertical-align:top}code{font-family:ui-monospace,monospace}</style></head><body>
<h1>ThreatLens AI - local heuristic report</h1>
<p class="banner">LOCAL RULE-BASED MODE. Not a validated ML prediction. Not a demo fixture.</p>
<p>Generated ${esc(r.generated_utc)} &middot; rule set <code>${esc(r.rule_set_version)}</code> &middot; input: ${esc(r.input_type)}</p>
<h2>Verdict</h2><p><strong>${esc(r.verdict)}</strong> &middot; heuristic risk score ${r.heuristic_risk_score}/100</p><p>${esc(r.score_semantics)}</p>
<h2>Threat intelligence</h2><p><strong>${esc(r.threat_intelligence.state)}</strong> - ${esc(r.threat_intelligence.detail)}</p>
<h2>Findings</h2>${r.findings.length ? `<table><tr><th>Rule</th><th>Weight</th><th>Observed</th><th>Explanation</th></tr>${r.findings.map((f) => `<tr><td><code>${esc(f.rule_id)}</code><br>${esc(f.title)}</td><td>${f.weight}</td><td>${esc(f.observed)}</td><td>${esc(f.explanation)}</td></tr>`).join("")}</table>` : "<p>No top-level rule fired.</p>"}
<h2>URLs examined</h2>${r.urls.length ? `<table><tr><th>URL (defanged)</th><th>Verdict</th><th>Score</th><th>Intel</th><th>Rules</th></tr>${r.urls.map((u) => `<tr><td><code>${esc(u.url_defanged)}</code></td><td>${esc(u.verdict)}</td><td>${u.score}</td><td>${esc(u.threat_intel_state)}</td><td>${esc(u.rule_ids.join(", ") || "none")}</td></tr>`).join("")}</table>` : "<p>None.</p>"}
<h2>Recommended defensive actions</h2>${li(r.recommended_actions)}
<h2>Limitations</h2>${li(r.limitations)}
</body></html>`;
}
