import { ArrowRight, Check, Copy, Info, Save, ShieldQuestion } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, CardHeader, PageHeader, Tip } from "@/components/ui/primitives";
import { IssueList, LocalStorageNote, QualityBadge } from "@/components/campaigns/shared";
import { analyzeRecords } from "@/lib/campaign/quality";
import { campaignStore, useCampaigns, useNaming, type CampaignStore } from "@/lib/campaign/store";
import { buildUtmUrl, emptyUtm, extractUtm, missingRequired, parseDestination, REQUIRED_UTM, SUGGESTED_MEDIUMS, SUGGESTED_SOURCES, suggestSlug, UTM_KEYS, type UtmKey, type UtmValues } from "@/lib/campaign/utm";
import { cn } from "@/lib/utils";

const FIELDS: { key: UtmKey; label: string; hint: string; tip: string; example: string }[] = [
  { key: "utm_source", label: "Source", hint: "Where the traffic comes from.", tip: "The referrer: a site, platform or list, e.g. google, linkedin, newsletter.", example: "newsletter" },
  { key: "utm_medium", label: "Medium", hint: "The channel type.", tip: "The marketing channel type, e.g. cpc, social, email, referral.", example: "email" },
  { key: "utm_campaign", label: "Campaign", hint: "The promotion or initiative name.", tip: "One name per initiative, reused on every link of that campaign.", example: "spring_launch" },
  { key: "utm_term", label: "Term", hint: "Paid keyword, if any.", tip: "Optional. The paid-search keyword the ad targeted.", example: "running+shoes" },
  { key: "utm_content", label: "Content", hint: "Distinguishes links or creatives in the same campaign.", tip: "Optional. Tells two links in the same campaign apart, e.g. header_cta vs footer_link.", example: "header_cta" },
];

export const NAMING_GUIDE = `UTM naming guide
- Use lowercase only: "linkedin", not "LinkedIn".
- Use letters, digits, "_", "-" and "." only. No spaces: "spring_launch", not "Spring Launch".
- One spelling per source, medium and campaign across every link ("facebook", never "face_book").
- utm_source = the platform or list (google, linkedin, newsletter).
- utm_medium = the channel type (cpc, social, email, referral).
- utm_campaign = one name per initiative, reused on every link of it.
- utm_content = tells links in the same campaign apart (hero_cta, footer_link).
- utm_term = paid keyword, only for paid search.
- Required on every link: utm_source, utm_medium, utm_campaign.`;

export interface StudioDefaults { dest: string; utm: Partial<UtmValues>; name?: string; note?: string }
export type StudioFocus = "build" | "validate" | "save";

/** Route wrapper: re-mounts the form when a different saved URL is opened for editing, so its fields reset cleanly. */
export default function CampaignStudio() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader kicker="UTM Studio" title="Build a tagged campaign URL"
        description="Create → validate → save. Existing query parameters and fragments are preserved, values are encoded, and nothing is ever fetched or opened." />
      <StudioForm key={params.get("edit") ?? "new"} editId={params.get("edit") ?? undefined} />
    </>
  );
}

/** The Studio workspace. `store` defaults to the user's real library; the demo passes its own sandbox store. */
export function StudioForm({ store = campaignStore, editId, defaults, focus, embedded }: {
  store?: CampaignStore; editId?: string; defaults?: StudioDefaults; focus?: StudioFocus; embedded?: boolean;
}) {
  const nav = useNavigate();
  const records = useCampaigns(store);
  const naming = useNaming();
  const editing = useMemo(() => records.find((r) => r.id === editId), [records, editId]);

  // Initial state comes from the record being edited, or from the demo defaults (the store is synchronous, so this is available on first render).
  const init = useMemo(() => {
    const x = editing ? extractUtm(editing.finalUrl) : null;
    return { dest: x?.base ?? defaults?.dest ?? "", utm: x?.utm ?? { ...emptyUtm(), ...defaults?.utm }, name: editing?.name ?? defaults?.name ?? "", note: editing?.note ?? defaults?.note ?? "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const [dest, setDest] = useState(init.dest);
  const [utm, setUtm] = useState<UtmValues>(init.utm);
  const [name, setName] = useState(init.name);
  const [note, setNote] = useState(init.note);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState<"url" | "guide" | null>(null);
  const [saved, setSaved] = useState<{ id: string; updated: boolean } | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const parsed = parseDestination(dest);
  const missing = missingRequired(utm);
  const built = buildUtmUrl(dest, utm);
  const show = (k: string) => submitted || touched[k];
  const destError = !parsed.ok && dest.trim() !== "" ? parsed.error : !parsed.ok && show("dest") ? parsed.error : null;
  const ready = parsed.ok && missing.length === 0;

  // Real validation: the draft is analysed together with the saved library, so duplicates and spelling variants are detected against it.
  const findings = useMemo(() => {
    if (!built.url) return null;
    const others = records.filter((r) => r.id !== editing?.id);
    const draft = { id: "__draft__", name: name.trim(), finalUrl: built.url, note: "", createdUtc: "", updatedUtc: "" };
    return analyzeRecords([...others, draft], naming).at(-1)!;
  }, [built.url, records, editing, naming, name]);

  const suggestions = useMemo(() => {
    const seen: Record<UtmKey, Set<string>> = { utm_source: new Set(SUGGESTED_SOURCES), utm_medium: new Set(SUGGESTED_MEDIUMS), utm_campaign: new Set(), utm_term: new Set(), utm_content: new Set() };
    for (const r of records) { const x = extractUtm(r.finalUrl); if (x) for (const f of FIELDS) if (x.utm[f.key]) seen[f.key].add(x.utm[f.key]); }
    return seen;
  }, [records]);

  const set = (k: UtmKey, v: string) => { setUtm((u) => ({ ...u, [k]: v })); setSaved(null); };

  async function copyText(text: string, which: "url" | "guide") {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1800); }
    catch { setStorageError("Copy failed: your browser blocked clipboard access. Select the text and copy it manually."); }
  }
  function copy() { if (!ready) { setSubmitted(true); return; } void copyText(built.url, "url"); }

  function save() {
    setSubmitted(true);
    if (!ready) return;
    setStorageError(null);
    if (editing) {
      const r = store.update(editing.id, { name: name.trim(), finalUrl: built.url, note: note.trim() });
      if (!r.ok) return setStorageError(r.error ?? "Could not save.");
      setSaved({ id: editing.id, updated: true });
    } else {
      const r = store.add([{ name: name.trim(), finalUrl: built.url, note: note.trim() }]);
      if (r.added.length === 0) return setStorageError(`The local library is full (${r.dropped} not saved). Export and remove old records first.`);
      if (!r.ok) return setStorageError(r.error ?? "Could not save.");
      setSaved({ id: r.added[0].id, updated: false });
    }
  }

  function reset() {
    setDest(""); setUtm(emptyUtm()); setName(""); setNote(""); setTouched({}); setSubmitted(false); setSaved(null); setStorageError(null);
    if (editing && !embedded) nav("/campaigns/studio", { replace: true });
  }

  const ring = (f: StudioFocus) => (focus === f ? "ring-2 ring-accent/60" : "");
  const outUrl = parsed.ok && built.url ? new URL(built.url) : null;
  const outParams = outUrl ? [...outUrl.searchParams.entries()] : [];

  return (
    <>
      {editing && !embedded && <div className="mb-4"><Badge tone="accent">Editing saved URL</Badge></div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <Card className={cn("transition-shadow", ring("build"))}>
          <CardHeader title="1 · Link details" description="Fields marked required must be filled before you can copy or save." />
          <form className="card-pad space-y-6" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div>
              <label htmlFor="dest" className="label mb-1.5 flex items-center justify-between">Destination URL <span className="normal-case tracking-normal text-accent">required</span></label>
              <input id="dest" className={cn("field font-mono", destError && "border-sev-high/60")} value={dest} placeholder="https://example.com/landing?ref=home#pricing"
                onChange={(e) => { setDest(e.target.value); setSaved(null); }} onBlur={() => setTouched((t) => ({ ...t, dest: true }))}
                aria-invalid={!!destError} aria-describedby={destError ? "dest-err" : "dest-hint"} autoComplete="off" spellCheck={false} maxLength={2000} />
              {destError ? <p id="dest-err" className="mt-1.5 text-xs text-sev-high">{destError}</p>
                : <p id="dest-hint" className="mt-1.5 text-xs text-muted">Include https://. Existing parameters such as <span className="font-mono">?ref=home</span> and <span className="font-mono">#fragments</span> are kept; existing utm_* values are replaced.</p>}
            </div>

            <fieldset>
              <legend className="label mb-3">Required tracking parameters</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.filter((f) => REQUIRED_UTM.includes(f.key)).map((f) => <UtmInput key={f.key} wide={f.key === "utm_campaign"} f={f} value={utm[f.key]} required onChange={set}
                  error={show(f.key) && !utm[f.key].trim() ? `${f.label} is required.` : null} onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))} options={[...suggestions[f.key]]} chips={f.key !== "utm_campaign"} />)}
              </div>
            </fieldset>

            <fieldset>
              <legend className="label mb-3">Optional</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.filter((f) => !REQUIRED_UTM.includes(f.key)).map((f) => <UtmInput key={f.key} f={f} value={utm[f.key]} onChange={set} error={null} onBlur={() => undefined} options={[...suggestions[f.key]]} />)}
              </div>
            </fieldset>

            <fieldset className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
              <legend className="label mb-3 w-full">For your library (not added to the URL)</legend>
              <div><label htmlFor="name" className="label mb-1.5 block">Label</label>
                <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Spring launch · header button" /></div>
              <div><label htmlFor="note" className="label mb-1.5 block">Note</label>
                <input id="note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Owner, channel brief, etc." /></div>
            </fieldset>
          </form>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Generated URL" description="Updates as you type." actions={ready ? <Badge tone="accent"><Check className="h-3 w-3" aria-hidden />Required tags present</Badge> : <Badge tone="dashed">Incomplete</Badge>} />
            <div className="card-pad space-y-4">
              <output data-testid="utm-preview" aria-live="polite" className={cn("block min-h-20 break-all rounded-md border border-line bg-bg/80 p-3 font-mono text-xs leading-relaxed", built.url ? "text-ink" : "text-faint")}>
                {built.url || "Enter a valid destination URL to see the tagged link."}
              </output>
              {outUrl && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted hover:text-ink">Exact final destination · {outParams.length} parameter{outParams.length === 1 ? "" : "s"}</summary>
                  <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono">
                    <dt className="text-faint">path</dt><dd className="break-all text-muted">{outUrl.origin}{outUrl.pathname}</dd>
                    {outParams.map(([k, v], i) => (<Fragment key={i}><dt className={k.startsWith("utm_") ? "text-accent" : "text-faint"}>{k}</dt><dd className="break-all text-muted">{v}</dd></Fragment>))}
                    {outUrl.hash && (<><dt className="text-faint">fragment</dt><dd className="break-all text-muted">{outUrl.hash}</dd></>)}
                  </dl>
                </details>)}
              {parsed.ok && submitted && missing.length > 0 && <Alert tone="error" title="Required parameters missing">Add {missing.map((m) => m.replace("utm_", "")).join(", ")} before copying or saving.</Alert>}
              {saved && <Alert tone="success" title={saved.updated ? "Changes saved" : "Saved to your library"}>
                {store === campaignStore ? <>Stored in this browser only. <Link to="/campaigns/intelligence" className="underline">Open the Campaign Library</Link></> : "Saved to the demo workspace only. Your real campaigns are untouched."}
              </Alert>}
              {storageError && <Alert tone="error">{storageError}</Alert>}
              <div className={cn("flex flex-wrap gap-2 rounded-md", ring("save"), focus === "save" && "p-2")}>
                <Button variant="primary" onClick={copy} disabled={!built.url}>{copied === "url" ? <><Check className="h-4 w-4" aria-hidden />Copied</> : <><Copy className="h-4 w-4" aria-hidden />Copy URL</>}</Button>
                <Button onClick={save} disabled={!built.url}><Save className="h-4 w-4" aria-hidden />{editing ? "Save changes" : "Save to library"}</Button>
                <Button variant="ghost" onClick={reset}>{editing && !embedded ? "Cancel edit" : "Reset form"}</Button>
              </div>
              <span className="sr-only" role="status">{copied === "url" ? "URL copied to clipboard" : ""}</span>
            </div>
          </Card>

          <Card className={cn("transition-shadow", ring("validate"))}>
            <CardHeader title="2 · Validation" description="Tag quality, checked against your naming rules and saved library." actions={findings ? <QualityBadge status={findings.status} /> : undefined} />
            <div className="card-pad" data-testid="studio-validation">
              {!findings ? <p className="text-sm text-muted">Enter a valid destination URL to validate it.</p>
                : findings.issues.length === 0 ? <p className="text-sm text-accent">No tagging issues found. Required parameters are present, naming follows your rules, and it is not a duplicate.</p>
                : <>
                  <IssueList issues={findings.issues} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {UTM_KEYS.filter((k) => utm[k] && suggestSlug(utm[k]) !== utm[k]).map((k) => (
                      <Button key={k} size="sm" onClick={() => set(k, suggestSlug(utm[k]))}>Use “{suggestSlug(utm[k])}” for {k.replace("utm_", "")}</Button>))}
                  </div>
                </>}
            </div>
          </Card>

          <Card className="card-pad">
            <div className="flex items-start gap-3">
              <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-faint" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Tag quality is not a safety check</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">Correct UTM tags say nothing about whether the destination is trustworthy. The security Analyzer is a separate tool; opening it only fills in the URL, it does not run anything.</p>
                {built.url ? <Link to={`/analyzer?url=${encodeURIComponent(built.url)}`} className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline">Open in Analyzer <ArrowRight className="h-3 w-3" aria-hidden /></Link> : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Naming guide" description="Copy-ready conventions for your team." actions={<Button size="sm" onClick={() => void copyText(NAMING_GUIDE, "guide")}>{copied === "guide" ? <><Check className="h-3.5 w-3.5" aria-hidden />Copied</> : <><Copy className="h-3.5 w-3.5" aria-hidden />Copy guide</>}</Button>} />
            <pre className="card-pad max-h-48 overflow-auto whitespace-pre-wrap text-2xs leading-relaxed text-muted">{NAMING_GUIDE}</pre>
          </Card>
          {!embedded && <LocalStorageNote />}
        </div>
      </div>
    </>
  );
}

function UtmInput({ f, value, onChange, error, onBlur, required, options, chips, wide }: {
  f: (typeof FIELDS)[number]; value: string; onChange: (k: UtmKey, v: string) => void; error: string | null; onBlur: () => void; required?: boolean; options: string[]; chips?: boolean; wide?: boolean;
}) {
  const listId = `${f.key}-list`;
  const chipValues = chips ? options.slice(0, 8) : [];
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={f.key} className="label mb-1.5 flex items-center gap-1.5">{f.label}{required && <span aria-hidden className="text-accent">*</span>}
        <Tip content={f.tip}><span aria-hidden className="cursor-help text-faint hover:text-ink"><Info className="h-3 w-3" aria-hidden /></span></Tip></label>
      <input id={f.key} className={cn("field font-mono", error && "border-sev-high/60")} value={value} onChange={(e) => onChange(f.key, e.target.value)} onBlur={onBlur}
        placeholder={f.example} list={options.length ? listId : undefined} aria-required={required} aria-invalid={!!error} aria-describedby={`${f.key}-d ${f.key}-tip`} autoComplete="off" spellCheck={false} maxLength={200} />
      {options.length > 0 && <datalist id={listId}>{options.slice(0, 50).map((o) => <option key={o} value={o} />)}</datalist>}
      <span id={`${f.key}-tip`} className="sr-only">{f.tip}</span>
      <p id={`${f.key}-d`} className={cn("mt-1.5 text-xs", error ? "text-sev-high" : "text-muted")}>{error ?? <><span className="font-mono text-faint">{f.key}</span> · {f.hint}</>}</p>
      {chipValues.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`Suggested ${f.label.toLowerCase()} values (optional)`}>
          {chipValues.map((o) => <button key={o} type="button" onClick={() => onChange(f.key, o)} className="rounded border border-line px-1.5 py-0.5 font-mono text-2xs text-muted hover:border-accent/50 hover:text-ink">{o}</button>)}
        </div>)}
    </div>
  );
}
