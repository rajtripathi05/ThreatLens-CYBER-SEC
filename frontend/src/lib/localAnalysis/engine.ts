import { header, parseAuth, parseEmail, parseMailbox } from "./emailParse";
import { EMAIL_RULES, evaluateEmailRules } from "./emailRules";
import { lookupIndicator } from "./threatSnapshot";
import { parseUrlInput } from "./urlParse";
import { evaluateUrlRules, URL_RULES } from "./urlRules";
import {
  RULE_SET_VERSION,
  type AnalysisConfig, type EvidenceEntry, type Finding, type LocalAnalysis, type LocalVerdict, type TIEntry, type UrlAnalysis, type ValidationError,
} from "./types";

export const SCORE_SEMANTICS =
  "Heuristic risk score (0-100): the sum of documented rule weights, clamped. It is not a probability, was not calibrated, and no machine-learning model produced it.";
export const THRESHOLDS = { higherRisk: 60, suspicious: 25 } as const;

export const LIMITATIONS: string[] = [
  "Deterministic local rules only: no ML inference, no live threat intelligence, no backend services.",
  "The supplied URLs were parsed as text. Nothing was fetched, resolved, redirected or opened, so page content, domain age, DNS and certificates were not examined.",
  "Rules are simple, transparent heuristics with documented weights; they were not trained or validated against a labelled dataset and are not part of the research experiments.",
  "'INSUFFICIENT EVIDENCE' means the rules found little to flag. It does not mean the input is safe.",
  "Email-wording rules are plain phrase matches and have not been scientifically validated.",
];

export function verdictFor(score: number): LocalVerdict {
  return score >= THRESHOLDS.higherRisk ? "HIGHER RISK" : score >= THRESHOLDS.suspicious ? "SUSPICIOUS" : "INSUFFICIENT EVIDENCE";
}
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const sum = (fs: Finding[]) => fs.reduce((a, x) => a + x.weight, 0);

/** Analyse one URL string. Pure: depends only on its arguments. */
export function analyzeUrlInput(raw: string, cfg: AnalysisConfig): UrlAnalysis | ValidationError {
  const p = parseUrlInput(raw);
  if (!p.ok) return p;
  const ti = lookupIndicator(cfg, p.normalized, p.features.host);
  const findings = evaluateUrlRules(p.features);
  if (ti.state === "MATCH") {
    const r = URL_RULES["U-TI-MATCH"];
    findings.push({ ruleId: r.id, title: r.title, weight: r.weight, observed: `${ti.indicator} in ${ti.snapshot?.source ?? "snapshot"}`, explanation: r.description });
  }
  const score = clamp(sum(findings));
  return { input: raw.trim(), normalized: p.normalized, features: p.features, findings, score, verdict: verdictFor(score), ti };
}

function urlEvidence(u: UrlAnalysis, idx: number): EvidenceEntry[] {
  const out: EvidenceEntry[] = u.findings.map((f) => ({
    id: `url${idx}-${f.ruleId}`, kind: "rule", provenance: `local-rule ${f.ruleId} @ ${RULE_SET_VERSION}`, subject: u.normalized,
    finding: `${f.title}: ${f.observed}`, interpretation: f.explanation, influencedScore: f.weight !== 0, weight: f.weight,
  }));
  out.push({
    id: `url${idx}-ti`, kind: "threat_intel", provenance: u.ti.snapshot ? `bundled snapshot "${u.ti.snapshot.source}"${u.ti.snapshot.retrievedUtc ? ` retrieved ${u.ti.snapshot.retrievedUtc}` : ""}` : "no snapshot available",
    subject: u.normalized, finding: `Threat-intelligence state: ${u.ti.state}`, interpretation: u.ti.detail, influencedScore: u.ti.state === "MATCH", weight: u.ti.state === "MATCH" ? URL_RULES["U-TI-MATCH"].weight : 0,
  });
  return out;
}

const MISSING: Omit<EvidenceEntry, "id">[] = [
  { kind: "missing", provenance: "scope", subject: "page content", finding: "Not examined: page content, redirects, certificates, domain age and DNS", interpretation: "Local mode never contacts the supplied domain.", influencedScore: false, weight: 0 },
  { kind: "missing", provenance: "scope", subject: "ML model", finding: "Not run: the ML URL classifier is a backend service", interpretation: "The score above comes from deterministic rules, not a trained model.", influencedScore: false, weight: 0 },
];

function actionsFor(v: LocalVerdict, kind: "url" | "email"): string[] {
  const what = kind === "url" ? "link" : "message";
  const common = ["Do not enter credentials or payment details on the basis of this result alone.", `Verify the sender or site through a channel you already trust, not through details in the ${what}.`];
  if (v === "HIGHER RISK") return [`Do not open the ${what} or reply. Report it to your security team or mail provider.`, ...common];
  if (v === "SUSPICIOUS") return [`Treat the ${what} with caution and have it reviewed before interacting.`, ...common];
  return [`Few rules fired. This does not establish that the ${what} is safe; apply normal caution.`, "Reconnect to the backend for ML classification and live intelligence when available."];
}

export function analyzeUrlLocal(raw: string, cfg: AnalysisConfig): LocalAnalysis | ValidationError {
  const u = analyzeUrlInput(raw, cfg);
  if ("ok" in u) return u;
  return {
    mode: "LOCAL_RULE_BASED", inputType: "url", ruleSetVersion: RULE_SET_VERSION, verdict: u.verdict, riskScore: u.score, scoreSemantics: SCORE_SEMANTICS,
    findings: u.findings, urls: [u], email: null,
    evidence: [...urlEvidence(u, 0), ...MISSING.map((m, i) => ({ ...m, id: `missing-${i}` }))],
    threatIntel: u.ti, recommendedActions: actionsFor(u.verdict, "url"), limitations: LIMITATIONS,
  };
}

function aggregateTI(urls: UrlAnalysis[], cfg: AnalysisConfig): TIEntry {
  if (!cfg.snapshot) return urls[0]?.ti ?? lookupIndicator(cfg, "", "");
  const hit = urls.find((u) => u.ti.state === "MATCH");
  if (hit) return hit.ti;
  if (urls.length === 0) return { state: "UNKNOWN", indicator: "", snapshot: null, detail: "The message contains no URLs, so there was nothing to look up in the snapshot." };
  return urls[0].ti.state === "NO_MATCH" ? { ...urls[0].ti, indicator: `${urls.length} URL(s)`, detail: `No exact match for any of ${urls.length} URL(s) in the bundled snapshot. Absence from a snapshot does not mean a URL is safe.` } : urls[0].ti;
}

/** Analyse pasted email text or the contents of an .eml file. Pure and offline. */
export function analyzeEmailLocal(raw: string, cfg: AnalysisConfig): LocalAnalysis | ValidationError {
  const p = parseEmail(raw);
  if (!p.ok) return p;
  const urls: UrlAnalysis[] = [];
  for (const href of p.urls) { const a = analyzeUrlInput(href, cfg); if (!("ok" in a)) urls.push(a); }
  const from = parseMailbox(header(p, "from"));
  const replyTo = parseMailbox(header(p, "reply-to"));
  const auth = parseAuth(p);
  const maxUrlScore = urls.reduce((m, u) => Math.max(m, u.score), 0);
  const findings = evaluateEmailRules({
    fromAddress: from.address, fromDomain: from.domain, displayName: from.display, replyToDomain: replyTo.domain,
    text: p.text, anchors: p.anchors, auth, maxUrlScore, hasHeaders: p.hasHeaders,
  });
  const score = clamp(sum(findings));
  const verdict = verdictFor(score);
  const evidence: EvidenceEntry[] = findings.map((f) => ({
    id: `email-${f.ruleId}`, kind: "rule", provenance: `local-rule ${f.ruleId} @ ${RULE_SET_VERSION}`, subject: "email", finding: `${f.title}: ${f.observed}`,
    interpretation: `${f.explanation} (heuristic, not a validated classifier)`, influencedScore: f.weight !== 0, weight: f.weight,
  }));
  urls.forEach((u, i) => evidence.push(...urlEvidence(u, i).map((e) => ({ ...e, influencedScore: false, weight: 0, interpretation: `${e.interpretation} Contributes to the email score only through ${EMAIL_RULES["E-EMBEDDED-URL-RISK"].id}.` }))));
  if (!p.hasHeaders) evidence.push({ id: "missing-headers", kind: "missing", provenance: "scope", subject: "headers", finding: "Not available: pasted text has no headers (sender, Reply-To, authentication)", interpretation: "Header rules could not run. This is not evidence of a problem.", influencedScore: false, weight: 0 });
  evidence.push(...MISSING.map((m, i) => ({ ...m, id: `missing-${i}` })));
  return {
    mode: "LOCAL_RULE_BASED", inputType: "email", ruleSetVersion: RULE_SET_VERSION, verdict, riskScore: score, scoreSemantics: SCORE_SEMANTICS,
    findings, urls,
    email: { from: header(p, "from"), fromAddress: from.address, fromDomain: from.domain, displayName: from.display, replyTo: header(p, "reply-to"), replyToDomain: replyTo.domain,
      subject: header(p, "subject"), hasHeaders: p.hasHeaders, auth, urlCount: urls.length, urlsTruncated: p.urlsTruncated },
    evidence, threatIntel: aggregateTI(urls, cfg), recommendedActions: actionsFor(verdict, "email"), limitations: LIMITATIONS,
  };
}

export function isValidationError(x: unknown): x is ValidationError {
  return typeof x === "object" && x !== null && (x as ValidationError).ok === false;
}
