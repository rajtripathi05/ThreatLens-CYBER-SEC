import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ShortcutPanel } from "@/components/research/ShortcutPanel";
import { useApp } from "@/context/AppContext";
import { ChartCard, Provenance } from "@/components/research/shared";
import { Alert, Card, CardHeader, Metric, Segmented } from "@/components/ui/primitives";
import type { ClassifierRun, ExperimentSet } from "@/lib/types";
import { num, pct } from "@/lib/utils";

const PROTOCOL = { stratified: "Stratified holdout", host_grouped: "Host-grouped holdout" } as Record<string, string>;
const VARIANT = { raw_url: "Raw URL", scheme_www_stripped: "Scheme & www. stripped" } as Record<string, string>;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(a.length, 1);
const sd = (a: number[]) => (a.length < 2 ? 0 : Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1)));

export function ClassifierView({ set }: { set: ExperimentSet }) {
  const { mode } = useApp();
  const m = set.metadata;
  const runs = m.runs ?? [];
  const protocols = [...new Set(runs.map((r) => r.protocol))];
  const variants = [...new Set(runs.map((r) => r.variant))];
  const [protocol, setProtocol] = useState(protocols[0] ?? "stratified");
  const [variant, setVariant] = useState(variants[0] ?? "raw_url");

  const sel = useMemo(() => runs.filter((r) => r.protocol === protocol && r.variant === variant), [runs, protocol, variant]);
  const first: ClassifierRun | undefined = sel[0];
  const agg = (k: keyof ClassifierRun) => { const v = sel.map((r) => r[k] as number); return { m: mean(v), s: sd(v) }; };

  const compare = useMemo(() => protocols.flatMap((p) => variants.map((v) => {
    const rs = runs.filter((r) => r.protocol === p && r.variant === v);
    return { name: `${PROTOCOL[p] ?? p} · ${VARIANT[v] ?? v}`, p, v, f1: mean(rs.map((r) => r.f1)), f1sd: sd(rs.map((r) => r.f1)), fpr: mean(rs.map((r) => r.fpr)), recall: mean(rs.map((r) => r.recall)), auc: mean(rs.map((r) => r.roc_auc)) };
  })), [runs, protocols, variants]);

  const artefact = useMemo(() => {
    const raw = compare.find((c) => c.v === "raw_url" && c.p === protocol), st = compare.find((c) => c.v !== "raw_url" && c.p === protocol);
    return raw && st && raw.f1 - st.f1 > 0.03 ? { raw: raw.f1, st: st.f1 } : null;
  }, [compare, protocol]);

  const roc = first ? first.roc_curve.fpr.map((x, i) => ({ fpr: x, tpr: first.roc_curve.tpr[i], diag: x })) : [];
  const rel = first?.reliability_bins.map((b) => ({ p: b.mean_predicted, observed: b.observed_rate, ideal: b.mean_predicted, n: b.n })) ?? [];
  const f = (k: keyof ClassifierRun) => agg(k);

  return (
    <div className="space-y-5">
      <Provenance m={m} />
      <ShortcutPanel set={set} demo={mode === "demo"} />
      <Card className="card-pad">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div><p className="label mb-1.5">Split protocol</p><Segmented label="Split protocol" value={protocol} onChange={setProtocol} options={protocols.map((p) => ({ value: p, label: PROTOCOL[p] ?? p }))} /></div>
          <div><p className="label mb-1.5">URL preprocessing</p><Segmented label="URL preprocessing" value={variant} onChange={setVariant} options={variants.map((v) => ({ value: v, label: VARIANT[v] ?? v }))} /></div>
        </div>
        <p className="mt-3 text-xs text-muted">{m.split_protocols?.[protocol]}. {m.threshold_policy}. Seeds: {sel.map((r) => r.seed).join(", ")}. Positive class: phishing.</p>
      </Card>

      {artefact && (
        <Alert tone="warn" title="Large part of the raw-URL score comes from a dataset artefact">
          With the scheme (<span className="font-mono">https://</span>) and leading <span className="font-mono">www.</span> removed, F1 falls from {num(artefact.raw, 4)} to {num(artefact.st, 4)} under this protocol. Raw-URL results should be read as an upper bound on this dataset, not as expected real-world performance.
        </Alert>
      )}

      {first && (
        <Card>
          <CardHeader title="Held-out test performance" description={`Mean ± SD over ${sel.length} seeds · n = ${first.n_test.toLocaleString()} test URLs per run (phishing share ${pct(first.phishing_rate.test)}) · decision threshold chosen on validation`} />
          <div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
            <Metric label="Precision" value={num(f("precision").m, 4)} sub={`±${num(f("precision").s, 4)}`} />
            <Metric label="Recall" value={num(f("recall").m, 4)} sub={`±${num(f("recall").s, 4)}`} />
            <Metric label="F1" value={num(f("f1").m, 4)} sub={`±${num(f("f1").s, 4)}`} tone="accent" />
            <Metric label="False-positive rate" value={num(f("fpr").m, 4)} sub={`±${num(f("fpr").s, 4)}`} />
            <Metric label="ROC-AUC" value={num(f("roc_auc").m, 4)} sub={`±${num(f("roc_auc").s, 4)}`} />
            <Metric label="Latency / URL" value={`${num(f("latency_ms_per_url").m, 2)} ms`} sub="single-URL, this machine" />
          </div>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">
            95% bootstrap CIs for seed {first.seed} (test-set resampling, not including split variance): F1 {num(first.ci95.f1[0], 4)}–{num(first.ci95.f1[1], 4)} · recall {num(first.ci95.recall[0], 4)}–{num(first.ci95.recall[1], 4)} · FPR {num(first.ci95.fpr[0], 4)}–{num(first.ci95.fpr[1], 4)} · ROC-AUC {num(first.ci95.roc_auc[0], 4)}–{num(first.ci95.roc_auc[1], 4)}.
          </p>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="F1 across protocols and preprocessing" subtitle="Whisker: ±1 SD over seeds" caption={`EMPIRICAL · PhiUSIIL · ${m.config && (m.config as { seeds?: number[] }).seeds?.length} seeds per bar`}
          table={{ headers: ["Condition", "F1", "Recall", "FPR", "ROC-AUC"], rows: compare.map((c) => [c.name, c.f1.toFixed(4), c.recall.toFixed(4), c.fpr.toFixed(4), c.auc.toFixed(4)]) }}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={compare} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="#223452" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={false} />
              <YAxis domain={[0.7, 1]} tickFormatter={(v) => v.toFixed(2)} />
              <Tooltip formatter={(v: number) => v.toFixed(4)} labelFormatter={(l) => String(l)} />
              <Bar dataKey="f1" name="F1" fill="#2DD4BF" isAnimationActive={false} radius={[2, 2, 0, 0]}><ErrorBar dataKey="f1sd" stroke="#E6EDF7" width={4} /></Bar>
            </BarChart>
          </ResponsiveContainer>
          <ul className="grid gap-x-4 gap-y-1 px-3 pb-2 text-2xs text-muted sm:grid-cols-2">{compare.map((c, i) => <li key={c.name}><span className="font-mono text-faint">{i + 1}.</span> {c.name}</li>)}</ul>
        </ChartCard>

        <ChartCard title="ROC curve" subtitle={`${PROTOCOL[protocol]} · ${VARIANT[variant]} · seed ${first?.seed}`} caption="EMPIRICAL · held-out test split"
          table={{ headers: ["FPR", "TPR"], rows: roc.filter((_, i) => i % 12 === 0).map((r) => [r.fpr.toFixed(4), r.tpr.toFixed(4)]) }}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={roc} margin={{ top: 8, right: 16, bottom: 22, left: 0 }}>
              <CartesianGrid stroke="#223452" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="fpr" domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} label={{ value: "False-positive rate", position: "insideBottom", offset: -14, fill: "#8FA3C0", fontSize: 11 }} />
              <YAxis domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip formatter={(v: number) => v.toFixed(4)} />
              <Line dataKey="diag" stroke="#5F7391" strokeDasharray="4 4" dot={false} name="Chance" isAnimationActive={false} />
              <Line dataKey="tpr" stroke="#2DD4BF" dot={false} strokeWidth={2} name="True-positive rate" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Calibration (reliability diagram)" subtitle={`Raw ECE ${num(first?.ece, 4)} → after isotonic fit on validation ${num(first?.ece_isotonic_val_fit, 4)}`}
          caption="EMPIRICAL · points far from the diagonal indicate over/under-confidence. Live scores are NOT recalibrated."
          table={{ headers: ["Mean predicted", "Observed phishing rate", "n"], rows: rel.map((b) => [b.p.toFixed(3), b.observed.toFixed(3), String(b.n)]) }}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={rel} margin={{ top: 8, right: 16, bottom: 22, left: 0 }}>
              <CartesianGrid stroke="#223452" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="p" domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Mean predicted probability", position: "insideBottom", offset: -14, fill: "#8FA3C0", fontSize: 11 }} />
              <YAxis domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip formatter={(v: number) => v.toFixed(3)} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#5F7391" strokeDasharray="4 4" />
              <Line dataKey="observed" name="Observed rate" stroke="#FF9F6B" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card>
          <CardHeader title="Leakage audit" description="How much of the test set shares a host or near-duplicate URL with training data." />
          <div className="overflow-x-auto"><table className="w-full min-w-[26rem]"><caption className="sr-only">Leakage audit by protocol</caption>
            <thead><tr><th className="th" scope="col">Protocol</th><th className="th text-right" scope="col">Host seen in train</th><th className="th text-right" scope="col">Near-duplicate in train</th></tr></thead>
            <tbody>{protocols.map((p) => { const r = runs.find((x) => x.protocol === p && x.variant === variant) ?? runs.find((x) => x.protocol === p)!; return (
              <tr key={p}><th scope="row" className="td text-left font-medium">{PROTOCOL[p] ?? p}</th><td className="td text-right font-mono text-xs">{pct(r.leakage_audit.frac_test_host_seen_in_train, 2)}</td><td className="td text-right font-mono text-xs">{pct(r.leakage_audit.frac_test_near_duplicate_in_train, 2)}</td></tr>); })}</tbody></table></div>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">Exact duplicate URLs were removed before splitting. Near-duplicate = same host/path ignoring scheme, “www.” and trailing slash. The host-grouped protocol guarantees 0% host overlap.</p>
        </Card>
      </div>

      <Card>
        <CardHeader title="All runs" description="One row per (protocol, preprocessing, seed)." />
        <div className="overflow-x-auto"><table className="w-full min-w-[52rem]"><caption className="sr-only">All classifier runs</caption>
          <thead><tr>{["Protocol", "Preprocessing", "Seed", "n test", "Precision", "Recall", "F1", "FPR", "ROC-AUC", "ECE"].map((h) => <th key={h} className="th" scope="col">{h}</th>)}</tr></thead>
          <tbody>{runs.map((r, i) => (
            <tr key={i}><td className="td text-xs">{PROTOCOL[r.protocol] ?? r.protocol}</td><td className="td text-xs">{VARIANT[r.variant] ?? r.variant}</td><td className="td font-mono text-xs">{r.seed}</td><td className="td font-mono text-xs">{r.n_test.toLocaleString()}</td>
              {[r.precision, r.recall, r.f1, r.fpr, r.roc_auc, r.ece].map((v, j) => <td key={j} className="td font-mono text-xs tabular-nums">{v.toFixed(4)}</td>)}</tr>))}</tbody></table></div>
      </Card>
    </div>
  );
}
