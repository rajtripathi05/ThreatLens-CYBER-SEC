import "fake-indexeddb/auto";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { LOCAL_BANNER_TEXT, LOCAL_BANNER_TITLE } from "@/components/ConnectivityBanner";
import { AppProvider } from "@/context/AppContext";
import { connectivity } from "@/lib/connectivity";
import { clearLocalIncidents, listLocalIncidents } from "@/lib/localStore";
import type { AnalysisResponse } from "@/lib/types";

const PHISH = "http://secure-paypal-login.example/verify/a1b2c3";

const backendResult: AnalysisResponse = {
  analysis_id: "abc12345", created_utc: "2026-01-01T00:00:00+00:00", input_kind: "url", overall_decision: "review", overall_label: "Needs human review",
  overall_score: 0.4, score_semantics: "Heuristic, not a probability.", scope_note: "URL strings only.", disclaimer: "d",
  model: { kind: "real_phiusiil", version: "v-backend", trained_on_synthetic: false, detail: "", thresholds: { t_hi: 0.5 } },
  ti_source: { loaded: true, entries: 8, consulted: true }, email_meta: {}, email_evidence: [], notes: [],
  urls: [{
    url: PHISH, normalized: PHISH, source: "input", decision: "review", decision_label: "x", risk_score: 0.4, ml_probability: 0.42, ml_top_terms: [],
    ti: { state: "NO_MATCH", indicator: "", source: "", observed_at: null, expires_at: null, detail: "no match" }, contributions: [], rationale: "backend rationale",
    evidence: [], suggested_actions: ["Be careful"],
  }],
};
const STATUS = { api_version: "1.0", uptime_seconds: 1, model: { kind: "real_phiusiil", detail: "" }, dataset: { phiusiil_present: true },
  threat_intel: { loaded: true, entries: 8, detail: "" }, experiments: [], incidents: { enabled: true, token_required: false, raw_storage_allowed: false, persistence_note: "" }, disclaimer: "" };

interface Net { health: "ok" | "down"; analyze: "ok" | "down" | "timeout" | "422"; calls: string[]; hold?: Promise<void> }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function installNet(net: Net) {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    net.calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/ti/snapshot.json")) return new Response("", { status: 404 });
    if (url.includes("demo/demo-bundle.json")) return json({ generated_utc: "x", note: "n", experiments: { sets: [], data: {} }, incidents: [],
      analyses: [{ name: "Fixture A", description: "d", analysis: backendResult }] });
    if (url.endsWith("/health") || url.endsWith("/api/v1/status")) {
      if (net.health === "down") throw new TypeError("Failed to fetch");
      return url.endsWith("/health") ? json({ status: "ok", version: "1" }) : json(STATUS);
    }
    if (url.includes("/analyze/")) {
      await net.hold;
      if (net.analyze === "down") throw new TypeError("Failed to fetch");
      if (net.analyze === "timeout") throw Object.assign(new Error("aborted"), { name: "AbortError" });
      if (net.analyze === "422") return json({ error: { code: "validation_error", message: "URL rejected by the server" } }, 422);
      return json(backendResult);
    }
    throw new TypeError(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", f);
  return f;
}
const analyzeCalls = (net: Net) => net.calls.filter((c) => c.startsWith("POST") && c.includes("/analyze/"));

function renderAt(path = "/analyzer") {
  return render(<MemoryRouter initialEntries={[path]}><AppProvider><App /></AppProvider></MemoryRouter>);
}
async function analyze(text = PHISH) {
  const input = await screen.findByLabelText("URL");
  await userEvent.clear(input);
  await userEvent.type(input, text);
  await userEvent.click(screen.getByRole("button", { name: /^Analyze/ }));
}

let net: Net;
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); connectivity.reset(); await clearLocalIncidents();
  net = { health: "ok", analyze: "ok", calls: [] };
});
afterEach(() => vi.unstubAllGlobals());

describe("A. backend connected", () => {
  it("keeps the existing backend behaviour and shows no local-mode warning", async () => {
    installNet(net);
    renderAt();
    await waitFor(() => expect(screen.getByTestId("mode-pill")).toHaveTextContent(/Backend connected/));
    expect(screen.queryByTestId("local-mode-banner")).toBeNull();
    await analyze();
    expect(await screen.findByText("Triage outcome")).toBeInTheDocument();
    expect(screen.getByText(/backend rationale/)).toBeInTheDocument();
    expect(screen.queryByTestId("local-result")).toBeNull();
    expect(analyzeCalls(net)).toHaveLength(1);
  });

  it("reports HTTP errors as errors instead of falling back to local rules", async () => {
    net.analyze = "422";
    installNet(net);
    renderAt();
    await waitFor(() => expect(screen.getByTestId("mode-pill")).toHaveTextContent(/Backend connected/));
    await analyze();
    expect(await screen.findByText("URL rejected by the server")).toBeInTheDocument();
    expect(screen.queryByTestId("local-result")).toBeNull();
    expect(screen.queryByTestId("local-mode-banner")).toBeNull();
  });

  it("does not start a second request while one is running", async () => {
    let release!: () => void;
    net.hold = new Promise<void>((r) => { release = r; });
    installNet(net);
    renderAt();
    await waitFor(() => expect(screen.getByTestId("mode-pill")).toHaveTextContent(/Backend connected/));
    const input = await screen.findByLabelText("URL");
    await userEvent.type(input, PHISH);
    const btn = screen.getByRole("button", { name: /^Analyze/ });
    await userEvent.click(btn); await userEvent.click(btn);
    release();
    expect(await screen.findByText("Triage outcome")).toBeInTheDocument();
    expect(analyzeCalls(net)).toHaveLength(1);
  });
});

describe("B. local deterministic mode", () => {
  it("warns persistently and analyses the user's real input locally, without contacting the backend", async () => {
    net.health = "down";
    installNet(net);
    renderAt();
    const banner = await screen.findByTestId("local-mode-banner");
    expect(banner).toHaveTextContent(LOCAL_BANNER_TITLE);
    expect(LOCAL_BANNER_TITLE).toBe("BACKEND UNAVAILABLE · LOCAL RULE-BASED MODE ACTIVE");
    expect(banner).toHaveTextContent(LOCAL_BANNER_TEXT);
    expect(screen.getByTestId("mode-pill")).toHaveTextContent(/Local rules/);
    await userEvent.click(within(banner).getByText("What is unavailable in local mode?"));
    expect(within(banner).getByText(/ML-based URL classification/)).toBeInTheDocument();

    await analyze("https://paypal.com@evil-login-verify.example/");
    const result = await screen.findByTestId("local-result");
    expect(result).toHaveTextContent("LOCAL RULES · no ML");
    expect(result).toHaveTextContent("U-USERINFO");
    expect(result).toHaveTextContent(/not a probability/i);
    expect(result).toHaveTextContent("Intel: UNKNOWN");
    expect(result).toHaveTextContent("local-rules-1.0.0");
    expect(result).toHaveTextContent(/hxxps:\/\/evil-login-verify\[\.\]example\//);
    expect(analyzeCalls(net)).toHaveLength(0);
    expect(screen.getByTestId("local-mode-banner")).toBeInTheDocument(); // still there
  });

  it("shows structured validation errors for invalid URLs", async () => {
    net.health = "down";
    installNet(net);
    renderAt();
    await screen.findByTestId("local-mode-banner");
    await analyze("http://exa mple.com");
    expect(await screen.findByText(/cannot contain spaces/)).toBeInTheDocument();
    expect(screen.queryByTestId("local-result")).toBeNull();
  });

  it("analyses pasted email text locally and keeps raw text out of storage by default", async () => {
    net.health = "down";
    installNet(net);
    renderAt();
    await screen.findByTestId("local-mode-banner");
    await userEvent.click(screen.getByRole("radio", { name: "Email body" }));
    await userEvent.type(screen.getByLabelText("Pasted email body"), "Please verify your account immediately at http://192.0.2.9/login - final notice");
    await userEvent.click(screen.getByRole("button", { name: /^Analyze/ }));
    const result = await screen.findByTestId("local-result");
    expect(result).toHaveTextContent("E-CREDENTIAL-REQUEST");
    expect(result).toHaveTextContent("U-IP-HOST");
    const box = within(result).getByRole("checkbox", { name: /store the raw message text/i });
    expect(box).not.toBeChecked();
    await userEvent.click(within(result).getByRole("button", { name: /Save locally/ }));
    expect(await within(result).findByText("Saved in this browser only")).toBeInTheDocument();
    const [rec] = await listLocalIncidents();
    expect(rec).toMatchObject({ rawSaved: false, storage: "local-browser" });
    expect(rec.raw).toBeUndefined();
  });

  it("shows a local-only incident list that can be cleared", async () => {
    net.health = "down";
    installNet(net);
    renderAt();
    await screen.findByTestId("local-mode-banner");
    await analyze();
    const result = await screen.findByTestId("local-result");
    await userEvent.click(within(result).getByRole("button", { name: /Save locally/ }));
    await within(result).findByText("Saved in this browser only");
    expect(await listLocalIncidents()).toHaveLength(1);
    // Incident page, same provider tree
    const { unmount } = renderAt("/incidents");
    const list = await screen.findByRole("list", { name: "Local incidents" });
    expect(within(list).getByText("Local only")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Clear local data/ }));
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("button", { name: "Clear local data" }));
    await waitFor(async () => expect(await listLocalIncidents()).toHaveLength(0));
    unmount();
  });

  it.each(["/", "/analyzer", "/evidence", "/research", "/incidents", "/methodology"])("shows the active mode on %s", async (path) => {
    net.health = "down";
    installNet(net);
    renderAt(path);
    expect(await screen.findByTestId("local-mode-banner")).toHaveTextContent(LOCAL_BANNER_TITLE);
    expect(screen.getByTestId("mode-pill")).toHaveTextContent(/Local rules/);
  });
});

describe("fallback during a request", () => {
  it.each([["down", "disappears"], ["timeout", "times out"]] as const)("switches to local rules when the backend %s mid-request", async (kind, _label) => {
    net.analyze = kind;
    installNet(net);
    renderAt();
    await waitFor(() => expect(screen.getByTestId("mode-pill")).toHaveTextContent(/Backend connected/));
    await analyze();
    expect(await screen.findByText("Backend request failed")).toBeInTheDocument();
    expect(await screen.findByTestId("local-result")).toHaveTextContent("U-BRAND-LOOKALIKE");
    expect(screen.getByTestId("local-mode-banner")).toBeInTheDocument();
    expect(screen.getByTestId("mode-pill")).toHaveTextContent(/Local rules/);
  });
});

describe("recovery", () => {
  it("returns to backend mode when Retry Connection succeeds", async () => {
    net.health = "down";
    installNet(net);
    renderAt();
    await screen.findByTestId("local-mode-banner");
    net.health = "ok";
    await userEvent.click(screen.getByRole("button", { name: /Retry Connection/ }));
    await waitFor(() => expect(screen.queryByTestId("local-mode-banner")).toBeNull());
    expect(screen.getByTestId("mode-pill")).toHaveTextContent(/Backend connected/);
    await analyze();
    expect(await screen.findByText("Triage outcome")).toBeInTheDocument();
  });

  it("offers, but does not force, a return to backend mode when the network comes back by itself", async () => {
    net.health = "down";
    installNet(net);
    renderAt();
    await screen.findByTestId("local-mode-banner");
    net.health = "ok";
    await act(async () => { window.dispatchEvent(new Event("online")); });
    const resume = await screen.findByRole("button", { name: "Resume backend mode" });
    await analyze();
    expect(await screen.findByTestId("local-result")).toBeInTheDocument(); // still local until the user resumes
    expect(analyzeCalls(net)).toHaveLength(0);
    await userEvent.click(resume);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Resume backend mode" })).toBeNull());
    await analyze();
    expect(await screen.findByText("Triage outcome")).toBeInTheDocument();
  });
});

describe("C. demo fixtures", () => {
  it("are labelled DEMO FIXTURE and kept apart from user-input analyses", async () => {
    localStorage.setItem("threatlens.mode", "demo");
    net.health = "down";
    installNet(net);
    renderAt();
    expect(screen.getByTestId("mode-pill")).toHaveTextContent("Demo fixtures · Example data only");
    expect(screen.getByText("DEMO FIXTURE")).toBeInTheDocument();
    expect(screen.queryByTestId("local-mode-banner")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /Fixture A/ }));
    expect(await screen.findByText(/Demo fixture: Fixture A/)).toBeInTheDocument();
    expect(screen.queryByTestId("local-result")).toBeNull();
    expect(analyzeCalls(net)).toHaveLength(0);
  });

  it("are never substituted for a failed live request", async () => {
    net.health = "down";
    installNet(net);
    renderAt();
    await screen.findByTestId("local-mode-banner");
    await analyze();
    await screen.findByTestId("local-result");
    expect(screen.queryByText(/Demo fixture/i)).toBeNull();
    expect(screen.queryByText("DEMO FIXTURE")).toBeNull();
  });
});
