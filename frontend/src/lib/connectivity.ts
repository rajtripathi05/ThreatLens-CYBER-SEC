import { API_BASE_URL } from "./api";

export type Connectivity = "CHECKING" | "CONNECTED" | "UNAVAILABLE";
export const HEALTH_TIMEOUT_MS = 3000;

export interface ConnectivitySnapshot { state: Connectivity; error: string | null; checkedAt: number | null }

/**
 * Small connectivity manager. It checks /health once at start-up, on explicit retry, and when the browser reports it is back online.
 * It never polls. Concurrent checks share one request, so overlapping callers cannot produce conflicting states.
 * A health check counts as CONNECTED only on a 2xx answer. Network failures, timeouts and a non-2xx health answer mark it UNAVAILABLE
 * (with a message that says which). During analysis, only network failures and timeouts trigger local fallback; HTTP errors are reported as errors.
 */
export class ConnectivityManager {
  private snap: ConnectivitySnapshot = { state: "CHECKING", error: null, checkedAt: null };
  private listeners = new Set<() => void>();
  private inflight: Promise<ConnectivitySnapshot> | null = null;
  private epoch = 0;

  constructor(private readonly baseUrl: string = API_BASE_URL, private readonly fetchImpl: () => typeof fetch = () => fetch, private readonly timeoutMs = HEALTH_TIMEOUT_MS) {}

  getSnapshot = (): ConnectivitySnapshot => this.snap;
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };

  private set(next: ConnectivitySnapshot) {
    if (next.state === this.snap.state && next.error === this.snap.error) return;
    this.snap = next;
    this.listeners.forEach((l) => l());
  }

  /** Runs (or joins) a health check. */
  check(): Promise<ConnectivitySnapshot> {
    if (this.inflight) return this.inflight;
    const myEpoch = ++this.epoch;
    this.set({ ...this.snap, state: "CHECKING", error: null });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const run = (async (): Promise<ConnectivitySnapshot> => {
      try {
        const res = await this.fetchImpl()(`${this.baseUrl}/health`, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) throw new HttpFailure(res.status);
        if (myEpoch === this.epoch) this.set({ state: "CONNECTED", error: null, checkedAt: Date.now() });
      } catch (e) {
        if (myEpoch === this.epoch) {
          const aborted = (e as Error).name === "AbortError";
          const msg = e instanceof HttpFailure ? `The backend answered the health check with HTTP ${e.status}.`
            : aborted ? `The backend did not answer within ${this.timeoutMs / 1000} s.` : `Cannot reach the backend at ${this.baseUrl}.`;
          this.set({ state: "UNAVAILABLE", error: msg, checkedAt: Date.now() });
        }
      } finally { clearTimeout(timer); }
      return this.snap;
    })();
    this.inflight = run;
    void run.finally(() => { if (this.inflight === run) this.inflight = null; });
    return run;
  }

  /** Back to the initial CHECKING state and drop any in-flight result. Used by tests. */
  reset(): void { this.epoch++; this.inflight = null; this.snap = { state: "CHECKING", error: null, checkedAt: null }; this.listeners.forEach((l) => l()); }

  /** Called by the request layer after a genuine network failure or timeout (not after an HTTP error). */
  reportNetworkFailure(message: string): void {
    this.epoch++;
    this.set({ state: "UNAVAILABLE", error: message, checkedAt: Date.now() });
  }
}

class HttpFailure extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }

export const connectivity = new ConnectivityManager();
