import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeEmailLocal, analyzeUrlLocal, isValidationError, type LocalAnalysis } from "@/lib/localAnalysis";
import { buildLocalReport, buildLocalReportHtml } from "@/lib/localReport";
import { clearLocalIncidents, deleteLocalIncident, listLocalIncidents, saveLocalIncident } from "@/lib/localStore";

const get = (r: ReturnType<typeof analyzeUrlLocal>): LocalAnalysis => { if (isValidationError(r)) throw new Error(r.message); return r; };
const EML = "From: A <a@example.org>\nSubject: Private subject\n\nSecret body text http://secure-paypal-login.example/verify/x";

beforeEach(async () => { await clearLocalIncidents(); });

describe("local incident storage", () => {
  it("saves a summary and lists it newest first", async () => {
    const a = await saveLocalIncident(get(analyzeUrlLocal("http://secure-paypal-login.example/verify/x", { snapshot: null })), { note: "n1", now: new Date("2026-01-01") });
    const b = await saveLocalIncident(get(analyzeUrlLocal("https://example.org/", { snapshot: null })), { now: new Date("2026-02-01") });
    const all = await listLocalIncidents();
    expect(all.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(all[1]).toMatchObject({ storage: "local-browser", inputType: "url", note: "n1", rawSaved: false, tiState: "UNKNOWN" });
    expect(all[1].ruleIds).toContain("U-BRAND-LOOKALIKE");
  });

  it("does not store raw email content unless the user opts in", async () => {
    const a = get(analyzeEmailLocal(EML, { snapshot: null }));
    const none = await saveLocalIncident(a, { rawContent: null });
    expect(none.rawSaved).toBe(false);
    expect(JSON.stringify(await listLocalIncidents())).not.toContain("Secret body text");
    expect(JSON.stringify(await listLocalIncidents())).not.toContain("Private subject"); // subject/from are not kept either
    const yes = await saveLocalIncident(a, { rawContent: EML });
    expect(yes.rawSaved).toBe(true);
    expect((await listLocalIncidents()).find((i) => i.id === yes.id)?.raw).toBe(EML);
  });

  it("deletes one record and clears everything including opted-in raw text", async () => {
    const a = get(analyzeEmailLocal(EML, { snapshot: null }));
    const x = await saveLocalIncident(a, { rawContent: EML });
    await saveLocalIncident(a);
    await deleteLocalIncident(x.id);
    expect(await listLocalIncidents()).toHaveLength(1);
    await clearLocalIncidents();
    expect(await listLocalIncidents()).toEqual([]);
  });
});

describe("local reports", () => {
  const a = get(analyzeUrlLocal("http://secure-paypal-login.example/verify/x", { snapshot: null }));
  it("identifies local mode, rule set, time, findings, intel state, limitations and non-fixture status", () => {
    const r = buildLocalReport(a, new Date("2026-03-04T05:06:07Z"));
    expect(r).toMatchObject({
      mode: "LOCAL_RULE_BASED", rule_set_version: a.ruleSetVersion, generated_utc: "2026-03-04T05:06:07.000Z", demo_fixture: false,
      not_a_validated_ml_prediction: true, raw_content_included: false, threat_intelligence: { state: "UNKNOWN" },
    });
    expect(r.findings.length).toBe(a.findings.length);
    expect(r.limitations.length).toBeGreaterThan(3);
    expect(r.urls[0].url_defanged).toBe("hxxp://secure-paypal-login[.]example/verify/x");
    expect(JSON.parse(JSON.stringify(r)).heuristic_risk_score).toBe(a.riskScore);
  });
  it("renders escaped, script-free printable HTML", () => {
    const evil = get(analyzeUrlLocal("http://x.example/<script>alert(1)</script>", { snapshot: null }));
    const html = buildLocalReportHtml(buildLocalReport(evil));
    expect(html).toContain("LOCAL RULE-BASED MODE");
    expect(html).toContain(a.ruleSetVersion);
    expect(html).not.toMatch(/<script/i);
  });
});
