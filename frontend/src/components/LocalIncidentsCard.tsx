import { HardDrive, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Dialog } from "@/components/ui/primitives";
import { clearLocalIncidents, deleteLocalIncident, listLocalIncidents, type LocalIncident } from "@/lib/localStore";
import { defang, fmtDate } from "@/lib/utils";

/** Incidents saved in THIS browser by the local rule engine. Clearly separate from backend (remote) incidents. */
export function LocalIncidentsCard() {
  const [items, setItems] = useState<LocalIncident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await listLocalIncidents()); setError(null); } catch (e) { setItems([]); setError(e instanceof Error ? e.message : "Local storage is unavailable."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card className="mb-4">
      <CardHeader title={<span className="inline-flex items-center gap-2"><HardDrive className="h-4 w-4 text-faint" aria-hidden />Local incidents (this browser only)</span>}
        description="Saved by the local rule engine. Not synchronised with the backend and never uploaded automatically."
        actions={<Button variant="danger" size="sm" onClick={() => setConfirm(true)} disabled={!items?.length}><Trash2 className="h-3.5 w-3.5" aria-hidden />Clear local data</Button>} />
      {error && <p className="card-pad text-sm text-sev-high" role="alert">{error}</p>}
      {items && items.length === 0 && !error && <p className="card-pad text-sm text-muted">No local incidents. Analyses are not saved unless you choose "Save locally" in the Analyzer.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y divide-line" aria-label="Local incidents">{items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:px-5">
            <span className="font-mono text-xs text-ink">{i.id}</span>
            <Badge tone="demo">Local only</Badge>
            <Badge tone={i.verdict === "HIGHER RISK" ? "high" : i.verdict === "SUSPICIOUS" ? "medium" : "neutral"}>{i.verdict}</Badge>
            <span className="font-mono text-xs text-muted">{i.riskScore}/100 · {i.ruleSetVersion}</span>
            <span className="text-xs text-muted">{fmtDate(i.createdUtc)} · {i.inputType}{i.rawSaved ? " · raw text stored" : ""}</span>
            {i.firstUrl && <span className="min-w-0 break-all font-mono text-2xs text-faint">{defang(i.firstUrl)}</span>}
            <Button variant="ghost" size="sm" className="ml-auto" aria-label={`Delete local incident ${i.id}`} onClick={() => void deleteLocalIncident(i.id).then(load)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
          </li>))}
        </ul>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm} title="Clear all local data?" description="Deletes every incident stored in this browser, including any raw message text you opted to keep. Backend incidents are not affected."
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void clearLocalIncidents().then(() => { setConfirm(false); return load(); })}>Clear local data</Button></>}>
        <p className="text-sm text-muted">This cannot be undone.</p>
      </Dialog>
    </Card>
  );
}
