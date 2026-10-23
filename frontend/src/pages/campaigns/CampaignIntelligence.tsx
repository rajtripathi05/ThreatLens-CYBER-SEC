import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileUp, Pencil, Search, ShieldQuestion, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LocalStorageNote, QualityBadge } from "@/components/campaigns/shared";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Metric, PageHeader } from "@/components/ui/primitives";
import { cleanedCsv, importCampaignCsv, MAX_IMPORT_BYTES, rejectedCsv, reportCsv, type ImportResult } from "@/lib/campaign/importer";
import { analyzeRecords, type Analyzed, type IssueCode } from "@/lib/campaign/quality";
import { campaignStore, useCampaigns, useNaming } from "@/lib/campaign/store";
import { buildUtmUrl, extractUtm, parseDestination } from "@/lib/campaign/utm";
import { cn, downloadBlob } from "@/lib/utils";

const PAGE_SIZE = 25;
type SortKey = "name" | "source" | "medium" | "campaign" | "status" | "createdUtc";
type Status = "all" | Analyzed["status"];
const ISSUE_LABEL: Record<IssueCode, string> = {
  "invalid-url": "Invalid URL", "missing-required": "Missing UTM", duplicate: "Duplicate", "naming-case": "Not lowercase",
  "naming-chars": "Special characters", "naming-variant": "Spelling variants", "param-repeat": "Repeated parameter",
};
const sortVal = (r: Analyzed, k: SortKey) => k === "source" ? r.utm.utm_source : k === "medium" ? r.utm.utm_medium : k === "campaign" ? r.utm.utm_campaign
  : k === "status" ? ({ error: 0, warn: 1, ok: 2 })[r.status] : k === "name" ? (r.name || r.baseUrl) : r.createdUtc;

export default function CampaignIntelligence() {
  const records = useCampaigns();
  const naming = useNaming();
  const all = useMemo(() => analyzeRecords(records, naming), [records, naming]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [issue, setIssue] = useState<IssueCode | "">("");
  const [src, setSrc] = useState(""), [med, setMed] = useState(""), [camp, setCamp] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdUtc", dir: -1 });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Analyzed | null>(null);
  const [confirm, setConfirm] = useState<null | "selected" | "all">(null);
  const [imp, setImp] = useState<{ file: string; result: ImportResult; dropped: number; storageError?: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const uniq = (f: (r: Analyzed) => string) => [...new Set(all.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { src: uniq((r) => r.utm.utm_source), med: uniq((r) => r.utm.utm_medium), camp: uniq((r) => r.utm.utm_campaign) };
  }, [all]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = all.filter((r) =>
      (status === "all" || r.status === status) && (!issue || r.issues.some((i) => i.code === issue)) &&
      (!src || r.utm.utm_source === src) && (!med || r.utm.utm_medium === med) && (!camp || r.utm.utm_campaign === camp) &&
      (!needle || `${r.name} ${r.finalUrl} ${r.note}`.toLowerCase().includes(needle)));
    return rows.sort((a, b) => {
      const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    });
  }, [all, q, status, issue, src, med, camp, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const rows = filtered.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE);
  const filtering = !!(q || status !== "all" || issue || src || med || camp);

  const counts = useMemo(() => {
    const byCode = new Map<IssueCode, number>();
    all.forEach((r) => new Set(r.issues.map((i) => i.code)).forEach((c) => byCode.set(c, (byCode.get(c) ?? 0) + 1)));
    return { byCode, errors: all.filter((r) => r.status === "error").length, clean: all.filter((r) => r.status === "ok").length };
  }, [all]);

  const resetPage = () => setPage(0);
  const toggleSort = (key: SortKey) => { setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 })); resetPage(); };
  const clearFilters = () => { setQ(""); setStatus("all"); setIssue(""); setSrc(""); setMed(""); setCamp(""); resetPage(); };

  async function onFile(f: File | undefined) {
    setImportError(null); setImp(null);
    if (fileRef.current) fileRef.current.value = ""; // allow re-selecting the same file after a fix
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) return setImportError("Choose a .csv file.");
    if (f.size > MAX_IMPORT_BYTES) return setImportError(`File is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${MAX_IMPORT_BYTES / 1048576} MB.`);
    let text: string;
    try { text = await f.text(); } catch { return setImportError("The file could not be read."); }
    const result = importCampaignCsv(text);
    if (result.fatal) return setImportError(result.fatal);
    const r = campaignStore.add(result.records);
    setImp({ file: f.name, result, dropped: r.dropped, storageError: r.ok ? undefined : r.error });
    if (fileRef.current) fileRef.current.value = "";
  }

  const download = (name: string, text: string) => downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), name);
  const stamp = new Date().toISOString().slice(0, 10);
  const exportRows = filtering ? filtered : all;

  function removeConfirmed() {
    if (confirm === "all") campaignStore.clear(); else campaignStore.remove([...selected]);
    setSelected(new Set()); setConfirm(null); resetPage();
  }

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <>
      <PageHeader kicker="Campaigns · Intelligence" title="Campaign Intelligence"
        description="Organise tagged URLs and find tagging problems: missing parameters, duplicates and inconsistent naming. This reports data quality only. It does not know clicks, conversions or traffic, and it does not judge whether a URL is safe."
        actions={<>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Import CSV file" data-testid="csv-input" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button variant="primary" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" aria-hidden />Import CSV</Button>
        </>} />

      {importError && <Alert tone="error" title="Import failed" className="mb-4">{importError}</Alert>}
      {imp && <ImportSummary imp={imp} onDismiss={() => setImp(null)} onDownload={() => download(`rejected-rows-${stamp}.csv`, rejectedCsv(imp.result.rejected))} />}

      {all.length === 0 ? (
        <Card className="card-pad">
          <EmptyState icon={<Search className="h-7 w-7" aria-hidden />} title="No campaign URLs yet"
            action={<div className="flex flex-wrap justify-center gap-2"><Link to="/campaigns/studio" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-dim">Build a URL</Link>
              <Button onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" aria-hidden />Import CSV</Button></div>}>
            Build a tagged URL in the Studio or import a CSV with a column named <span className="font-mono">url</span> (optional: name, note, utm_* columns).
          </EmptyState>
          <div className="mt-4"><LocalStorageNote /></div>
        </Card>
      ) : (<>
        <section aria-label="Data quality summary" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Saved URLs" value={all.length} sub={`${options.camp.length} unique campaign${options.camp.length === 1 ? "" : "s"}`} />
          <Metric label="Clean" value={counts.clean} tone="accent" sub="no tagging issues" />
          <Metric label="With errors" value={counts.errors} sub="invalid URL or missing required UTM" />
          <Metric label="Duplicates" value={counts.byCode.get("duplicate") ?? 0} sub="URLs sharing an identical tagged link" />
        </section>

        <Card className="mb-5">
          <CardHeader title="Issues found" description="Select an issue to filter the table to affected URLs."
            actions={<NamingRules />} />
          <div className="flex flex-wrap gap-2 px-4 py-3 sm:px-5">
            {counts.byCode.size === 0 ? <p className="text-sm text-muted">No tagging issues in the current library.</p> :
              [...counts.byCode.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => (
                <button key={code} onClick={() => { setIssue(issue === code ? "" : code); resetPage(); }} aria-pressed={issue === code}
                  className={cn("inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors", issue === code ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:border-faint hover:text-ink")}>
                  {ISSUE_LABEL[code]} <span className="numeral text-ink">{n}</span>
                </button>))}
          </div>
        </Card>

        <Card>
          <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3 sm:px-5">
            <div className="relative min-w-[14rem] flex-1">
              <label htmlFor="q" className="label mb-1.5 block">Search</label>
              <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-faint" aria-hidden />
              <input id="q" className="field pl-9" value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} placeholder="URL, label or note" />
            </div>
            <Select id="f-status" label="Status" value={status} onChange={(v) => { setStatus(v as Status); resetPage(); }} options={[["all", "All"], ["ok", "Clean"], ["warn", "Warnings"], ["error", "Errors"]]} />
            <Select id="f-src" label="Source" value={src} onChange={(v) => { setSrc(v); resetPage(); }} options={[["", "All"], ...options.src.map((o): [string, string] => [o, o])]} />
            <Select id="f-med" label="Medium" value={med} onChange={(v) => { setMed(v); resetPage(); }} options={[["", "All"], ...options.med.map((o): [string, string] => [o, o])]} />
            <Select id="f-camp" label="Campaign" value={camp} onChange={(v) => { setCamp(v); resetPage(); }} options={[["", "All"], ...options.camp.map((o): [string, string] => [o, o])]} />
            {filtering && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 sm:px-5">
            <p className="text-xs text-muted" aria-live="polite">{filtered.length === all.length ? `${all.length} URLs` : `${filtered.length} of ${all.length} URLs`}{selected.size > 0 && ` · ${selected.size} selected`}</p>
            <div className="flex flex-wrap gap-2">
              {selected.size > 0 && <Button variant="danger" size="sm" onClick={() => setConfirm("selected")}><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete {selected.size}</Button>}
              <Button size="sm" disabled={exportRows.length === 0} onClick={() => download(`campaign-urls-${stamp}.csv`, cleanedCsv(exportRows))}><Download className="h-3.5 w-3.5" aria-hidden />Export URLs{filtering ? " (filtered)" : ""}</Button>
              <Button size="sm" disabled={exportRows.length === 0} onClick={() => download(`validation-report-${stamp}.csv`, reportCsv(exportRows))}><Download className="h-3.5 w-3.5" aria-hidden />Validation report</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm("all")}>Clear library</Button>
            </div>
          </div>

          {filtered.length === 0 ? <div className="card-pad"><EmptyState title="No URLs match these filters" action={<Button onClick={clearFilters}>Clear filters</Button>} /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left" aria-label="Campaign URLs">
                <thead><tr>
                  <th className="th w-9"><input type="checkbox" aria-label="Select all on this page" className="accent-[#2DD4BF]" checked={allOnPage}
                    onChange={(e) => setSelected((s) => { const n = new Set(s); pageIds.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n; })} /></th>
                  <SortTh k="name" label="Label / URL" sort={sort} on={toggleSort} />
                  <SortTh k="source" label="Source" sort={sort} on={toggleSort} />
                  <SortTh k="medium" label="Medium" sort={sort} on={toggleSort} />
                  <SortTh k="campaign" label="Campaign" sort={sort} on={toggleSort} />
                  <SortTh k="status" label="Quality" sort={sort} on={toggleSort} />
                  <th className="th"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="td"><input type="checkbox" aria-label={`Select ${r.name || r.baseUrl}`} className="accent-[#2DD4BF]" checked={selected.has(r.id)}
                        onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                      <td className="td max-w-[22rem]">
                        {r.name && <p className="truncate text-sm font-medium">{r.name}</p>}
                        <p className="truncate font-mono text-xs text-muted" title={r.finalUrl}>{r.baseUrl}</p>
                      </td>
                      <td className="td font-mono text-xs">{r.utm.utm_source || <span className="text-sev-high">—</span>}</td>
                      <td className="td font-mono text-xs">{r.utm.utm_medium || <span className="text-sev-high">—</span>}</td>
                      <td className="td font-mono text-xs">{r.utm.utm_campaign || <span className="text-sev-high">—</span>}</td>
                      <td className="td"><QualityBadge status={r.status} />
                        {r.issues.length > 0 && <p className="mt-1 max-w-[14rem] text-2xs text-muted">{[...new Set(r.issues.map((i) => ISSUE_LABEL[i.code]))].join(" · ")}</p>}</td>
                      <td className="td whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEdit(r)} aria-label={`Inspect and edit ${r.name || r.baseUrl}`}><Pencil className="h-3.5 w-3.5" aria-hidden />Inspect</Button>
                      </td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}

          {pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
              <p className="text-xs text-muted">Page {cur + 1} of {pages}</p>
              <div className="flex gap-2"><Button size="sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</Button><Button size="sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</Button></div>
            </nav>)}
        </Card>
        <div className="mt-4"><LocalStorageNote /></div>
      </>)}

      {edit && <EditDialog rec={edit} onClose={() => setEdit(null)} />}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm === "all" ? "Clear the whole library?" : `Delete ${selected.size} selected URL${selected.size === 1 ? "" : "s"}?`}
        description="This removes them from this browser. Export a CSV first if you need a copy."
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={removeConfirmed}>{confirm === "all" ? "Clear library" : "Delete"}</Button></>} />
    </>
  );
}

function ImportSummary({ imp, onDismiss, onDownload }: { imp: { file: string; result: ImportResult; dropped: number; storageError?: string }; onDismiss: () => void; onDownload: () => void }) {
  const { result } = imp;
  const rej = result.rejected;
  return (
    <Alert tone={rej.length || imp.dropped || imp.storageError ? "warn" : "success"} title={`Imported ${result.records.length - imp.dropped} of ${result.totalRows} rows from ${imp.file}`} className="mb-4"
      action={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
      {result.warnings.map((w) => <p key={w}>{w}</p>)}
      {imp.dropped > 0 && <p>{imp.dropped} rows were not saved because the library limit was reached.</p>}
      {imp.storageError && <p>{imp.storageError}</p>}
      {rej.length > 0 && (<div className="mt-2">
        <p>{rej.length} row{rej.length === 1 ? "" : "s"} rejected:</p>
        <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">{rej.slice(0, 50).map((r) => <li key={r.line}>Line {r.line}: {r.message}</li>)}</ul>
        {rej.length > 50 && <p className="mt-1 text-xs">…and {rej.length - 50} more. Download the full list.</p>}
        <Button size="sm" className="mt-2" onClick={onDownload}><Download className="h-3.5 w-3.5" aria-hidden />Download rejected rows</Button>
      </div>)}
    </Alert>
  );
}

function NamingRules() {
  const n = useNaming();
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted" role="group" aria-label="Naming rules">
      <label className="inline-flex items-center gap-2"><input type="checkbox" className="accent-[#2DD4BF]" checked={n.requireLowercase} onChange={(e) => campaignStore.setNaming({ ...n, requireLowercase: e.target.checked })} />Require lowercase</label>
      <label className="inline-flex items-center gap-2"><input type="checkbox" className="accent-[#2DD4BF]" checked={n.requireSlugChars} onChange={(e) => campaignStore.setNaming({ ...n, requireSlugChars: e.target.checked })} />Letters, digits, - _ . only</label>
    </div>
  );
}

function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="min-w-[8.5rem]">
      <label htmlFor={id} className="label mb-1.5 block">{label}</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
  );
}

function SortTh({ k, label, sort, on }: { k: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; on: (k: SortKey) => void }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th className="th" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => on(k)} className={cn("inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink", active && "text-ink")}>{label}<Icon className="h-3 w-3" aria-hidden /></button>
    </th>
  );
}

function EditDialog({ rec, onClose }: { rec: Analyzed; onClose: () => void }) {
  const [url, setUrl] = useState(rec.finalUrl);
  const [name, setName] = useState(rec.name);
  const [note, setNote] = useState(rec.note);
  const [err, setErr] = useState<string | null>(null);
  const parsed = parseDestination(url);
  const live = parsed.ok ? extractUtm(url) : null;

  function save() {
    if (!parsed.ok) return setErr(parsed.error);
    const clean = buildUtmUrl(url, live?.utm ?? {}).url; // re-encode consistently
    const r = campaignStore.update(rec.id, { finalUrl: clean, name: name.trim(), note: note.trim() });
    if (!r.ok) return setErr(r.error ?? "Could not save.");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Inspect and edit" description="Fix the tagged URL directly. Quality is re-checked as soon as you save."
      footer={<><Link to={`/campaigns/studio?edit=${rec.id}`} className="mr-auto self-center text-xs text-accent hover:underline">Open in Studio</Link>
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <div><label htmlFor="e-url" className="label mb-1.5 block">Tagged URL</label>
          <textarea id="e-url" className="field min-h-24 font-mono text-xs" value={url} onChange={(e) => { setUrl(e.target.value); setErr(null); }} spellCheck={false} maxLength={2000} aria-invalid={!parsed.ok} /></div>
        {!parsed.ok && <p className="text-xs text-sev-high">{parsed.error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="e-name" className="label mb-1.5 block">Label</label><input id="e-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></div>
          <div><label htmlFor="e-note" className="label mb-1.5 block">Note</label><input id="e-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
        </div>
        {rec.issues.length > 0 && (<div><p className="label mb-1.5">Current issues</p>
          <ul className="space-y-1 text-xs text-muted">{rec.issues.map((i) => <li key={i.code + i.message} className="flex gap-2"><Badge tone={i.severity === "error" ? "high" : "medium"}>{i.severity}</Badge>{i.message}</li>)}</ul></div>)}
        <Link to={`/analyzer?url=${encodeURIComponent(rec.finalUrl)}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ShieldQuestion className="h-3.5 w-3.5" aria-hidden />Check this URL in the security Analyzer (separate from tag quality)</Link>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Dialog>
  );
}
