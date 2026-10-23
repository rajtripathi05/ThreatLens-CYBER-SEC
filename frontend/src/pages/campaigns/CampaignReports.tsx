import { Download } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardHeader, EmptyState, Metric, PageHeader } from "@/components/ui/primitives";
import { IssueList, LocalStorageNote } from "@/components/campaigns/shared";
import { NamingRules } from "@/pages/campaigns/CampaignIntelligence";
import { cleanedCsv, reportCsv } from "@/lib/campaign/importer";
import { analyzeRecords, type IssueCode } from "@/lib/campaign/quality";
import { computeStats, ISSUE_LABEL } from "@/lib/campaign/stats";
import { campaignStore, useCampaigns, useNaming, type CampaignStore } from "@/lib/campaign/store";
import { downloadBlob } from "@/lib/utils";

export default function CampaignReports() {
  return (
    <>
      <PageHeader kicker="Campaign QA & Reports" title="Campaign QA & Reports"
        description="Every finding below comes from the validation rules run on your saved URLs. Fix them in UTM Studio or the Library, then export the library or the validation report." />
      <ReportsView />
    </>
  );
}

export function ReportsView({ store = campaignStore }: { store?: CampaignStore }) {
  const records = useCampaigns(store);
  const naming = useNaming();
  const rows = useMemo(() => analyzeRecords(records, naming), [records, naming]);
  const stats = useMemo(() => computeStats(rows), [rows]);
  const stamp = new Date().toISOString().slice(0, 10);
  const download = (name: string, text: string) => downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), name);

  const byCode = useMemo(() => {
    const m = new Map<IssueCode, typeof rows>();
    for (const r of rows) for (const c of new Set(r.issues.map((i) => i.code))) m.set(c, [...(m.get(c) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Exports" description="CSV files open in any spreadsheet. Cells that could run as formulas are neutralised."
          actions={<NamingRules />} />
        <div className="card-pad flex flex-wrap gap-2">
          <Button variant="primary" disabled={!rows.length} onClick={() => download(`campaign-urls-${stamp}.csv`, cleanedCsv(rows))}><Download className="h-4 w-4" aria-hidden />Export campaign library</Button>
          <Button disabled={!rows.length} onClick={() => download(`validation-report-${stamp}.csv`, reportCsv(rows))}><Download className="h-4 w-4" aria-hidden />Export validation report</Button>
          <p className="basis-full text-xs text-muted">The library export can be imported again from the Campaign Library. Rejected rows from an import are downloaded from the import preview.</p>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card className="card-pad"><EmptyState title="Nothing to report yet"
          action={<Link to="/campaigns/studio" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-dim">Create a UTM URL</Link>}>
          Save or import campaign URLs and their quality findings will appear here.</EmptyState></Card>
      ) : (<>
        <section aria-label="QA summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="URLs checked" value={stats.total} />
          <Metric label="Clean" value={stats.clean} tone="accent" sub="no findings" />
          <Metric label="Need attention" value={stats.withIssues} />
          <Metric label="Duplicates" value={stats.duplicates} />
        </section>

        <Card>
          <CardHeader title="Findings and fixes" description="Grouped by rule, most frequent first." />
          {byCode.length === 0 ? <div className="card-pad"><p className="text-sm text-accent">No findings. Every saved URL has the required parameters, follows the naming rules and is unique.</p></div> : (
            <ul className="divide-y divide-line">
              {byCode.map(([code, affected]) => (
                <li key={code} className="px-4 py-4 sm:px-5">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-medium">
                      <span>{ISSUE_LABEL[code]}</span><span className="text-xs font-normal text-muted">{affected.length} URL{affected.length === 1 ? "" : "s"}</span>
                    </summary>
                    <ul className="mt-3 space-y-3">
                      {affected.slice(0, 20).map((r) => (
                        <li key={r.id} className="rounded-md border border-line bg-bg/50 p-3">
                          <p className="truncate text-sm">{r.name || r.baseUrl}</p>
                          <p className="mb-2 break-all font-mono text-2xs text-muted">{r.finalUrl}</p>
                          <IssueList issues={r.issues.filter((i) => i.code === code)} />
                        </li>))}
                    </ul>
                    {affected.length > 20 && <p className="mt-2 text-xs text-muted">Showing 20 of {affected.length}. The validation report CSV lists all of them.</p>}
                  </details>
                </li>))}
            </ul>)}
        </Card>
      </>)}
      <LocalStorageNote />
    </div>
  );
}
