import { ArrowRight, FileUp, Link2, ScanSearch, ShieldCheck, Tags } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardHeader, EmptyState, Metric, PageHeader } from "@/components/ui/primitives";
import { LocalStorageNote } from "@/components/campaigns/shared";
import { analyzeRecords } from "@/lib/campaign/quality";
import { useCampaigns, useNaming } from "@/lib/campaign/store";
import { extractUtm } from "@/lib/campaign/utm";
import { listLocalIncidents, type LocalIncident } from "@/lib/localStore";
import { defang, fmtDate } from "@/lib/utils";

const btn = "inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-raised/70 px-4 text-sm font-medium transition hover:border-accent/40";

export default function CampaignHub() {
  const records = useCampaigns();
  const naming = useNaming();
  const analyzed = useMemo(() => analyzeRecords(records, naming), [records, naming]);
  const [incidents, setIncidents] = useState<LocalIncident[] | null>(null);
  useEffect(() => { let alive = true; listLocalIncidents().then((l) => alive && setIncidents(l)).catch(() => alive && setIncidents([])); return () => { alive = false; }; }, []);

  const campaigns = useMemo(() => new Set(records.map((r) => extractUtm(r.finalUrl)?.utm.utm_campaign.trim().toLowerCase()).filter(Boolean)).size, [records]);
  const withIssues = analyzed.filter((r) => r.issues.some((i) => i.code === "missing-required" || i.code === "invalid-url")).length;
  const urlIncidents = (incidents ?? []).filter((i) => i.inputType === "url");
  const needReview = urlIncidents.filter((i) => i.verdict !== "INSUFFICIENT EVIDENCE").length;

  const activity = useMemo(() => {
    const a = records.map((r) => ({ at: r.updatedUtc, kind: "campaign" as const, text: r.name || extractUtm(r.finalUrl)?.base || r.finalUrl, to: `/campaigns/studio?edit=${r.id}` }));
    const b = (incidents ?? []).map((i) => ({ at: i.createdUtc, kind: "security" as const, text: i.firstUrl ? defang(i.firstUrl) : `${i.inputType} analysis`, to: "/incidents" }));
    return [...a, ...b].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6);
  }, [records, incidents]);

  return (
    <>
      <PageHeader kicker="Campaigns · Overview" title="Unified URL Intelligence"
        description="Two separate questions about the same links. Are they tagged consistently? Are they suspicious? The answers are tracked independently: well-tagged links can still be malicious, and a suspicious link can be tagged perfectly."
        actions={<Link to="/" className="text-xs text-accent hover:underline">Research overview</Link>} />

      <div className="mb-6 flex flex-wrap gap-2">
        <Link to="/campaigns/studio" className={btn}><Link2 className="h-4 w-4 text-accent" aria-hidden />Create campaign URL</Link>
        <Link to="/campaigns/intelligence" className={btn}><FileUp className="h-4 w-4 text-accent" aria-hidden />Import a CSV</Link>
        <Link to="/analyzer" className={btn}><ScanSearch className="h-4 w-4 text-accent" aria-hidden />Analyze a suspicious URL</Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Campaign quality" description="Tagging hygiene of saved campaign URLs." actions={<Tags className="h-4 w-4 text-faint" aria-hidden />} />
          <div className="card-pad">
            {records.length === 0 ? (
              <EmptyState title="No campaign URLs saved">Build one in the Studio or import a CSV to see tagging quality here.</EmptyState>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Saved URLs" value={records.length} />
                <Metric label="Campaigns" value={campaigns} sub="unique utm_campaign" />
                <Metric label="Tag errors" value={withIssues} tone={withIssues ? undefined : "accent"} sub="missing UTM or invalid URL" />
              </div>)}
            <Link to="/campaigns/intelligence" className="mt-4 inline-flex items-center gap-1 text-xs text-accent hover:underline">Open Campaign Intelligence <ArrowRight className="h-3 w-3" aria-hidden /></Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="Security analysis" description="URL analyses you saved as incidents in this browser." actions={<ShieldCheck className="h-4 w-4 text-faint" aria-hidden />} />
          <div className="card-pad">
            {incidents && urlIncidents.length === 0 ? (
              <EmptyState title="No saved URL analyses">Analyze a URL and choose “Save incident” to track it here. Analyses you do not save are not counted.</EmptyState>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric label="Analyzed & saved" value={incidents ? urlIncidents.length : "…"} />
                <Metric label="Flagged or suspicious" value={incidents ? needReview : "…"} sub="rule verdict other than “insufficient evidence”" />
              </div>)}
            <Link to="/analyzer" className="mt-4 inline-flex items-center gap-1 text-xs text-accent hover:underline">Open Analyzer <ArrowRight className="h-3 w-3" aria-hidden /></Link>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Recent activity" description="Most recently saved or changed records, from this browser." />
        {activity.length === 0 ? <div className="card-pad"><EmptyState title="Nothing yet">Saved campaign URLs and incidents will appear here.</EmptyState></div> : (
          <ul className="divide-y divide-line">
            {activity.map((a, i) => (
              <li key={i}><Link to={a.to} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-raised/50 sm:px-5">
                <Badge tone={a.kind === "campaign" ? "accent" : "low"}>{a.kind === "campaign" ? "Campaign" : "Security"}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{a.text}</span>
                <span className="text-2xs text-faint">{fmtDate(a.at)}</span>
              </Link></li>))}
          </ul>)}
      </Card>
      <div className="mt-4"><LocalStorageNote /></div>
    </>
  );
}
