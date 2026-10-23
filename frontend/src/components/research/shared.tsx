import type { ReactNode } from "react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import type { ExperimentMetadata } from "@/lib/types";
import { fmtDate, shortHash } from "@/lib/utils";

export function Provenance({ m, sim }: { m: ExperimentMetadata; sim?: boolean }) {
  const items: [string, string][] = [
    ["Run ID", m.run_id],
    ["Finished", fmtDate(m.finished_utc ?? m.started_utc)],
    ["Evidence level", m.evidence_level],
    ["Dataset", m.data_provenance?.synthetic ? "SYNTHETIC generator (not real data)" : "UCI PhiUSIIL (CC BY 4.0)"],
    ["Dataset SHA-256", shortHash(m.data_provenance?.sha256, 16)],
    ["Rows after cleaning", m.data_provenance?.final_rows?.toLocaleString() ?? "n/a"],
    ["Code version", m.git_commit ?? "unavailable"],
    ["Preprocessing", m.preprocessing_version ?? "n/a"],
    ["Software", m.versions ? Object.entries(m.versions).map(([k, v]) => `${k} ${v}`).join(" · ") : "n/a"],
  ];
  if (m.split) items.splice(6, 0, ["Split (seed " + m.split.seed + ")", `train ${m.split.train.toLocaleString()} · val ${m.split.val.toLocaleString()} · test used ${m.split.test_used.toLocaleString()}`]);
  if (m.thresholds_fit_on_validation) items.push(["Thresholds (fit on validation only)", Object.entries(m.thresholds_fit_on_validation).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(" · ")]);
  return (
    <Card>
      <CardHeader title="Run provenance" description="Every figure below traces to this run." actions={<>
        {sim ? <Badge tone="sim">SIMULATION</Badge> : <Badge tone="accent">EMPIRICAL</Badge>}
        {m.is_synthetic ? <Badge tone="demo">SYNTHETIC DATA</Badge> : <Badge>REAL DATA</Badge>}</>} />
      <dl className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
        {items.map(([k, v]) => <div key={k} className="min-w-0"><dt className="label">{k}</dt><dd className="mt-0.5 break-words font-mono text-xs text-ink">{v}</dd></div>)}
      </dl>
      {m.feed_mode_description && <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5"><strong className="text-ink">Feed:</strong> {m.feed_mode_description}</p>}
    </Card>
  );
}

/** Chart with an accessible tabular alternative. */
export function ChartCard({ title, subtitle, caption, table, children }: {
  title: string; subtitle?: string; caption?: string; children: ReactNode; table?: { headers: string[]; rows: string[][] };
}) {
  return (
    <Card>
      <CardHeader title={title} description={subtitle} />
      <div className="px-2 pb-1 pt-3 sm:px-3" role="group" aria-label={`${title} chart`}>{children}</div>
      {caption && <p className="px-4 pb-2 text-2xs text-faint sm:px-5">{caption}</p>}
      {table && (
        <details className="border-t border-line px-4 py-2 text-xs sm:px-5">
          <summary className="cursor-pointer text-muted hover:text-ink">View data table</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">{title}</caption>
              <thead><tr>{table.headers.map((h) => <th key={h} scope="col" className="th">{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="td font-mono text-xs">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}
