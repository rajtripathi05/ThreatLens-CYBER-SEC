import { ArrowDownRight, ArrowRight, ArrowUpRight, FlaskConical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LabelStrip, labelsFor, LabelLegend } from "@/components/EvidenceLabel";
import { ChartCard } from "@/components/research/shared";
import { Alert, Card, CardHeader, EmptyState, Field, Spinner } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { useExperimentIndex, useExperimentSet } from "@/hooks/useExperiments";
import { compare, PRESETS, presetRows, saturation, type Outcome } from "@/lib/findings";
import { METHODS, METRICS, methodMeta, val, type Row } from "@/lib/research";
import { cn, fmtDate, pct } from "@/lib/utils";

const MAIN = ["ml_only", "naive_fusion", "reliability_aware"];

const NOTES: Record<string, { supports: string; cannot: string }> = {
  baseline: { supports: "With a clean feed, how much the fusion rules change the ML-only decision.", cannot: "How a real feed behaves. The feed here is derived from the dataset, not from a provider." },
  missing50: { supports: "How decisions degrade when the feed misses indicators. A missing indicator gives NO_MATCH, which is not evidence of safety.", cannot: "The real miss rate of any provider." },
  noise10: { supports: "How each policy copes with false matches it cannot tell apart from true ones. Naive fusion trusts every match.", cannot: "The real false-match rate of any provider; the noise is injected at random." },
  shuffled: { supports: "A negative control: matches carry no information, so a sound policy should not benefit from them.", cannot: "Anything about real threat intelligence. It is a sanity check on the pipeline." },
  oracle: { supports: "The best case for fusion: a feed that is right wherever it has coverage.", cannot: "Real-world benefit. The feed uses test labels, so these numbers are an upper bound." },
};

const OUTCOME_STYLE: Record<Outcome, { word: string; cls: string; Icon: typeof ArrowUpRight }> = {
  improved: { word: "improved", cls: "text-accent", Icon: ArrowUpRight },
  matched: { word: "matched", cls: "text-muted", Icon: ArrowRight },
  worsened: { word: "worsened", cls: "text-sev-high", Icon: ArrowDownRight },
};

/** Presets are filters over SAVED observations. Choosing one never starts an experiment. */
export function ScenarioExplorer({ initialPreset = "noise10", showLegend = true }: { initialPreset?: string; showLegend?: boolean }) {
  const { mode } = useApp();
  const idx = useExperimentIndex();
  const [presetId, setPresetId] = useState(initialPreset);
  const [override, setOverride] = useState<string | null>(null);
  const [seed, setSeed] = useState<"all" | number>("all");
  const [methods, setMethods] = useState<string[]>(MAIN);
  useEffect(() => setPresetId(initialPreset), [initialPreset]);

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const sims = (idx.data ?? []).filter((s) => s.kind === "ti_simulation");
  const setId = override ?? preset.setId;
  const info = sims.find((s) => s.id === setId);
  const set = useExperimentSet(info?.available ? setId : null);
  const m = set.data?.metadata;
  const seeds = m?.seeds ?? [];
  useEffect(() => { if (seed !== "all" && !seeds.includes(seed)) setSeed("all"); }, [seeds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => presetRows(set.data, preset, seed), [set.data, preset, seed]);
  const shown = METHODS.filter((x) => methods.includes(x.id));
  const nTest = m?.split?.test_used;

  const chart = (["f1", "fpr", "review_rate"] as const).map((k) => {
    const o: Record<string, number | string | null> = { name: METRICS.find((x) => x.id === k)!.label };
    for (const x of shown) { const r = rows.find((q) => q.method === x.id); o[x.id] = val(r, k); o[`${x.id}_sd`] = val(r, k, "std"); }
    return o;
  });

  const vsNaive = compare(rows, "naive_fusion", "reliability_aware");
  const vsMl = compare(rows, "ml_only", "reliability_aware");
  const review = val(rows.find((r) => r.method === "reliability_aware"), "review_rate");
  const sat = saturation(set.data, preset);

  return (
    <section aria-labelledby="explorer-h" className="space-y-4">
      <Card>
        <CardHeader title={<span id="explorer-h">Experiment explorer</span>}
          description="Choose a scenario to view its saved observations. This filters stored results; it does not run a new experiment." />
        <div className="card-pad space-y-4">
          <div role="radiogroup" aria-label="Scenario preset" className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.id} role="radio" aria-checked={p.id === presetId} onClick={() => { setPresetId(p.id); setOverride(null); }}
                className={cn("rounded-md border px-3 py-1.5 text-sm transition-colors", p.id === presetId ? "border-accent/60 bg-raised text-ink" : "border-line text-muted hover:border-faint hover:text-ink")}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted">{preset.blurb}</p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="ex-set" label="Result set (feed configuration)">
              <select id="ex-set" className="field" value={setId} onChange={(e) => setOverride(e.target.value)}>
                {sims.map((s) => <option key={s.id} value={s.id} disabled={!s.available}>{s.title}{s.available ? "" : " (not generated)"}</option>)}
              </select>
            </Field>
            <Field id="ex-seed" label="Seed">
              <select id="ex-seed" className="field" value={String(seed)} onChange={(e) => setSeed(e.target.value === "all" ? "all" : Number(e.target.value))} disabled={!seeds.length}>
                <option value="all">All seeds (mean ± SD)</option>
                {seeds.map((s) => <option key={s} value={s}>Seed {s} only</option>)}
              </select>
            </Field>
          </div>
          <fieldset><legend className="label mb-1.5">Methods shown</legend>
            <div className="flex flex-wrap gap-2">
              {METHODS.map((x) => {
                const on = methods.includes(x.id);
                return (
                  <label key={x.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs focus-within:ring-2 focus-within:ring-accent", on ? "border-faint bg-raised" : "border-line text-muted")}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => setMethods((cur) => on ? cur.filter((q) => q !== x.id) : [...cur, x.id])} />
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: x.color, opacity: on ? 1 : 0.3 }} aria-hidden />{x.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </Card>

      {idx.loading && <Spinner label="Loading result index" />}
      {idx.data && !info?.available && (
        <EmptyState icon={<FlaskConical className="h-8 w-8" aria-hidden />} title="This result set has not been generated here">
          No saved results exist for “{info?.title ?? setId}”, so nothing is shown rather than inventing numbers.
          {info?.hint && <span className="mt-2 block font-mono text-xs text-faint">{info.hint}</span>}
        </EmptyState>
      )}
      {set.loading && <Spinner label="Loading results" />}
      {set.error && <Alert tone="error">{set.error}</Alert>}

      {set.data && m && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <LabelStrip kinds={labelsFor(m, mode === "demo")} />
            <span className="text-xs text-muted">{m.feed_mode === "oracle_test_labels" ? "Feed built from test labels: best case only." : "Feed corrupted on purpose by the experiment."}</span>
          </div>
          {sat && (
            <Alert tone="warn" title="Saturated scenario: read with care">
              This scenario injects {sat.injected.toLocaleString()} false matches, but only {sat.pool.toLocaleString()} legitimate test URLs exist to receive them, so every legitimate URL is falsely matched. A false-positive rate near 100% here is a saturation effect of the experiment design, not a graded measurement. Choose the oracle-derived result set for a graded noise comparison.
            </Alert>
          )}
          {rows.length === 0 ? (
            <Alert tone="info" title="No saved rows for this combination">The selected result set has no observation for “{preset.label}”{seed !== "all" ? ` at seed ${seed}` : ""}.</Alert>
          ) : (
            <>
              <ChartCard title={`${preset.label}: F1, false-positive rate and review rate`}
                subtitle={seed === "all" ? `Mean over ${seeds.length} seeds; whiskers ±1 SD (spread across seeds, not a confidence interval).` : `Seed ${seed} only; no variability shown.`}
                caption={`${m.evidence_level} · run ${m.run_id} · scenario ${rows[0]?.scenario_id}`}
                table={{ headers: ["Method", "Precision", "Recall", "F1", "FPR", "Review rate", "ROC-AUC"],
                  rows: shown.map((x) => { const r = rows.find((q) => q.method === x.id); return [x.name, ...(["precision", "recall", "f1", "fpr", "review_rate", "roc_auc"] as const).map((k) => { const v = val(r, k); return v == null ? "n/a" : v.toFixed(4); })]; }) }}>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chart} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="#223452" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 1]} tickFormatter={(v) => pct(v, 0)} />
                    <Tooltip formatter={(v: number, n) => [pct(v, 2), methodMeta(String(n))?.name ?? n]} />
                    <Legend verticalAlign="top" height={28} formatter={(v) => methodMeta(String(v))?.name ?? v} wrapperStyle={{ fontSize: 11 }} />
                    {shown.map((x) => (
                      <Bar key={x.id} dataKey={x.id} fill={x.color} isAnimationActive={false} radius={[2, 2, 0, 0]}>
                        {seed === "all" && <ErrorBar dataKey={`${x.id}_sd`} stroke="#E6EDF7" width={3} strokeWidth={1} />}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ScenarioTable rows={rows} methods={shown.map((x) => x.id)} />

              <Card>
                <CardHeader title="Security versus review: what the policy did here" description="Reliability-aware triage (C) compared with each alternative at this scenario." />
                <div className="grid gap-4 px-4 py-4 sm:px-5 md:grid-cols-2">
                  <Comparison title="C vs B · naive fusion" deltas={vsNaive} />
                  <Comparison title="C vs A · ML only" deltas={vsMl} />
                </div>
                <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">
                  Cost: reliability-aware triage sent <strong className="text-ink">{pct(review, 2)}</strong> of items to a human instead of deciding them. Strict metrics count review items as not flagged, so a lower false-positive rate can be bought with analyst time.
                </p>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card className="card-pad"><p className="label">What this supports</p><p className="mt-1 text-sm">{NOTES[preset.id].supports}</p></Card>
                <Card className="card-pad"><p className="label">What it cannot establish</p><p className="mt-1 text-sm">{NOTES[preset.id].cannot}</p></Card>
              </div>

              <Card>
                <CardHeader title="Provenance of these numbers" />
                <dl className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
                  {([
                    ["Run ID", m.run_id], ["Finished", fmtDate(m.finished_utc ?? m.started_utc)],
                    ["Data", m.is_synthetic ? "Synthetic URL generator" : "PhiUSIIL URLs"],
                    ["Test items per run", nTest?.toLocaleString() ?? "n/a"],
                    ["Seeds", seeds.join(", ") || "n/a"],
                    ["Split seed", m.split ? String(m.split.seed) : "n/a"],
                    ["Feed mode", m.feed_mode ?? "n/a"],
                    ["Thresholds", m.thresholds_fit_on_validation ? Object.entries(m.thresholds_fit_on_validation).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(" · ") + " (fit on validation only)" : "n/a"],
                    ["Latency (this machine)", m.latency_ms_per_item ? `URL model ${m.latency_ms_per_item.url_model} ms · lookup + both policies ${m.latency_ms_per_item.ti_lookup_plus_both_fusion_policies} ms` : "not recorded"],
                  ] as [string, string][]).map(([k, v]) => <div key={k} className="min-w-0"><dt className="label">{k}</dt><dd className="mt-0.5 break-words font-mono text-xs">{v}</dd></div>)}
                </dl>
                {mode === "demo" && <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">Loaded from the bundled demo file, a copy of the saved run above; it was not recomputed in your browser.</p>}
              </Card>
            </>
          )}
        </>
      )}
      {showLegend && (
        <details className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">What do the labels mean?</summary>
          <div className="mt-3"><LabelLegend /></div>
        </details>
      )}
    </section>
  );
}

function Comparison({ title, deltas }: { title: string; deltas: ReturnType<typeof compare> }) {
  const names: Record<string, string> = { f1: "F1", fpr: "False-positive rate", review_rate: "Review rate" };
  return (
    <div>
      <p className="label mb-2">{title}</p>
      <ul className="space-y-1.5 text-sm">
        {deltas.map((d) => {
          if (d.a == null || d.b == null) return <li key={d.metric} className="text-muted">{names[d.metric]}: n/a</li>;
          const o = d.outcome ? OUTCOME_STYLE[d.outcome] : null;
          return (
            <li key={d.metric} className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-40 shrink-0 text-muted">{names[d.metric]}</span>
              <span className="font-mono text-xs tabular-nums">{pct(d.a, 2)} → {pct(d.b, 2)}</span>
              {o ? <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", o.cls)}><o.Icon className="h-3 w-3" aria-hidden />{o.word} ({d.diffPoints! >= 0 ? "+" : ""}{d.diffPoints!.toFixed(2)} pp)</span>
                : <span className="text-xs text-muted">cost ({d.diffPoints! >= 0 ? "+" : ""}{d.diffPoints!.toFixed(2)} pp)</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScenarioTable({ rows, methods }: { rows: Row[]; methods: string[] }) {
  const cols = ["precision", "recall", "f1", "fpr", "review_rate", "roc_auc"];
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem]">
          <caption className="sr-only">Explorer metrics by method for the selected preset</caption>
          <thead><tr><th className="th" scope="col">Method</th>{cols.map((c) => <th key={c} className="th text-right" scope="col">{METRICS.find((x) => x.id === c)?.label ?? c}</th>)}</tr></thead>
          <tbody>
            {METHODS.filter((x) => methods.includes(x.id)).map((x) => {
              const r = rows.find((q) => q.method === x.id);
              return (
                <tr key={x.id}>
                  <th scope="row" className="td whitespace-nowrap text-left font-medium"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: x.color }} aria-hidden />{x.name}</th>
                  {cols.map((c) => { const a = val(r, c), s = val(r, c, "std"); return <td key={c} className="td text-right font-mono text-xs tabular-nums">{a == null ? <span className="text-faint">n/a</span> : <>{a.toFixed(4)}{s ? <span className="text-faint"> ±{s.toFixed(4)}</span> : null}</>}</td>; })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">Only the “phishing” verdict counts as flagged; review items are not flagged. n/a means undefined, for example precision when nothing is flagged. All methods share the same split and seeds; each policy uses its own validation-fit threshold(s), so thresholds are not identical across methods.</p>
    </Card>
  );
}
