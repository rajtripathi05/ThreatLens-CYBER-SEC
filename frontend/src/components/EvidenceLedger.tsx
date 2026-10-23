import { CircleDashed } from "lucide-react";
import { DecisionBadge, TIBadge } from "@/components/badges";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import type { AnalysisResponse, EvidenceItem, Origin, TIState, UrlResult } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";

export const TI_EXPLAIN: Record<TIState, string> = {
  MATCH_FRESH: "MATCH: a known indicator was found, with a source and a recent timestamp.",
  MATCH_STALE: "MATCH (weak): a known indicator exists but it is old, expired or lacks provenance, so it carries little weight.",
  SYNTHETIC_MATCH: "MATCH (synthetic): an entry injected by an experiment scenario. Ignored by the policy.",
  NO_MATCH: "NO_MATCH: the loaded snapshot has no exact match. Feeds are incomplete, so this does NOT mean the URL is safe.",
  UNKNOWN: "UNKNOWN: intelligence was unavailable or not consulted. This does NOT mean the URL is safe.",
};

const GROUP_OF: Record<TIState, "MATCH" | "NO_MATCH" | "UNKNOWN"> = {
  MATCH_FRESH: "MATCH", MATCH_STALE: "MATCH", SYNTHETIC_MATCH: "MATCH", NO_MATCH: "NO_MATCH", UNKNOWN: "UNKNOWN",
};

/** The three threat-intelligence outcomes side by side; the current one is highlighted. */
export function TIStatusLegend({ state }: { state?: TIState }) {
  const cur = state ? GROUP_OF[state] : null;
  const items: { id: "MATCH" | "NO_MATCH" | "UNKNOWN"; means: string; not: string }[] = [
    { id: "MATCH", means: "An indicator was found in the feed. Weight depends on its freshness and provenance.", not: "Not proof of phishing if the match is stale or unsourced." },
    { id: "NO_MATCH", means: "The feed was consulted and holds no matching indicator.", not: "Not proof of safety: feeds are incomplete." },
    { id: "UNKNOWN", means: "The feed was not consulted or could not answer.", not: "Not proof of safety, and not even a negative lookup." },
  ];
  return (
    <ul className="grid gap-3 md:grid-cols-3" aria-label="Threat-intelligence outcomes">
      {items.map((i) => (
        <li key={i.id} className={cn("rounded-md border p-3", cur === i.id ? "border-accent/60 bg-raised" : "border-line bg-bg/40")} aria-current={cur === i.id ? "true" : undefined}>
          <p className="flex items-center gap-2 font-mono text-sm font-semibold">{i.id}{cur === i.id && <Badge tone="accent">this URL</Badge>}</p>
          <p className="mt-1.5 text-xs text-ink/90">{i.means}</p>
          <p className="mt-1 text-xs text-muted">{i.not}</p>
        </li>
      ))}
    </ul>
  );
}

interface Row {
  layer: string; finding: string; category: string; source: string; basis: string; observed: string; status: string;
  contribution: string; explanation: string; used: boolean | null;
}

function build(a: AnalysisResponse, u: UrlResult, origin: Origin): Row[] {
  const m = u.evidence.find((e) => e.kind === "model");
  const t = a.model.thresholds ?? {};
  const modelBasis = a.model.trained_on_synthetic ? "model · synthetic demo training data" : "model · PhiUSIIL training data";
  const tiContrib = u.contributions.find((c) => /TI|match/i.test(c.name));
  const rows: Row[] = [];
  rows.push({
    layer: "1 · ML classifier", category: "Model", source: m?.source ?? "url_model", basis: modelBasis,
    finding: `Uncalibrated score P(phishing) = ${u.ml_probability.toFixed(3)}`,
    observed: fmtDate(a.created_utc), status: t.t_hi != null ? (u.ml_probability >= t.t_hi ? `flagged (≥ ${t.t_hi.toFixed(3)})` : t.t_low != null && u.ml_probability < t.t_low ? `clear (< ${t.t_low.toFixed(3)})` : `uncertain band`) : "n/a",
    contribution: `${u.contributions[0]?.value.toFixed(3) ?? "n/a"} (raw score)`, used: m?.influenced_decision ?? true,
    explanation: m?.interpretation ?? "Character n-gram logistic regression over the URL string.",
  });
  const rules = u.evidence.filter((e) => e.kind === "heuristic");
  if (rules.length === 0) rows.push({ layer: "2 · URL heuristics", category: "Rule", source: "lexical_rule", basis: "fixed rule", finding: "No lexical rule fired.", observed: fmtDate(a.created_utc), status: "none fired", contribution: "none", used: false, explanation: "Absence of a rule hit is weak evidence only." });
  for (const r of rules) rows.push({ layer: "2 · URL heuristics", category: "Rule", source: r.source, basis: "fixed rule, not a model", finding: r.finding, observed: fmtDate(a.created_utc), status: "fired",
    contribution: r.influenced_decision ? "used in decision" : "shown only; not added to the score", used: r.influenced_decision, explanation: r.interpretation });
  rows.push({
    layer: "3 · Threat intelligence", category: "Feed lookup", source: u.ti.source || a.ti_source.name || "snapshot",
    basis: a.ti_source.is_demo ? "demo snapshot (reserved .example names, not real intelligence)" : "feed snapshot",
    finding: `${GROUP_OF[u.ti.state]}${u.ti.state !== GROUP_OF[u.ti.state] ? ` (${u.ti.state})` : ""}${u.ti.detail ? `: ${u.ti.detail}` : ""}`,
    observed: u.ti.observed_at ? fmtDate(u.ti.observed_at) : "not recorded", status: u.ti.state,
    contribution: tiContrib ? `${tiContrib.value >= 0 ? "+" : ""}${tiContrib.value.toFixed(2)}` : "none", used: Math.abs(tiContrib?.value ?? 0) > 0, explanation: TI_EXPLAIN[u.ti.state],
  });
  rows.push({
    layer: "4 · Reliability policy", category: "Decision rule", source: "reliability_triage()", basis: "explicit rule per TI state (no learned weights)",
    finding: u.rationale, observed: fmtDate(a.created_utc), status: "applied",
    contribution: u.contributions.map((c) => `${c.name} ${c.value >= 0 ? "+" : ""}${c.value.toFixed(2)}`).join("; "), used: true,
    explanation: "A match is only trusted when fresh and not contradicted by a clearly low model score. NO_MATCH and UNKNOWN add nothing.",
  });
  rows.push({
    layer: "5 · Final triage", category: "Recommendation", source: "ThreatLens", basis: origin === "demo-fixture" ? "demo fixture" : "live API",
    finding: u.decision_label, observed: fmtDate(a.created_utc), status: u.decision, contribution: `heuristic score ${u.risk_score.toFixed(2)} (not a probability)`, used: true,
    explanation: u.suggested_actions[0] ?? "Apply normal caution.",
  });
  return rows;
}

export function EvidenceLedger({ analysis, url, origin }: { analysis: AnalysisResponse; url: UrlResult; origin: Origin }) {
  const rows = build(analysis, url, origin);
  const missing = url.evidence.filter((e) => e.kind === "missing");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Threat-intelligence outcome" description="Three different answers that are easy to confuse." />
        <div className="card-pad"><TIStatusLegend state={url.ti.state} /></div>
      </Card>
      <Card>
        <CardHeader title="Evidence ledger" description="Ordered from raw signal to final recommendation. Each layer states what it is based on." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem]">
            <caption className="sr-only">Evidence ledger for the selected URL, from classifier to final triage</caption>
            <thead><tr>{["Layer", "Finding", "Source and basis", "Observed", "Status", "Contribution", "Explanation"].map((h) => <th key={h} className="th" scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="align-top">
                  <th scope="row" className="td whitespace-nowrap text-left text-xs font-medium"><span className="block">{r.layer}</span><Badge className="mt-1" tone="neutral">{r.category}</Badge></th>
                  <td className="td max-w-[16rem] text-sm">{r.finding}</td>
                  <td className="td max-w-[13rem] text-xs"><span className="break-all font-mono text-2xs text-faint">{r.source}</span><span className="mt-0.5 block text-muted">{r.basis}</span></td>
                  <td className="td whitespace-nowrap text-xs text-muted">{r.observed}</td>
                  <td className="td text-xs">{r.layer.startsWith("3") ? <TIBadge state={url.ti.state} /> : r.layer.startsWith("5") ? <DecisionBadge decision={url.decision} /> : r.status}</td>
                  <td className="td max-w-[12rem] text-xs text-muted">{r.contribution}{r.used === false && <CircleDashed className="ml-1 inline h-3 w-3 text-faint" aria-label="did not influence the decision" />}</td>
                  <td className="td max-w-[18rem] text-xs text-muted">{r.explanation}</td>
                </tr>
              ))}
              {missing.map((e: EvidenceItem) => (
                <tr key={e.id} className="bg-bg/30 align-top">
                  <th scope="row" className="td whitespace-nowrap text-left text-xs font-medium"><Badge tone="dashed">Not examined</Badge></th>
                  <td className="td text-sm" colSpan={5}>{e.finding}</td>
                  <td className="td text-xs text-muted">{e.interpretation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">{analysis.score_semantics}</p>
      </Card>
      <WhyDecision analysis={analysis} url={url} />
    </div>
  );
}

export function TermsCard({ u }: { u: UrlResult }) {
  const max = Math.max(0.0001, ...u.ml_top_terms.map((t) => Math.abs(t.contribution)));
  return (
    <Card>
      <CardHeader title="Model feature contributions" description="Character n-grams that moved this URL's score: logistic-regression coefficient × TF-IDF weight. Describes the model's arithmetic, not cause." />
      {u.ml_top_terms.length === 0 ? <p className="card-pad text-sm text-muted">No known n-grams for this input.</p> : (
        <ul className="space-y-2 px-4 py-3 sm:px-5">
          {u.ml_top_terms.map((t) => {
            const up = t.contribution > 0;
            return (
              <li key={t.ngram} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-3 text-xs">
                <code className="truncate rounded bg-bg px-1.5 py-0.5 font-mono" title={t.ngram}>“{t.ngram}”</code>
                <div className="h-2 rounded-full bg-line" role="img" aria-label={`${t.direction}, contribution ${t.contribution}`}>
                  <div className={cn("h-full rounded-full", up ? "bg-sev-high" : "bg-sev-low")} style={{ width: `${(Math.abs(t.contribution) / max) * 100}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums text-muted">{t.contribution > 0 ? "+" : ""}{t.contribution.toFixed(2)}</span>
              </li>
            );
          })}
          <li className="flex gap-4 pt-1 text-2xs text-muted"><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sev-high" aria-hidden />toward phishing</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sev-low" aria-hidden />toward legitimate</span></li>
        </ul>
      )}
    </Card>
  );
}

/** Expandable step-by-step account. Every sentence is built from the analysis fields, not from assumptions. */
export function WhyDecision({ analysis, url }: { analysis: AnalysisResponse; url: UrlResult }) {
  const t = analysis.model.thresholds ?? {};
  const band = t.t_hi == null ? null : url.ml_probability >= t.t_hi ? "at or above the flag threshold" : t.t_low != null && url.ml_probability < t.t_low ? "below the clear threshold" : "inside the uncertain band";
  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold sm:px-5">Why did ThreatLens reach this decision?</summary>
      <div className="space-y-4 border-t border-line px-4 py-4 sm:px-5">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li><strong>Model.</strong> The URL classifier gave {url.ml_probability.toFixed(3)}{band ? `, which is ${band}${t.t_hi != null ? ` (flag at ${t.t_hi.toFixed(3)}${t.t_low != null ? `, clear below ${t.t_low.toFixed(3)}` : ""})` : ""}` : ""}. This is a raw, uncalibrated score.</li>
          <li><strong>Threat intelligence.</strong> {TI_EXPLAIN[url.ti.state]}</li>
          <li><strong>Policy.</strong> {url.rationale}</li>
          <li><strong>Outcome.</strong> {url.decision_label}. {analysis.model.trained_on_synthetic ? "The model behind this score was trained on synthetic demo data, so treat it as an illustration of the mechanism, not a measured detector." : ""}</li>
        </ol>
        <TermsCard u={url} />
        <p className="text-xs text-muted">The n-gram view is specific to this linear model (coefficient × TF-IDF). No SHAP values are computed. Heuristic rules are listed separately and are not part of the model explanation.</p>
      </div>
    </details>
  );
}
