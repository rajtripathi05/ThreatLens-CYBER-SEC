import { ArrowRight, Database, FlaskConical, History, PlayCircle, ScanSearch, ScrollText, Server, ShieldCheck, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DecisionBadge, SourceBadge } from "@/components/badges";
import { LabelStrip } from "@/components/EvidenceLabel";
import { OfflineNotice } from "@/components/ModeBanner";
import { Alert, Card, CardHeader, EmptyState, Spinner } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { useExperimentIndex, useExperimentSet } from "@/hooks/useExperiments";
import { api } from "@/lib/api";
import { loadDemo } from "@/lib/demo";
import { PRESETS, presetRows, shortcutFinding } from "@/lib/findings";
import { LIMITATIONS } from "@/lib/limitations";
import { val } from "@/lib/research";
import type { IncidentSummary } from "@/lib/types";
import { defang, fmtDate, num, pct, shortHash } from "@/lib/utils";

export default function Overview() {
  const { mode, apiState, apiError, status, refresh } = useApp();
  const idx = useExperimentIndex();
  const avail = (id: string) => (idx.data?.find((x) => x.id === id && x.available) ? id : null);
  const clf = useExperimentSet(avail("real-classifier"));
  const sim = useExperimentSet(avail(PRESETS.find((x) => x.id === "noise10")!.setId));
  const [incidents, setIncidents] = useState<IncidentSummary[] | null>(null);
  const [incErr, setIncErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setIncidents(null); setIncErr(null);
    if (mode === "demo") { loadDemo().then((d) => alive && setIncidents(d.incidents.slice(0, 3))).catch(() => alive && setIncidents([])); return () => { alive = false; }; }
    if (apiState !== "online") return;
    api.incidents({ sort: "newest" }).then((r) => alive && setIncidents(r.items.slice(0, 5))).catch((e) => alive && setIncErr(e.message));
    return () => { alive = false; };
  }, [mode, apiState]);

  const live = mode === "live";
  const demo = mode === "demo";
  const modelKind = status?.model.kind;
  const sc = shortcutFinding(clf.data).find((c) => c.protocol === "stratified") ?? shortcutFinding(clf.data)[0];
  const noise = PRESETS.find((p) => p.id === "noise10")!;
  const nRows = presetRows(sim.data, noise, "all");
  const mlFpr = val(nRows.find((r) => r.method === "ml_only"), "fpr");
  const naiveFpr = val(nRows.find((r) => r.method === "naive_fusion"), "fpr");
  const raFpr = val(nRows.find((r) => r.method === "reliability_aware"), "fpr");
  const raReview = val(nRows.find((r) => r.method === "reliability_aware"), "review_rate");

  return (
    <>
      <section aria-labelledby="hero" className="fade-in mb-8 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-stretch">
        <div className="relative flex flex-col justify-center py-2">
          <div className="mb-4 flex flex-wrap items-center gap-2"><span className="eyebrow">01 · Research overview</span><SourceBadge kind={live ? "live" : "demo"} /></div>
          <h1 id="hero" className="max-w-2xl text-3xl font-semibold leading-[1.08] sm:text-[2.6rem]">
            Phishing triage that shows its evidence and <span className="text-accent">admits its uncertainty.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-[0.95rem] leading-relaxed text-muted">
            ThreatLens scores URLs with a character n-gram classifier, combines that score with threat-intelligence lookups, and decides whether to flag, clear or route an item to a person.
            Controlled experiments then degrade the intelligence feed on purpose to ask one question: <em className="not-italic text-ink">does a reliability-aware policy hold up when the feed is missing or wrong?</em>
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/demo" className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-ink shadow-glow transition hover:bg-accent-dim active:translate-y-px"><PlayCircle className="h-4 w-4" aria-hidden />Start Research Demo</Link>
            <Link to="/analyzer" className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-raised/70 px-4 text-sm font-medium transition hover:border-accent/40"><ScanSearch className="h-4 w-4 text-accent" aria-hidden />Analyze a URL</Link>
            <Link to="/evidence" className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-raised/70 px-4 text-sm font-medium transition hover:border-accent/40"><ScrollText className="h-4 w-4 text-accent" aria-hidden />Explore Evidence</Link>
            <Link to="/research" className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-raised/70 px-4 text-sm font-medium transition hover:border-accent/40"><FlaskConical className="h-4 w-4 text-accent" aria-hidden />Open Research Lab</Link>
          </div>
          <dl className="mt-7 grid max-w-2xl grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
            {[["Evaluated on real data", "URL-string classifier on held-out PhiUSIIL URLs", "text-accent"],
              ["Simulated", "Threat-intel feed: missing, noisy, shuffled, oracle", "text-sim"],
              ["Not validated", "Email-body classification · hosted deployment", "text-sev-medium"]].map(([k, v, c]) => (
              <div key={k} className="bg-surface px-3.5 py-3"><dt className={`font-mono text-[0.6rem] uppercase tracking-[0.16em] ${c}`}>{k}</dt><dd className="mt-1 text-xs text-muted">{v}</dd></div>))}
          </dl>
        </div>
        <ShortcutHero cell={sc} loading={idx.loading || clf.loading} demo={demo} />
      </section>

      {live && apiState === "offline" && <div className="mb-5"><OfflineNotice error={apiError} onRetry={() => void refresh()} what="Status, results and incidents come from the Python API. The guided demo can run on clearly labelled fixtures." /></div>}

      <section aria-labelledby="sys" className="mb-6">
        <h2 id="sys" className="mb-3 text-sm font-semibold text-muted">System status</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatusTile icon={Server} title="API" value={!live ? "Not used" : apiState === "online" ? `Online · v${status?.api_version}` : apiState === "checking" ? "Connecting…" : "Unreachable"}
            tone={!live ? "demo" : apiState === "online" ? "ok" : apiState === "checking" ? "idle" : "bad"} sub={!live ? "Demo mode uses bundled fixtures" : undefined} />
          <StatusTile icon={ShieldCheck} title="URL model" value={!live ? "Not loaded" : modelKind === "real_phiusiil" ? "Real-data model" : modelKind === "synthetic_demo" ? "Synthetic demo model" : modelKind === "unavailable" ? "No model trained" : "—"}
            tone={modelKind === "real_phiusiil" ? "ok" : modelKind === "synthetic_demo" ? "demo" : modelKind === "unavailable" ? "bad" : "idle"} sub={status?.model.detail} />
          <StatusTile icon={Database} title="Dataset (PhiUSIIL)" value={!live ? "—" : status?.dataset.phiusiil_present ? `Present · ${status.dataset.rows?.toLocaleString()} rows` : "Not downloaded on server"}
            tone={status?.dataset.phiusiil_present ? "ok" : "idle"} sub={status?.dataset.sha256 ? `sha256 ${shortHash(status.dataset.sha256)}` : undefined} />
          <StatusTile icon={Waypoints} title="Threat-intel snapshot" value={!live ? "—" : status?.threat_intel.loaded ? `${status.threat_intel.entries} indicators` : "Not loaded"}
            tone={status?.threat_intel.loaded ? (status.threat_intel.is_demo ? "demo" : "ok") : "idle"} sub={status?.threat_intel.is_demo ? "Demo data on reserved .example names; not real intelligence" : status?.threat_intel.detail} />
        </div>
      </section>

      <section aria-labelledby="find" className="mb-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="find" className="text-sm font-semibold text-muted">Research findings (read from saved result files)</h2>
          <Link to="/research" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Research Lab <ArrowRight className="h-3 w-3" aria-hidden /></Link>
        </div>
        {idx.loading && <Spinner label="Loading result index" />}
        {idx.error && !idx.loading && live && apiState === "online" && <Alert tone="error">{idx.error}</Alert>}
        {idx.data && (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="card-pad">
              <LabelStrip kinds={demo ? ["real", "fixture"] : ["real"]} />
              <p className="mt-3 text-sm font-semibold">Raw-URL score vs normalised URL</p>
              {sc ? (<>
                <p className="mt-2 font-mono text-2xl tabular-nums">{num(sc.raw, 3)} <span className="text-faint">→</span> {num(sc.stripped, 3)}</p>
                <p className="mt-1 text-xs text-muted">F1 falls {sc.points.toFixed(1)} points when only the scheme and “www.” are removed. Suggests formatting shortcuts; does not prove leakage.</p>
              </>) : <p className="mt-2 text-sm text-muted">Classifier evaluation not generated here. No figure shown.</p>}
            </Card>
            <Card className="card-pad">
              <LabelStrip kinds={demo ? ["synthetic", "oracle", "fixture"] : ["synthetic", "oracle"]} />
              <p className="mt-3 text-sm font-semibold">Naive fusion with 10% false matches</p>
              {naiveFpr != null && raFpr != null && mlFpr != null ? (<>
                <p className="mt-2 font-mono text-2xl tabular-nums">{pct(mlFpr, 2)} <span className="text-faint">→</span> {pct(naiveFpr, 2)}</p>
                <p className="mt-1 text-xs text-muted">False-positive rate, ML only → naive fusion, with injected false matches. Reliability-aware triage stayed at {pct(raFpr, 2)}.</p>
              </>) : <p className="mt-2 text-sm text-muted">Simulation results not generated here.</p>}
            </Card>
            <Card className="card-pad">
              <LabelStrip kinds={demo ? ["synthetic", "oracle", "fixture"] : ["synthetic", "oracle"]} />
              <p className="mt-3 text-sm font-semibold">The cost: manual review</p>
              {raReview != null ? (<>
                <p className="mt-2 font-mono text-2xl tabular-nums">{pct(raReview, 1)}</p>
                <p className="mt-1 text-xs text-muted">of items sent to a person in the same scenario. The oracle-derived feed is a best case, not independent intelligence.</p>
              </>) : <p className="mt-2 text-sm text-muted">Simulation results not generated here.</p>}
            </Card>
          </div>
        )}
        {idx.data && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {idx.data.map((x) => (
              <li key={x.id} className="rounded-md border border-line bg-bg/40 px-2.5 py-1.5 text-2xs">
                <span className="text-muted">{x.title}</span>{" "}
                <span className="font-mono text-faint">{x.available ? `${x.run_id} · ${fmtDate(x.finished_utc)}` : "not generated yet"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader title="Limitations" description="Read these before quoting any number." />
          <ul className="list-disc space-y-1.5 px-9 py-4 text-sm text-muted">{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
        </Card>

        <Card>
          <CardHeader title={demo ? "Sample incidents (demo fixtures)" : "Recent incidents"} actions={<Link to="/incidents" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">All incidents <ArrowRight className="h-3 w-3" aria-hidden /></Link>} />
          <div className="p-0">
            {incidents === null && !incErr && live && apiState !== "online" && <p className="card-pad text-sm text-muted">Connect the API to list saved incidents.</p>}
            {incidents === null && !incErr && (mode === "demo" || apiState === "online") && <div className="card-pad"><Spinner /></div>}
            {incErr && <div className="card-pad"><Alert tone="error">{incErr}</Alert></div>}
            {incidents && incidents.length === 0 && <div className="card-pad"><EmptyState icon={<History className="h-7 w-7" aria-hidden />} title="No saved incidents">Analyse something and choose “Save incident”.</EmptyState></div>}
            {incidents && incidents.length > 0 && (
              <ul className="divide-y divide-line">
                {incidents.map((i) => (
                  <li key={i.case_id}><Link to={`/incidents/${i.case_id}`} className="block px-4 py-3 hover:bg-raised/50 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2"><DecisionBadge decision={i.verdict} />{i.origin === "demo-fixture" && <SourceBadge kind="demo" />}<span className="font-mono text-2xs text-faint">{i.case_id}</span></div>
                    <p className="mt-1 truncate font-mono text-xs text-muted">{i.first_url ? defang(i.first_url) : `${i.input_kind} · no URLs`}</p>
                  </Link></li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <QuickLink to="/evidence" icon={ScrollText} title="Evidence Explorer" text="Ordered ledger of every signal behind the latest decision." />
        <QuickLink to="/incidents" icon={History} title="Incident History" text="Saved cases with PDF and JSON export." />
        <QuickLink to="/methodology" icon={Database} title="Methodology & data" text="Dataset provenance, threat model, limitations, reproduction commands." />
      </div>
    </>
  );
}

/** Editorial panel for the headline real-data finding. Every number is read from the saved classifier run. */
function ShortcutHero({ cell, loading, demo }: { cell: ReturnType<typeof shortcutFinding>[number] | undefined; loading: boolean; demo: boolean }) {
  return (
    <Card className="relative overflow-hidden">
      <svg aria-hidden className="pointer-events-none absolute -right-10 -top-6 h-48 w-80 opacity-40" viewBox="0 0 320 190" fill="none">
        <path d="M0 150 C40 150 50 40 90 40 S140 120 170 120 S220 20 260 30 S300 90 320 90" stroke="#2DD4BF" strokeOpacity=".25" />
        <path d="M0 170 C50 170 70 90 110 95 S170 160 210 150 S280 70 320 80" stroke="#C4A1FF" strokeOpacity=".18" />
        {[90, 170, 260].map((x, i) => <circle key={x} cx={x} cy={[40, 120, 30][i]} r="2.5" fill="#2DD4BF" fillOpacity=".5" />)}
      </svg>
      <div className="relative card-pad sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-2xs uppercase tracking-[0.16em] text-faint">Headline finding · shortcut sensitivity</p>
          <LabelStrip kinds={demo ? ["real", "fixture"] : ["real"]} />
        </div>
        {loading && <div className="mt-6"><Spinner label="Reading the saved classifier run" /></div>}
        {!loading && !cell && <div className="mt-5"><EmptyState title="Classifier evaluation not available">No saved real-data run was found, so no figure is shown here.</EmptyState></div>}
        {!loading && cell && (<>
          <p className="mt-4 font-display text-lg font-semibold leading-snug">Removing only <span className="font-mono text-base text-accent">http(s)://</span> and <span className="font-mono text-base text-accent">www.</span> changes the score substantially.</p>
          <div className="mt-5 space-y-4">
            {([["Raw URL", cell.raw, cell.rawSd, "bg-accent"], ["Normalised URL", cell.stripped, cell.strippedSd, "bg-sev-medium"]] as const).map(([k, v, s, c]) => (
              <div key={k}>
                <div className="flex items-baseline justify-between"><span className="text-xs text-muted">{k}</span>
                  <span className="numeral text-xl">{num(v, 3)}<span className="ml-1.5 font-mono text-2xs font-normal text-faint">F1{s > 0 ? ` ± ${num(s, 3)}` : ""}</span></span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line/70"><div className={`grow-x h-full rounded-full ${c}`} style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></div>
              </div>))}
          </div>
          <div className="mt-5 flex items-end justify-between gap-4 border-t border-line pt-4">
            <div><p className="label">Change in F1</p><p className="numeral mt-0.5 text-4xl text-sev-medium">−{cell.points.toFixed(1)}<span className="ml-1 text-base text-muted">pts</span></p></div>
            <p className="max-w-[15rem] text-right text-2xs leading-relaxed text-muted">{cell.protocol} split · {cell.seeds.length} seed{cell.seeds.length === 1 ? "" : "s"}{cell.nTest ? ` · ${cell.nTest.toLocaleString()} test URLs` : ""}</p>
          </div>
          <p className="mt-3 rounded-md border border-sev-medium/25 bg-sev-medium/[0.06] px-3 py-2 text-xs text-ink/80"><strong className="text-sev-medium">Interpretation.</strong> Suggests the raw-URL score leans on formatting habits in the dataset. It does not prove leakage or real-world failure.</p>
        </>)}
      </div>
    </Card>
  );
}

function StatusTile({ icon: Icon, title, value, sub, tone }: { icon: typeof Server; title: string; value: string; sub?: string; tone: "ok" | "bad" | "demo" | "idle" }) {
  const dot = { ok: "bg-accent", bad: "bg-sev-high", demo: "bg-demo", idle: "bg-faint" }[tone];
  return (
    <Card className="card-pad">
      <div className="flex items-center justify-between"><p className="label">{title}</p><Icon className="h-4 w-4 text-faint" aria-hidden /></div>
      <p className="mt-2 flex items-center gap-2 text-sm font-semibold"><span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />{value}</p>
      {sub && <p className="mt-1 line-clamp-3 text-xs text-muted">{sub}</p>}
    </Card>
  );
}
function QuickLink({ to, icon: Icon, title, text }: { to: string; icon: typeof Server; title: string; text: string }) {
  return (
    <Link to={to} className="group card card-pad transition-colors hover:border-accent/50">
      <Icon className="h-5 w-5 text-accent" aria-hidden />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted">{text}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Open <ArrowRight className="h-3 w-3" aria-hidden /></span>
    </Link>
  );
}
