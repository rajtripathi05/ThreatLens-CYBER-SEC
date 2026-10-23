import { CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { usePwa } from "@/lib/pwa";

export const LOCAL_BANNER_TITLE = "BACKEND UNAVAILABLE · LOCAL RULE-BASED MODE ACTIVE";
export const LOCAL_BANNER_TEXT =
  "The backend could not be reached. ThreatLens is using deterministic local rules. ML inference, live threat intelligence and backend services are unavailable. Results are heuristic assessments, not calibrated probabilities.";

export const UNAVAILABLE_IN_LOCAL = [
  "ML-based URL classification (the trained model runs only on the backend)",
  "Live or enriched threat intelligence (only an optional bundled snapshot, otherwise UNKNOWN)",
  "Remote incident storage and sync (incidents are kept in this browser only)",
  "Research API data (saved experiment results are available only as labelled bundled fixtures in Demo mode)",
  "Backend PDF export (a JSON file and a print-friendly HTML report are available instead)",
];

/** Persistent mode banner shown on every page while the backend is unavailable (and a prompt when it returns). */
export function ConnectivityBanner() {
  const { mode, effectiveMode, backendReturned, apiError, refresh, resumeBackend, connectivity } = useApp();
  const pwa = usePwa();
  if (mode === "demo") return null;

  if (backendReturned) {
    return (
      <div className="border-b border-accent/30 bg-accent/5 px-4 py-2.5 sm:px-6" role="status">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <CheckCircle2 className="h-4 w-4 text-accent" aria-hidden />
          <p className="text-ink/90"><strong className="text-accent">Backend available again.</strong> Analyses still run locally until you resume backend mode.</p>
          <Button size="sm" variant="primary" onClick={resumeBackend}>Resume backend mode</Button>
        </div>
      </div>
    );
  }
  if (effectiveMode !== "LOCAL") return null;

  return (
    <div className="border-b border-demo/40 bg-demo/10 px-4 py-3 sm:px-6" role="status" aria-live="polite" data-testid="local-mode-banner">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start gap-3">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-demo" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold tracking-wide text-demo sm:text-sm">{LOCAL_BANNER_TITLE}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/85">{LOCAL_BANNER_TEXT}</p>
            {apiError && <p className="mt-1 font-mono text-2xs text-muted">{apiError}</p>}
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer select-none text-ink/90 underline-offset-2 hover:underline">What is unavailable in local mode?</summary>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{UNAVAILABLE_IN_LOCAL.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="mt-1.5">Still available: URL and email analysis by transparent local rules, local JSON/HTML reports, browser-only incident notes{pwa.offlineReady ? ", and this app (cached for offline use)" : ""}.</p>
            </details>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void refresh()} loading={connectivity === "CHECKING"}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />Retry Connection
          </Button>
        </div>
      </div>
    </div>
  );
}
