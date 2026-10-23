import { AlertOctagon, CircleHelp, CircleSlash, Download, FileCode2, Link2, Save, ShieldAlert, ShieldQuestion, SearchCheck, Cpu } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, CardHeader, Field } from "@/components/ui/primitives";
import { snapshotAgeDays, STALE_AFTER_DAYS, type LocalAnalysis, type LocalTIState, type LocalVerdict, type TIEntry } from "@/lib/localAnalysis";
import { buildLocalReport, buildLocalReportHtml } from "@/lib/localReport";
import { saveLocalIncident } from "@/lib/localStore";
import { defang, downloadBlob } from "@/lib/utils";

const VERDICT: Record<LocalVerdict, { tone: "high" | "medium" | "neutral"; Icon: typeof ShieldAlert }> = {
  "HIGHER RISK": { tone: "high", Icon: ShieldAlert },
  "SUSPICIOUS": { tone: "medium", Icon: ShieldQuestion },
  "INSUFFICIENT EVIDENCE": { tone: "neutral", Icon: SearchCheck },
};
export function LocalVerdictBadge({ verdict }: { verdict: LocalVerdict }) {
  const { tone, Icon } = VERDICT[verdict];
  return <Badge tone={tone}><Icon className="h-3 w-3" aria-hidden />{verdict}</Badge>;
}

const TI: Record<LocalTIState, { tone: "high" | "neutral" | "dashed"; Icon: typeof AlertOctagon }> = {
  MATCH: { tone: "high", Icon: AlertOctagon }, NO_MATCH: { tone: "neutral", Icon: CircleSlash }, UNKNOWN: { tone: "dashed", Icon: CircleHelp },
};
export function LocalTIBadge({ state }: { state: LocalTIState }) {
  const { tone, Icon } = TI[state];
  return <Badge tone={tone} title={state}><Icon className="h-3 w-3" aria-hidden />Intel: {state}</Badge>;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function TIBlock({ ti }: { ti: TIEntry }) {
  const age = ti.snapshot ? snapshotAgeDays(ti.snapshot, new Date()) : null;
  const stale = ti.snapshot && (age === null || age > STALE_AFTER_DAYS);
  return (
    <div className="space-y-1.5 px-4 py-3 text-sm sm:px-5">
      <div className="flex flex-wrap items-center gap-2"><LocalTIBadge state={ti.state} /><span className="text-xs text-muted">Bundled snapshot only. Not a live feed.</span></div>
      <p className="text-xs text-muted">{ti.detail}</p>
      {ti.snapshot && <p className="font-mono text-2xs text-faint">source: {ti.snapshot.source} · version: {ti.snapshot.version ?? "unknown"} · retrieved: {ti.snapshot.retrievedUtc ?? "unknown"}</p>}
      {stale && <Alert tone="warn">This snapshot is {age === null ? "of unknown age" : `${age} days old`} and may be outdated or incomplete.</Alert>}
    </div>
  );
}

export function LocalResultPanel({ a, rawContent, fellBack }: { a: LocalAnalysis; rawContent?: string; fellBack?: boolean }) {
  const [note, setNote] = useState("");
  const [keepRaw, setKeepRaw] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try { setSaved((await saveLocalIncident(a, { note, rawContent: keepRaw ? rawContent : null })).id); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save to local storage."); } finally { setSaving(false); }
  }
  function exportJson() {
    try { downloadBlob(new Blob([JSON.stringify(buildLocalReport(a), null, 2)], { type: "application/json" }), "threatlens-local-report.json"); setExportErr(null); }
    catch { setExportErr("The browser blocked the download."); }
  }
  function exportHtml() {
    try { downloadBlob(new Blob([buildLocalReportHtml(buildLocalReport(a))], { type: "text/html" }), "threatlens-local-report.html"); setExportErr(null); }
    catch { setExportErr("The browser blocked the download."); }
  }

  return (
    <div className="fade-in space-y-4" data-testid="local-result">
      {fellBack && <Alert tone="warn" title="Backend request failed">The backend became unreachable during this request, so this input was analysed locally by deterministic rules.</Alert>}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div>
            <p className="label">Local rule-based assessment</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <LocalVerdictBadge verdict={a.verdict} />
              <Badge tone="demo"><Cpu className="h-3 w-3" aria-hidden />LOCAL RULES · no ML</Badge>
            </div>
          </div>
          <div className="text-right">
            <p className="label">Heuristic risk score</p>
            <div className="mt-1.5 flex items-center justify-end gap-2" role="img" aria-label={`Heuristic risk score ${a.riskScore} out of 100`}>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-sev-medium" style={{ width: `${a.riskScore}%` }} /></div>
              <span className="font-mono text-xs tabular-nums text-muted">{a.riskScore}/100</span>
            </div>
          </div>
        </div>
        <p className="border-b border-line px-4 py-2.5 text-xs text-muted sm:px-5">{a.scoreSemantics}</p>
        <p className="px-4 py-2.5 text-xs text-muted sm:px-5">Rule set <span className="font-mono">{a.ruleSetVersion}</span> · same input and rule set always give the same result</p>
      </Card>

      <Card>
        <CardHeader title="Threat intelligence" />
        <TIBlock ti={a.threatIntel} />
      </Card>

      {a.email && (
        <Card>
          <CardHeader title="Email" description="Header and wording rules are simple heuristics, not a validated classifier." />
          <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2 sm:px-5">
            <Row k="Subject" v={a.email.subject} /><Row k="From" v={a.email.from} />
            <Row k="Reply-To" v={a.email.replyTo || "not present"} /><Row k="URLs found" v={`${a.email.urlCount}${a.email.urlsTruncated ? " (list truncated)" : ""}`} />
            <Row k="SPF / DKIM / DMARC" v={(["spf", "dkim", "dmarc"] as const).map((k) => a.email!.auth[k] === "not_present" ? "not present" : a.email!.auth[k]).join(" / ")} />
          </dl>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">"Not present" means the supplied text did not state a result. It is not a failed check.</p>
        </Card>
      )}

      <Card>
        <CardHeader title={`Matched rules (${a.findings.length})`} />
        {a.findings.length === 0 ? <p className="card-pad text-sm text-muted">No {a.inputType === "email" ? "message-level " : ""}rule matched{a.inputType === "url" ? "" : "; see the URL results below"}. That is not evidence of safety.</p> : <FindingList items={a.findings} />}
      </Card>

      {a.inputType === "email" && (
        <Card>
          <CardHeader title={`URLs examined by the URL rules (${a.urls.length})`} />
          {a.urls.length === 0 ? <p className="card-pad text-sm text-muted">No URLs were found in the message.</p> : (
            <ul className="divide-y divide-line">{a.urls.map((u) => (
              <li key={u.normalized} className="space-y-2 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2"><Link2 className="h-3.5 w-3.5 text-faint" aria-hidden /><span className="break-all font-mono text-xs" title="Defanged for display">{defang(u.normalized)}</span></div>
                <div className="flex flex-wrap items-center gap-3"><LocalVerdictBadge verdict={u.verdict} /><LocalTIBadge state={u.ti.state} /><span className="font-mono text-xs text-muted">{u.score}/100</span></div>
                {u.findings.length > 0 && <FindingList items={u.findings} compact />}
              </li>))}
            </ul>
          )}
        </Card>
      )}

      {a.inputType === "url" && a.urls[0] && (
        <Card>
          <CardHeader title="Parsed URL" description="Computed from the text only. Nothing was fetched or resolved." />
          <p className="break-all px-4 py-3 font-mono text-xs sm:px-5" title="Defanged for display">{defang(a.urls[0].normalized)}{a.urls[0].features.schemeAssumed && <span className="ml-2 font-sans text-faint">(no scheme typed; http assumed for parsing)</span>}</p>
        </Card>
      )}

      <Card>
        <CardHeader title="Evidence ledger" description="Each entry names where it came from. Entries marked 'not examined' are things local mode cannot see." />
        <LocalEvidenceList evidence={a.evidence} />
      </Card>

      <Card>
        <CardHeader title="Recommended defensive actions" />
        <ul className="list-disc space-y-1 px-9 py-3 text-sm text-muted sm:px-10">{a.recommendedActions.map((x) => <li key={x}>{x}</li>)}</ul>
      </Card>

      <Alert tone="info" title="Limitations"><ul className="list-disc space-y-0.5 pl-4 text-xs">{a.limitations.map((x) => <li key={x}>{x}</li>)}</ul></Alert>

      <Card>
        <CardHeader title="Export report" description="Generated in your browser. Works without the backend." />
        <div className="card-pad space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportJson}><Download className="h-4 w-4" aria-hidden />Download JSON</Button>
            <Button onClick={exportHtml}><FileCode2 className="h-4 w-4" aria-hidden />Download printable HTML</Button>
          </div>
          <p className="text-xs text-muted">A PDF cannot be produced locally (no PDF library is bundled). Open the HTML report and use your browser's Print &rarr; Save as PDF.</p>
          {exportErr && <Alert tone="error">{exportErr}</Alert>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Save as local incident" description="Stored in this browser only (IndexedDB). Not synchronised with any backend." />
        <div className="card-pad space-y-3">
          {saved ? <Alert tone="success" title="Saved in this browser only">Local record <span className="font-mono">{saved}</span>. <Link className="text-accent underline" to="/incidents">View local incidents</Link>.</Alert> : (
            <>
              <Field id="local-note" label="Analyst note (optional)"><input id="local-note" className="field" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              {a.inputType === "email" && rawContent && (
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[#2DD4BF]" checked={keepRaw} onChange={(e) => setKeepRaw(e.target.checked)} />
                  <span><span className="text-ink">Also store the raw message text in this browser</span><span className="block text-xs text-muted">Off by default. May contain personal data. Removed by "Clear local data".</span></span>
                </label>
              )}
              {err && <Alert tone="error">{err}</Alert>}
              <Button onClick={() => void save()} loading={saving}><Save className="h-4 w-4" aria-hidden />Save locally</Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

export function LocalEvidenceList({ evidence }: { evidence: LocalAnalysis["evidence"] }) {
  return (
    <ul className="divide-y divide-line" aria-label="Evidence ledger">{evidence.map((e) => (
      <li key={e.id} className="space-y-0.5 px-4 py-2.5 text-sm sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={e.kind === "missing" ? "dashed" : e.kind === "threat_intel" ? "neutral" : e.influencedScore ? "medium" : "neutral"}>{e.kind === "missing" ? "Not examined" : e.kind === "threat_intel" ? "Threat intel" : "Rule"}</Badge>
          <span className="text-ink">{e.finding}</span>
          {e.influencedScore && <span className="font-mono text-2xs text-muted">{signed(e.weight)} pts</span>}
        </div>
        <p className="text-xs text-muted">{e.interpretation}</p>
        <p className="font-mono text-2xs text-faint">source: {e.provenance}</p>
      </li>))}
    </ul>
  );
}

function FindingList({ items, compact }: { items: LocalAnalysis["findings"]; compact?: boolean }) {
  return (
    <ul className={compact ? "space-y-1.5" : "divide-y divide-line"}>{items.map((f) => (
      <li key={f.ruleId + f.observed} className={compact ? "text-xs" : "px-4 py-3 sm:px-5"}>
        <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-2xs text-accent">{f.ruleId}</span><span className="text-sm text-ink">{f.title}</span><span className="font-mono text-2xs text-muted">{signed(f.weight)} pts</span></div>
        <p className="text-xs text-muted">Observed: {f.observed}</p>
        {!compact && <p className="text-xs text-faint">{f.explanation}</p>}
      </li>))}
    </ul>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return <div className="min-w-0"><dt className="label">{k}</dt><dd className="break-words text-ink">{v || <span className="text-faint">not available</span>}</dd></div>;
}
