import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { AppProvider } from "@/context/AppContext";
import { DEMO_SAMPLE_CSV, demoSeed } from "@/lib/campaign/demoData";
import { importCampaignCsv, splitDuplicates, cleanedCsv } from "@/lib/campaign/importer";
import { analyzeRecords } from "@/lib/campaign/quality";
import { computeStats } from "@/lib/campaign/stats";
import { campaignStore, createCampaignStore, demoStore } from "@/lib/campaign/store";
import { suggestSlug } from "@/lib/campaign/utm";

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppProvider><App /></AppProvider></MemoryRouter>);
}
beforeEach(() => {
  localStorage.clear(); campaignStore._reset(); demoStore._reset();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
});

describe("demo data isolation", () => {
  it("seeds the demo store without touching the real library", () => {
    campaignStore.add([{ name: "mine", finalUrl: "https://mine.example/?utm_source=a&utm_medium=b&utm_campaign=c", note: "" }]);
    expect(demoStore.list().length).toBe(demoSeed().length);
    expect(campaignStore.list()).toHaveLength(1);
    expect(localStorage.getItem("tl.campaigns.v1")).not.toContain("DEMO-");
    expect(localStorage.getItem("tl.campaigns.demo.v1") ?? "").not.toContain("mine.example");
  });
  it("reset restores only the demo", () => {
    campaignStore.add([{ name: "mine", finalUrl: "https://mine.example/?utm_source=a&utm_medium=b&utm_campaign=c", note: "" }]);
    demoStore.clear(); demoStore._reset();
    expect(demoStore.list()).toHaveLength(0); // an emptied demo stays empty until reset
    demoStore.reset();
    expect(demoStore.list()).toHaveLength(demoSeed().length);
    expect(campaignStore.list()).toHaveLength(1);
  });
  it("overview metrics never include demo records", async () => {
    renderAt("/");
    expect(await screen.findByText("No campaign URLs saved yet")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-data-banner")).toBeNull();
  });
  it("overview labels demo data unmistakably when it is shown", async () => {
    renderAt("/?data=demo");
    expect(await screen.findByTestId("demo-data-banner")).toHaveTextContent(/Demo data/);
    expect(screen.getByLabelText("Campaign metrics")).toHaveTextContent(String(demoSeed().length));
    expect(campaignStore.list()).toHaveLength(0);
  });
});

describe("demo fixtures run through the real validator", () => {
  const stats = () => computeStats(analyzeRecords(demoSeed()));
  it("contains genuine, computed findings", () => {
    const s = stats();
    const codes = s.issueCounts.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["missing-required", "duplicate", "naming-case", "naming-chars", "naming-variant"]));
    expect(s.duplicates).toBe(2);
  });
  it("sample csv: 3 new, 1 duplicate, rejected rows with line numbers", () => {
    const r = importCampaignCsv(DEMO_SAMPLE_CSV);
    expect(r.records).toHaveLength(4);
    expect(r.rejected.map((x) => x.line)).toEqual([6, 7]);
    const { fresh, duplicates } = splitDuplicates(r.records, demoSeed());
    expect(fresh).toHaveLength(3);
    expect(duplicates).toHaveLength(1);
    expect(r.columns.recognized.map((c) => c.as)).toContain("utm_source");
  });
});

describe("guided demo workspace", () => {
  it("walks the real workflow: validate with findings, apply the fix, save to the demo store only", async () => {
    const u = userEvent.setup();
    renderAt("/demo?step=3");
    expect(screen.getByTestId("demo-data-banner")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Demo progress" })).toHaveAttribute("aria-valuenow", "3");
    const val = screen.getByTestId("studio-validation");
    expect(val).toHaveTextContent(/not lowercase/);
    expect(val).toHaveTextContent(/spelling variants/);
    await u.click(within(val).getByRole("button", { name: /Use “linkedin” for source/ }));
    expect(screen.getByTestId("utm-preview")).toHaveTextContent("utm_source=linkedin");
    await u.click(screen.getByRole("button", { name: /Save to library/ }));
    expect(await screen.findByText(/demo workspace only/)).toBeInTheDocument();
    expect(demoStore.list()).toHaveLength(demoSeed().length + 1);
    expect(campaignStore.list()).toHaveLength(0);
  });
  it("previews the sample import, then imports it into the demo store", async () => {
    const u = userEvent.setup();
    renderAt("/demo?step=6");
    await u.click(screen.getByRole("button", { name: "Preview sample import" }));
    const prev = await screen.findByTestId("import-preview");
    expect(prev).toHaveTextContent(/Line 6:/);
    await u.click(screen.getByRole("button", { name: /Import 3 rows/ }));
    expect(await screen.findByText(/Imported 3 of 6 rows/)).toBeInTheDocument();
    expect(demoStore.list()).toHaveLength(demoSeed().length + 3);
    expect(campaignStore.list()).toHaveLength(0);
  });
  it("resets only the demo", async () => {
    const u = userEvent.setup();
    campaignStore.add([{ name: "mine", finalUrl: "https://mine.example/?utm_source=a&utm_medium=b&utm_campaign=c", note: "" }]);
    demoStore.clear();
    renderAt("/demo");
    await u.click(screen.getByRole("button", { name: /Reset demo/ }));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Reset demo" }));
    expect(demoStore.list()).toHaveLength(demoSeed().length);
    expect(campaignStore.list()).toHaveLength(1);
  });
  it("hands a campaign URL to the Analyzer without running anything", async () => {
    renderAt("/demo?step=7");
    const link = screen.getByRole("link", { name: /Send to Analyzer/ });
    expect(link.getAttribute("href")).toMatch(/^\/analyzer\?url=https%3A%2F%2Fthreatlens\.example/);
    // The app's own backend health check may run; no request may ever target the campaign host.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.includes("threatlens.example"))).toEqual([]);
  });
});

describe("primary navigation", () => {
  it("is campaign-first with security under its own heading", async () => {
    renderAt("/");
    const nav = (await screen.findAllByRole("navigation", { name: "Primary" }))[0];
    const labels = within(nav).getAllByRole("link").map((l) => l.textContent);
    expect(labels.slice(0, 4).join("|")).toMatch(/Campaign Overview.*UTM Studio.*Campaign Library.*QA & Reports/);
    expect(within(nav).getByText("Security tools")).toBeInTheDocument();
  });
  it("keeps older routes working", async () => {
    for (const [path, h] of [["/campaigns/reports", "Campaign QA & Reports"], ["/security/tour", /Guided demo|Research|demo/i], ["/campaigns/intelligence", "Campaign Library"]] as const) {
      const { unmount } = renderAt(path);
      expect(await screen.findAllByRole("heading", { level: 1, name: h as never }).catch(() => screen.findAllByText(h as never))).toBeTruthy();
      unmount();
    }
  });
});

describe("studio suggestions and storage failures", () => {
  it("suggestSlug normalises case, spaces and special characters", () => {
    expect(suggestSlug("Partner News!")).toBe("partner_news");
    expect(suggestSlug("  LinkedIn ")).toBe("linkedin");
    expect(suggestSlug("a+b")).toBe("a_b");
  });
  it("reports a storage write failure instead of pretending it saved", () => {
    const s = createCampaignStore("tl.test.fail");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    const r = s.add([{ name: "", finalUrl: "https://a.example/?utm_source=a&utm_medium=b&utm_campaign=c", note: "" }]);
    spy.mockRestore();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not write to browser storage/);
  });
  it("ignores invalid stored records and duplicate ids", () => {
    localStorage.setItem("tl.campaigns.v1", JSON.stringify([{ id: "a", finalUrl: "https://x.example/" }, { id: "a", finalUrl: "https://y.example/" }, null, { id: 5 }, "junk"]));
    campaignStore._reset();
    expect(campaignStore.list()).toHaveLength(1);
  });
  it("exports neutralise formulas and re-import cleanly", () => {
    const rec = { id: "1", name: "=HYPERLINK(\"x\")", finalUrl: "https://a.example/?utm_source=a&utm_medium=b&utm_campaign=c", note: "", createdUtc: "", updatedUtc: "" };
    const csv = cleanedCsv(analyzeRecords([rec]));
    expect(csv).toContain("'=HYPERLINK");
    const back = importCampaignCsv(csv);
    expect(back.records[0].name).toBe("=HYPERLINK(\"x\")");
    expect(back.records[0].finalUrl).toBe(rec.finalUrl);
  });
});
