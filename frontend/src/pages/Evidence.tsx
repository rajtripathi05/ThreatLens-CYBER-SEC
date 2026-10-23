import { ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DecisionBadge, SourceBadge, TIBadge } from "@/components/badges";
import { EvidenceLedger, TI_EXPLAIN } from "@/components/EvidenceLedger";
import { LocalEvidenceList, LocalVerdictBadge } from "@/components/LocalResultPanel";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import type { UrlResult } from "@/lib/types";
import { defang } from "@/lib/utils";

export default function Evidence() {
  const { analysis, localAnalysis, mode } = useApp();
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [analysis?.data.analysis_id]);

  if (!analysis && localAnalysis && mode === "live") {
    return (
      <>
        <PageHeader kicker="03 · Forensic ledger" title="Evidence Explorer" eyebrow={<Badge tone="demo">Local rules · no ML</Badge>}
          description="Evidence behind the latest browser-local analysis. Each entry names its rule and source." />
        <Alert tone="warn" title="Deterministic local analysis" className="mb-4">Rule set <span className="font-mono">{localAnalysis.ruleSetVersion}</span>. The score is a heuristic ({localAnalysis.riskScore}/100), not a model probability, and no live threat intelligence was consulted.</Alert>
        <Card>
          <CardHeader title="Evidence ledger" actions={<LocalVerdictBadge verdict={localAnalysis.verdict} />} />
          <LocalEvidenceList evidence={localAnalysis.evidence} />
        </Card>
      </>
    );
  }
  if (!analysis) {
    return (
      <>
        <PageHeader kicker="03 · Forensic ledger" title="Evidence Explorer" description="Inspect how each signal contributed to a triage outcome." />
        <EmptyState icon={<ScrollText className="h-8 w-8" aria-hidden />} title="No analysis selected"
          action={<Link to="/analyzer" className="text-sm text-accent underline">Go to the Analyzer</Link>}>
          Run an analysis (or load a demo fixture) first. The evidence for the most recent analysis is shown here.
        </EmptyState>
      </>
    );
  }
  const { data, origin } = analysis;
  const u = data.urls[Math.min(idx, data.urls.length - 1)];

  return (
    <>
      <PageHeader kicker="03 · Forensic ledger" title="Evidence Explorer"
        eyebrow={<><SourceBadge kind={origin === "live" ? "live" : "demo"} />{data.model.trained_on_synthetic && <Badge tone="sim">Synthetic demo model</Badge>}</>}
        description="Model prediction, heuristic findings and threat-intelligence state are kept separate so you can see which one drove the outcome." />

      {origin === "demo-fixture" && <Alert tone="warn" title={`Demo fixture: ${analysis.fixtureName}`} className="mb-4">Precomputed output, not a live prediction.</Alert>}
      {!u ? (
        <Alert tone="info" title="No URLs to explain">This analysis found no URLs, so there is no classifier evidence. Email heuristics, if any, are listed on the Analyzer page.</Alert>
      ) : (
        <div className="space-y-5">
          {data.urls.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="url-select" className="label">URL</label>
              <select id="url-select" className="field max-w-full sm:max-w-xl font-mono text-xs" value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
                {data.urls.map((x, i) => <option key={x.url} value={i}>{defang(x.url)}</option>)}
              </select>
            </div>
          )}
          <Card className="card-pad">
            <p className="label">Subject URL (defanged)</p>
            <p className="mt-1 break-all font-mono text-sm">{defang(u.url)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3"><DecisionBadge decision={u.decision} /><span className="text-sm text-muted">{u.decision_label}</span></div>
            <p className="mt-2 text-sm">{u.rationale}</p>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <ModelCard u={u} thresholds={data.model.thresholds} />
            <HeuristicCard u={u} />
            <TICard u={u} />
          </div>

          <div>
            <Card>
              <CardHeader title="How the score was generated" description="Heuristic risk score = model output plus rule-based adjustments. Not a calibrated probability." />
              <ul className="divide-y divide-line">
                {u.contributions.map((c) => (
                  <li key={c.name} className="flex items-start justify-between gap-4 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0"><p className="text-sm">{c.name}</p>{c.note && <p className="text-xs text-muted">{c.note}</p>}</div>
                    <span className="font-mono text-sm tabular-nums">{c.value >= 0 ? "+" : ""}{c.value.toFixed(2)}</span>
                  </li>
                ))}
                <li className="flex justify-between bg-bg/40 px-4 py-2.5 text-sm sm:px-5"><span className="font-medium">Resulting heuristic score</span><span className="font-mono tabular-nums">{u.risk_score.toFixed(2)}</span></li>
              </ul>
              <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">{data.score_semantics}</p>
            </Card>
          </div>

          <EvidenceLedger analysis={data} url={u} origin={origin} />

          <Card>
            <CardHeader title="Suggested defensive actions" />
            <ul className="list-disc space-y-1.5 px-9 py-4 text-sm">{u.suggested_actions.map((s) => <li key={s}>{s}</li>)}</ul>
          </Card>
        </div>
      )}
    </>
  );
}

function ModelCard({ u, thresholds }: { u: UrlResult; thresholds?: Record<string, number> | null }) {
  const hi = thresholds?.t_hi;
  return (
    <Card className="card-pad">
      <p className="label">Model prediction</p>
      <p className="mt-2 font-mono text-3xl font-semibold tabular-nums">{u.ml_probability.toFixed(3)}</p>
      <p className="mt-1 text-xs text-muted">Raw P(phishing) from the URL-string classifier. Uncalibrated.</p>
      {hi != null && <p className="mt-3 text-xs">Flag threshold <span className="font-mono">{hi.toFixed(3)}</span> (validation-tuned) → <strong className={u.ml_probability >= hi ? "text-sev-high" : "text-ink"}>{u.ml_probability >= hi ? "flagged" : "not flagged"}</strong></p>}
    </Card>
  );
}
function HeuristicCard({ u }: { u: UrlResult }) {
  const rules = u.evidence.filter((e) => e.kind === "heuristic");
  return (
    <Card className="card-pad">
      <p className="label">Heuristic findings</p>
      <p className="mt-2 font-mono text-3xl font-semibold tabular-nums">{rules.length}</p>
      <p className="mt-1 text-xs text-muted">Transparent lexical rules shown next to, not inside, the model score.</p>
      {rules.length === 0 && <p className="mt-3 text-xs text-muted">No rule fired. That is weak evidence only.</p>}
    </Card>
  );
}
function TICard({ u }: { u: UrlResult }) {
  return (
    <Card className="card-pad">
      <p className="label">Threat-intelligence state</p>
      <div className="mt-2.5"><TIBadge state={u.ti.state} /></div>
      <p className="mt-3 text-xs text-muted">{TI_EXPLAIN[u.ti.state]}</p>
    </Card>
  );
}
