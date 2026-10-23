import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileUp, Pencil, Search, ShieldQuestion, Trash2 } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { IssueList, LocalStorageNote, QualityBadge } from "@/components/campaigns/shared";
import { Alert, Button, Card, CardHeader, Dialog, EmptyState, Metric, PageHeader } from "@/components/ui/primitives";
import { cleanedCsv, importCampaignCsv, MAX_IMPORT_BYTES, rejectedCsv, reportCsv, splitDuplicates, type ImportResult } from "@/lib/campaign/importer";
import { analyzeRecords, type Analyzed, type IssueCode } from "@/lib/campaign/quality";
import { ISSUE_LABEL } from "@/lib/campaign/stats";
import { campaignStore, namingStore, useCampaigns, useNaming, type CampaignStore } from "@/lib/campaign/store";
import { buildUtmUrl, extractUtm, parseDestination } from "@/lib/campaign/utm";
import { cn, downloadBlob, fmtDate } from "@/lib/utils";

const PAGE_SIZE = 25;
type SortKey = "name" | "source" | "medium" | "campaign" | "status" | "updatedUtc";
type Status = "all" | Analyzed["status"];
const sortVal = (r: Analyzed, k: SortKey) => k === "source" ? r.utm.utm_source : k === "medium" ? r.utm.utm_medium : k === "campaign" ? r.utm.utm_campaign
  : k === "status" ? ({ error: 0, warn: 1, ok: 2 })[r.status] : k === "name" ? (r.name || r.baseUrl) : r.updatedUtc;

export default function CampaignIntelligence() {
  return (
    <>
      <PageHeader kicker="Campaign Library" title="Campaign Library"
        description="Search, filter and fix your saved campaign URLs. This reports tagging quality only: it does not know clicks, conversions or traffic, and it does not judge whether a URL is safe." />
      <CampaignLibrary />
    </>
  );
}

/** The library workspace. `store` defaults to the user's real library; the demo passes its sandbox store. */
export function CampaignLibrary({ store = campaignStore, embedded, sampleCsv, highlight }: {
  store?: CampaignStore; embedded?: boolean; sampleCsv?: { name: string; text: string }; highlight?: "browse" | "transfer";
}) {
  const records = useCampaigns(store);
  const naming = useNaming();
  const all = useMemo(() => analyzeRecords(records, naming), [records, naming]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [issue, setIssue] = useState<IssueCode | "">("");
  const [src, setSrc] = useState(""), [med, setMed] = useState(""), [camp, setCamp] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updatedUtc", dir: -1 });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Analyzed | null>(null);
  const [confirm, setConfirm] = useState<null | "selected" | "all">(null);
  const [pending, setPending] = useState<{ file: string; result: ImportResult } | null>(null);
  const [skipDupes, setSkipDupes] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [imp, setImp] = useState<ImportSummaryData | null>(null);
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

  function readText(file: string, text: string) {
    setImportError(null); setImp(null);
    const result = importCampaignCsv(text);
    if (result.fatal) { setPending(null); return setImportError(result.fatal); }
    setSkipDupes(true); setPending({ file, result });
  }
  async function onFile(f: File | undefined) {
    setImportError(null); setImp(null); setPending(null);
    if (fileRef.current) fileRef.current.value = ""; // allow re-selecting the same file after a fix
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) return setImportError("Choose a .csv file.");
    if (f.size > MAX_IMPORT_BYTES) return setImportError(`File is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${MAX_IMPORT_BYTES / 1048576} MB.`);
    let text: string;
    try { text = await f.text(); } catch { return setImportError("The file could not be read."); }
    readText(f.name, text);
  }
  const split = useMemo(() => (pending ? splitDuplicates(pending.result.records, records) : null), [pending, records]);
  function confirmImport() {
    if (!pending || !split) return;
    const toAdd = skipDupes ? split.fresh : pending.result.records;
    const r = store.add(toAdd);
    const skipped = skipDupes ? split.duplicates.length : 0;
    store.logImport({ at: new Date().toISOString(), file: pending.file, imported: r.added.length, rejected: pending.result.rejected.length, skippedDuplicates: skipped });
    setImp({ file: pending.file, result: pending.result, imported: r.added.length, dropped: r.dropped, skipped, duplicatesKept: skipDupes ? 0 : split.duplicates.length, storageError: r.ok ? undefined : r.error });
    setPending(null);
  }

  const download = (name: string, text: string) => downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), name);
  const stamp = new Date().toISOString().slice(0, 10);
  const exportRows = filtering ? filtered : all;

  function removeConfirmed() {
    if (confirm === "all") store.clear(); else store.remove([...selected]);
    setSelected(new Set()); setConfirm(null); resetPage();
  }

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void onFile(e.dataTransfer.files?.[0]); }}
        className={cn("mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors", dragging ? "border-accent bg-accent/10" : "border-line bg-surface/40", highlight === "transfer" && "ring-2 ring-accent/60")}>
        <p className="text-sm text-muted">{dragging ? "Drop the CSV to preview it." : <>Drag a CSV here, or import one. You will see a preview before anything is saved. Needs a <span className="font-mono text-ink">url</span> column; <span className="font-mono">name</span>, <span className="font-mono">note</span> and <span className="font-mono">utm_*</span> columns are optional.</>}</p>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Import CSV file" data-testid="csv-input" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button variant="primary" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" aria-hidden />Import CSV</Button>
          {sampleCsv && <>
            <Button onClick={() => download(sampleCsv.name, sampleCsv.text)}><Download className="h-4 w-4" aria-hidden />Download sample CSV</Button>
            <Button onClick={() => readText(sampleCsv.name, sampleCsv.text)}>Preview sample import</Button>
          </>}
        </div>
      </div>

      {importError && <Alert tone="error" title="Import failed" className="mb-4">{importError}</Alert>}
      {imp && <ImportSummary imp={imp} onDismiss={() => setImp(null)} onDownload={() => download(`rejected-rows-${stamp}.csv`, rejectedCsv(imp.result.rejected))} />}
      {pending && split && <ImportPreview pending={pending} split={split} skipDupes={skipDupes} setSkipDupes={setSkipDupes} onConfirm={confirmImport} onCancel={() => setPending(null)}
        onDownload={() => download(`rejected-rows-${stamp}.csv`, rejectedCsv(pending.result.rejected))} />}

      {all.length === 0 ? (
        <Card className="card-pad">
          <EmptyState icon={<Search className="h-7 w-7" aria-hidden />} title="No campaign URLs yet"
            action={<div className="flex flex-wrap justify-center gap-2">{!embedded && <Link to="/campaigns/studio" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-dim">Build a URL</Link>}
              <Button onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" aria-hidden />Import CSV</Button></div>}>
            Build a tagged URL in the Studio or import a CSV with a column named <span className="font-mono">url</span> (optional: name, note, utm_* columns).
          </EmptyState>
          {!embedded && <div className="mt-4"><LocalStorageNote /></div>}
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
              <table className="w-full min-w-[62rem] text-left" aria-label="Campaign URLs">
                <thead><tr>
                  <th className="th w-9"><input type="checkbox" aria-label="Select all on this page" className="accent-[#2DD4BF]" checked={allOnPage}
                    onChange={(e) => setSelected((s) => { const n = new Set(s); pageIds.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n; })} /></th>
                  <SortTh k="name" label="Label / URL" sort={sort} on={toggleSort} />
                  <SortTh k="source" label="Source" sort={sort} on={toggleSort} />
                  <SortTh k="medium" label="Medium" sort={sort} on={toggleSort} />
                  <SortTh k="campaign" label="Campaign" sort={sort} on={toggleSort} />
                  <SortTh k="status" label="Quality" sort={sort} on={toggleSort} />
                  <SortTh k="updatedUtc" label="Updated" sort={sort} on={toggleSort} />
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
                      <td className="td whitespace-nowrap text-2xs text-muted">{fmtDate(r.updatedUtc)}</td>
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
        {!embedded && <div className="mt-4"><LocalStorageNote /></div>}
      </>)}

      {edit && <EditDialog rec={edit} store={store} embedded={embedded} onClose={() => setEdit(null)} />}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm === "all" ? "Clear the whole library?" : `Delete ${selected.size} selected URL${selected.size === 1 ? "" : "s"}?`}
        description="This removes them from this browser. Export a CSV first if you need a copy."
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={removeConfirmed}>{confirm === "all" ? "Clear library" : "Delete"}</Button></>} />
    </>
  );
}

interface ImportSummaryData { file: string; result: ImportResult; imported: number; dropped: number; skipped: number; duplicatesKept: number; storageError?: string }

function ImportPreview({ pending, split, skipDupes, setSkipDupes, onConfirm, onCancel, onDownload }: {
  pending: { file: string; result: ImportResult }; split: { fresh: { finalUrl: string; name: string }[]; duplicates: unknown[] };
  skipDupes: boolean; setSkipDupes: (v: boolean) => void; onConfirm: () => void; onCancel: () => void; onDownload: () => void;
}) {
  const { result } = pending;
  const n = skipDupes ? split.fresh.length : result.records.length;
  const sample = result.records.slice(0, 5);
  return (
    <Card className="mb-5" data-testid="import-preview">
      <CardHeader title={`Preview: ${pending.file}`} description="Nothing has been saved yet." />
      <div className="card-pad space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Rows read" value={result.totalRows} />
          <Metric label="Valid" value={result.records.length} tone="accent" />
          <Metric label="Rejected" value={result.rejected.length} sub="listed below" />
          <Metric label="Already in library" value={split.duplicates.length} sub="duplicate tagged URLs" />
        </div>
        <p className="text-xs text-muted"><span className="text-ink">Columns used:</span> {result.columns.recognized.map((c) => `${c.column} → ${c.as}`).join(", ") || "none"}.
          {result.columns.ignored.length > 0 && <> <span className="text-ink">Ignored:</span> {result.columns.ignored.join(", ")}.</>}</p>
        {result.warnings.map((w) => <p key={w} className="text-xs text-sev-medium">{w}</p>)}
        {sample.length > 0 && (
          <ul className="space-y-1 rounded-md border border-line bg-bg/60 p-3 font-mono text-2xs text-muted" aria-label="First valid rows">
            {sample.map((r, i) => <li key={i} className="truncate" title={r.finalUrl}>{r.name ? `${r.name} · ` : ""}{r.finalUrl}</li>)}
            {result.records.length > sample.length && <li className="text-faint">… and {result.records.length - sample.length} more valid</li>}
          </ul>)}
        {result.rejected.length > 0 && (
          <div><p className="text-sm text-ink">{result.rejected.length} row{result.rejected.length === 1 ? "" : "s"} will be rejected:</p>
            <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-muted">{result.rejected.slice(0, 50).map((r) => <li key={r.line}>Line {r.line}: {r.message}</li>)}</ul>
            {result.rejected.length > 50 && <p className="mt-1 text-xs text-muted">…and {result.rejected.length - 50} more. Download the full list.</p>}
            <Button size="sm" className="mt-2" onClick={onDownload}><Download className="h-3.5 w-3.5" aria-hidden />Download rejection report</Button></div>)}
        {split.duplicates.length > 0 && (
          <label className="flex items-start gap-2 text-sm text-muted"><input type="checkbox" className="mt-1 accent-[#2DD4BF]" checked={skipDupes} onChange={(e) => setSkipDupes(e.target.checked)} />
            Skip the {split.duplicates.length} row{split.duplicates.length === 1 ? "" : "s"} already in the library or repeated earlier in this file (they are counted in the summary, not hidden).</label>)}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={n === 0} onClick={onConfirm}>Import {n} row{n === 1 ? "" : "s"}</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

function ImportSummary({ imp, onDismiss, onDownload }: { imp: ImportSummaryData; onDismiss: () => void; onDownload: () => void }) {
  const { result } = imp;
  const rej = result.rejected;
  return (
    <Alert tone={rej.length || imp.dropped || imp.storageError ? "warn" : "success"} title={`Imported ${imp.imported} of ${result.totalRows} rows from ${imp.file}`} className="mb-4"
      action={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
      {result.warnings.map((w) => <p key={w}>{w}</p>)}
      {imp.skipped > 0 && <p>{imp.skipped} duplicate row{imp.skipped === 1 ? "" : "s"} skipped.</p>}
      {imp.duplicatesKept > 0 && <p>{imp.duplicatesKept} duplicate row{imp.duplicatesKept === 1 ? "" : "s"} imported and flagged as duplicates.</p>}
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

export function NamingRules() {
  const n = useNaming();
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted" role="group" aria-label="Naming rules">
      <label className="inline-flex items-center gap-2"><input type="checkbox" className="accent-[#2DD4BF]" checked={n.requireLowercase} onChange={(e) => namingStore.set({ ...n, requireLowercase: e.target.checked })} />Require lowercase</label>
      <label className="inline-flex items-center gap-2"><input type="checkbox" className="accent-[#2DD4BF]" checked={n.requireSlugChars} onChange={(e) => namingStore.set({ ...n, requireSlugChars: e.target.checked })} />Letters, digits, - _ . only</label>
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

function EditDialog({ rec, store, embedded, onClose }: { rec: Analyzed; store: CampaignStore; embedded?: boolean; onClose: () => void }) {
  const [url, setUrl] = useState(rec.finalUrl);
  const [name, setName] = useState(rec.name);
  const [note, setNote] = useState(rec.note);
  const [err, setErr] = useState<string | null>(null);
  const parsed = parseDestination(url);
  const live = parsed.ok ? extractUtm(url) : null;

  function save() {
    if (!parsed.ok) return setErr(parsed.error);
    const clean = buildUtmUrl(url, live?.utm ?? {}).url; // re-encode consistently
    const r = store.update(rec.id, { finalUrl: clean, name: name.trim(), note: note.trim() });
    if (!r.ok) return setErr(r.error ?? "Could not save.");
    onClose();
  }
  return (
    <Dialog open wide onOpenChange={(o) => !o && onClose()} title="Campaign details" description="Inspect the tagged URL and fix it directly. Quality is re-checked as soon as you save."
      footer={<>{!embedded && <Link to={`/campaigns/studio?edit=${rec.id}`} className="mr-auto self-center text-xs text-accent hover:underline">Open in UTM Studio</Link>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <div><label htmlFor="e-url" className="label mb-1.5 block">Tagged URL</label>
          <textarea id="e-url" className="field min-h-24 break-all font-mono text-xs" value={url} onChange={(e) => { setUrl(e.target.value); setErr(null); }} spellCheck={false} maxLength={2000} aria-invalid={!parsed.ok} /></div>
        {!parsed.ok && <p className="text-xs text-sev-high">{parsed.error}</p>}
        {live && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-md border border-line bg-bg/60 p-3 font-mono text-xs" aria-label="UTM parameters">
            <dt className="text-faint">destination</dt><dd className="break-all text-muted">{live.base}</dd>
            {(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const).map((k) => (<Fragment key={k}><dt className="text-faint">{k}</dt><dd className="break-all">{live.utm[k] || <span className="text-faint">not set</span>}</dd></Fragment>))}
          </dl>)}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="e-name" className="label mb-1.5 block">Label</label><input id="e-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></div>
          <div><label htmlFor="e-note" className="label mb-1.5 block">Note</label><input id="e-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
        </div>
        <div><p className="label mb-1.5">Quality checks (as saved)</p>
          {rec.issues.length === 0 ? <p className="text-xs text-accent">No tagging issues.</p> : <IssueList issues={rec.issues} />}</div>
        <Link to={`/analyzer?url=${encodeURIComponent(rec.finalUrl)}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ShieldQuestion className="h-3.5 w-3.5" aria-hidden />Check this URL in the security Analyzer (separate from tag quality; it only pre-fills, it does not run)</Link>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Dialog>
  );
}
