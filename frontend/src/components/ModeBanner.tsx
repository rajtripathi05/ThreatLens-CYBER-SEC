import { Alert, Button } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";

export function ModeBanner() {
  const { setMode } = useApp();
  return (
    <div className="border-b border-demo/30 bg-demo/5 px-4 py-2 sm:px-6">
      <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 text-xs text-demo">
        <strong className="font-semibold uppercase tracking-wide">DEMO FIXTURE</strong>
        <span className="text-ink/80">You are viewing precomputed named fixtures and saved result files bundled with this site. Nothing is being scored by a live model.</span>
        <button className="underline underline-offset-2 hover:text-ink" onClick={() => setMode("live")}>Switch to live API</button>
      </p>
    </div>
  );
}

/** Shown on any page that needs the backend while the API is unreachable. Never auto-switches to demo. */
export function OfflineNotice({ error, onRetry, what }: { error: string | null; onRetry: () => void; what: string }) {
  const { setMode } = useApp();
  return (
    <Alert tone="error" title="Backend not reachable"
      action={<div className="flex shrink-0 items-start gap-2"><Button size="sm" onClick={onRetry}>Retry</Button><Button size="sm" variant="secondary" onClick={() => setMode("demo")}>Use demo mode</Button></div>}>
      {error ?? "The API did not respond."} {what} Nothing has been substituted: no results are shown until the API responds or you explicitly choose demo mode.
    </Alert>
  );
}
