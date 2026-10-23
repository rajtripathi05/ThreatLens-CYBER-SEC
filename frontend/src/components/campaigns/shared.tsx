import { FlaskConical, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { Analyzed, Issue } from "@/lib/campaign/quality";
import type { Tally } from "@/lib/campaign/stats";

export function LocalStorageNote() {
  return (
    <p className="flex items-start gap-2 px-1 text-2xs leading-relaxed text-faint">
      <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      Saved campaign URLs are stored in this browser only (localStorage). They are not uploaded and do not sync between devices. Use CSV export to back them up or move them.
    </p>
  );
}

export function QualityBadge({ status }: { status: Analyzed["status"] }) {
  return status === "ok" ? <Badge tone="accent">Clean</Badge> : status === "warn" ? <Badge tone="medium">Warnings</Badge> : <Badge tone="high">Errors</Badge>;
}

/** Persistent, unmistakable marker for anything that shows sample data. */
export function DemoDataBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" data-testid="demo-data-banner" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-demo/50 bg-demo/10 px-4 py-2.5 text-sm text-ink">
      <span className="inline-flex items-center gap-1.5 font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-demo"><FlaskConical className="h-3.5 w-3.5" aria-hidden />Demo data</span>
      <span className="text-muted">{children ?? "Fictional sample campaign URLs (.example hosts). Kept separate from your saved campaigns; nothing here is real traffic."}</span>
    </div>
  );
}

/** Horizontal bar list computed from counts. Exact numbers are always printed next to the bars. */
export function Distribution({ title, items, empty }: { title: string; items: Tally[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div>
      <h3 className="label mb-3">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="space-y-2" aria-label={title}>
          {items.slice(0, 8).map((i) => (
            <li key={i.value} className="grid grid-cols-[minmax(0,7rem)_1fr_1.5rem] items-center gap-3 text-xs">
              <span className="truncate font-mono text-muted" title={i.value}>{i.value}</span>
              <span className="h-2 overflow-hidden rounded-full bg-raised" aria-hidden><span className="block h-full rounded-full bg-accent/70" style={{ width: `${(i.count / max) * 100}%` }} /></span>
              <span className="numeral text-right text-ink">{i.count}</span>
            </li>))}
          {items.length > 8 && <li className="text-2xs text-faint">+ {items.length - 8} more</li>}
        </ul>)}
    </div>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="space-y-2 text-xs">
      {issues.map((i) => (
        <li key={i.code + i.message} className="flex gap-2">
          <Badge tone={i.severity === "error" ? "high" : "medium"} className="mt-0.5 h-fit">{i.severity}</Badge>
          <span className="min-w-0"><span className="text-ink">{i.message}</span>{i.fix && <span className="block text-muted">Fix: {i.fix}</span>}</span>
        </li>))}
    </ul>
  );
}
