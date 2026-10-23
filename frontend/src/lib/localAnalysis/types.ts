/**
 * Types for the browser-local, deterministic rule engine. This engine is a transparent fallback used when the
 * backend is unreachable. It is NOT the ML pipeline and its score is NOT a probability.
 */

/** Bump whenever a rule, weight, threshold or wording changes. Reported in every result. */
export const RULE_SET_VERSION = "local-rules-1.0.0";

export type LocalVerdict = "HIGHER RISK" | "SUSPICIOUS" | "INSUFFICIENT EVIDENCE";
export type LocalTIState = "MATCH" | "NO_MATCH" | "UNKNOWN";

export interface RuleDef {
  id: string;
  title: string;
  /** Signed contribution to the 0-100 heuristic score. */
  weight: number;
  description: string;
  /** Honest statement of what the rule cannot establish. */
  limitation: string;
}

export interface Finding {
  ruleId: string;
  title: string;
  /** Signed contribution actually applied (0 for informational findings). */
  weight: number;
  /** What was observed in the input. */
  observed: string;
  explanation: string;
}

export interface ValidationError {
  ok: false;
  code: "empty" | "too_long" | "contains_whitespace" | "unsupported_scheme" | "unparseable" | "missing_host" | "too_large";
  message: string;
}

export interface UrlFeatures {
  scheme: string;
  schemeAssumed: boolean;
  host: string;
  registrable: string;
  labelCount: number;
  subdomainDepth: number;
  tld: string;
  isIpHost: boolean;
  hasUserInfo: boolean;
  userInfoLooksLikeHost: boolean;
  port: string;
  hasPunycode: boolean;
  urlLength: number;
  hostLength: number;
  hostHyphens: number;
  pathLength: number;
  queryLength: number;
  percentEncodedCount: number;
  lureTokens: string[];
  brandHits: string[];
  isShortener: boolean;
}

export interface SnapshotInfo {
  source: string;
  version: string | null;
  retrievedUtc: string | null;
  note: string;
}

export interface TIEntry {
  state: LocalTIState;
  indicator: string;
  detail: string;
  snapshot: SnapshotInfo | null;
}

export interface UrlAnalysis {
  input: string;
  normalized: string;
  features: UrlFeatures;
  findings: Finding[];
  score: number;
  verdict: LocalVerdict;
  ti: TIEntry;
}

export type AuthResult = "pass" | "fail" | "softfail" | "neutral" | "none" | "other" | "not_present";

export interface EmailMeta {
  from: string;
  fromAddress: string;
  fromDomain: string;
  displayName: string;
  replyTo: string;
  replyToDomain: string;
  subject: string;
  hasHeaders: boolean;
  auth: { spf: AuthResult; dkim: AuthResult; dmarc: AuthResult };
  urlCount: number;
  urlsTruncated: boolean;
}

export interface EvidenceEntry {
  id: string;
  kind: "rule" | "threat_intel" | "missing" | "limitation";
  /** Where the evidence comes from, e.g. "local-rule U-IP-HOST". */
  provenance: string;
  subject: string;
  finding: string;
  interpretation: string;
  influencedScore: boolean;
  weight: number;
}

export interface LocalAnalysis {
  mode: "LOCAL_RULE_BASED";
  inputType: "url" | "email";
  ruleSetVersion: string;
  verdict: LocalVerdict;
  /** 0-100 heuristic score. Sum of the documented rule weights, clamped. Not a probability. */
  riskScore: number;
  scoreSemantics: string;
  findings: Finding[];
  urls: UrlAnalysis[];
  email: EmailMeta | null;
  evidence: EvidenceEntry[];
  threatIntel: TIEntry;
  recommendedActions: string[];
  limitations: string[];
}

export interface SnapshotIndicator { indicator: string; kind: "url" | "domain" }
export interface ThreatSnapshot extends SnapshotInfo { indicators: SnapshotIndicator[] }

export interface AnalysisConfig {
  snapshot: ThreatSnapshot | null;
  /** Why no snapshot is available (shown to the user). */
  snapshotUnavailableReason?: string;
}
