import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LabelStrip, type LabelKind } from "@/components/EvidenceLabel";
import { ChartCard } from "@/components/research/shared";
import { Alert, Card, CardHeader, Metric } from "@/components/ui/primitives";
import { shortcutFinding } from "@/lib/findings";
import type { ExperimentSet } from "@/lib/types";
import { fmtDate, num } from "@/lib/utils";

const PROTOCOL: Record<string, string> = { stratified: "Stratified holdout", host_grouped: "Host-grouped holdout" };

/** Raw URL vs URL with scheme and "www." removed. Every number is computed from the saved classifier run. */
export function ShortcutPanel({ set, demo }: { set: ExperimentSet; demo: boolean }) {
  const cells = shortcutFinding(set);
  const m = set.metadata;
  const labels: LabelKind[] = demo ? ["real", "fixture"] : ["real"];
  if (!cells.length) {
    return <Alert tone="info" title="Raw vs normalised comparison unavailable">This result set has no paired raw / stripped runs.</Alert>;
  }
  const head = cells.find((c) => c.protocol === "stratified") ?? cells[0];
  const chart = cells.map((c) => ({ name: PROTOCOL[c.protocol] ?? c.protocol, raw: c.raw, rawSd: c.rawSd, stripped: c.stripped, strippedSd: c.strippedSd }));
  const cfg = m.config as { seeds?: number[] } | undefined;
  return (
    <section aria-labelledby="shortcut-h" className="space-y-4">
      <Card>
        <CardHeader title={<span id="shortcut-h">Raw vs normalised URLs: a shortcut-learning check</span>}
          description="Same model, same data, same splits. Only the text of the URL changes: the scheme (http:// or https://) and a leading “www.” are removed before training and testing."
          actions={<LabelStrip kinds={labels} />} />
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-3 sm:px-5">
          <Metric label="F1, raw URL" value={num(head.raw, 4)} sub={`${PROTOCOL[head.protocol] ?? head.protocol} · ±${num(head.rawSd, 4)} SD`} tone="accent" />
          <Metric label="F1, scheme and www. removed" value={num(head.stripped, 4)} sub={`±${num(head.strippedSd, 4)} SD`} />
          <Metric label="Absolute change" value={`−${head.points.toFixed(1)} pp`} sub="percentage points of F1" />
        </div>
        <p className="border-t border-line px-4 py-2.5 font-mono text-2xs text-faint sm:px-5">
          run {m.run_id} · finished {fmtDate(m.finished_utc)} · PhiUSIIL, {m.data_provenance?.final_rows?.toLocaleString() ?? "n/a"} rows after cleaning · seeds {head.seeds.join(", ")} · n={head.nTest.toLocaleString()} test URLs per run
        </p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard title="F1 by URL representation" subtitle="Side by side for each split protocol. Whiskers: ±1 SD over seeds."
          caption={`REAL-DATA EVALUATION · ${cfg?.seeds?.length ?? "?"} seeds per bar · threshold chosen on validation, never on test`}
          table={{ headers: ["Protocol", "Raw F1", "Stripped F1", "Change (pp)"], rows: cells.map((c) => [PROTOCOL[c.protocol] ?? c.protocol, c.raw.toFixed(4), c.stripped.toFixed(4), (-c.points).toFixed(2)]) }}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chart} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="#223452" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis domain={[0.7, 1]} tickFormatter={(v) => v.toFixed(2)} />
              <Tooltip formatter={(v: number) => v.toFixed(4)} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="raw" name="Raw URL" fill="#2DD4BF" isAnimationActive={false} radius={[2, 2, 0, 0]}><ErrorBar dataKey="rawSd" stroke="#E6EDF7" width={4} /></Bar>
              <Bar dataKey="stripped" name="Scheme and www. removed" fill="#FF9F6B" isAnimationActive={false} radius={[2, 2, 0, 0]}><ErrorBar dataKey="strippedSd" stroke="#E6EDF7" width={4} /></Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card>
          <CardHeader title="Research interpretation" />
          <dl className="space-y-3 px-4 py-4 text-sm sm:px-5">
            <Item k="Why it matters">A near-perfect score can come from a formatting habit of the dataset rather than from anything about phishing. If one class is mostly written with <span className="font-mono">https://</span> or <span className="font-mono">www.</span>, a model can score well by reading that.</Item>
            <Item k="What changed">Only the scheme and leading “www.” were removed. Model, split, seeds and threshold policy are identical.</Item>
            <Item k="What it suggests">F1 fell by {head.points.toFixed(1)} points ({num(head.raw, 3)} → {num(head.stripped, 3)}), so the score is partly sensitive to this formatting. That is representation sensitivity, consistent with shortcut learning.</Item>
            <Item k="What it does not prove">It does not show data leakage, and it does not measure real-world performance. The stripped score is still a PhiUSIIL result, and other dataset artefacts may remain. The classifier view reports host and near-duplicate overlap separately.</Item>
          </dl>
        </Card>
      </div>
    </section>
  );
}

function Item({ k, children }: { k: string; children: ReactNode }) {
  return <div><dt className="label">{k}</dt><dd className="mt-0.5 text-muted">{children}</dd></div>;
}
