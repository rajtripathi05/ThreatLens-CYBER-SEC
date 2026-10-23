import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { connectivity, type Connectivity } from "@/lib/connectivity";
import { loadBundledSnapshot, type AnalysisConfig, type LocalAnalysis } from "@/lib/localAnalysis";
import type { StatusResponse, TaggedAnalysis } from "@/lib/types";

export type Mode = "live" | "demo";
export type ApiState = "checking" | "online" | "offline";
/** What is actually answering analysis requests right now. */
export type EffectiveMode = "BACKEND" | "LOCAL" | "DEMO" | "CHECKING";

interface Ctx {
  mode: Mode;
  setMode: (m: Mode) => void;
  apiState: ApiState;
  connectivity: Connectivity;
  apiError: string | null;
  status: StatusResponse | null;
  /** Explicit user retry. A successful retry resumes backend mode. */
  refresh: () => Promise<void>;
  effectiveMode: EffectiveMode;
  /** True while the backend is reachable again but the user has not yet resumed backend mode. */
  backendReturned: boolean;
  resumeBackend: () => void;
  /** Called after a genuine network failure/timeout during a backend request. */
  reportBackendFailure: (message: string) => void;
  getLocalConfig: () => Promise<AnalysisConfig>;
  analysis: TaggedAnalysis | null;
  setAnalysis: (a: TaggedAnalysis | null) => void;
  /** Latest browser-local result. Memory only, never persisted. */
  localAnalysis: LocalAnalysis | null;
  setLocalAnalysis: (a: LocalAnalysis | null) => void;
}

const AppCtx = createContext<Ctx | null>(null);
const MODE_KEY = "threatlens.mode";
const ANALYSIS_KEY = "threatlens.lastAnalysis";

function readMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === "demo" ? "demo" : "live"; } catch { return "live"; }
}
function readAnalysis(): TaggedAnalysis | null {
  try { const s = sessionStorage.getItem(ANALYSIS_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

const API_STATE: Record<Connectivity, ApiState> = { CHECKING: "checking", CONNECTED: "online", UNAVAILABLE: "offline" };

export function AppProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(readMode);
  const conn = useSyncExternalStore(connectivity.subscribe, connectivity.getSnapshot);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [analysis, setAnalysisState] = useState<TaggedAnalysis | null>(readAnalysis);
  const [localAnalysis, setLocalAnalysis] = useState<LocalAnalysis | null>(null);
  const [localHold, setLocalHold] = useState(false);
  const cfg = useRef<Promise<AnalysisConfig> | null>(null);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  }, []);

  const setAnalysis = useCallback((a: TaggedAnalysis | null) => {
    setAnalysisState(a);
    try { a ? sessionStorage.setItem(ANALYSIS_KEY, JSON.stringify(a)) : sessionStorage.removeItem(ANALYSIS_KEY); } catch { /* ignore */ }
  }, []);

  const loadStatus = useCallback(async () => {
    try { setStatus(await api.status()); }
    catch (e) {
      setStatus(null);
      if (e instanceof ApiError && e.status === 0) connectivity.reportNetworkFailure(e.message); // the HTTP-level answer, if any, keeps us CONNECTED
    }
  }, []);

  /** Single entry point for checks; concurrent calls share one health request. */
  const check = useCallback(async (explicit: boolean) => {
    const snap = await connectivity.check();
    if (snap.state === "CONNECTED") {
      if (explicit) setLocalHold(false);
      await loadStatus();
    } else setStatus(null);
  }, [loadStatus]);

  const refresh = useCallback(() => check(true), [check]);

  // Start-up check, once per switch into live mode. No polling.
  useEffect(() => { if (mode === "live") void check(false); }, [mode, check]);
  // Browser says the network is back: one automatic check (may offer, never force, a switch back).
  useEffect(() => {
    if (mode !== "live") return;
    const on = () => void check(false);
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [mode, check]);
  // Latch local mode as soon as the backend is unavailable; only the user can release it.
  useEffect(() => { if (conn.state === "UNAVAILABLE") setLocalHold(true); }, [conn.state]);

  const resumeBackend = useCallback(() => setLocalHold(false), []);
  const reportBackendFailure = useCallback((m: string) => connectivity.reportNetworkFailure(m), []);
  const getLocalConfig = useCallback(() => (cfg.current ??= loadBundledSnapshot()), []);

  const effectiveMode: EffectiveMode =
    mode === "demo" ? "DEMO"
    : conn.state === "UNAVAILABLE" || localHold ? "LOCAL"
    : conn.state === "CHECKING" ? "CHECKING" : "BACKEND";
  const backendReturned = mode === "live" && localHold && conn.state === "CONNECTED";

  const value = useMemo(
    () => ({
      mode, setMode, apiState: API_STATE[conn.state], connectivity: conn.state, apiError: conn.error, status, refresh, effectiveMode, backendReturned,
      resumeBackend, reportBackendFailure, getLocalConfig, analysis, setAnalysis, localAnalysis, setLocalAnalysis,
    }),
    [mode, setMode, conn, status, refresh, effectiveMode, backendReturned, resumeBackend, reportBackendFailure, getLocalConfig, analysis, setAnalysis, localAnalysis],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}
