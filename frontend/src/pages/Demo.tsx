import { ArrowLeft, ArrowRight, Check, FileJson, FileText, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DecisionBadge } from "@/components/badges";
import { EvidenceLedger } from "@/components/EvidenceLedger";
import { LabelStrip, labelsFor, type LabelKind } from "@/components/EvidenceLabel";
import { OfflineNotice } from "@/components/ModeBanner";
import { ScenarioExplorer } from "@/components/research/ScenarioExplorer";
import { ShortcutPanel } from "@/components/research/ShortcutPanel";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Metric, Spinner } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { useExperimentIndex, useExperimentSet } from "@/hooks/useExperiments";
import { api, describeError } from "@/lib/api";
import { loadDemo } from "@/lib/demo";
import { compare, PRESETS, presetRows, saturation, shortcutFinding } from "@/lib/findings";
import { LIMITATIONS } from "@/lib/limitations";
import { buildReportPreview } from "@/lib/report";
import { val } from "@/lib/research";
import type { AnalysisResponse, ExperimentSet } from "@/lib/types";
import { describeUrl } from "@/lib/urlFeatures";
import { cn, defang, downloadBlob, fmtDate, num, pct } from "@/lib/utils";

/** The prepared example is a reserved .example name from data/demo_urls.csv. The URL is only parsed and scored, never fetched. */
export const PREPARED_URL = "http://secure-paypal-login.example/verify/a1b2c3";
const PREPARED_FIXTURE = "Fresh TI match + suspicious URL";

interface StepDef { id: string; title: string; short: string; why: string; notice: string[]; limit: string; labels: (demo: boolean) => LabelKind[] }
const STEPS: StepDef[] = [
  { id: "analyze", title: "Analyze a URL", short: "Analyze",
    why: "ThreatLens scores a prepared, safe example URL. Nothing is fetched or opened: the system reads the text of the URL only.",
    notice: ["The classifier's score and the policy's decision are different things.", "The facts on the left are computed from the URL string; the model reads character n-grams."],
    limit: "The classifier operates on URL strings. It has not been validated as an email-body classifier.", labels: (d) => (d ? ["fixture"] : []) },
  { id: "evidence", title: "Inspect the evidence", short: "Evidence",
    why: "Each signal is kept in its own layer, from the raw model score through the rules to the final recommendation, so you can see which one drove the outcome.",
    notice: ["MATCH, NO_MATCH and UNKNOWN mean three different things.", "Rows marked “not examined” list what the system did not look at."],
    limit: "NO_MATCH means the feed holds no indicator. It does not mean the URL is safe.", labels: (d) => (d ? ["fixture"] : []) },
  { id: "shortcut", title: "Reveal the shortcut-learning issue", short: "Shortcut",
    why: "A very high score on raw URLs can hide a dataset habit. Removing only the scheme and “www.” shows how much of the score depended on it.",
    notice: ["Same model, same data, only the URL text changed.", "The size of the drop is read from the saved run, not typed in."],
    limit: "The drop suggests representation sensitivity. It does not prove leakage or real-world failure.", labels: (d) => (d ? ["real", "fixture"] : ["real"]) },
  { id: "degrade", title: "Simulate threat-intelligence degradation", short: "Degradation",
    why: "The experiment corrupts a simulated feed on purpose: baseline, half the indicators missing, 10% false matches, a shuffled control and an oracle best case.",
    notice: ["Every row is labelled as a synthetic simulation or an oracle upper bound.", "The shuffled feed is a control: matches there carry no information."],
    limit: "These test a decision policy under control. They do not establish how any real threat-intelligence provider performs.", labels: (d) => (d ? ["synthetic", "oracle", "fixture"] : ["synthetic", "oracle"]) },
  { id: "compare", title: "Compare the methods", short: "Compare",
    why: "ML-only (A), naive fusion (B) and reliability-aware triage (C) are compared on F1, false-positive rate and review rate together.",
    notice: ["Choose a scenario above the chart; the numbers change because you are selecting different saved observations.", "Look at the review rate: that is the price of a careful policy."],
    limit: "Better here means better in a simulation. Check the labels before generalising.", labels: (d) => (d ? ["synthetic", "fixture"] : ["synthetic"]) },
  { id: "report", title: "Generate an incident report", short: "Report",
    why: "The analysis from step 1 becomes a report with the verdict, evidence, model details, threat-intelligence status, response and limitations.",
    notice: ["This preview is not saved anywhere. Saving is a separate, explicit action.", "No raw message content is included."],
    limit: "Hosted storage may be ephemeral. A saved case is only as durable as the server's disk.", labels: (d) => (d ? ["fixture"] : []) },
  { id: "summary", title: "Summary of the findings", short: "Summary",
    why: "What the controlled experiments say, with the numbers read from the saved results.",
    notice: [], limit: "This is a research demonstration, not a production detector.", labels: () => [] },
];

export default function Demo() {
  const { mode, setMode, apiState, apiError, refresh } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const step = Math.min(Math.max((Number(params.get("step")) || 1) - 1, 0), STEPS.length - 1);
  const goto = useCallback((i: number) => setParams({ step: String(Math.min(Math.max(i, 0), STEPS.length - 1) + 1) }, { replace: true }), [setParams]);
  const [runKey, setRunKey] = useState(0);
  const stepRef = useRef(step);
  stepRef.current = step;

  const ready = mode === "demo" || apiState === "online";
  const demo = mode === "demo";
  const an = useTourAnalysis(ready, mode, runKey);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Only navigate when focus is not in a form control, so arrows still work inside selects, inputs and radio groups.
      if (t && (t.closest("input, textarea, select, [role=radiogroup], [role=tablist]") || t.isContentEditable)) return;
      if (e.key === "Escape") nav("/");
      else if (e.key === "ArrowRight" && !e.altKey && !e.metaKey) goto(stepRef.current + 1);
      else if (e.key === "ArrowLeft" && !e.altKey && !e.metaKey) goto(stepRef.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, goto]);

  const restart = () => { setRunKey((k) => k + 1); goto(0); window.scrollTo(0, 0); };
  const def = STEPS[step];
  const first = step === 0, last = step === STEPS.length - 1;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Guided research demo · about three minutes</p>
          <h1 key={def.id} className="fade-in mt-2 text-2xl font-semibold sm:text-[1.9rem]"><span className="mr-2 font-mono text-base font-medium text-faint">Step {step + 1} of {STEPS.length}:</span>{" "}{def.title}</h1>
          <p className="mt-1 hidden text-2xs text-faint sm:block">Keyboard: <kbd className="rounded border border-line px-1 font-mono">←</kbd> <kbd className="rounded border border-line px-1 font-mono">→</kbd> to move between steps, <kbd className="rounded border border-line px-1 font-mono">Esc</kbd> to exit.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => nav("/")}><X className="h-3.5 w-3.5" aria-hidden />Exit demo</Button>
      </header>

      <div className="mb-5" role="progressbar" aria-label="Demo progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-valuetext={`Step ${step + 1} of ${STEPS.length}: ${def.title}`}>
        <div className="h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        <ol className="mt-3 hidden gap-1.5 md:flex" aria-label="Demo steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className="min-w-0 flex-1">
              <button onClick={() => goto(i)} aria-current={i === step ? "step" : undefined}
                className={cn("flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-all duration-200", i === step ? "border-accent/60 bg-raised text-ink shadow-glow" : i < step ? "border-accent/20 bg-surface/60 text-ink/80 hover:border-accent/40" : "border-line bg-surface/40 text-muted hover:border-faint hover:text-ink")}>
                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-2xs font-semibold", i < step ? "bg-accent text-accent-ink" : i === step ? "border border-accent text-accent" : "bg-line")}>{i < step ? <Check className="h-3 w-3" aria-label="done" /> : i + 1}</span>
                <span className="truncate">{s.short}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {demo && (
        <Alert tone="warn" title="Running on bundled demo fixtures" className="mb-4">
          The backend is not being used. The analysis comes from a synthetic demo model on a reserved <span className="font-mono">.example</span> name; result files are copies of saved runs. Everything is labelled.
        </Alert>
      )}
      {!ready && (
        <div className="mb-4"><OfflineNotice error={apiError} onRetry={() => void refresh()} what="The demo scores a URL and reads saved results through the API." />
          {apiState === "checking" && <Spinner label="Connecting to the API" />}</div>
      )}

      {ready && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div key={`${def.id}-${runKey}`} className="fade-in min-w-0 space-y-5" data-testid={`step-${def.id}`}>
            {def.id === "analyze" && <StepAnalyze an={an} demo={demo} />}
            {def.id === "evidence" && <StepEvidence an={an} demo={demo} />}
            {def.id === "shortcut" && <StepShortcut demo={demo} />}
            {def.id === "degrade" && <StepDegrade demo={demo} />}
            {def.id === "compare" && <ScenarioExplorer initialPreset="noise10" showLegend={false} />}
            {def.id === "report" && <StepReport an={an} demo={demo} />}
            {def.id === "summary" && <StepSummary />}
          </div>
          <aside aria-label="About this step" className="space-y-3 xl:sticky xl:top-20 xl:self-start">
            <Card key={def.id} className="fade-in overflow-hidden">
              <div className="border-b border-line bg-accent/[0.05] px-4 py-3">
                <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-accent">Why it matters</p>
                <p className="mt-1.5 text-sm leading-relaxed">{def.why}</p>
                {def.labels(demo).length > 0 && <div className="mt-3"><LabelStrip kinds={def.labels(demo)} /></div>}
              </div>
              {def.notice.length > 0 && (
                <div className="border-b border-line px-4 py-3">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted">What to notice</p>
                  <ol className="mt-2 space-y-2 text-xs text-ink/85">{def.notice.map((n, i) => (
                    <li key={n} className="flex gap-2"><span className="mt-px font-mono text-2xs text-accent">{String(i + 1).padStart(2, "0")}</span><span>{n}</span></li>))}</ol>
                </div>)}
              <div className="bg-sev-medium/[0.05] px-4 py-3">
                <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-sev-medium">Limitation</p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink/80">{def.limit}</p>
              </div>
            </Card>
          </aside>
        </div>
      )}

      <nav aria-label="Demo controls" className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-bg/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button variant="secondary" onClick={() => goto(step - 1)} disabled={first}><ArrowLeft className="h-4 w-4" aria-hidden />Previous</Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={restart}><RotateCcw className="h-4 w-4" aria-hidden />Restart</Button>
          {!last ? <Button variant="primary" onClick={() => goto(step + 1)}>Next<ArrowRight className="h-4 w-4" aria-hidden /></Button>
            : <Button variant="primary" onClick={() => nav("/research")}>Open Research Lab<ArrowRight className="h-4 w-4" aria-hidden /></Button>}
        </div>
      </nav>
      {!demo && mode === "live" && apiState === "offline" && <p className="mt-2 text-xs text-muted">Prefer to stay offline? <button className="underline" onClick={() => setMode("demo")}>Use demo fixtures</button>.</p>}
    </>
  );
}

// =========================================================================================== data
interface TourAnalysis { data: AnalysisResponse | null; origin: "live" | "demo-fixture"; loading: boolean; error: string | null; retry: () => void }
function useTourAnalysis(ready: boolean, mode: "live" | "demo", runKey: number): TourAnalysis {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    if (!ready) return;
    setLoading(true);
    const p = mode === "demo"
      ? loadDemo().then((d) => { const f = d.analyses.find((a) => a.name === PREPARED_FIXTURE) ?? d.analyses[0]; if (!f) throw new Error("The demo bundle has no prepared analysis."); return f.analysis; })
      : api.analyzeUrl(PREPARED_URL, true);
    p.then((a) => alive && setData(a)).catch((e) => alive && setError(describeError(e))).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [ready, mode, runKey, tick]);
  return { data, origin: mode === "demo" ? "demo-fixture" : "live", loading, error, retry: () => setTick((t) => t + 1) };
}

function AnalysisGate({ an, children }: { an: TourAnalysis; children: (a: AnalysisResponse) => ReactNode }) {
  if (an.loading) return <Spinner label="Scoring the prepared URL" />;
  if (an.error) return <Alert tone="error" title="The prepared URL could not be analysed" action={<Button size="sm" onClick={an.retry}>Retry</Button>}>{an.error} Nothing has been substituted.</Alert>;
  if (!an.data) return null;
  return <>{children(an.data)}</>;
}

// =========================================================================================== steps
function StepAnalyze({ an, demo }: { an: TourAnalysis; demo: boolean }) {
  return (
    <AnalysisGate an={an}>{(a) => {
      const u = a.urls[0];
      if (!u) return <Alert tone="info">No URL was extracted.</Alert>;
      const t = a.model.thresholds;
      return (
        <>
          <Card className="card-pad">
            <p className="label">Prepared example (defanged here; never fetched)</p>
            <p className="mt-1 break-all font-mono text-sm">{defang(u.url)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3"><DecisionBadge decision={u.decision} /><span className="text-sm text-muted">{u.decision_label}</span>
              {demo ? null : <Badge tone="accent">Live API</Badge>}</div>
          </Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Classifier P(phishing)" value={u.ml_probability.toFixed(3)} sub={t?.t_hi != null ? `uncalibrated · flag at ≥ ${t.t_hi.toFixed(3)}` : "uncalibrated"} tone="accent" />
            <Metric label="Policy decision" value={u.decision} sub="after the reliability rules" />
            <Metric label="Heuristic score" value={u.risk_score.toFixed(2)} sub="a ranking value, not a probability" />
          </div>
          <Card>
            <CardHeader title="Facts read from the URL string" description="Computed in your browser. These are not the model's inputs; they show what a lexical rule can see." />
            <dl className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
              {describeUrl(u.url).map((f) => <div key={f.name} className="min-w-0"><dt className="label">{f.name}</dt><dd className="break-words font-mono text-xs">{f.name === "Host" ? defang(f.value) : f.value}</dd><dd className="text-2xs text-faint">{f.note}</dd></div>)}
            </dl>
          </Card>
          <Alert tone="info" title="Scope">{a.scope_note}</Alert>
        </>
      );
    }}</AnalysisGate>
  );
}

function StepEvidence({ an, demo }: { an: TourAnalysis; demo: boolean }) {
  return (
    <AnalysisGate an={an}>{(a) => {
      const u = a.urls[0];
      if (!u) return <Alert tone="info">No URL to explain.</Alert>;
      return (
        <>
          {demo && <Alert tone="warn" title={`Demo fixture: ${PREPARED_FIXTURE}`}>Precomputed output of the synthetic demo model. Not a live prediction.</Alert>}
          <EvidenceLedger analysis={a} url={u} origin={an.origin} />
          <div className="flex flex-wrap gap-2"><Link to="/evidence" className="text-sm text-accent underline">Open this in the full Evidence Explorer</Link></div>
        </>
      );
    }}</AnalysisGate>
  );
}

function useClassifier(): { set: ExperimentSet | null; loading: boolean; error: string | null; missing: boolean } {
  const idx = useExperimentIndex();
  const avail = idx.data?.find((s) => s.id === "real-classifier")?.available ?? false;
  const set = useExperimentSet(avail ? "real-classifier" : null);
  return { set: set.data, loading: idx.loading || set.loading, error: idx.error ?? set.error, missing: !!idx.data && !avail };
}

function StepShortcut({ demo }: { demo: boolean }) {
  const c = useClassifier();
  if (c.loading) return <Spinner label="Loading the classifier run" />;
  if (c.error) return <Alert tone="error">{c.error}</Alert>;
  if (c.missing || !c.set) return <EmptyState title="Classifier results not generated here">Run <span className="font-mono">python experiments/run_real_data.py</span> to create them. No numbers are shown instead.</EmptyState>;
  return <ShortcutPanel set={c.set} demo={demo} />;
}

function StepDegrade({ demo }: { demo: boolean }) {
  const idx = useExperimentIndex();
  const need = new Set(PRESETS.map((p) => p.setId));
  const ids = [...need];
  const a = useExperimentSet(idx.data?.find((s) => s.id === ids[0])?.available ? ids[0] : null);
  const b = useExperimentSet(idx.data?.find((s) => s.id === ids[1])?.available ? ids[1] : null);
  const sets: Record<string, ExperimentSet | null> = { [ids[0]]: a.data, [ids[1]]: b.data };
  if (idx.loading || a.loading || b.loading) return <Spinner label="Loading simulation results" />;
  const err = idx.error ?? a.error ?? b.error;
  if (err) return <Alert tone="error">{err}</Alert>;
  const ref = a.data ?? b.data;
  return (
    <Card>
      <CardHeader title="Five controlled conditions, three methods" description="F1 and false-positive rate (FPR) from the saved runs; review rate is the share sent to a human. Mean over seeds."
        actions={<LabelStrip kinds={demo ? ["synthetic", "oracle", "fixture"] : ["synthetic", "oracle"]} />} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem]">
          <caption className="sr-only">Saved simulation results for each degradation scenario</caption>
          <thead><tr>
            <th className="th" scope="col">Scenario</th><th className="th" scope="col">Label</th>
            <th className="th text-right" scope="col">A · F1</th><th className="th text-right" scope="col">B · F1</th><th className="th text-right" scope="col">C · F1</th>
            <th className="th text-right" scope="col">B · FPR</th><th className="th text-right" scope="col">C · FPR</th><th className="th text-right" scope="col">C · review</th>
          </tr></thead>
          <tbody>
            {PRESETS.map((p) => {
              const s = sets[p.setId]; const rows = presetRows(s, p, "all");
              const get = (m: string, k: string) => val(rows.find((r) => r.method === m), k);
              const sat = saturation(s, p);
              return (
                <tr key={p.id}>
                  <th scope="row" className="td text-left font-medium">{p.label}{sat && <span className="mt-0.5 block text-2xs font-normal text-sev-medium">saturated: all legitimate URLs falsely matched</span>}</th>
                  <td className="td"><LabelStrip kinds={labelsFor(s?.metadata, false)} /></td>
                  {s && rows.length ? (<>
                    <Cell v={get("ml_only", "f1")} /><Cell v={get("naive_fusion", "f1")} /><Cell v={get("reliability_aware", "f1")} />
                    <Cell v={get("naive_fusion", "fpr")} /><Cell v={get("reliability_aware", "fpr")} /><Cell v={get("reliability_aware", "review_rate")} />
                  </>) : <td className="td text-xs text-muted" colSpan={6}>{s ? "no saved rows" : "result set not generated"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
        <p>A = ML only · B = naive fusion · C = reliability-aware triage. Baseline, missing-indicator and shuffled rows use a feed derived from training-split hosts. The noise and oracle rows use a feed built from test labels, so they are best-case starting points. Different feeds mean the rows are not a single controlled sweep.</p>
        {ref && <p className="font-mono text-2xs text-faint">{[a.data, b.data].filter(Boolean).map((s) => `${s!.id}: run ${s!.metadata.run_id} (${fmtDate(s!.metadata.finished_utc)}, ${s!.metadata.seeds?.length ?? "?"} seeds, n=${s!.metadata.split?.test_used?.toLocaleString() ?? "?"})`).join(" · ")}</p>}
      </div>
    </Card>
  );
}
function Cell({ v }: { v: number | null }) { return <td className="td text-right font-mono text-xs tabular-nums">{v == null ? <span className="text-faint">n/a</span> : pct(v, 2)}</td>; }

function StepReport({ an, demo }: { an: TourAnalysis; demo: boolean }) {
  const idx = useExperimentIndex();
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "pdf" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const runs = useMemo(() => Object.fromEntries((idx.data ?? []).filter((s) => s.available && s.run_id).map((s) => [s.id, s.run_id as string])), [idx.data]);
  return (
    <AnalysisGate an={an}>{(a) => {
      const r = buildReportPreview(a, an.origin, runs);
      const u = r.indicators[0];
      return (
        <>
          <Alert tone="warn" title="Report preview, not a saved case">
            {demo ? "Built from a demo fixture. " : ""}This preview has not been written to incident history. The identifier below is temporary.
          </Alert>
          <Card>
            <CardHeader title={`Incident report · ${r.report_id}`} description={`Analysis created ${fmtDate(r.analysis_created_utc)} · generated ${fmtDate(r.generated_utc)} · provenance: ${r.provenance.source}`}
              actions={<><Button size="sm" onClick={() => downloadBlob(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }), `${r.report_id}.json`)}><FileJson className="h-3.5 w-3.5" aria-hidden />Download JSON</Button>
                <Button size="sm" disabled={!saved} loading={busy === "pdf"} title={saved ? undefined : demo ? "PDF is produced by the backend; unavailable in demo mode" : "Save the incident first"}
                  onClick={async () => { setBusy("pdf"); try { downloadBlob(await api.exportIncident(saved!, "pdf"), `${saved}.pdf`); } catch (e) { setErr(describeError(e)); } finally { setBusy(null); } }}>
                  <FileText className="h-3.5 w-3.5" aria-hidden />Download PDF</Button></>} />
            <div className="space-y-4 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center gap-3"><DecisionBadge decision={a.overall_decision} /><span className="text-sm">{r.verdict_label}</span><span className="text-xs text-muted">heuristic score {r.heuristic_score.toFixed(2)} (not a probability)</span></div>
              {u && (
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Row k="Indicator (defanged)" v={u.url_defanged} mono />
                  <Row k="Model" v={`${r.model.kind} · ${r.model.version ?? "unversioned"}${r.model.trained_on_synthetic ? " · trained on synthetic demo data" : ""} · score ${u.model_score.toFixed(3)}`} />
                  <Row k="Threat-intelligence status" v={`${u.ti_state}: ${u.ti_detail}`} />
                  <Row k="Snapshot" v={r.threat_intel_snapshot.is_demo ? "demo snapshot (not real intelligence)" : `${r.threat_intel_snapshot.entries ?? "?"} entries`} />
                  <Row k="Triage reasoning" v={u.rationale} />
                  <Row k="Experiment run IDs" v={Object.entries(runs).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none available"} mono />
                </dl>
              )}
              {u && <div><p className="label">Evidence</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">{u.evidence.filter((e) => e.kind !== "missing").map((e) => <li key={e.source + e.finding}>{e.finding}</li>)}</ul></div>}
              {u && <div><p className="label">Recommended response</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{u.recommended_actions.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              <div><p className="label">Limitations</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted">{r.limitations.slice(0, 5).map((x) => <li key={x}>{x}</li>)}</ul></div>
            </div>
          </Card>
          {!demo && (
            <Card className="card-pad">
              <p className="text-sm font-medium">Optional: save this as a real incident</p>
              <p className="mt-1 text-xs text-muted">This adds one case to your actual incident history on the server (no raw message content; this is a URL analysis). Hosted disks can be ephemeral, so a saved case may not survive a restart. Saving enables the PDF.</p>
              <div className="mt-3 flex items-center gap-3">
                <Button variant="secondary" size="sm" loading={busy === "save"} disabled={!!saved}
                  onClick={async () => { setBusy("save"); setErr(null); try { setSaved((await api.saveIncident(a.analysis_id, false, "Created from the guided demo")).case_id); } catch (e) { setErr(describeError(e)); } finally { setBusy(null); } }}>
                  <Save className="h-3.5 w-3.5" aria-hidden />{saved ? "Saved" : "Save to incident history"}</Button>
                {saved && <Link className="text-sm text-accent underline" to={`/incidents/${saved}`}>View {saved}</Link>}
              </div>
            </Card>
          )}
          {demo && <Alert tone="info">PDF export is produced by the backend, so it is unavailable in demo mode. JSON works offline.</Alert>}
          {err && <Alert tone="error">{err}</Alert>}
        </>
      );
    }}</AnalysisGate>
  );
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="label">{k}</dt><dd className={cn("mt-0.5 break-words text-sm", mono && "font-mono text-xs")}>{v}</dd></div>;
}

function StepSummary() {
  const idx = useExperimentIndex();
  const clfOk = idx.data?.find((s) => s.id === "real-classifier")?.available;
  const clf = useExperimentSet(clfOk ? "real-classifier" : null);
  const proxy = useExperimentSet(idx.data?.find((s) => s.id === "real-ti-proxy")?.available ? "real-ti-proxy" : null);
  const oracle = useExperimentSet(idx.data?.find((s) => s.id === "real-ti-oracle")?.available ? "real-ti-oracle" : null);
  if (idx.loading || clf.loading || proxy.loading || oracle.loading) return <Spinner label="Reading saved results" />;

  const sc = shortcutFinding(clf.data).find((c) => c.protocol === "stratified") ?? shortcutFinding(clf.data)[0];
  const noise = PRESETS.find((p) => p.id === "noise10")!, orc = PRESETS.find((p) => p.id === "oracle")!;
  const setOf = (id: string) => (id === "real-ti-oracle" ? oracle.data : proxy.data);
  const nRows = presetRows(setOf(noise.setId), noise, "all"), oRows = presetRows(setOf(orc.setId), orc, "all");
  const dn = compare(nRows, "naive_fusion", "reliability_aware"), dml = compare(nRows, "ml_only", "reliability_aware");
  const naiveVsMl = compare(nRows, "ml_only", "naive_fusion");
  const review = val(nRows.find((r) => r.method === "reliability_aware"), "review_rate");
  const oracleNaive = compare(oRows, "ml_only", "naive_fusion");

  const findings: { title: string; body: ReactNode; label: LabelKind[] }[] = [
    { title: "A near-perfect raw score is partly a formatting artefact", label: ["real"],
      body: sc ? <>F1 on raw URLs was {num(sc.raw, 3)}; after removing only the scheme and “www.” it was {num(sc.stripped, 3)}, a drop of {sc.points.toFixed(1)} percentage points. This points to representation sensitivity, not proven leakage.</> : "Classifier results are not available in this environment." },
    { title: "Naive fusion can be hurt by noisy intelligence", label: ["synthetic", "oracle"],
      body: naiveVsMl[0]?.diffPoints != null ? <>With 10% unlabelled false matches added to the oracle-derived feed, naive fusion's false-positive rate went from {pct(naiveVsMl[1].a, 2)} (ML only) to {pct(naiveVsMl[1].b, 2)}, and its F1 changed by {naiveVsMl[0].diffPoints.toFixed(1)} points. The noise was injected on purpose.</> : "Simulation results are not available in this environment." },
    { title: "Reliability-aware triage trades review work for fewer false positives", label: ["synthetic", "oracle"],
      body: dn[1]?.diffPoints != null ? <>In the same scenario reliability-aware triage had FPR {pct(dn[1].b, 2)} versus {pct(dn[1].a, 2)} for naive fusion (F1 {dn[0].outcome}, {dn[0].diffPoints! >= 0 ? "+" : ""}{dn[0].diffPoints!.toFixed(1)} points). Against ML only, its F1 {dml[0].outcome} and its FPR {dml[1].outcome}. The price: {pct(review, 1)} of items were sent to manual review.</> : "Simulation results are not available in this environment." },
    { title: "The oracle feed is an upper bound", label: ["oracle"],
      body: oracleNaive[0]?.diffPoints != null ? <>When the simulated feed is built from test labels, naive fusion's F1 changed by {oracleNaive[0].diffPoints.toFixed(2)} points relative to ML-only. That is the best case for fusion and not independent threat-intelligence performance.</> : "Oracle results are not available in this environment." },
  ];

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {([["Real-data finding", "Measured on held-out PhiUSIIL URLs", "border-accent/50", "text-accent", findings.filter((f) => f.label.includes("real"))],
          ["Simulated findings", "Controlled degradation of a synthetic feed; not real-world validation", "border-sim/50", "text-sim", findings.filter((f) => !f.label.includes("real"))]] as const).map(([h, sub, rail, tone, list]) => (
          <section key={h} aria-label={h} className={cn("rounded-xl border-l-2 bg-surface/40 py-1 pl-4", rail)}>
            <p className={cn("font-mono text-[0.6rem] uppercase tracking-[0.16em]", tone)}>{h}</p>
            <p className="mt-0.5 text-2xs text-faint">{sub}</p>
            <ol className="stagger mt-3 space-y-3">
              {list.map((f) => (
                <li key={f.title}><Card className="card-pad">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-faint">{String(findings.indexOf(f) + 1).padStart(2, "0")}</span><LabelStrip kinds={f.label} /></div>
                  <p className="mt-2 font-display text-[0.95rem] font-semibold">{f.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{f.body}</p>
                </Card></li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <Card>
        <CardHeader title="What this does not show" />
        <ul className="list-disc space-y-1.5 px-9 py-4 text-sm text-muted">{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
      </Card>
    </>
  );
}
