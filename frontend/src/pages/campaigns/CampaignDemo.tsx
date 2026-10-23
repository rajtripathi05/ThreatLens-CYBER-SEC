import { ArrowLeft, ArrowRight, RotateCcw, ScanSearch, ShieldQuestion } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Card, CardHeader, Dialog, Metric, PageHeader } from "@/components/ui/primitives";
import { DemoDataBanner, Distribution, QualityBadge } from "@/components/campaigns/shared";
import { DEMO_CAMPAIGN, DEMO_DESTINATION, DEMO_SAMPLE_CSV } from "@/lib/campaign/demoData";
import { analyzeRecords } from "@/lib/campaign/quality";
import { computeStats } from "@/lib/campaign/stats";
import { demoStore, useCampaigns, useNaming } from "@/lib/campaign/store";
import { cn } from "@/lib/utils";
import { CampaignLibrary } from "./CampaignIntelligence";
import { ReportsView } from "./CampaignReports";
import { StudioForm, type StudioFocus } from "./CampaignStudio";

const STEPS = [
  { key: "overview", title: "Explore", blurb: "See the sample campaign dataset and how healthy its tagging is." },
  { key: "build", title: "Build", blurb: "Edit the fields and watch the final URL change live." },
  { key: "validate", title: "Validate", blurb: "The real validation rules run on your draft against the demo library." },
  { key: "save", title: "Save", blurb: "Save the corrected URL into the demo workspace." },
  { key: "browse", title: "Intelligence", blurb: "Search, filter, sort and open any campaign to inspect its quality checks." },
  { key: "transfer", title: "Import / export", blurb: "Preview a CSV import, then export the library and a validation report." },
  { key: "security", title: "Security", blurb: "Send a campaign URL to the separate security Analyzer." },
] as const;

const STUDIO_DEFAULTS = {
  dest: DEMO_DESTINATION,
  // "LinkedIn" is intentionally mis-cased so the validation step has a real, fixable finding.
  utm: { utm_source: "LinkedIn", utm_medium: "social", utm_campaign: DEMO_CAMPAIGN, utm_content: "launch_week" },
  name: "LinkedIn · launch week",
};

export default function CampaignDemo() {
  const [params, setParams] = useSearchParams();
  const idx = Math.min(STEPS.length - 1, Math.max(0, (Number(params.get("step")) || 1) - 1));
  const step = STEPS[idx];
  const [runKey, setRunKey] = useState(0);
  const mine = useCampaigns();
  const [confirmReset, setConfirmReset] = useState(false);
  const go = (i: number) => setParams({ step: String(Math.min(STEPS.length, Math.max(1, i + 1))) }, { replace: true });

  function reset() {
    demoStore.reset(); setRunKey((k) => k + 1); setConfirmReset(false); go(0);
  }

  const inStudio = idx >= 1 && idx <= 3;
  const inLibrary = idx === 4 || idx === 5;
  const studioFocus: StudioFocus = idx === 1 ? "build" : idx === 2 ? "validate" : "save";

  return (
    <>
      <PageHeader kicker="Demo Workspace" title="Guided demo: ThreatLens Product Launch"
        description="A fictional launch campaign, walked through with the real Studio, validator, Library and CSV tools. Everything runs in your browser on sample data. Nothing is fetched and your saved campaigns are never touched."
        actions={<Button onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" aria-hidden />Reset demo</Button>} />
      <DemoDataBanner />

      <nav aria-label="Demo steps" className="mb-2">
        <ol className="flex gap-1.5 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <li key={s.key} className="min-w-fit flex-1">
              <button onClick={() => go(i)} aria-current={i === idx ? "step" : undefined}
                className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  i === idx ? "border-accent bg-accent/10 text-ink" : i < idx ? "border-line text-muted hover:border-faint" : "border-line text-faint hover:text-muted")}>
                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-2xs", i <= idx ? "bg-accent/20 text-accent" : "bg-raised")}>{i + 1}</span>
                <span className="whitespace-nowrap font-medium">{s.title}</span>
              </button>
            </li>))}
        </ol>
      </nav>
      <div className="mb-5 h-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Demo progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={idx + 1}>
        <div className="h-full bg-accent transition-all" style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} />
      </div>

      <section aria-labelledby="step-title" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface/60 px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-accent">Step {idx + 1} of {STEPS.length}</p>
          <h2 id="step-title" className="text-lg font-semibold">{step.title}</h2>
          <p className="text-sm text-muted">{step.blurb}</p>
        </div>
        <div className="flex gap-2">
          <Button disabled={idx === 0} onClick={() => go(idx - 1)}><ArrowLeft className="h-4 w-4" aria-hidden />Back</Button>
          <Button variant="primary" disabled={idx === STEPS.length - 1} onClick={() => go(idx + 1)}>Next<ArrowRight className="h-4 w-4" aria-hidden /></Button>
        </div>
      </section>

      <div key={runKey}>
        {idx === 0 && <StepOverview />}
        {inStudio && (<>
          {idx === 1 && <Alert tone="info" title="Try it" className="mb-4">The destination and values are prefilled. Change the campaign or content, or pick a suggested medium, and the Generated URL updates immediately. Then press Next.</Alert>}
          {idx === 2 && <Alert tone="info" title="These findings are real" className="mb-4">“LinkedIn” has a capital L and the demo library already holds a lowercase “linkedin”. The validator reports the case and spelling-variant findings and offers a fix. Click the suggested fix, then press Next.</Alert>}
          {idx === 3 && <Alert tone="info" title="Save to the demo workspace" className="mb-4">Press <strong>Save to library</strong>. It is written to the demo store only; your own campaigns are not affected. Then press Next to find it in the library.</Alert>}
          <StudioForm store={demoStore} embedded defaults={STUDIO_DEFAULTS} focus={studioFocus} />
        </>)}
        {inLibrary && (<>
          {idx === 4 && <Alert tone="info" title="Explore" className="mb-4">Search “linkedin”, filter Status to Errors, sort by Updated, or open a row with Inspect to see its UTM parameters, quality checks and suggested fixes.</Alert>}
          {idx === 5 && <Alert tone="info" title="Import and export" className="mb-4">Download the sample CSV, or press <strong>Preview sample import</strong>. The sample contains 3 good rows, 1 duplicate of an existing demo row and 2 broken rows, so the preview shows real rejection and duplicate handling. Import it, then export the library and the validation report below.</Alert>}
          <CampaignLibrary store={demoStore} embedded sampleCsv={{ name: "threatlens-demo-sample.csv", text: DEMO_SAMPLE_CSV }} highlight={idx === 5 ? "transfer" : "browse"} />
          {idx === 5 && <div className="mt-6"><h3 className="mb-3 text-base font-semibold">Validation report for the demo dataset</h3><ReportsView store={demoStore} /></div>}
        </>)}
        {idx === 6 && <StepSecurity />}
      </div>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset} title="Reset the demo?" description="This restores the original fictional sample data and clears demo-only changes and import history. Your saved campaigns are not affected."
        footer={<><Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="primary" onClick={reset}>Reset demo</Button></>} />
      <p className="mt-6 text-2xs text-faint">Your own library holds {mine.length} saved URL{mine.length === 1 ? "" : "s"} and is separate from everything on this page.</p>
    </>
  );
}

function StepOverview() {
  const records = useCampaigns(demoStore);
  const naming = useNaming();
  const rows = useMemo(() => analyzeRecords(records, naming), [records, naming]);
  const stats = useMemo(() => computeStats(rows), [rows]);
  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Demo metrics">
        <Metric label="Sample URLs" value={stats.total} sub="fictional, demo only" />
        <Metric label="Campaigns" value={stats.uniqueCampaigns} />
        <Metric label="Required UTM present" value={stats.validRequired} tone="accent" />
        <Metric label="With tagging issues" value={stats.withIssues} sub={`${stats.duplicates} duplicates`} />
      </section>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Sample campaign URLs" description="Source / medium / campaign for each fictional link." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left" aria-label="Demo campaign URLs">
              <thead><tr><th className="th">Label</th><th className="th">Source</th><th className="th">Medium</th><th className="th">Quality</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}><td className="td max-w-[16rem] truncate">{r.name}</td><td className="td font-mono text-xs">{r.utm.utm_source || "—"}</td><td className="td font-mono text-xs">{r.utm.utm_medium || "—"}</td><td className="td"><QualityBadge status={r.status} /></td></tr>))}</tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Sources" description="Counted from the sample dataset." />
          <div className="card-pad"><Distribution title="Sources" items={stats.sources} empty="No sources." /></div>
        </Card>
      </div>
      <p className="text-xs text-muted">Some of these links contain deliberate mistakes (mixed case, a space, a missing medium, a duplicate) so the validator has something real to find in the next steps.</p>
    </div>
  );
}

function StepSecurity() {
  const records = useCampaigns(demoStore);
  const [id, setId] = useState("");
  const chosen = records.find((r) => r.id === id) ?? records[0];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Security is a separate question" description="Tagging quality and URL safety are never merged into one score." actions={<ShieldQuestion className="h-4 w-4 text-faint" aria-hidden />} />
        <div className="card-pad space-y-4">
          <p className="text-sm text-muted">A perfectly tagged URL can still lead somewhere malicious, and UTM parameters are trivial to add to any link. A clean campaign-quality result therefore says <strong className="text-ink">nothing</strong> about whether the destination is safe.</p>
          {chosen ? (<>
            <div>
              <label htmlFor="sec-pick" className="label mb-1.5 block">Pick a demo campaign URL</label>
              <select id="sec-pick" className="field max-w-xl" value={chosen.id} onChange={(e) => setId(e.target.value)}>{records.map((r) => <option key={r.id} value={r.id}>{r.name || r.finalUrl}</option>)}</select>
            </div>
            <p className="break-all rounded-md border border-line bg-bg/60 p-3 font-mono text-xs text-muted">{chosen.finalUrl}</p>
            <div className="flex flex-wrap gap-2">
              <Link to={`/analyzer?url=${encodeURIComponent(chosen.finalUrl)}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-dim"><ScanSearch className="h-4 w-4" aria-hidden />Send to Analyzer</Link>
              <Link to="/security/tour" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm hover:border-accent/40">Security walkthrough</Link>
            </div>
            <p className="text-xs text-muted">The Analyzer only pre-fills the URL. It does not analyze or fetch anything until you press Analyze, and the page it scores is never visited.</p>
          </>) : <p className="text-sm text-muted">The demo library is empty. Reset the demo to restore the sample data.</p>}
        </div>
      </Card>
    </div>
  );
}
