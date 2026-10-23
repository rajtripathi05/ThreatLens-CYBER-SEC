import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeEmailLocal, analyzeUrlLocal, EMAIL_RULES, isValidationError, loadBundledSnapshot, parseSnapshot, RULE_SET_VERSION, URL_RULES,
  type AnalysisConfig, type LocalAnalysis,
} from "@/lib/localAnalysis";

const none: AnalysisConfig = { snapshot: null };
const snap = (indicators: { indicator: string; kind: "url" | "domain" }[]): AnalysisConfig => ({
  snapshot: { source: "TEST-FIXTURE-FEED", version: "t1", retrievedUtc: "2026-01-01T00:00:00Z", note: "unit test", indicators },
});
const ok = (r: ReturnType<typeof analyzeUrlLocal>): LocalAnalysis => { if (isValidationError(r)) throw new Error(r.message); return r; };

const PHISH_EML = [
  "From: \"PayPal Security\" <alerts@secure-pay-check.example>",
  "Reply-To: collect@other-domain.example",
  "Subject: Urgent: verify your account immediately",
  "Authentication-Results: mx.test; spf=fail smtp.mailfrom=secure-pay-check.example; dkim=none; dmarc=fail",
  "Content-Type: text/plain; charset=utf-8", "",
  "Final notice. Please verify your account immediately: http://secure-paypal-login.example/verify/a1b2c3.",
].join("\r\n");

afterEach(() => vi.restoreAllMocks());

describe("URL rules", () => {
  it("returns identical results for identical input and configuration", () => {
    const a = analyzeUrlLocal("http://secure-paypal-login.example/verify/a1b2c3", none);
    const b = analyzeUrlLocal("http://secure-paypal-login.example/verify/a1b2c3", none);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reports the rule-set version and a heuristic, non-ML score", () => {
    const r = ok(analyzeUrlLocal("http://secure-paypal-login.example/verify/a1b2c3", none));
    expect(r.ruleSetVersion).toBe(RULE_SET_VERSION);
    expect(r.mode).toBe("LOCAL_RULE_BASED");
    expect(r.scoreSemantics).toMatch(/not a probability/i);
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.findings.map((f) => f.ruleId)).toEqual(expect.arrayContaining(["U-BRAND-LOOKALIKE", "U-LURE-TOKENS"]));
  });

  it("makes every score contribution traceable to a documented rule", () => {
    const r = ok(analyzeUrlLocal("http://user.bank.com@xn--pypal-4ve.example:8443/login/verify?x=1", none));
    expect(r.findings.length).toBeGreaterThan(3);
    for (const f of r.findings) expect(f.weight).toBe(URL_RULES[f.ruleId].weight);
    expect(r.riskScore).toBe(Math.min(100, r.findings.reduce((s, f) => s + f.weight, 0)));
    expect(r.verdict).toBe("HIGHER RISK");
  });

  it("does not treat a missing HTTPS scheme as malicious", () => {
    const bare = ok(analyzeUrlLocal("example.com/docs", none));
    expect(bare.findings).toEqual([]);
    expect(bare.verdict).toBe("INSUFFICIENT EVIDENCE");
    const http = ok(analyzeUrlLocal("http://example.com/docs", none));
    expect(http.riskScore).toBeLessThan(10);
    expect(http.verdict).toBe("INSUFFICIENT EVIDENCE");
  });

  it("never labels an unflagged URL as safe", () => {
    const r = ok(analyzeUrlLocal("https://example.org/", none));
    expect(r.verdict).toBe("INSUFFICIENT EVIDENCE");
    expect(r.recommendedActions.join(" ")).toMatch(/does not establish/);
    expect(r.limitations.join(" ")).toMatch(/does not mean the input is safe/);
  });

  it.each([
    ["", "empty"], ["   ", "empty"], ["http://exa mple.com", "contains_whitespace"], ["javascript:alert(1)", "unsupported_scheme"],
    ["ftp://example.com/x", "unsupported_scheme"], ["http://", "unparseable"], [`http://example.com/${"a".repeat(5000)}`, "too_long"],
  ])("returns a structured validation error for %j", (input, code) => {
    const r = analyzeUrlLocal(input, none);
    expect(isValidationError(r)).toBe(true);
    expect(r).toMatchObject({ ok: false, code });
    expect((r as { message: string }).message.length).toBeGreaterThan(5);
  });

  it("flags IP hosts, user-information and punycode", () => {
    expect(ok(analyzeUrlLocal("http://192.168.10.5/login", none)).findings.map((f) => f.ruleId)).toContain("U-IP-HOST");
    expect(ok(analyzeUrlLocal("https://paypal.com@evil.example/", none)).findings.map((f) => f.ruleId)).toEqual(expect.arrayContaining(["U-USERINFO", "U-USERINFO-HOSTLIKE"]));
    expect(ok(analyzeUrlLocal("https://xn--80ak6aa92e.example/", none)).findings.map((f) => f.ruleId)).toContain("U-PUNYCODE");
  });

  it("does not flag the genuine brand domain itself", () => {
    expect(ok(analyzeUrlLocal("https://www.paypal.com/signin", none)).findings.map((f) => f.ruleId)).not.toContain("U-BRAND-LOOKALIKE");
  });
});

describe("threat-intelligence states", () => {
  const url = "http://secure-paypal-login.example/verify/a1b2c3";
  it("is UNKNOWN when no snapshot exists", () => {
    const r = ok(analyzeUrlLocal(url, none));
    expect(r.threatIntel.state).toBe("UNKNOWN");
    expect(r.threatIntel.snapshot).toBeNull();
    expect(r.verdict).not.toBe("INSUFFICIENT EVIDENCE"); // rules still work without intelligence
  });
  it("is MATCH on an exact local indicator and says where it came from", () => {
    const r = ok(analyzeUrlLocal(url, snap([{ indicator: url, kind: "url" }])));
    expect(r.threatIntel.state).toBe("MATCH");
    expect(r.threatIntel.snapshot?.source).toBe("TEST-FIXTURE-FEED");
    expect(r.findings.map((f) => f.ruleId)).toContain("U-TI-MATCH");
    expect(r.verdict).toBe("HIGHER RISK");
  });
  it("matches an exact domain indicator but not a near-miss", () => {
    expect(ok(analyzeUrlLocal("https://bad.example/x", snap([{ indicator: "bad.example", kind: "domain" }]))).threatIntel.state).toBe("MATCH");
    expect(ok(analyzeUrlLocal("https://notbad.example/x", snap([{ indicator: "bad.example", kind: "domain" }]))).threatIntel.state).toBe("NO_MATCH");
  });
  it("is NO_MATCH, and says so is not safety, when the snapshot lacks the indicator", () => {
    const r = ok(analyzeUrlLocal("https://river-garden.example/news", snap([{ indicator: url, kind: "url" }])));
    expect(r.threatIntel.state).toBe("NO_MATCH");
    expect(r.threatIntel.detail).toMatch(/does not mean/);
  });
  it("treats a missing, non-JSON or invalid snapshot file as UNKNOWN", async () => {
    const html = vi.fn().mockResolvedValue(new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadBundledSnapshot(html as unknown as typeof fetch, "/")).snapshot).toBeNull();
    const bad = vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: 1 }), { status: 200, headers: { "content-type": "application/json" } }));
    const cfg = await loadBundledSnapshot(bad as unknown as typeof fetch, "/");
    expect(cfg.snapshot).toBeNull();
    expect(cfg.snapshotUnavailableReason).toMatch(/rejected/);
    expect((await loadBundledSnapshot(vi.fn().mockRejectedValue(new Error("x")) as unknown as typeof fetch, "/")).snapshot).toBeNull();
    expect("error" in parseSnapshot(null)).toBe(true);
  });
});

describe("email rules", () => {
  it("returns identical results for identical input and configuration", () => {
    expect(JSON.stringify(analyzeEmailLocal(PHISH_EML, none))).toBe(JSON.stringify(analyzeEmailLocal(PHISH_EML, none)));
  });

  it("applies header, wording and authentication rules to a real .eml and scores embedded URLs", () => {
    const r = ok(analyzeEmailLocal(PHISH_EML, none));
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["E-REPLYTO-MISMATCH", "E-DISPLAY-BRAND", "E-URGENCY", "E-CREDENTIAL-REQUEST", "E-AUTH-SPF-FAIL", "E-AUTH-DMARC-FAIL", "E-EMBEDDED-URL-RISK"]));
    for (const f of r.findings.filter((x) => x.ruleId !== "E-EMBEDDED-URL-RISK")) expect(f.weight).toBe(EMAIL_RULES[f.ruleId].weight);
    expect(r.verdict).toBe("HIGHER RISK");
    expect(r.urls).toHaveLength(1);
    expect(r.urls[0].normalized).toBe("http://secure-paypal-login.example/verify/a1b2c3"); // trailing full stop removed
    expect(r.evidence.some((e) => e.subject.includes("secure-paypal-login") && e.kind === "rule")).toBe(true);
    expect(r.email).toMatchObject({ fromDomain: "secure-pay-check.example", replyToDomain: "other-domain.example", auth: { spf: "fail", dkim: "none", dmarc: "fail" } });
  });

  it("distinguishes absent authentication from explicit failure", () => {
    const eml = ["From: Ann <ann@example.org>", "Subject: Lunch", "", "See you at noon."].join("\n");
    const r = ok(analyzeEmailLocal(eml, none));
    expect(r.email?.auth).toEqual({ spf: "not_present", dkim: "not_present", dmarc: "not_present" });
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).toContain("E-AUTH-ABSENT");
    expect(ids.some((i) => /FAIL/.test(i))).toBe(false);
    expect(r.riskScore).toBe(0);
    expect(r.verdict).toBe("INSUFFICIENT EVIDENCE");
  });

  it("detects link text that names a different domain (HTML part, base64 + multipart)", () => {
    const html = '<p>Sign in at <a href="http://evil.example/x">https://www.mybank.example/login</a></p>';
    const eml = ["From: Bank <noreply@mybank.example>", "Subject: Notice", 'Content-Type: multipart/alternative; boundary="B1"', "", "--B1",
      "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", btoa(html), "--B1--", ""].join("\r\n");
    const r = ok(analyzeEmailLocal(eml, none));
    expect(r.findings.map((f) => f.ruleId)).toContain("E-LINK-TEXT-MISMATCH");
  });

  it("handles pasted text without headers and says header rules could not run", () => {
    const r = ok(analyzeEmailLocal("Hello, see http://192.0.2.7/login for details", none));
    expect(r.email?.hasHeaders).toBe(false);
    expect(r.evidence.some((e) => e.id === "missing-headers")).toBe(true);
    expect(r.urls[0].findings.map((f) => f.ruleId)).toContain("U-IP-HOST");
  });

  it("rejects empty and oversized input with structured errors", () => {
    expect(analyzeEmailLocal("  ", none)).toMatchObject({ ok: false, code: "empty" });
    expect(analyzeEmailLocal("x".repeat(2_000_001), none)).toMatchObject({ ok: false, code: "too_large" });
  });

  it("reports UNKNOWN threat intelligence for an email when no snapshot exists", () => {
    expect(ok(analyzeEmailLocal(PHISH_EML, none)).threatIntel.state).toBe("UNKNOWN");
  });
});

describe("local analyses stay local", () => {
  it("make no network requests", () => {
    const f = vi.fn(); const xhr = vi.fn(); const beacon = vi.fn();
    vi.stubGlobal("fetch", f); vi.stubGlobal("XMLHttpRequest", xhr); vi.stubGlobal("WebSocket", xhr);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    analyzeUrlLocal("https://example.com/a?b=c", snap([{ indicator: "x.example", kind: "domain" }]));
    analyzeEmailLocal(PHISH_EML, none);
    expect(f).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); expect(beacon).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not depend on the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01"));
    const a = JSON.stringify(analyzeUrlLocal("http://secure-paypal-login.example/verify", none));
    vi.setSystemTime(new Date("2030-01-01"));
    expect(JSON.stringify(analyzeUrlLocal("http://secure-paypal-login.example/verify", none))).toBe(a);
    vi.useRealTimers();
  });
});
