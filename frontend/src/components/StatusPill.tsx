import { Loader2, RefreshCw } from "lucide-react";
import { Button, Segmented } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";

/** Always-visible active-mode indicator + explicit live/demo switch. Switching to demo is never automatic. */
export function StatusPill() {
  const { mode, setMode, effectiveMode, status, refresh } = useApp();
  const live = mode === "live";
  const model = status?.model.kind === "real_phiusiil" ? "real-data model" : status?.model.kind === "synthetic_demo" ? "synthetic demo model" : "no model";
  const view = {
    DEMO: { text: "Demo fixtures · Example data only", title: "DEMO FIXTURE mode: bundled example data only", dot: "bg-demo" },
    CHECKING: { text: "Connecting…", title: "Checking the backend", dot: "bg-faint" },
    BACKEND: { text: `Backend connected · ${model}`, title: "Backend connected · ML and supported backend services available", dot: status?.model.kind === "unavailable" ? "bg-sev-medium" : "bg-accent" },
    LOCAL: { text: "Local rules · backend unavailable", title: "Backend unavailable · Deterministic local analysis active", dot: "bg-sev-medium" },
  }[effectiveMode];
  return (
    <div className="flex items-center gap-2">
      <div className="flex max-w-[11rem] items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs sm:max-w-none" role="status" aria-live="polite" title={view.title} data-testid="mode-pill">
        {effectiveMode === "CHECKING" ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted" aria-hidden /> : <span className={cn("h-2 w-2 shrink-0 rounded-full", view.dot, effectiveMode === "BACKEND" && "pulse-dot")} aria-hidden />}
        <span className="truncate text-ink">{view.text}</span>
      </div>
      {live && <Button variant="ghost" size="icon" aria-label="Re-check backend connection" onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" /></Button>}
      <Segmented label="Data mode" value={mode} onChange={setMode}
        options={[{ value: "live", label: "Live API" }, { value: "demo", label: "Demo" }]} />
    </div>
  );
}
