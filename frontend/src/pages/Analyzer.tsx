import { FileUp, Link2, ScanSearch, Save, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DecisionBadge, ScoreBar, SourceBadge, TIBadge } from "@/components/badges";
import { AboutLocalAnalysis } from "@/components/AboutLocalAnalysis";
import { LocalResultPanel } from "@/components/LocalResultPanel";
import { Alert, Button, Card, CardHeader, EmptyState, Field, PageHeader, Segmented, Spinner } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { api, ApiError, describeError } from "@/lib/api";
import { loadDemo, type DemoFixture } from "@/lib/demo";
import { analyzeEmailLocal, analyzeUrlLocal, isValidationError, type AnalysisConfig } from "@/lib/localAnalysis";
import type { AnalysisResponse } from "@/lib/types";
import { defang, fmtDate } from "@/lib/utils";

type InputKind = "url" | "email" | "eml";
const MAX_EML_BYTES = 2 * 1024 * 1024;
// Reserved .example domains: safe, non-live fixtures for trying the form.
const SAMPLE_URLS = ["http://secure-paypal-login.example/verify/a1b2c3", "https://river-garden.example/news"];

export default function Analyzer() {
  const { mode, apiState, effectiveMode, status, analysis, setAnalysis, localAnalysis, setLocalAnalysis, getLocalConfig, reportBackendFailure } = useApp();
  const [kind, setKind] = useState<InputKind>("url");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [eml, setEml] = useState<{ name: string; text: string } | null>(null);
  const [useTI, setUseTI] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<DemoFixture[] | null>(null);
  const [fixtureErr, setFixtureErr] = useState<string | null>(null);
  const [fellBack, setFellBack] = useState(false);
  const [localRaw, setLocalRaw] = useState<string | undefined>(undefined);
  const seq = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode !== "demo") return;
    loadDemo().then((d) => setFixtures(d.analyses)).catch((e) => setFixtureErr(describeError(e)));
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (kind === "url" && !url.trim()) return setError("Enter a URL to analyse.");
    if (kind === "email" && !body.trim()) return setError("Paste an email body to analyse.");
    if (kind === "eml" && !eml) return setError("Choose an .eml file first.");
    if (busy) return;
    const my = ++seq.current;
    setBusy(true);
    const rawText = kind === "url" ? undefined : kind === "email" ? body : eml!.text;

    async function runLocal(fromFailure: boolean) {
      const cfg: AnalysisConfig = useTI ? await getLocalConfig() : { snapshot: null, snapshotUnavailableReason: "Snapshot lookup was switched off for this analysis." };
      const result = kind === "url" ? analyzeUrlLocal(url, cfg) : analyzeEmailLocal(rawText!, cfg);
      if (my !== seq.current) return; // a newer request owns the result panel
      if (isValidationError(result)) return setError(result.message);
      setAnalysis(null); setLocalAnalysis(result); setLocalRaw(rawText); setFellBack(fromFailure);
    }

    try {
      if (effectiveMode === "LOCAL") { await runLocal(false); return; }
      try {
        const data = kind === "url" ? await api.analyzeUrl(url.trim(), useTI)
          : kind === "email" ? await api.analyzeEmail({ body, useThreatIntel: useTI })
          : await api.analyzeEmail({ eml: eml!.text, useThreatIntel: useTI });
        if (my !== seq.current) return;
        setLocalAnalysis(null); setFellBack(false); setAnalysis({ origin: "live", data });
      } catch (err) {
        // Only a genuine network failure or timeout (status 0) falls back; validation and server errors are reported as such.
        if (err instanceof ApiError && err.status === 0) { reportBackendFailure(err.message); await runLocal(true); }
        else if (my === seq.current) setError(describeError(err));
      }
    } finally { if (my === seq.current) setBusy(false); }
  }

  async function onFile(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!/\.eml$/i.test(f.name)) return setError("Only .eml files are supported.");
    if (f.size > MAX_EML_BYTES) return setError(`File is ${(f.size / 1048576).toFixed(1)} MB; the limit is 2 MB.`);
    setEml({ name: f.name, text: await f.text() });
  }

  const live = mode === "live";
  const local = live && effectiveMode === "LOCAL";
  const modelMissing = live && !local && apiState === "online" && status?.model.kind === "unavailable";

  return (
    <>
      <PageHeader kicker="02 · Investigation" title="URL & Email Analyzer" eyebrow={<SourceBadge kind={live ? "live" : "demo"} />}
        description={local ? "The backend is unavailable, so URLs and emails are assessed by deterministic rules running in your browser. Nothing you enter is sent anywhere, fetched or opened." : "Score URLs with the URL-string classifier, check them against a local threat-intelligence snapshot, and get an explained triage recommendation. Nothing you enter is ever fetched or opened."} />

      {modelMissing && <Alert tone="warn" title="No trained model on the server" className="mb-4">{status?.model.detail}</Alert>}
      {live && !local && status?.model.kind === "synthetic_demo" && (
        <Alert tone="warn" title="Server is using the synthetic demo model" className="mb-4">
          Predictions come from a model trained on generated URLs and are illustrative only. Train the real model with the command in the Methodology page.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <CardHeader title="Input" description={local ? "Assessed by deterministic local rules (no ML)." : live ? "Scored by the live API." : "Demo mode: choose a named fixture below."} />
          <div className="card-pad">
            {live ? (
              <form onSubmit={submit} className="space-y-4" noValidate>
                <Segmented<InputKind> label="Input type" value={kind} onChange={(k) => { setKind(k); setError(null); }}
                  options={[{ value: "url", label: "URL" }, { value: "email", label: "Email body" }, { value: "eml", label: ".eml file" }]} />

                {kind === "url" && (
                  <Field id="url" label="URL" hint="Use defanged or reserved example domains when testing. The URL is analysed as text only.">
                    <input id="url" className="field font-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/login"
                      autoComplete="off" spellCheck={false} maxLength={4096} />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {SAMPLE_URLS.map((s) => <button key={s} type="button" onClick={() => setUrl(s)} className="rounded border border-line px-2 py-1 font-mono text-2xs text-muted hover:border-faint hover:text-ink">{s.replace(/^https?:\/\//, "").slice(0, 34)}</button>)}
                    </div>
                  </Field>
                )}
                {kind === "email" && (
                  <Field id="body" label="Pasted email body" hint="URLs found in the text are extracted and scored. Headers are not available for pasted text.">
                    <textarea id="body" className="field min-h-44 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} maxLength={500000} spellCheck={false} />
                  </Field>
                )}
                {kind === "eml" && (
                  <Field id="eml" label=".eml file (max 2 MB)" hint="Parsed locally by the API. Attachments are listed, never opened.">
                    <input ref={fileRef} id="eml" type="file" accept=".eml,message/rfc822" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
                    <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-md border border-dashed border-line px-3 py-4 text-left text-sm text-muted hover:border-faint hover:text-ink">
                      <FileUp className="h-5 w-5 shrink-0" aria-hidden />{eml ? <span className="font-mono text-ink">{eml.name}</span> : "Choose an .eml file…"}
                    </button>
                  </Field>
                )}

                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[#2DD4BF]" checked={useTI} onChange={(e) => setUseTI(e.target.checked)} />
                  <span><span className="text-ink">Check local threat-intel snapshot</span>
                    <span className="block text-xs text-muted">When off, or when no snapshot exists, the intel state is reported as UNKNOWN (never "no match").</span></span>
                </label>

                {error && <Alert tone="error">{error}</Alert>}
                <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={modelMissing}>
                  <ScanSearch className="h-4 w-4" aria-hidden /> {local ? "Analyze locally" : "Analyze"}
                </Button>
                {kind !== "url" && <p className="text-xs text-muted">{local ? "Scope: header and wording rules are simple heuristics and extracted URLs go through the URL rules. None of it is a validated classifier." : "Scope: the classifier scores extracted URLs only. It has not been validated on email text."}</p>}
              </form>
            ) : (
              <DemoPicker fixtures={fixtures} error={fixtureErr} onPick={(f) => setAnalysis({ origin: "demo-fixture", fixtureName: f.name, data: f.analysis })} />
            )}
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          {busy && <Card className="card-pad"><Spinner label="Analysing" /></Card>}
          {!busy && live && localAnalysis && <LocalResultPanel a={localAnalysis} rawContent={localRaw} fellBack={fellBack} />}
          {!busy && !(live && localAnalysis) && !analysis && (
            <EmptyState icon={<ScanSearch className="h-8 w-8" aria-hidden />} title="No analysis yet">
              Enter a URL, paste an email, or upload an .eml file. Results appear here with the supporting evidence.
            </EmptyState>
          )}
          {!busy && !(live && localAnalysis) && analysis && <ResultPanel a={analysis.data} origin={analysis.origin} fixtureName={analysis.fixtureName} />}
        </div>
      </div>
      {live && <div className="mt-6"><AboutLocalAnalysis /></div>}
    </>
  );
}

function DemoPicker({ fixtures, error, onPick }: { fixtures: DemoFixture[] | null; error: string | null; onPick: (f: DemoFixture) => void }) {
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!fixtures) return <Spinner label="Loading fixtures" />;
  return (
    <div className="space-y-3">
      <Alert tone="warn">Demo mode cannot score your own input. These are precomputed outputs of the synthetic demo model on reserved <span className="font-mono">.example</span> names.</Alert>
      <ul className="space-y-2">
        {fixtures.map((f) => (
          <li key={f.name}>
            <button onClick={() => onPick(f)} className="w-full rounded-md border border-line bg-bg/40 px-3 py-2.5 text-left hover:border-accent/50">
              <span className="block text-sm font-medium text-ink">{f.name}</span>
              <span className="block text-xs text-muted">{f.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultPanel({ a, origin, fixtureName }: { a: AnalysisResponse; origin: "live" | "demo-fixture"; fixtureName?: string }) {
  const { mode } = useApp();
  const [raw, setRaw] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isFixture = origin === "demo-fixture";
  const canSave = !isFixture && mode === "live";

  async function save() {
    setSaving(true); setErr(null);
    try { const r = await api.saveIncident(a.analysis_id, raw, note); setSaved(r.case_id); }
    catch (e) { setErr(describeError(e)); } finally { setSaving(false); }
  }

  return (
    <div className="fade-in space-y-4">
      {isFixture && <Alert tone="warn" title={`Demo fixture: ${fixtureName}`}>Precomputed with the synthetic demo model. Not a live prediction.</Alert>}
      {a.model.trained_on_synthetic && !isFixture && <Alert tone="warn">Scored by a model trained on synthetic data. Illustrative only.</Alert>}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div>
            <p className="label">Triage outcome</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3"><DecisionBadge decision={a.overall_decision} /><span className="text-sm text-muted">{a.overall_label}</span></div>
          </div>
          <div className="text-right"><p className="label">Heuristic risk score</p><div className="mt-1.5"><ScoreBar value={a.overall_score} label="Heuristic risk score" /></div></div>
        </div>
        <p className="border-b border-line px-4 py-2.5 text-xs text-muted sm:px-5">{a.score_semantics}</p>
        <p className="px-4 py-2.5 text-xs text-muted sm:px-5">Analysed {fmtDate(a.created_utc)} · model <span className="font-mono">{a.model.version}</span> · intel snapshot: {a.ti_source.consulted === false ? "not consulted" : a.ti_source.loaded ? `${a.ti_source.entries} entries${a.ti_source.is_demo ? " (demo data)" : ""}` : "unavailable"}</p>
      </Card>

      {a.input_kind === "email" && (
        <Card>
          <CardHeader title="Email" description="Header and wording checks are heuristics, separate from the URL classifier." />
          <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2 sm:px-5">
            <Row k="Subject" v={a.email_meta.subject} /><Row k="From" v={a.email_meta.from} />
            <Row k="Reply-To" v={a.email_meta.reply_to || "not present"} /><Row k="Attachments" v={String(a.email_meta.n_attachments ?? 0)} />
            <Row k="SPF / DKIM / DMARC" v={a.email_meta.auth ? Object.values(a.email_meta.auth).join(" / ") : "not available"} />
          </dl>
          {a.email_evidence.length > 0 && (
            <ul className="space-y-1 border-t border-line px-4 py-3 text-sm sm:px-5">
              {a.email_evidence.map((e) => <li key={e.id} className="flex gap-2"><span className={e.influenced_decision ? "text-sev-medium" : "text-faint"} aria-hidden>●</span><span>{e.finding} <span className="text-2xs uppercase text-faint">heuristic</span></span></li>)}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title={`URLs scored (${a.urls.length})`} actions={<Link to="/evidence" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Open in Evidence Explorer <ArrowRight className="h-3 w-3" aria-hidden /></Link>} />
        {a.urls.length === 0 ? <p className="card-pad text-sm text-muted">No URLs were found, so the classifier had nothing to score.</p> : (
          <ul className="divide-y divide-line">
            {a.urls.map((u) => (
              <li key={u.url} className="space-y-2 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2"><Link2 className="h-3.5 w-3.5 text-faint" aria-hidden /><span className="break-all font-mono text-xs" title="Defanged for display">{defang(u.url)}</span></div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><DecisionBadge decision={u.decision} /><TIBadge state={u.ti.state} /><span className="text-xs text-muted">Model score <span className="font-mono text-ink">{u.ml_probability.toFixed(3)}</span></span></div>
                <p className="text-sm text-muted">{u.rationale}</p>
                <ul className="list-disc pl-5 text-xs text-muted">{u.suggested_actions.slice(0, 2).map((s) => <li key={s}>{s}</li>)}</ul>
              </li>
            ))}
          </ul>
        )}
        {a.notes.length > 0 && <ul className="space-y-1 border-t border-line px-4 py-3 text-xs text-muted sm:px-5">{a.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </Card>

      <Alert tone="info" title="Scope">{a.scope_note}</Alert>

      <Card>
        <CardHeader title="Save as incident" description={canSave ? "Stores structured results in the server database." : "Saving is available only for live analyses."} />
        <div className="card-pad space-y-3">
          {saved ? <Alert tone="success" title="Incident saved">Case <span className="font-mono">{saved}</span>. <Link className="text-accent underline" to={`/incidents/${saved}`}>View it</Link>.</Alert> : (
            <>
              <Field id="note" label="Analyst note (optional)"><input id="note" className="field" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canSave} /></Field>
              {a.input_kind === "email" && (
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[#2DD4BF]" checked={raw} onChange={(e) => setRaw(e.target.checked)} disabled={!canSave} />
                  <span><span className="text-ink">Also store the raw email body</span><span className="block text-xs text-muted">Off by default. The raw text may contain personal data. You can delete it later.</span></span>
                </label>
              )}
              {err && <Alert tone="error">{err}</Alert>}
              <Button onClick={() => void save()} loading={saving} disabled={!canSave}><Save className="h-4 w-4" aria-hidden />Save incident</Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return <div className="min-w-0"><dt className="label">{k}</dt><dd className="break-words text-ink">{v || <span className="text-faint">not available</span>}</dd></div>;
}

