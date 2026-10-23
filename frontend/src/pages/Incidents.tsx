import { ArrowLeft, FileJson, FileText, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DecisionBadge, SeverityBadge, SourceBadge, TIBadge } from "@/components/badges";
import { LocalIncidentsCard } from "@/components/LocalIncidentsCard";
import { OfflineNotice } from "@/components/ModeBanner";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { api, ApiError, describeError, getIncidentToken, setIncidentToken } from "@/lib/api";
import { loadDemo } from "@/lib/demo";
import type { IncidentRecord, IncidentSummary } from "@/lib/types";
import { defang, downloadBlob, fmtDate } from "@/lib/utils";

export default function Incidents() {
  const { id } = useParams();
  return id ? <Detail id={id} /> : <List />;
}

function useIncidentSource() {
  const { mode, apiState } = useApp();
  return { mode, ready: mode === "demo" || apiState === "online", apiState };
}

function List() {
  const { mode, ready, apiState } = useIncidentSource();
  const { apiError, refresh } = useApp();
  const [items, setItems] = useState<IncidentSummary[] | null>(null);
  const [error, setError] = useState<{ msg: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [verdict, setVerdict] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [note, setNote] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [token, setToken] = useState(getIncidentToken());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setLoading(true); setError(null);
    const p = mode === "demo"
      ? loadDemo().then((d) => ({ items: d.incidents as IncidentSummary[], note: "Demo fixtures are bundled with the site and are not saved cases." }))
      : api.incidents({ q, verdict, status, sort }).then((r) => ({ items: r.items, note: r.persistence_note }));
    p.then((r) => { if (!alive) return; setItems(r.items); setNote(r.note); })
      .catch((e) => alive && setError({ msg: describeError(e), code: e instanceof ApiError ? e.code : undefined }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [mode, ready, q, verdict, status, sort, tick]);

  const shown = useMemo(() => {
    if (mode !== "demo" || !items) return items;
    const rank = { high: 0, medium: 1, low: 2 } as const;
    let r = items.filter((i) => (!verdict || i.verdict === verdict) && (!status || i.status === status) &&
      (!q || i.case_id.toLowerCase().includes(q.toLowerCase()) || (i.first_url ?? "").toLowerCase().includes(q.toLowerCase())));
    r = [...r].sort(sort === "oldest" ? (a, b) => a.created_utc.localeCompare(b.created_utc) : sort === "severity" ? (a, b) => rank[a.severity] - rank[b.severity] || b.score - a.score : sort === "score" ? (a, b) => b.score - a.score : (a, b) => b.created_utc.localeCompare(a.created_utc));
    return r;
  }, [items, mode, q, verdict, status, sort]);

  const clearAll = useCallback(async () => {
    try { await api.clearIncidents(); setClearOpen(false); setTick((t) => t + 1); } catch (e) { setError({ msg: describeError(e) }); setClearOpen(false); }
  }, []);

  return (
    <>
      <PageHeader kicker="05 · Case records" title="Incident History" eyebrow={<SourceBadge kind={mode === "live" ? "live" : "demo"} />}
        description="Cases you chose to save from the Analyzer. Raw email bodies are stored only when you explicitly opted in."
        actions={mode === "live" ? <Button variant="danger" size="sm" onClick={() => setClearOpen(true)} disabled={!items?.length}><Trash2 className="h-3.5 w-3.5" aria-hidden />Clear all</Button> : undefined} />

      {mode === "live" && apiState === "offline" && <OfflineNotice error={apiError} onRetry={() => void refresh()} what="Remote incidents are stored by the Python API and cannot be listed while it is unreachable. Incidents you saved locally are listed below." />}
      {mode === "live" && <LocalIncidentsCard />}
      {mode === "demo" && <Alert tone="warn" title="Demo fixtures" className="mb-4">These sample incidents ship with the website. They are not saved cases and cannot be changed.</Alert>}

      {ready && (
        <>
          <Card className="mb-4 card-pad">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
              <div className="relative">
                <label htmlFor="inc-q" className="sr-only">Search incidents</label>
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-faint" aria-hidden />
                <input id="inc-q" className="field pl-9" placeholder="Search case ID or URL" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <Select id="inc-v" label="Outcome" value={verdict} onChange={setVerdict} options={[["", "All outcomes"], ["phishing", "Likely phishing"], ["review", "Needs review"], ["benign", "No strong evidence"]]} />
              <Select id="inc-s" label="Status" value={status} onChange={setStatus} options={[["", "All statuses"], ["open", "Open"], ["triaged", "Triaged"], ["closed", "Closed"]]} />
              <Select id="inc-o" label="Sort" value={sort} onChange={setSort} options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["severity", "Severity"], ["score", "Risk score"]]} />
            </div>
          </Card>

          {error?.code === "token_required" && (
            <Alert tone="warn" title="Access token required" className="mb-4">
              <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setIncidentToken(token); setTick((t) => t + 1); }}>
                <label htmlFor="tok" className="sr-only">Incident access token</label>
                <input id="tok" type="password" className="field max-w-xs" value={token} onChange={(e) => setToken(e.target.value)} placeholder="X-ThreatLens-Token" autoComplete="off" />
                <Button type="submit" size="md">Use token</Button>
              </form>
              <p className="mt-1 text-xs text-muted">Kept in this tab&apos;s session storage only.</p>
            </Alert>
          )}
          {error && error.code !== "token_required" && <Alert tone="error" className="mb-4">{error.msg}</Alert>}
          {loading && !items && <Spinner label="Loading incidents" />}
          {shown && shown.length === 0 && !loading && !error && (
            <EmptyState title={q || verdict || status ? "No incidents match these filters" : "No saved incidents yet"}>
              {q || verdict || status ? "Clear the filters to see everything." : <>Analyse a URL or email, then choose “Save incident”. <Link to="/analyzer" className="text-accent underline">Open the Analyzer</Link>.</>}
            </EmptyState>
          )}
          {shown && shown.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[46rem]">
                <caption className="sr-only">Saved incidents</caption>
                <thead><tr><th className="th" scope="col">Case</th><th className="th" scope="col">Outcome</th><th className="th" scope="col">Severity</th><th className="th" scope="col">Status</th><th className="th" scope="col">First URL</th><th className="th" scope="col">Created</th></tr></thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.case_id} className="hover:bg-raised/40">
                      <td className="td"><Link to={`/incidents/${i.case_id}`} className="font-mono text-xs text-accent hover:underline">{i.case_id}</Link>
                        <div className="mt-1 flex gap-1">{i.origin === "demo-fixture" && <SourceBadge kind="demo" />}{i.model_trained_on_synthetic && <Badge tone="sim">synthetic model</Badge>}{i.raw_saved && <Badge tone="medium">raw body stored</Badge>}</div></td>
                      <td className="td"><DecisionBadge decision={i.verdict} /></td>
                      <td className="td"><SeverityBadge severity={i.severity} /></td>
                      <td className="td text-xs capitalize text-muted">{i.status}</td>
                      <td className="td max-w-[16rem] truncate font-mono text-xs text-muted">{i.first_url ? defang(i.first_url) : "—"}</td>
                      <td className="td whitespace-nowrap text-xs text-muted">{fmtDate(i.created_utc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {note && <p className="mt-3 text-xs text-faint">{note}</p>}
        </>
      )}
      <Dialog open={clearOpen} onOpenChange={setClearOpen} title="Delete all incidents?" description="This permanently removes every saved incident and any stored raw email bodies from the server database. It cannot be undone."
        footer={<><Button variant="secondary" onClick={() => setClearOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => void clearAll()}>Delete everything</Button></>} />
    </>
  );
}

function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div><label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
  );
}

function Detail({ id }: { id: string }) {
  const { mode, ready } = useIncidentSource();
  const nav = useNavigate();
  const [rec, setRec] = useState<IncidentRecord | null>(null);
  const [error, setError] = useState<{ msg: string; notFound: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setRec(null); setError(null);
    const p = mode === "demo"
      ? loadDemo().then((d) => { const f = d.incidents.find((x) => x.case_id === id); if (!f) throw new ApiError(404, "incident_not_found", `Demo incident ${id} does not exist.`); return { ...f.record, origin: "demo-fixture" as const }; })
      : api.incident(id);
    p.then((r) => alive && setRec(r)).catch((e) => alive && setError({ msg: describeError(e), notFound: e instanceof ApiError && e.status === 404 }));
    return () => { alive = false; };
  }, [id, mode, ready]);

  async function exportAs(fmt: "json" | "pdf") {
    if (!rec) return;
    setBusy(fmt);
    try {
      if (mode === "demo") {
        if (fmt === "pdf") return;
        downloadBlob(new Blob([JSON.stringify(rec, null, 2)], { type: "application/json" }), `${id}.demo.json`);
      } else downloadBlob(await api.exportIncident(id, fmt), `${id}.${fmt}`);
    } catch (e) { setError({ msg: describeError(e), notFound: false }); } finally { setBusy(null); }
  }
  async function setStatus(status: string) {
    try { await api.patchIncident(id, { status }); setRec((r) => (r ? { ...r, status } : r)); } catch (e) { setError({ msg: describeError(e), notFound: false }); }
  }
  async function remove() {
    try { await api.deleteIncident(id); nav("/incidents"); } catch (e) { setError({ msg: describeError(e), notFound: false }); setDelOpen(false); }
  }

  const demo = mode === "demo";
  return (
    <>
      <Link to="/incidents" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />All incidents</Link>
      {!ready && <Alert tone="info">Connect the API (or switch to demo mode) to view incidents.</Alert>}
      {ready && !rec && !error && <Spinner label="Loading incident" />}
      {error && (
        <Alert tone={error.notFound ? "warn" : "error"} title={error.notFound ? "Incident unavailable" : "Error"}>
          {error.msg} {error.notFound && "It may have been deleted, or the server database was reset (free hosts can erase local storage)."}
        </Alert>
      )}
      {rec && (
        <div className="space-y-5">
          <PageHeader kicker="05 · Case record" title={`Incident ${rec.case_id}`} eyebrow={<>{demo ? <SourceBadge kind="demo" /> : <Badge tone="accent">Saved case</Badge>}{rec.model_trained_on_synthetic && <Badge tone="sim">Synthetic demo model</Badge>}</>}
            description={`Created ${fmtDate(rec.created_utc)} · model ${rec.model_version ?? "unknown"} · ${rec.input_kind}`}
            actions={<>
              <Button size="sm" onClick={() => void exportAs("json")} loading={busy === "json"}><FileJson className="h-3.5 w-3.5" aria-hidden />JSON</Button>
              <Button size="sm" onClick={() => void exportAs("pdf")} loading={busy === "pdf"} disabled={demo} title={demo ? "PDF export needs the live API" : undefined}><FileText className="h-3.5 w-3.5" aria-hidden />PDF</Button>
              {!demo && <Button size="sm" variant="danger" onClick={() => setDelOpen(true)}><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete</Button>}
            </>} />
          {demo && <Alert tone="warn">This is a bundled demo fixture, not a saved case. PDF export and edits are disabled.</Alert>}
          <Card className="card-pad">
            <div className="flex flex-wrap items-center gap-3"><DecisionBadge decision={rec.verdict} /><SeverityBadge severity={rec.severity} />
              <span className="text-sm text-muted">Heuristic score <span className="font-mono text-ink">{rec.overall_score.toFixed(2)}</span></span>
              <div className="ml-auto flex items-center gap-2"><label htmlFor="st" className="label">Status</label>
                <select id="st" className="field w-auto" value={rec.status} onChange={(e) => void setStatus(e.target.value)} disabled={demo}><option value="open">Open</option><option value="triaged">Triaged</option><option value="closed">Closed</option></select></div></div>
            <p className="mt-3 text-xs text-muted">{rec.score_semantics}</p>
            {rec.raw_saved && <Alert tone="warn" className="mt-3">The raw email body was stored for this incident. Delete the incident to remove it.</Alert>}
            {rec.note && <p className="mt-3 text-sm"><span className="label mr-2">Note</span>{rec.note}</p>}
          </Card>

          {rec.email_meta && Object.keys(rec.email_meta).length > 0 && (
            <Card><CardHeader title="Email metadata" /><dl className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-2 sm:px-5">
              {(["subject", "from", "reply_to"] as const).map((k) => <div key={k}><dt className="label">{k.replace("_", "-")}</dt><dd className="break-words">{rec.email_meta[k] || "not available"}</dd></div>)}
            </dl></Card>
          )}

          <Card>
            <CardHeader title="Evidence summary" description="Per-URL model score, threat-intel state and the reasoning recorded at analysis time." />
            {rec.urls.length === 0 ? <p className="card-pad text-sm text-muted">No URLs were scored in this case.</p> : (
              <ul className="divide-y divide-line">
                {rec.urls.map((u) => (
                  <li key={u.url} className="space-y-2 px-4 py-3 sm:px-5">
                    <p className="break-all font-mono text-xs">{defang(u.url)}</p>
                    <div className="flex flex-wrap items-center gap-3"><DecisionBadge decision={u.decision} /><TIBadge state={u.ti.state} /><span className="text-xs text-muted">Model score <span className="font-mono text-ink">{u.ml_probability.toFixed(3)}</span></span></div>
                    <p className="text-sm text-muted">{u.rationale}</p>
                    {u.signals.length > 0 && <ul className="list-disc pl-5 text-xs text-muted">{u.signals.map((s) => <li key={s.name}>{s.detail}</li>)}</ul>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card><CardHeader title="Recommended actions" /><ul className="list-disc space-y-1.5 px-9 py-4 text-sm">{actionsFor(rec.verdict).map((a) => <li key={a}>{a}</li>)}</ul></Card>
          <p className="text-xs text-faint">{rec.disclaimer}</p>
        </div>
      )}
      <Dialog open={delOpen} onOpenChange={setDelOpen} title="Delete this incident?" description="The incident and any stored raw email body will be permanently removed."
        footer={<><Button variant="secondary" onClick={() => setDelOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => void remove()}>Delete</Button></>} />
    </>
  );
}

function actionsFor(v: string): string[] {
  if (v === "phishing") return ["Do not open the link; report it to your security team or the impersonated brand.", "If it was opened, reset affected credentials and notify the account owner.", "Block the host at the mail/web gateway if policy allows."];
  if (v === "review") return ["Treat as untrusted until a person has verified it.", "Confirm the sender and destination through an independent channel.", "Inspect in an isolated environment if your policy allows."];
  return ["No strong evidence was found by the available checks; this is not proof of safety.", "Apply normal caution for unexpected requests."];
}

