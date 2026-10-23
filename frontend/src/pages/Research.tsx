import { FlaskConical, TestTube2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, Bar, BarChart, ErrorBar } from "recharts";
import { SourceBadge } from "@/components/badges";
import { ScenarioExplorer } from "@/components/research/ScenarioExplorer";
import { LabelLegend } from "@/components/EvidenceLabel";
import { ClassifierView } from "@/components/research/ClassifierView";
import { ChartCard, Provenance } from "@/components/research/shared";
import { OfflineNotice } from "@/components/ModeBanner";
import { Alert, Badge, Card, CardHeader, EmptyState, Field, PageHeader, Segmented, Spinner } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { useExperimentIndex, useExperimentSet } from "@/hooks/useExperiments";
import { FAMILIES, METHODS, METRICS, methodMeta, uniq, val, type Row } from "@/lib/research";
import type { ExperimentSet, ExperimentSetInfo } from "@/lib/types";
import { cn, pct } from "@/lib/utils";

export default function Research() {
  const { mode, apiState, apiError, refresh } = useApp();
  const idx = useExperimentIndex();
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (!idx.data) return;
    if (!sel || !idx.data.find((s) => s.id === sel && s.available)) setSel(idx.data.find((s) => s.available)?.id ?? idx.data[0]?.id ?? null);
  }, [idx.data, sel]);

  const set = useExperimentSet(sel && idx.data?.find((s) => s.id === sel)?.available ? sel : null);
  const info = idx.data?.find((s) => s.id === sel);

  return (
    <>
      <PageHeader kicker="04 · Controlled experiments" title="Research Evaluation Lab" eyebrow={<SourceBadge kind={mode === "live" ? "live" : "demo"} />}
        description="Saved results from the experiment pipeline. Three kinds of evidence are kept apart: empirical classifier results on real data, and controlled simulations of degraded threat intelligence." />

      <div className="mb-5 grid gap-3 md:grid-cols-2">
        <Alert tone="success" title="Empirical (real data)"><span>Measured on held-out URLs from the UCI PhiUSIIL dataset. Valid only for URL-string classification on that dataset.</span></Alert>
        <Alert tone="sim" title="Simulation"><span>Threat-intel degradation is <em>synthetic corruption</em> of a feed, to test decision policies under control. It is not evidence about any real provider.</span></Alert>
      </div>

      {idx.data && (
        <details className="mb-5 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">What do the evidence labels mean?</summary>
          <div className="mt-3"><LabelLegend /></div>
        </details>
      )}

      {mode === "live" && apiState === "offline" && <OfflineNotice error={apiError} onRetry={() => void refresh()} what="Result files are served by the Python API. Copies of the saved experiment results ship with the site and can be browsed, with their provenance labels, in demo mode. The local rule engine did not produce any of these results and is not a research baseline." />}
      {idx.loading && <Spinner label="Loading result index" />}
      {idx.error && apiState === "online" && <Alert tone="error">{idx.error}</Alert>}

      {idx.data && <div className="mb-8"><ScenarioExplorer showLegend={false} /></div>}

      {idx.data && (
        <>
          <h2 className="mb-3 text-base font-semibold">All saved result sets</h2>
          <div role="tablist" aria-label="Result sets" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {idx.data.map((s) => <SetTab key={s.id} s={s} active={s.id === sel} onClick={() => setSel(s.id)} />)}
          </div>
          {info && !info.available && (
            <EmptyState icon={<FlaskConical className="h-8 w-8" aria-hidden />} title="Not generated in this environment">
              No saved results exist for “{info.title}”. Nothing is shown rather than inventing numbers.
              {info.hint && <p className="mt-2 font-mono text-xs text-faint">{info.hint}</p>}
            </EmptyState>
          )}
          {set.loading && <Spinner label="Loading results" />}
          {set.error && <Alert tone="error">{set.error}</Alert>}
          {set.data && (set.data.kind === "classifier" ? <ClassifierView set={set.data} /> : <SimulationView set={set.data} />)}
        </>
      )}
    </>
  );
}

function SetTab({ s, active, onClick }: { s: ExperimentSetInfo; active: boolean; onClick: () => void }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} disabled={false}
      className={cn("rounded-lg border px-3.5 py-3 text-left transition-colors", active ? "border-accent/60 bg-raised" : "border-line bg-surface hover:border-faint", !s.available && "opacity-60")}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {s.kind === "classifier" ? <Badge tone="accent"><TestTube2 className="h-3 w-3" aria-hidden />Empirical</Badge> : <Badge tone="sim"><FlaskConical className="h-3 w-3" aria-hidden />Simulation</Badge>}
        {s.is_synthetic === true && <Badge tone="demo">Synthetic URLs</Badge>}
        {s.is_synthetic === false && <Badge>PhiUSIIL URLs</Badge>}
        {!s.available && <Badge tone="dashed">Missing</Badge>}
      </div>
      <p className="text-sm font-medium leading-snug">{s.title}</p>
      <p className="mt-1 truncate font-mono text-2xs text-faint">{s.run_id ?? "no run"}</p>
    </button>
  );
}

// =========================================================================================
function SimulationView({ set }: { set: ExperimentSet }) {
  const rows = set.summary as Row[];
  const m = set.metadata;
  const [family, setFamily] = useState("coverage_noise");
  const [coverage, setCoverage] = useState(0.5);
  const [noise, setNoise] = useState(0.1);
  const [visibility, setVisibility] = useState<"unlabelled" | "labelled">("unlabelled");
  const [frac, setFrac] = useState<number | null>(null);
  const [metric, setMetric] = useState("f1");
  const [methods, setMethods] = useState<string[]>(["ml_only", "naive_fusion", "reliability_aware"]);

  const fam = useMemo(() => rows.filter((r) => r.group === family), [rows, family]);
  const covs = useMemo(() => uniq(rows.filter((r) => r.group === "coverage_noise"), "coverage"), [rows]);
  const noises = useMemo(() => uniq(rows.filter((r) => r.group === "coverage_noise"), "noise"), [rows]);
  const fracKey = family === "stale" ? "stale" : "outage";
  const fracs = useMemo(() => uniq(fam, fracKey), [fam, fracKey]);
  const ctlNoises = useMemo(() => uniq(rows.filter((r) => r.group === "control_shuffled"), "noise"), [rows]);

  useEffect(() => {
    if (!covs.includes(coverage)) setCoverage(covs.includes(0.5) ? 0.5 : covs[0]);
    if (!noises.includes(noise)) setNoise(noises.includes(0.1) ? 0.1 : noises[0]);
  }, [covs, noises]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFrac(fracs[fracs.length - 1] ?? null); }, [family, fracs.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // rows describing "the selected scenario"
  const scenario = useMemo(() => {
    if (family === "coverage_noise") {
      const vis = noise === 0 ? "unlabelled" : visibility;
      return fam.filter((r) => r.coverage === coverage && r.noise === noise && r.visibility === vis);
    }
    if (family === "control_shuffled") return fam.filter((r) => r.noise === (frac ?? ctlNoises[ctlNoises.length - 1]));
    return fam.filter((r) => r[fracKey] === frac);
  }, [fam, family, coverage, noise, visibility, frac, fracKey, ctlNoises]);

  const scLabel = family === "coverage_noise" ? `coverage ${pct(coverage, 0)}, ${pct(noise, 0)} false matches${noise > 0 ? `, noise ${visibility === "labelled" ? "labelled SYNTHETIC" : "unlabelled"}` : ""}`
    : family === "stale" ? `${pct(frac, 0)} indicators stale` : family === "outage" ? `${pct(frac, 0)} lookups unavailable` : `shuffled control, ${pct(frac ?? 0, 0)} false matches`;

  // series for line charts
  const covSeries = useMemo(() => covs.map((c) => {
    const o: Record<string, number | null> = { x: c };
    for (const mm of methods) o[mm] = val(rows.find((r) => r.group === "coverage_noise" && r.coverage === c && r.noise === 0 && r.method === mm), metric);
    return o;
  }), [rows, covs, methods, metric]);
  const noiseSeries = useMemo(() => noises.map((n) => {
    const o: Record<string, number | null> = { x: n };
    for (const mm of methods) {
      o[mm] = val(rows.find((r) => r.group === "coverage_noise" && r.coverage === 1 && r.noise === n && r.method === mm && (n === 0 || r.visibility === "unlabelled")), metric);
    }
    return o;
  }), [rows, noises, methods, metric]);

  const metricMeta = METRICS.find((x) => x.id === metric)!;
  const seeds = m.seeds ?? [];
  const nTest = m.split?.test_used;
  const familyInfo = FAMILIES.find((f) => f.id === family)!;
  const oracle = m.feed_mode === "oracle_test_labels";

  return (
    <div className="space-y-5">
      <Provenance m={m} sim />
      {oracle && (
        <Alert tone="warn" title="Oracle-labelled feed: an upper bound, not a deployable defence">
          The simulated feed is sampled from the held-out phishing <em>test</em> labels. It shows how a policy behaves when the feed is perfect where it has coverage. It is not independent threat intelligence and its benefits must not be read as real-world performance.
        </Alert>
      )}
      {m.feed_mode === "proxy_train_domains" && (
        <Alert tone="info" title="Proxy feed derived from the training split">
          Indicators are hosts of training-split phishing URLs, so they are disjoint from test URLs by construction and match only through shared hosts. Dataset-derived, not independent real-world intelligence.
        </Alert>
      )}
      {m.feed_overlap && (
        <Card><CardHeader title="Feed ↔ test-set overlap (before degradation)" description={`Seed ${(m.feed_overlap as { seed?: number }).seed}; measured, not assumed.`} />
          <div className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-4 sm:px-5">
            <Stat k="Feed entries" v={m.feed_overlap.feed_entries_before_degradation.toLocaleString()} />
            <Stat k="Phishing URLs matched" v={`${m.feed_overlap.test_phishing_with_match.toLocaleString()} / ${m.feed_overlap.test_phishing.toLocaleString()} (${pct(m.feed_overlap.phishing_match_rate)})`} />
            <Stat k="Legitimate URLs matched" v={`${m.feed_overlap.test_legitimate_with_match.toLocaleString()} / ${m.feed_overlap.test_legitimate.toLocaleString()} (${pct(m.feed_overlap.legitimate_match_rate, 2)})`} />
            <Stat k="Test items used" v={nTest?.toLocaleString() ?? "n/a"} />
          </div></Card>
      )}

      <Card>
        <CardHeader title="Compare conditions" description="Controls update every chart and the table below." />
        <div className="card-pad space-y-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div><span className="label mb-1.5 block" id="fam-l">Scenario family</span>
              <Segmented label="Scenario family" value={family} onChange={setFamily} options={FAMILIES.filter((f) => rows.some((r) => r.group === f.id)).map((f) => ({ value: f.id, label: f.label }))} /></div>
          </div>
          <p className="text-xs text-muted">{familyInfo.blurb}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {family === "coverage_noise" && (<>
              <Field id="cov" label="TI coverage retained"><select id="cov" className="field" value={coverage} onChange={(e) => setCoverage(Number(e.target.value))}>{covs.map((c) => <option key={c} value={c}>{pct(c, 0)}</option>)}</select></Field>
              <Field id="noise" label="False-match share"><select id="noise" className="field" value={noise} onChange={(e) => setNoise(Number(e.target.value))}>{noises.map((c) => <option key={c} value={c}>{pct(c, 0)}</option>)}</select></Field>
              <Field id="vis" label="Is noise labelled?" hint="Labelled = policy is told which entries are synthetic (an upper bound)."><select id="vis" className="field" value={noise === 0 ? "unlabelled" : visibility} disabled={noise === 0} onChange={(e) => setVisibility(e.target.value as "labelled" | "unlabelled")}><option value="unlabelled">Unlabelled (realistic)</option><option value="labelled">Labelled synthetic</option></select></Field>
            </>)}
            {(family === "stale" || family === "outage") && (
              <Field id="frac" label={family === "stale" ? "Stale share" : "Outage share"}><select id="frac" className="field" value={frac ?? ""} onChange={(e) => setFrac(Number(e.target.value))}>{fracs.map((c) => <option key={c} value={c}>{pct(c, 0)}</option>)}</select></Field>
            )}
            {family === "control_shuffled" && (
              <Field id="cn" label="False-match share"><select id="cn" className="field" value={frac ?? ""} onChange={(e) => setFrac(Number(e.target.value))}>{ctlNoises.map((c) => <option key={c} value={c}>{pct(c, 0)}</option>)}</select></Field>
            )}
            <Field id="metric" label="Metric (line charts)"><select id="metric" className="field" value={metric} onChange={(e) => setMetric(e.target.value)}>{METRICS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
          </div>
          <fieldset><legend className="label mb-1.5">Methods shown</legend>
            <div className="flex flex-wrap gap-2">
              {METHODS.map((mm) => {
                const on = methods.includes(mm.id);
                return (
                  <label key={mm.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs", on ? "border-faint bg-raised" : "border-line text-muted")}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => setMethods((cur) => on ? cur.filter((x) => x !== mm.id) : [...cur, mm.id])} />
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: mm.color, opacity: on ? 1 : 0.3 }} aria-hidden />{mm.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="text-xs text-muted"><strong className="text-ink">{metricMeta.label}:</strong> {metricMeta.help}</p>
        </div>
      </Card>

      <ScenarioTable rows={scenario} label={scLabel} methods={methods} seeds={seeds.length} nTest={nTest} />

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title={`${metricMeta.label} vs TI coverage retained`} subtitle="No false matches. Lines show the mean over seeds."
          caption={`SIMULATION · ${set.metadata.is_synthetic ? "synthetic URLs" : "PhiUSIIL URLs"} · ${seeds.length} seeds · n=${nTest ?? "?"} test items per run`}
          table={{ headers: ["Coverage", ...methods.map((x) => methodMeta(x)?.short ?? x)], rows: covSeries.map((r) => [pct(r.x as number, 0), ...methods.map((x) => fmt(r[x]))]) }}>
          <MethodLines data={covSeries} methods={methods} xLabel="TI coverage retained" xFmt={(v) => pct(v, 0)} metric={metricMeta} />
        </ChartCard>
        <ChartCard title={`${metricMeta.label} vs synthetic false-match share`} subtitle="Coverage 100%; false matches unlabelled."
          caption={`SIMULATION · ${seeds.length} seeds`}
          table={{ headers: ["False matches", ...methods.map((x) => methodMeta(x)?.short ?? x)], rows: noiseSeries.map((r) => [pct(r.x as number, 0), ...methods.map((x) => fmt(r[x]))]) }}>
          <MethodLines data={noiseSeries} methods={methods} xLabel="False-match share of feed" xFmt={(v) => pct(v, 0)} metric={metricMeta} />
        </ChartCard>
        <ChartCard title="Method comparison at the selected scenario" subtitle={scLabel} caption={`Bars: mean; whiskers: ±1 SD over ${seeds.length} seeds`}
          table={{ headers: ["Method", "Recall", "FPR", "Review rate"], rows: scenario.filter((r) => methods.includes(String(r.method))).map((r) => [methodMeta(String(r.method))?.name ?? String(r.method), pct(val(r, "recall")), pct(val(r, "fpr"), 2), pct(val(r, "review_rate"), 2)]) }}>
          <MethodBars rows={scenario} methods={methods} />
        </ChartCard>
        {set.tradeoff && set.tradeoff.length > 0 && (
          <ChartCard title="Detection vs manual-review load" subtitle="Reliability-aware policy; sweep of the low threshold (first seed)." caption="SIMULATION · each point is one validation-recall target for t_low"
            table={{ headers: ["Target recall (val)", "Review rate", "Recall incl. review", "FPR incl. review"], rows: set.tradeoff.map((t) => [String(t.target_recall_low), pct(t.review_rate as number, 2), pct(t.recall_incl_review as number, 2), pct(t.fpr_incl_review as number, 2)]) }}>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
                <CartesianGrid stroke="#223452" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="review_rate" name="Review rate" tickFormatter={(v) => pct(v, 1)} label={{ value: "Manual-review rate", position: "insideBottom", offset: -12, fill: "#8FA3C0", fontSize: 11 }} />
                <YAxis type="number" dataKey="recall_incl_review" name="Recall incl. review" tickFormatter={(v) => pct(v, 1)} domain={["auto", "auto"]} />
                <Tooltip formatter={(v: number) => pct(v, 2)} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={set.tradeoff} fill="#2DD4BF" />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>

      {m.latency_ms_per_item && (
        <Card className="card-pad"><p className="label">Measured latency (per item, this machine)</p>
          <p className="mt-1 text-sm">URL model: <span className="font-mono">{m.latency_ms_per_item.url_model} ms</span> · feed lookup + both fusion policies: <span className="font-mono">{m.latency_ms_per_item.ti_lookup_plus_both_fusion_policies} ms</span></p></Card>
      )}
    </div>
  );
}

const fmt = (v: unknown) => (typeof v === "number" ? v.toFixed(4) : "n/a");
function Stat({ k, v }: { k: string; v: string }) { return <div><p className="label">{k}</p><p className="mt-0.5 font-mono text-sm">{v}</p></div>; }

function MethodLines({ data, methods, xLabel, xFmt, metric }: { data: Record<string, number | null>[]; methods: string[]; xLabel: string; xFmt: (v: number) => string; metric: { id: string; label: string } }) {
  const isRate = metric.id !== "roc_auc";
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 22, left: 0 }}>
        <CartesianGrid stroke="#223452" strokeDasharray="3 3" />
        <XAxis dataKey="x" tickFormatter={xFmt} label={{ value: xLabel, position: "insideBottom", offset: -14, fill: "#8FA3C0", fontSize: 11 }} />
        <YAxis tickFormatter={(v) => (isRate ? pct(v, 2) : v.toFixed(3))} domain={["auto", "auto"]} width={64} />
        <Tooltip formatter={(v: number, name) => [isRate ? pct(v, 2) : v.toFixed(4), methodMeta(String(name))?.name ?? name]} labelFormatter={(l) => `${xLabel}: ${xFmt(Number(l))}`} />
        <Legend verticalAlign="top" height={28} formatter={(v) => methodMeta(String(v))?.name ?? v} wrapperStyle={{ fontSize: 11 }} />
        {methods.map((mm) => { const mt = methodMeta(mm)!; return <Line key={mm} type="monotone" dataKey={mm} stroke={mt.color} strokeDasharray={mt.dash} strokeWidth={mt.main ? 2.2 : 1.5} dot={{ r: 3 }} isAnimationActive={false} connectNulls />; })}
      </LineChart>
    </ResponsiveContainer>
  );
}

function MethodBars({ rows, methods }: { rows: Row[]; methods: string[] }) {
  const data = ["recall", "fpr", "review_rate"].map((k) => {
    const o: Record<string, number | string | null> = { name: METRICS.find((x) => x.id === k)?.label ?? k };
    for (const mm of methods) {
      const r = rows.find((x) => x.method === mm);
      o[mm] = val(r, k); o[`${mm}_sd`] = val(r, k, "std");
    }
    return o;
  });
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#223452" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" />
        <YAxis tickFormatter={(v) => pct(v, 0)} />
        <Tooltip formatter={(v: number, name) => [pct(v, 2), methodMeta(String(name))?.name ?? name]} />
        <Legend verticalAlign="top" height={28} formatter={(v) => methodMeta(String(v))?.name ?? v} wrapperStyle={{ fontSize: 11 }} />
        {methods.map((mm) => (
          <Bar key={mm} dataKey={mm} fill={methodMeta(mm)!.color} isAnimationActive={false} radius={[2, 2, 0, 0]}>
            <ErrorBar dataKey={`${mm}_sd`} stroke="#E6EDF7" width={3} strokeWidth={1} />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScenarioTable({ rows, label, methods, seeds, nTest }: { rows: Row[]; label: string; methods: string[]; seeds: number; nTest?: number }) {
  const cols = ["precision", "recall", "f1", "fpr", "review_rate", "roc_auc"];
  const shown = METHODS.filter((mm) => methods.includes(mm.id));
  return (
    <Card>
      <CardHeader title="Selected scenario" description={`${label} · mean ± SD over ${seeds} seeds · n = ${nTest?.toLocaleString() ?? "?"} test items per run · scenario id ${rows[0]?.scenario_id ?? "n/a"}`} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem]">
          <caption className="sr-only">Metrics by method for the selected scenario</caption>
          <thead><tr><th className="th" scope="col">Method</th>{cols.map((c) => <th key={c} className="th text-right" scope="col">{METRICS.find((x) => x.id === c)?.label ?? c}</th>)}</tr></thead>
          <tbody>
            {shown.map((mm) => {
              const r = rows.find((x) => x.method === mm.id);
              return (
                <tr key={mm.id}>
                  <th scope="row" className="td whitespace-nowrap text-left font-medium"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: mm.color }} aria-hidden />{mm.name}</th>
                  {cols.map((c) => { const a = val(r, c), s = val(r, c, "std"); return <td key={c} className="td text-right font-mono text-xs tabular-nums">{a == null ? <span className="text-faint">n/a</span> : <>{a.toFixed(4)}<span className="text-faint"> ±{(s ?? 0).toFixed(4)}</span></>}</td>; })}
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td className="td text-muted" colSpan={cols.length + 1}>No rows for this combination.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">Strict metrics count only the “phishing” verdict as a positive call; items sent to review are not counted as flagged. n/a: undefined (e.g. precision when nothing is flagged).</p>
    </Card>
  );
}
