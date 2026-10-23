import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { DecisionBadge, TIBadge } from "@/components/badges";
import { AppProvider } from "@/context/AppContext";
import type { AnalysisResponse } from "@/lib/types";
import { defang, pct } from "@/lib/utils";

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppProvider><App /></AppProvider></MemoryRouter>);
}

const fixture: AnalysisResponse = {
  analysis_id: "abc", created_utc: "2026-01-01T00:00:00+00:00", input_kind: "url", overall_decision: "review", overall_label: "Needs human review",
  overall_score: 0.4, score_semantics: "Heuristic, not a probability.", scope_note: "URL strings only.", disclaimer: "d",
  model: { kind: "synthetic_demo", version: "v", trained_on_synthetic: true, detail: "", thresholds: { t_hi: 0.5 } },
  ti_source: { loaded: true, entries: 8, consulted: true }, email_meta: {}, email_evidence: [], notes: [],
  urls: [{
    url: "https://river-garden.example/news", normalized: "river-garden.example/news", source: "input", decision: "benign", decision_label: "x", risk_score: 0.1, ml_probability: 0.1,
    ml_top_terms: [{ ngram: "gar", contribution: -0.2, direction: "toward legitimate" }],
    ti: { state: "NO_MATCH", indicator: "", source: "", observed_at: null, expires_at: null, detail: "no match" }, contributions: [{ name: "URL model", value: 0.1, note: "" }], rationale: "r",
    evidence: [{ id: "missing-content", kind: "missing", source: "scope", finding: "Not examined: page content", interpretation: "limitation", influenced_decision: false }],
    suggested_actions: ["Be careful"],
  }],
};

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe("utils", () => {
  it("defangs URLs so they cannot become live links", () => {
    expect(defang("http://evil.example/x")).toBe("hxxp://evil[.]example/x");
  });
  it("formats missing numbers as n/a", () => { expect(pct(null)).toBe("n/a"); expect(pct(0.5, 0)).toBe("50%"); });
});

describe("badges", () => {
  it("never labels the benign outcome as safe", () => {
    render(<DecisionBadge decision="benign" />);
    expect(screen.getByText("No strong evidence")).toBeInTheDocument();
    expect(screen.queryByText(/safe/i)).toBeNull();
  });
  it("distinguishes NO_MATCH from UNKNOWN", () => {
    render(<><TIBadge state="NO_MATCH" /><TIBadge state="UNKNOWN" /></>);
    expect(screen.getByText("No match")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});

describe("disconnected backend", () => {
  it("shows an error and no substituted results in live mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderAt("/research");
    expect(await screen.findByText("Backend not reachable")).toBeInTheDocument();
    expect(screen.queryByText(/Demo fixture/i)).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("only enters demo mode when the user chooses it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderAt("/analyzer");
    // The analyzer no longer dead-ends when the API is down: it announces local rule-based mode instead (see fallback.test.tsx).
    await screen.findByTestId("local-mode-banner");
    expect(screen.queryByText(/Nothing is being scored by a live model/)).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Demo" }));
    expect(await screen.findByText(/Nothing is being scored by a live model/)).toBeInTheDocument();
  });
});

describe("evidence explorer", () => {
  it("labels a demo fixture and explains NO_MATCH is not safety", async () => {
    sessionStorage.setItem("threatlens.lastAnalysis", JSON.stringify({ origin: "demo-fixture", fixtureName: "No TI match", data: fixture }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderAt("/evidence");
    expect(await screen.findByText(/Demo fixture: No TI match/)).toBeInTheDocument();
    expect(screen.getAllByText(/does NOT mean the URL is safe/).length).toBeGreaterThan(0);
    expect(screen.getByText("Not examined")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("hxxps://river-garden[.]example/news")).toBeInTheDocument());
  });

  it("shows an empty state when nothing was analysed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderAt("/evidence");
    expect(await screen.findByText("No analysis selected")).toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("renders every primary route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    for (const [path, heading] of [["/security", /Phishing triage that shows its evidence/], ["/analyzer", "URL & Email Analyzer"], ["/evidence", "Evidence Explorer"],
      ["/research", "Research Evaluation Lab"], ["/incidents", "Incident History"], ["/methodology", "Methodology & Data"]] as const) {
      const { unmount } = renderAt(path);
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      unmount();
    }
  });
});
