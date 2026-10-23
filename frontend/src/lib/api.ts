import type {
  AnalysisResponse, ApiErrorBody, ExperimentSet, ExperimentSetInfo, IncidentRecord, IncidentSummary, StatusResponse,
} from "./types";

/** Base URL of the FastAPI service. Public (VITE_*), so it must never hold a secret. */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const TOKEN_KEY = "threatlens.incidentToken";
export function getIncidentToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function setIncidentToken(t: string): void {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const token = getIncidentToken();
  if (token) headers.set("X-ThreatLens-Token", token);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: ctrl.signal });
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    throw new ApiError(0, aborted ? "timeout" : "unreachable",
      aborted ? "The backend did not respond in time (free hosts can take ~30-60 s to wake up)."
              : `Cannot reach the backend at ${API_BASE_URL}. Check VITE_API_BASE_URL, that the API is running, and CORS.`);
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try { body = await res.json(); } catch { /* non-JSON error */ }
    throw new ApiError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; version: string }>("/health", {}, 8000),
  status: () => request<StatusResponse>("/api/v1/status", {}, 25000),
  analyzeUrl: (url: string, useThreatIntel: boolean) =>
    request<AnalysisResponse>("/api/v1/analyze/url", { method: "POST", body: JSON.stringify({ url, use_threat_intel: useThreatIntel }) }, 20000),
  analyzeEmail: (p: { eml?: string; body?: string; useThreatIntel: boolean }) =>
    request<AnalysisResponse>("/api/v1/analyze/email", { method: "POST", body: JSON.stringify({ eml: p.eml, body: p.body, use_threat_intel: p.useThreatIntel }) }, 20000),
  experimentSets: () => request<{ sets: ExperimentSetInfo[] }>("/api/v1/experiments/results"),
  experimentSet: (id: string) => request<ExperimentSet>(`/api/v1/experiments/results/${encodeURIComponent(id)}`, {}, 30000),
  incidents: (p: { q?: string; verdict?: string; status?: string; sort?: string }) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
    return request<{ items: IncidentSummary[]; total: number; persistence_note: string }>(`/api/v1/incidents${qs ? `?${qs}` : ""}`);
  },
  incident: (id: string) => request<IncidentRecord>(`/api/v1/incidents/${encodeURIComponent(id)}`),
  saveIncident: (analysisId: string, storeRawBody: boolean, note: string) =>
    request<{ case_id: string; raw_body_stored: boolean }>("/api/v1/incidents", {
      method: "POST", body: JSON.stringify({ analysis_id: analysisId, store_raw_body: storeRawBody, note }),
    }),
  patchIncident: (id: string, body: { status?: string; note?: string }) =>
    request<{ updated: boolean }>(`/api/v1/incidents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteIncident: (id: string) => request<{ deleted: string }>(`/api/v1/incidents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  clearIncidents: () => request<{ deleted_count: number }>("/api/v1/incidents?confirm=true", { method: "DELETE" }),
  exportIncident: (id: string, format: "json" | "pdf") =>
    request<Blob>(`/api/v1/incidents/${encodeURIComponent(id)}/export?format=${format}`, {}, 60000),
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Unexpected error";
}
