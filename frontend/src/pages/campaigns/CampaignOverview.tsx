import { ArrowRight, CheckCircle2, FileUp, Link2, PlayCircle, ScanSearch, Table2 } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Card, CardHeader, EmptyState, Metric, PageHeader, Segmented } from "@/components/ui/primitives";
import { DemoDataBanner, Distribution, LocalStorageNote, QualityBadge } from "@/components/campaigns/shared";
import { analyzeRecords } from "@/lib/campaign/quality";
import { computeStats, ISSUE_LABEL } from "@/lib/campaign/stats";
import { campaignStore, demoStore, useCampaigns, useImportLog, useNaming } from "@/lib/campaign/store";
import { fmtDate } from "@/lib/utils";

const btn = "inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-raised/70 px-4 text-sm font-medium transition hover:border-accent/40";
const STEPS = [
  { n: "1", label: "Create", to: "/campaigns/studio", text: "Build a tagged URL" },
  { n: "2", label: "Validate", to: "/campaigns/studio", text: "Check required tags and naming" },
  { n: "3", label: "Save", to: "/campaigns/studio", text: "Keep it in your library" },
  { n: "4", label: "Organize", to: "/campaigns/intelligence", text: "Search, filter, fix" },
  { n: "5", label: "Export", to: "/campaigns/reports", text: "CSV and QA reports" },
];

export default function CampaignOverview() {
  const [params, setParams] = useSearchParams();
  const demo = params.get("data") === "demo";
  const store = demo ? demoStore : campaignStore;
  const records = useCampaigns(store);
  const imports = useImportLog(store);
  const naming = useNaming();
  const analyzed = useMemo(() => analyzeRecords(records, naming), [records, naming]);
  const stats = useMemo(() => computeStats(analyzed), [analyzed]);
  const live = !demo;

  return (
    <>
      <PageHeader kicker="ThreatLens Campaign Intelligence" title="Standardize your UTM links. Catch tagging mistakes early."
        description="Create consistent UTM URLs, keep them in one library, find missing parameters, duplicates and naming drift, and export clean reports. It manages tagged links; it does not measure clicks, conversions or traffic."
        actions={<Segmented label="Data source" value={demo ? "demo" : "mine"} onChange={(v) => setParams(v === "demo" ? { data: "demo" } : {}, { replace: true })}
          options={[{ value: "mine", label: "My campaigns" }, { value: "demo", label: "Demo data" }]} />} />

      {demo && <DemoDataBanner>You are viewing the fictional demo dataset, separate from your saved campaigns. <Link to="/demo" className="text-accent underline">Open the guided demo</Link></DemoDataBanner>}

      <ol className="mb-6 grid gap-2 sm:grid-cols-5" aria-label="Campaign workflow">
        {STEPS.map((s) => (
          <li key={s.n}><Link to={s.to} className="group flex h-full items-start gap-3 rounded-lg border border-line bg-surface/60 p-3 transition hover:border-accent/40">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 font-mono text-2xs text-accent">{s.n}</span>
            <span className="min-w-0"><span className="block text-sm font-semibold group-hover:text-accent">{s.label}</span><span className="block text-2xs text-muted">{s.text}</span></span>
          </Link></li>))}
      </ol>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link to="/campaigns/studio" className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:bg-accent-dim"><Link2 className="h-4 w-4" aria-hidden />Create UTM</Link>
        <Link to="/campaigns/intelligence" className={btn}><FileUp className="h-4 w-4 text-accent" aria-hidden />Import CSV</Link>
        <Link to="/campaigns/intelligence" className={btn}><Table2 className="h-4 w-4 text-accent" aria-hidden />Browse campaigns</Link>
        <Link to="/demo" className={btn}><PlayCircle className="h-4 w-4 text-accent" aria-hidden />Open demo</Link>
      </div>

      {records.length === 0 ? (
        <Card className="card-pad">
          <EmptyState title="No campaign URLs saved yet"
            action={<div className="flex flex-wrap justify-center gap-2"><Link to="/campaigns/studio" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-dim">Create your first UTM URL</Link>
              <Link to="/demo" className="inline-flex h-9 items-center rounded-md border border-line px-4 text-sm hover:border-accent/40">Try the guided demo</Link></div>}>
            Every number on this page is computed from the URLs you save. Nothing is shown until there is data, and no performance figures are ever invented.
          </EmptyState>
          {live && <div className="mt-4"><LocalStorageNote /></div>}
        </Card>
      ) : (<>
        <section aria-label="Campaign metrics" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Saved campaign URLs" value={stats.total} sub={`${stats.sources.length} source${stats.sources.length === 1 ? "" : "s"} · ${stats.mediums.length} medium${stats.mediums.length === 1 ? "" : "s"}`} />
          <Metric label="Unique campaigns" value={stats.uniqueCampaigns} sub="distinct utm_campaign values" />
          <Metric label="Required UTM present" value={stats.validRequired} tone="accent" sub="valid URL + source, medium, campaign" />
          <Metric label="With tagging issues" value={stats.withIssues} sub={`${stats.duplicates} duplicate${stats.duplicates === 1 ? "" : "s"}`} />
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Campaign health" description="Tagging quality of every saved URL. Not a performance measure." />
            <div className="card-pad space-y-3">
              <HealthBar clean={stats.clean} warn={analyzed.filter((r) => r.status === "warn").length} error={analyzed.filter((r) => r.status === "error").length} />
              {stats.issueCounts.length === 0
                ? <p className="flex items-center gap-2 text-sm text-accent"><CheckCircle2 className="h-4 w-4" aria-hidden />No tagging issues in this dataset.</p>
                : <>
                  <h3 className="label pt-1">Most common tagging issues</h3>
                  <ul className="space-y-1.5" aria-label="Most common tagging issues">
                    {stats.issueCounts.slice(0, 5).map((i) => (
                      <li key={i.code} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted">{ISSUE_LABEL[i.code]}</span><span className="numeral">{i.count}</span>
                      </li>))}
                  </ul>
                  <Link to={demo ? "/demo" : "/campaigns/reports"} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">{demo ? "Walk through fixing them in the demo" : "Open QA & Reports"} <ArrowRight className="h-3 w-3" aria-hidden /></Link>
                </>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Sources and mediums" description="Counts of saved URLs per value." />
            <div className="card-pad grid gap-6 sm:grid-cols-2">
              <Distribution title="Sources" items={stats.sources} empty="No utm_source values yet." />
              <Distribution title="Mediums" items={stats.mediums} empty="No utm_medium values yet." />
            </div>
          </Card>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader title="Recent campaign URLs" description="Most recently saved or changed." actions={demo && <Badge tone="dashed">Demo data</Badge>} />
            <ul className="divide-y divide-line">
              {stats.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name || r.baseUrl}</p>
                    <p className="truncate font-mono text-2xs text-muted">{[r.utm.utm_source, r.utm.utm_medium, r.utm.utm_campaign].map((v) => v || "—").join(" / ")}</p>
                  </div>
                  <QualityBadge status={r.status} />
                  <span className="text-2xs text-faint">{fmtDate(r.updatedUtc)}</span>
                </li>))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Recent imports" description="CSV imports into this dataset." />
            <div className="card-pad">
              {imports.length === 0 ? <p className="text-sm text-muted">No CSV imported yet. <Link to={demo ? "/demo" : "/campaigns/intelligence"} className="text-accent underline">Import one</Link> to see it here.</p> : (
                <ul className="space-y-2.5">
                  {imports.slice(0, 4).map((i) => (
                    <li key={i.at + i.file} className="text-sm">
                      <p className="truncate font-mono text-xs">{i.file}</p>
                      <p className="text-2xs text-muted">{fmtDate(i.at)} · {i.imported} imported · {i.rejected} rejected{i.skippedDuplicates ? ` · ${i.skippedDuplicates} duplicates skipped` : ""}</p>
                    </li>))}
                </ul>)}
            </div>
          </Card>
        </div>
        {live && <div className="mt-4"><LocalStorageNote /></div>}
      </>)}

      <Card className="mt-6">
        <div className="card-pad flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <p className="flex items-center gap-2 text-sm font-semibold"><ScanSearch className="h-4 w-4 text-faint" aria-hidden />Security Tools: URL Security Intelligence</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">A separate phishing-triage analyzer. Correctly tagged UTM links are not necessarily safe, so campaign quality and security assessment are never combined into one score.</p>
          </div>
          <Link to="/analyzer" className={btn}>Open Analyzer <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </div>
      </Card>
    </>
  );
}

function HealthBar({ clean, warn, error }: { clean: number; warn: number; error: number }) {
  const total = clean + warn + error || 1;
  const seg = [["Clean", clean, "bg-accent"], ["Warnings", warn, "bg-sev-medium"], ["Errors", error, "bg-sev-high"]] as const;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${clean} clean, ${warn} with warnings, ${error} with errors`}>
        {seg.map(([l, n, c]) => n > 0 && <span key={l} className={c} style={{ width: `${(n / total) * 100}%` }} />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {seg.map(([l, n, c]) => <li key={l} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${c}`} aria-hidden />{l} <span className="numeral text-ink">{n}</span></li>)}
      </ul>
    </div>
  );
}
