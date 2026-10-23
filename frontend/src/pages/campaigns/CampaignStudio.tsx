import { ArrowRight, Check, Copy, Save, ShieldQuestion } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { LocalStorageNote } from "@/components/campaigns/shared";
import { campaignStore, useCampaigns } from "@/lib/campaign/store";
import { buildUtmUrl, emptyUtm, extractUtm, missingRequired, parseDestination, REQUIRED_UTM, type UtmKey, type UtmValues } from "@/lib/campaign/utm";
import { cn } from "@/lib/utils";

const FIELDS: { key: UtmKey; label: string; hint: string; example: string }[] = [
  { key: "utm_source", label: "Source", hint: "Where the traffic comes from.", example: "newsletter" },
  { key: "utm_medium", label: "Medium", hint: "The channel type.", example: "email" },
  { key: "utm_campaign", label: "Campaign", hint: "The promotion or initiative name.", example: "spring_launch" },
  { key: "utm_term", label: "Term", hint: "Paid keyword, if any.", example: "running+shoes" },
  { key: "utm_content", label: "Content", hint: "Distinguishes links or creatives in the same campaign.", example: "header_cta" },
];

/** Re-mounts the form when a different saved URL is opened for editing, so its fields reset cleanly. */
export default function CampaignStudio() {
  const [params] = useSearchParams();
  return <StudioForm key={params.get("edit") ?? "new"} />;
}

function StudioForm() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const records = useCampaigns();
  const editing = useMemo(() => records.find((r) => r.id === params.get("edit")), [records, params]);

  // Initial state comes from the record being edited, if any (the store is synchronous, so this is available on first render).
  const init = useMemo(() => {
    const x = editing ? extractUtm(editing.finalUrl) : null;
    return { dest: x?.base ?? "", utm: x?.utm ?? emptyUtm(), name: editing?.name ?? "", note: editing?.note ?? "" };
  }, [editing]);
  const [dest, setDest] = useState(init.dest);
  const [utm, setUtm] = useState<UtmValues>(init.utm);
  const [name, setName] = useState(init.name);
  const [note, setNote] = useState(init.note);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<{ id: string; updated: boolean } | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const parsed = parseDestination(dest);
  const missing = missingRequired(utm);
  const built = buildUtmUrl(dest, utm);
  const show = (k: string) => submitted || touched[k];
  const destError = !parsed.ok && dest.trim() !== "" ? parsed.error : !parsed.ok && show("dest") ? parsed.error : null;
  const ready = parsed.ok && missing.length === 0;

  // Existing values for the datalist so people reuse spellings they already have.
  const suggestions = useMemo(() => {
    const out: Record<string, Set<string>> = { utm_source: new Set(), utm_medium: new Set(), utm_campaign: new Set(), utm_term: new Set(), utm_content: new Set() };
    for (const r of records) { const x = extractUtm(r.finalUrl); if (x) for (const f of FIELDS) if (x.utm[f.key]) out[f.key].add(x.utm[f.key]); }
    return out;
  }, [records]);

  const set = (k: UtmKey, v: string) => { setUtm((u) => ({ ...u, [k]: v })); setSaved(null); };

  async function copy() {
    if (!ready) { setSubmitted(true); return; }
    try { await navigator.clipboard.writeText(built.url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setStorageError("Copy failed: your browser blocked clipboard access. Select the URL in the preview and copy it manually."); }
  }

  function save() {
    setSubmitted(true);
    if (!ready) return;
    setStorageError(null);
    if (editing) {
      const r = campaignStore.update(editing.id, { name: name.trim(), finalUrl: built.url, note: note.trim() });
      if (!r.ok) return setStorageError(r.error ?? "Could not save.");
      setSaved({ id: editing.id, updated: true });
    } else {
      const r = campaignStore.add([{ name: name.trim(), finalUrl: built.url, note: note.trim() }]);
      if (r.added.length === 0) return setStorageError(`The local library is full (${r.dropped} not saved). Export and remove old records first.`);
      if (!r.ok) return setStorageError(r.error ?? "Could not save.");
      setSaved({ id: r.added[0].id, updated: false });
    }
  }

  function reset() {
    setDest(""); setUtm(emptyUtm()); setName(""); setNote(""); setTouched({}); setSubmitted(false); setSaved(null); setStorageError(null);
    if (editing) nav("/campaigns/studio", { replace: true });
  }

  return (
    <>
      <PageHeader kicker="Campaigns · Studio" title="Campaign URL Studio"
        eyebrow={editing ? <Badge tone="accent">Editing saved URL</Badge> : undefined}
        description="Build a tagged URL with UTM parameters. Existing query parameters and fragments are preserved, values are encoded, and nothing is ever fetched or opened." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader title="Link details" description="Fields marked required must be filled before you can copy or save." />
          <form className="card-pad space-y-6" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div>
              <label htmlFor="dest" className="label mb-1.5 flex items-center justify-between">Destination URL <span className="normal-case tracking-normal text-accent">required</span></label>
              <input id="dest" className={cn("field font-mono", destError && "border-sev-high/60")} value={dest} placeholder="https://example.com/landing?ref=home#pricing"
                onChange={(e) => { setDest(e.target.value); setSaved(null); }} onBlur={() => setTouched((t) => ({ ...t, dest: true }))}
                aria-invalid={!!destError} aria-describedby={destError ? "dest-err" : "dest-hint"} autoComplete="off" spellCheck={false} maxLength={2000} />
              {destError ? <p id="dest-err" className="mt-1.5 text-xs text-sev-high">{destError}</p>
                : <p id="dest-hint" className="mt-1.5 text-xs text-muted">Include https://. Existing parameters such as <span className="font-mono">?ref=home</span> and <span className="font-mono">#fragments</span> are kept.</p>}
            </div>

            <fieldset>
              <legend className="label mb-3">Required tracking parameters</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                {FIELDS.filter((f) => REQUIRED_UTM.includes(f.key)).map((f) => <UtmInput key={f.key} f={f} value={utm[f.key]} required onChange={set}
                  error={show(f.key) && !utm[f.key].trim() ? `${f.label} is required.` : null} onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))} options={[...suggestions[f.key]]} />)}
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
            <CardHeader title="Generated URL" description="Updates as you type." actions={ready ? <Badge tone="accent"><Check className="h-3 w-3" aria-hidden />Valid tags</Badge> : <Badge tone="dashed">Incomplete</Badge>} />
            <div className="card-pad space-y-4">
              <output data-testid="utm-preview" aria-live="polite" className={cn("block min-h-20 break-all rounded-md border border-line bg-bg/80 p-3 font-mono text-xs leading-relaxed", built.url ? "text-ink" : "text-faint")}>
                {built.url || "Enter a valid destination URL to see the tagged link."}
              </output>
              {parsed.ok && submitted && missing.length > 0 && <Alert tone="error" title="Required parameters missing">Add {missing.map((m) => m.replace("utm_", "")).join(", ")} before copying or saving.</Alert>}
              {saved && <Alert tone="success" title={saved.updated ? "Changes saved" : "Saved to your library"}>
                Stored in this browser only. <Link to="/campaigns/intelligence" className="underline">Open Campaign Intelligence</Link>
              </Alert>}
              {storageError && <Alert tone="error">{storageError}</Alert>}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={copy} disabled={!built.url}>{copied ? <><Check className="h-4 w-4" aria-hidden />Copied</> : <><Copy className="h-4 w-4" aria-hidden />Copy URL</>}</Button>
                <Button onClick={save} disabled={!built.url}><Save className="h-4 w-4" aria-hidden />{editing ? "Save changes" : "Save to library"}</Button>
                <Button variant="ghost" onClick={reset}>{editing ? "Cancel edit" : "Reset"}</Button>
              </div>
              <span className="sr-only" role="status">{copied ? "URL copied to clipboard" : ""}</span>
            </div>
          </Card>

          <Card className="card-pad">
            <div className="flex items-start gap-3">
              <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-faint" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Tag quality is not a safety check</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">Correct UTM tags say nothing about whether the destination is trustworthy. Run the security analyzer separately.</p>
                {built.url ? <Link to={`/analyzer?url=${encodeURIComponent(built.url)}`} className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline">Open in Analyzer <ArrowRight className="h-3 w-3" aria-hidden /></Link> : null}
              </div>
            </div>
          </Card>
          <LocalStorageNote />
        </div>
      </div>
    </>
  );
}

function UtmInput({ f, value, onChange, error, onBlur, required, options }: {
  f: (typeof FIELDS)[number]; value: string; onChange: (k: UtmKey, v: string) => void; error: string | null; onBlur: () => void; required?: boolean; options: string[];
}) {
  const listId = `${f.key}-list`;
  return (
    <div>
      <label htmlFor={f.key} className="label mb-1.5 block">{f.label}{required && <span aria-hidden className="ml-1 text-accent">*</span>}</label>
      <input id={f.key} className={cn("field font-mono", error && "border-sev-high/60")} value={value} onChange={(e) => onChange(f.key, e.target.value)} onBlur={onBlur}
        placeholder={f.example} list={options.length ? listId : undefined} aria-required={required} aria-invalid={!!error} aria-describedby={`${f.key}-d`} autoComplete="off" spellCheck={false} maxLength={200} />
      {options.length > 0 && <datalist id={listId}>{options.slice(0, 50).map((o) => <option key={o} value={o} />)}</datalist>}
      <p id={`${f.key}-d`} className={cn("mt-1.5 text-xs", error ? "text-sev-high" : "text-muted")}>{error ?? <><span className="font-mono text-faint">{f.key}</span> · {f.hint}</>}</p>
    </div>
  );
}
