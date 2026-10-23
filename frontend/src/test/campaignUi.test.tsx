import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { AppProvider } from "@/context/AppContext";
import { campaignStore } from "@/lib/campaign/store";

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppProvider><App /></AppProvider></MemoryRouter>);
}
beforeEach(() => { localStorage.clear(); campaignStore._reset(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline"))); });

describe("URL Studio", () => {
  it("builds the URL live, validates, and saves", async () => {
    const u = userEvent.setup();
    renderAt("/campaigns/studio");
    const preview = screen.getByTestId("utm-preview");
    await u.type(screen.getByLabelText(/Destination URL/), "https://example.com/p?id=1#top");
    await u.type(screen.getByLabelText(/Source/), "news");
    await u.type(screen.getByLabelText(/Medium/), "email");
    await u.click(screen.getByRole("button", { name: /Save to library/ }));
    expect(await screen.findByText(/Required parameters missing/)).toBeInTheDocument();
    expect(campaignStore.list()).toHaveLength(0);
    await u.type(screen.getByLabelText(/Campaign/), "Spring Sale");
    expect(preview).toHaveTextContent("https://example.com/p?id=1&utm_source=news&utm_medium=email&utm_campaign=Spring%20Sale#top");
    await u.click(screen.getByRole("button", { name: /Save to library/ }));
    expect(await screen.findByText(/Saved to your library/)).toBeInTheDocument();
    expect(campaignStore.list()[0].finalUrl).toContain("utm_campaign=Spring%20Sale#top");
  });
  it("shows an inline error for an invalid destination", async () => {
    const u = userEvent.setup();
    renderAt("/campaigns/studio");
    await u.type(screen.getByLabelText(/Destination URL/), "example.com");
    expect(screen.getByText(/Start the URL with http/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy URL/ })).toBeDisabled();
  });
});

describe("Campaign Intelligence", () => {
  const csv = "name,url\nGood,https://a.com/?utm_source=news&utm_medium=email&utm_campaign=spring\nBad,https://b.com/?utm_source=x\nBroken,nope\n";
  it("shows an empty state, then imports, reports rejected rows, filters and sorts", async () => {
    const u = userEvent.setup();
    renderAt("/campaigns/intelligence");
    expect(screen.getByText("No campaign URLs yet")).toBeInTheDocument();
    await u.upload(screen.getByTestId("csv-input"), new File([csv], "c.csv", { type: "text/csv" }));
    expect(await screen.findByTestId("import-preview")).toHaveTextContent("Nothing has been saved yet");
    expect(campaignStore.list()).toHaveLength(0);
    await u.click(screen.getByRole("button", { name: /Import 2 rows/ }));
    expect(await screen.findByText(/Imported 2 of 3 rows/)).toBeInTheDocument();
    expect(screen.getByText(/Line 4:/)).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    await u.selectOptions(screen.getByLabelText("Status"), "error");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("https://b.com/")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Clear filters" }));
    await u.type(screen.getByLabelText("Search"), "a.com");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    // persistence after "refresh"
    campaignStore._reset();
    expect(campaignStore.list()).toHaveLength(2);
  });
  it("rejects a file with no URL column", async () => {
    const u = userEvent.setup();
    renderAt("/campaigns/intelligence");
    await u.upload(screen.getByTestId("csv-input"), new File(["name,source\na,b\n"], "c.csv", { type: "text/csv" }));
    expect(await screen.findByText(/No URL column found/)).toBeInTheDocument();
    expect(campaignStore.list()).toHaveLength(0);
  });
  it("redirects the old /campaigns route to the campaign overview", async () => {
    renderAt("/campaigns");
    expect(await screen.findByRole("heading", { level: 1, name: /Standardize your UTM links/ })).toBeInTheDocument();
  });
});
