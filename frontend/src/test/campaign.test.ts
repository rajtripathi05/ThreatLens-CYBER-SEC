import { beforeEach, describe, expect, it, vi } from "vitest";
import { csvCell, parseCsv, toCsv } from "@/lib/campaign/csv";
import { cleanedCsv, importCampaignCsv, reportCsv } from "@/lib/campaign/importer";
import { analyzeRecords, type CampaignRecord } from "@/lib/campaign/quality";
import { campaignStore } from "@/lib/campaign/store";
import { buildUtmUrl, extractUtm, parseDestination } from "@/lib/campaign/utm";

const U = { utm_source: "news", utm_medium: "email", utm_campaign: "spring" };
const rec = (finalUrl: string, id = finalUrl): CampaignRecord => ({ id, createdUtc: "", updatedUtc: "", name: "", finalUrl, note: "" });

describe("buildUtmUrl", () => {
  it("builds a basic URL and omits blank optional fields", () => {
    expect(buildUtmUrl("https://example.com/page", { ...U, utm_term: "", utm_content: "  " }).url)
      .toBe("https://example.com/page?utm_source=news&utm_medium=email&utm_campaign=spring");
  });
  it("preserves existing query parameters and the fragment", () => {
    expect(buildUtmUrl("https://example.com/p?id=7&ref=a%20b#section-2", U).url)
      .toBe("https://example.com/p?id=7&ref=a%20b&utm_source=news&utm_medium=email&utm_campaign=spring#section-2");
  });
  it("encodes spaces and special characters", () => {
    const { url } = buildUtmUrl("https://example.com/", { ...U, utm_campaign: "Spring Sale & 50% off", utm_content: "ü/é?" });
    expect(url).toContain("utm_campaign=Spring%20Sale%20%26%2050%25%20off");
    expect(url).toContain("utm_content=%C3%BC%2F%C3%A9%3F");
    expect(extractUtm(url)!.utm.utm_campaign).toBe("Spring Sale & 50% off");
  });
  it("replaces existing utm parameters instead of duplicating them", () => {
    expect(buildUtmUrl("https://example.com/?utm_source=old&x=1&UTM_TERM=gone", U).url)
      .toBe("https://example.com/?x=1&utm_source=news&utm_medium=email&utm_campaign=spring");
  });
  it("rejects invalid destinations with a reason", () => {
    for (const bad of ["", "example.com", "ftp://example.com", "https://", "javascript:alert(1)", "https://a b.com", "https://nodot"])
      expect(buildUtmUrl(bad, U).error).toBeTruthy();
    expect(parseDestination("http://localhost:3000/x").ok).toBe(true);
  });
});

describe("analyzeRecords", () => {
  it("flags missing required UTM fields as errors", () => {
    const [a] = analyzeRecords([rec("https://example.com/?utm_source=a")]);
    expect(a.status).toBe("error");
    expect(a.issues[0].message).toMatch(/utm_medium, utm_campaign/);
  });
  it("detects duplicates regardless of parameter order", () => {
    const out = analyzeRecords([rec("https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c", "1"), rec("https://EXAMPLE.com/?utm_campaign=c&utm_medium=b&utm_source=a", "2")]);
    expect(out.every((o) => o.issues.some((i) => i.code === "duplicate"))).toBe(true);
  });
  it("detects naming problems and spelling variants", () => {
    const out = analyzeRecords([rec("https://x.com/?utm_source=Facebook&utm_medium=social&utm_campaign=a", "1"), rec("https://x.com/p?utm_source=face_book&utm_medium=social&utm_campaign=a%20b", "2")]);
    const codes = out.flatMap((o) => o.issues.map((i) => i.code));
    expect(codes).toContain("naming-case");
    expect(codes).toContain("naming-chars");
    expect(codes).toContain("naming-variant");
  });
  it("reports a clean record as ok and a malformed one as error", () => {
    const out = analyzeRecords([rec("https://x.com/?utm_source=a&utm_medium=b&utm_campaign=c"), rec("not a url")]);
    expect(out.map((o) => o.status)).toEqual(["ok", "error"]);
  });
  it("honours relaxed naming settings", () => {
    const [a] = analyzeRecords([rec("https://x.com/?utm_source=A&utm_medium=b&utm_campaign=c")], { requireLowercase: false, requireSlugChars: true });
    expect(a.status).toBe("ok");
  });
});

describe("csv", () => {
  it("round-trips quotes, commas and newlines", () => {
    const text = toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line1\nline2", ""]]);
    const p = parseCsv(text);
    expect(p.rows).toEqual([["x,y", 'say "hi"'], ["line1\nline2", ""]]);
  });
  it("neutralises spreadsheet formulas on export", () => {
    for (const s of ["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)"]) expect(csvCell(s).startsWith("'")).toBe(true);
    expect(csvCell("plain")).toBe("plain");
  });
  it("reports an unbalanced quote", () => { expect(parseCsv('url\n"https://a.com').errors.length).toBe(1); });
});

describe("importCampaignCsv", () => {
  it("imports valid rows and reports rejected rows with line numbers", () => {
    const r = importCampaignCsv("name,url\nA,https://a.com/?utm_source=a&utm_medium=b&utm_campaign=c\nB,notaurl\nC,\nD,https://d.com/x\n");
    expect(r.records).toHaveLength(2);
    expect(r.rejected.map((x) => x.line)).toEqual([3, 4]);
    expect(r.totalRows).toBe(4);
  });
  it("fails clearly when the URL column is missing or the file is empty", () => {
    expect(importCampaignCsv("name,source\nA,b").fatal).toMatch(/No URL column/);
    expect(importCampaignCsv("  ").fatal).toMatch(/empty/);
  });
  it("applies separate utm columns to the URL", () => {
    const r = importCampaignCsv("destination_url,utm_source,utm_medium,utm_campaign\nhttps://a.com/p?x=1#f,news,email,Spring Sale\n");
    expect(r.records[0].finalUrl).toBe("https://a.com/p?x=1&utm_source=news&utm_medium=email&utm_campaign=Spring%20Sale#f");
  });
  it("exports cleaned data and a validation report", () => {
    const rows = analyzeRecords([rec("https://x.com/?utm_source=a")]);
    expect(cleanedCsv(rows)).toContain("final_url");
    expect(reportCsv(rows)).toContain("missing-required");
  });
});

describe("campaignStore", () => {
  beforeEach(() => { localStorage.clear(); campaignStore._reset(); });
  it("persists across a simulated refresh", () => {
    campaignStore.add([{ name: "n", finalUrl: "https://a.com/?utm_source=a", note: "" }]);
    campaignStore._reset();
    expect(campaignStore.list()).toHaveLength(1);
    const id = campaignStore.list()[0].id;
    campaignStore.update(id, { name: "renamed" });
    campaignStore._reset();
    expect(campaignStore.list()[0].name).toBe("renamed");
    campaignStore.remove([id]);
    campaignStore._reset();
    expect(campaignStore.list()).toHaveLength(0);
  });
  it("survives corrupted storage", () => {
    localStorage.setItem("tl.campaigns.v1", "{not json");
    campaignStore._reset();
    expect(campaignStore.list()).toEqual([]);
  });
});

describe("campaignStore hardening", () => {
  beforeEach(() => { localStorage.clear(); campaignStore._reset(); });
  it("normalizes malformed, partial and duplicate stored records", () => {
    localStorage.setItem("tl.campaigns.v1", JSON.stringify([
      { id: "a", finalUrl: "https://a.com/" },
      { id: "a", finalUrl: "https://dup.com/" },
      { id: 5, finalUrl: "https://x.com/" },
      null, "str", { id: "b", finalUrl: "" },
    ]));
    campaignStore._reset();
    const list = campaignStore.list();
    expect(list).toHaveLength(1);
    expect(list[0].note).toBe("");
    expect(typeof list[0].createdUtc).toBe("string");
    expect(analyzeRecords(list)).toHaveLength(1);
  });
  it("reports a storage write failure", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const r = campaignStore.add([{ name: "n", finalUrl: "https://a.com/", note: "" }]);
    spy.mockRestore();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/browser storage/);
  });
  it("enforces the record limit", () => {
    const items = Array.from({ length: 5003 }, (_, i) => ({ name: "", finalUrl: `https://a.com/${i}`, note: "" }));
    const r = campaignStore.add(items);
    expect(r.dropped).toBe(3);
    expect(new Set(campaignStore.list().map((x) => x.id)).size).toBe(5000);
  });
});
