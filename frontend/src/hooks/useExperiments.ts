import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { api, describeError } from "@/lib/api";
import { loadDemo } from "@/lib/demo";
import type { ExperimentSet, ExperimentSetInfo } from "@/lib/types";

interface Async<T> { data: T | null; loading: boolean; error: string | null; reload: () => void }

/** Index of saved result sets from the live API, or from the bundled demo snapshot in demo mode. No fallback between the two. */
export function useExperimentIndex(): Async<ExperimentSetInfo[]> {
  const { mode, apiState } = useApp();
  const [data, setData] = useState<ExperimentSetInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setData(null);
    if (mode === "live" && apiState !== "online") {
      setLoading(apiState === "checking");
      if (apiState === "offline") setError("Backend not reachable.");
      return;
    }
    const p = mode === "demo" ? loadDemo().then((d) => d.experiments.sets) : api.experimentSets().then((r) => r.sets);
    p.then((d) => alive && setData(d)).catch((e) => alive && setError(describeError(e))).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [mode, apiState, tick]);

  return { data, loading, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function useExperimentSet(id: string | null): Async<ExperimentSet> {
  const { mode, apiState } = useApp();
  const [data, setData] = useState<ExperimentSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    if (!id) return;
    if (mode === "live" && apiState !== "online") return;
    setLoading(true);
    const p = mode === "demo"
      ? loadDemo().then((d) => { const s = d.experiments.data[id]; if (!s) throw new Error("This result set is not included in the demo bundle."); return s; })
      : api.experimentSet(id);
    p.then((d) => alive && setData(d)).catch((e) => alive && setError(describeError(e))).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id, mode, apiState, tick]);

  return { data, loading, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}
