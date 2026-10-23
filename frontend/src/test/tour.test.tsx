import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { AppProvider } from "@/context/AppContext";
import { compare, PRESETS, presetRows, saturation, shortcutFinding } from "@/lib/findings";
import { buildReportPreview } from "@/lib/report";
import { val } from "@/lib/research";
import type { DemoBundle } from "@/lib/demo";
import { num } from "@/lib/utils";

const bundle: DemoBundle = JSON.parse(readFileSync(resolve(__dirname, "../../public/demo/demo-bundle.json"), "utf8"));
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppProvider><App /></AppProvider></MemoryRouter>);
}
function stubBundle() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => bundle, headers: new Headers() })));
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("findings are computed from the saved files", () => {
  it("raw vs stripped F1 comes from the classifier runs", () => {
    const cells = shortcutFinding(bundle.experiments.data["real-classifier"]);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.raw).toBeGreaterThan(c.stripped);
      expect(c.points).toBeCloseTo((c.raw - c.stripped) * 100, 8);
    }
  });
  it("per-seed rows are the saved observations and differ from the mean only by seed variation", () => {
    const set = bundle.experiments.data["real-ti-proxy"];
    const mean = presetRows(set, preset("noise10"), "all");
    const seed = set.metadata.seeds![0];
    const one = presetRows(set, preset("noise10"), seed);
    expect(one.length).toBe(mean.length);
    const row = set.by_run!.find((r) => r.seed === seed && r.method === "naive_fusion" && r.group === "coverage_noise" && r.coverage === 1 && r.noise === 0.1 && r.visibility === "unlabelled")!;
    expect(val(one.find((r) => r.method === "naive_fusion"), "f1")).toBe(row.f1);
  });
  it("compare() reports improved, matched and worsened correctly", () => {
    const rows = [
      { method: "a", f1_mean: 0.9, fpr_mean: 0.1, review_rate_mean: 0 },
      { method: "b", f1_mean: 0.95, fpr_mean: 0.2, review_rate_mean: 0.3 },
      { method: "c", f1_mean: 0.9003, fpr_mean: 0.1, review_rate_mean: 0 },
    ];
    const ab = compare(rows, "a", "b");
    expect(ab[0].outcome).toBe("improved");
    expect(ab[1].outcome).toBe("worsened");
    expect(ab[2].outcome).toBeNull();
    expect(compare(rows, "a", "c")[0].outcome).toBe("matched");
  });
  it("detects saturated noise scenarios from run metadata", () => {
    const proxy = bundle.experiments.data["real-ti-proxy"], oracle = bundle.experiments.data["real-ti-oracle"];
    const noise = preset("noise10");
    const s = saturation(proxy, noise);
    expect(s).not.toBeNull();
    expect(s!.injected).toBeGreaterThanOrEqual(s!.pool);
    expect(saturation(oracle, noise)).toBeNull();
    expect(saturation(proxy, preset("baseline"))).toBeNull();
    // the saturation shows up in the saved numbers: every legitimate URL is falsely matched under naive fusion
    const fpr = val(presetRows(proxy, noise, "all").find((r) => r.method === "naive_fusion"), "fpr");
    expect(fpr).toBeGreaterThan(0.99);
  });
  it("oracle preset points at an oracle-labelled result set", () => {
    expect(bundle.experiments.data[preset("oracle").setId].metadata.feed_mode).toBe("oracle_test_labels");
    expect(bundle.experiments.data[preset("baseline").setId].metadata.feed_mode).not.toBe("oracle_test_labels");
  });
});

describe("guided demo", () => {
  it("runs from start to finish on labelled fixtures, then resets", async () => {
    localStorage.setItem("threatlens.mode", "demo");
    stubBundle();
    renderAt("/demo");
    expect(await screen.findByRole("heading", { level: 1, name: /Step 1 of 7: Analyze a URL/ })).toBeInTheDocument();
    expect(await screen.findByText(/Running on bundled demo fixtures/)).toBeInTheDocument();
    expect(await screen.findByText(/has not been validated as an email-body classifier/)).toBeInTheDocument();

    const next = screen.getByRole("button", { name: /Next/ });
    await userEvent.click(next);
    expect(await screen.findByRole("heading", { level: 1, name: /Step 2 of 7/ })).toBeInTheDocument();
    const legend = await screen.findByRole("list", { name: "Threat-intelligence outcomes" });
    for (const w of ["MATCH", "NO_MATCH", "UNKNOWN"]) expect(within(legend).getByText(w)).toBeInTheDocument();
    expect(screen.getByText("Why did ThreatLens reach this decision?")).toBeInTheDocument();

    await userEvent.click(next);
    const c = shortcutFinding(bundle.experiments.data["real-classifier"]).find((x) => x.protocol === "stratified")!;
    expect((await screen.findAllByText(num(c.raw, 4))).length).toBeGreaterThan(0);
    expect(screen.getAllByText(num(c.stripped, 4)).length).toBeGreaterThan(0);
    expect(screen.getByText(/does not prove leakage/i)).toBeInTheDocument();

    await userEvent.click(next);
    const table = await screen.findByRole("table", { name: /Saved simulation results/ });
    expect(within(table).getAllByText("Oracle upper bound").length).toBe(3); // oracle row name + two label badges (noise and oracle rows use the oracle-derived feed)
    expect(within(table).getAllByText("Synthetic simulation").length).toBe(5);

    await userEvent.click(next);
    expect(await screen.findByRole("radiogroup", { name: "Scenario preset" })).toBeInTheDocument();

    await userEvent.click(next);
    expect(await screen.findByText("Report preview, not a saved case")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download PDF/ })).toBeDisabled();

    await userEvent.click(next);
    expect(await screen.findByText(/What this does not show/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Restart/ }));
    expect(await screen.findByRole("heading", { level: 1, name: /Step 1 of 7/ })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Demo progress" })).toHaveAttribute("aria-valuenow", "1");

    await userEvent.click(screen.getByRole("button", { name: /Exit demo/ }));
    expect(await screen.findByRole("heading", { level: 1, name: /Phishing triage that shows its evidence/ })).toBeInTheDocument();
  });

  it("does not substitute fixtures when the backend is unreachable in live mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderAt("/demo");
    expect(await screen.findByText("Backend not reachable")).toBeInTheDocument();
    expect(screen.queryByTestId("step-analyze")).toBeNull();
    expect(screen.queryByText(/Running on bundled demo fixtures/)).toBeNull();
  });

  it("JSON export is an unsaved preview without raw content", () => {
    const a = bundle.analyses[0].analysis;
    const r = buildReportPreview(a, "demo-fixture", { "real-classifier": "x" });
    expect(r.persisted).toBe(false);
    expect(r.raw_content_stored).toBe(false);
    expect(r.report_id.startsWith("PREVIEW-")).toBe(true);
    expect(r.provenance.source).toBe("DEMO FIXTURE");
    expect(r.limitations.length).toBeGreaterThan(3);
    expect(JSON.stringify(r)).not.toMatch(/"eml"|"raw_body"/);
  });
});

describe("experiment explorer", () => {
  it("updates the table from the selected saved observations", async () => {
    localStorage.setItem("threatlens.mode", "demo");
    stubBundle();
    renderAt("/research");
    const group = await screen.findByRole("radiogroup", { name: "Scenario preset" });
    const setOf = (id: string) => bundle.experiments.data[preset(id).setId];
    const naiveF1 = (id: string, seed: "all" | number) => val(presetRows(setOf(id), preset(id), seed).find((r) => r.method === "naive_fusion"), "f1")!.toFixed(4);
    const tableName = "Explorer metrics by method for the selected preset";

    await userEvent.click(within(group).getByRole("radio", { name: "50% missing indicators" }));
    let t = await screen.findByRole("table", { name: tableName });
    expect(within(t).getAllByText(naiveF1("missing50", "all")).length).toBeGreaterThan(0);

    await userEvent.click(within(group).getByRole("radio", { name: "10% synthetic noise" }));
    t = await screen.findByRole("table", { name: tableName });
    expect(within(t).getAllByText(naiveF1("noise10", "all")).length).toBeGreaterThan(0);
    expect(naiveF1("noise10", "all")).not.toBe(naiveF1("missing50", "all"));

    const seed = setOf("noise10").metadata.seeds![0];
    await userEvent.selectOptions(screen.getByLabelText("Seed"), String(seed));
    t = await screen.findByRole("table", { name: tableName });
    expect(within(t).getAllByText(naiveF1("noise10", seed)).length).toBeGreaterThan(0);

    expect(screen.queryByText(/Saturated scenario/)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Result set (feed configuration)"), "real-ti-proxy");
    expect(await screen.findByText(/Saturated scenario/)).toBeInTheDocument();

    await userEvent.click(within(group).getByRole("radio", { name: "Oracle upper bound" }));
    expect((await screen.findAllByText("Oracle upper bound")).length).toBeGreaterThan(1);
    expect(screen.getAllByText("Demo fixture").length).toBeGreaterThan(0);
    expect(screen.getByText(/does not run a new experiment/)).toBeInTheDocument();
  });
});
