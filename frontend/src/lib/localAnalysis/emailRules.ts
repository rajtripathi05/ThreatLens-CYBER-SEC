import { registrableDomain, parseUrlInput } from "./urlParse";
import { BRAND_KEYWORDS } from "./urlRules";
import type { Anchor } from "./emailParse";
import type { AuthResult, Finding, RuleDef } from "./types";

/**
 * Documented email rules. These are simple string heuristics. They have NOT been scientifically validated and
 * must not be described as a trained or evaluated email classifier.
 */
export const EMAIL_RULES: Record<string, RuleDef> = {
  "E-REPLYTO-MISMATCH": { id: "E-REPLYTO-MISMATCH", title: "Reply-To domain differs from From domain", weight: 15,
    description: "Replies would go to a different organisation than the apparent sender.",
    limitation: "Mailing lists, ticketing systems and CRMs legitimately set a different Reply-To." },
  "E-DISPLAY-NAME-DOMAIN": { id: "E-DISPLAY-NAME-DOMAIN", title: "Display name shows a different address/domain than the sender", weight: 20,
    description: "The visible display name contains an email address or domain that does not match the real From domain.",
    limitation: "Only detects an address written inside the display name." },
  "E-DISPLAY-BRAND": { id: "E-DISPLAY-BRAND", title: "Display name uses a brand the sender domain does not contain", weight: 15,
    description: "A well-known brand keyword appears in the display name while the From domain does not contain it.",
    limitation: "Short fixed keyword list. Legitimate third-party senders often send on behalf of a brand." },
  "E-LINK-TEXT-MISMATCH": { id: "E-LINK-TEXT-MISMATCH", title: "Link text names a different domain than the link target", weight: 20,
    description: "HTML link text looks like a domain or URL, but the href points to another registrable domain.",
    limitation: "Only available for HTML bodies. Tracking redirects produce benign mismatches." },
  "E-URGENCY": { id: "E-URGENCY", title: "Multiple urgency/pressure phrases", weight: 8,
    description: "Two or more distinct pressure phrases (e.g. 'immediately', 'final notice', 'account will be suspended').",
    limitation: "Simple phrase list; legitimate notices also create urgency." },
  "E-CREDENTIAL-REQUEST": { id: "E-CREDENTIAL-REQUEST", title: "Asks to verify or enter credentials or account details", weight: 15,
    description: "Wording asks the reader to verify/confirm/update an account, password or payment detail.",
    limitation: "Simple phrase match; cannot tell a genuine security notice from a lure." },
  "E-PAYMENT-REQUEST": { id: "E-PAYMENT-REQUEST", title: "Unusual payment request wording", weight: 12,
    description: "Mentions gift cards, wire transfers, cryptocurrency or overdue-payment demands.",
    limitation: "Simple phrase match; legitimate invoices use some of these terms." },
  "E-AUTH-SPF-FAIL": { id: "E-AUTH-SPF-FAIL", title: "SPF result explicitly reports fail/softfail", weight: 12,
    description: "The supplied Authentication-Results/Received-SPF header states SPF did not pass.",
    limitation: "Forwarding commonly breaks SPF. Headers could also have been added by an untrusted hop." },
  "E-AUTH-DKIM-FAIL": { id: "E-AUTH-DKIM-FAIL", title: "DKIM result explicitly reports fail", weight: 12,
    description: "The supplied Authentication-Results header states DKIM verification failed.",
    limitation: "Mailing lists that alter messages break DKIM." },
  "E-AUTH-DMARC-FAIL": { id: "E-AUTH-DMARC-FAIL", title: "DMARC result explicitly reports fail", weight: 15,
    description: "The supplied Authentication-Results header states DMARC failed.",
    limitation: "Reflects the receiving server's evaluation at delivery time." },
  "E-AUTH-DMARC-PASS": { id: "E-AUTH-DMARC-PASS", title: "DMARC explicitly reports pass", weight: -5,
    description: "Slightly lowers the score: the sending domain is aligned with authenticated mail.",
    limitation: "Attackers can pass DMARC with a domain they own. A pass does not make a message safe." },
  "E-AUTH-ABSENT": { id: "E-AUTH-ABSENT", title: "No authentication results in supplied headers", weight: 0,
    description: "Informational only. Missing SPF/DKIM/DMARC results do NOT indicate failure; pasted text and stripped exports usually lack them.",
    limitation: "Contributes nothing to the score." },
  "E-EMBEDDED-URL-RISK": { id: "E-EMBEDDED-URL-RISK", title: "Embedded URLs scored by the URL rules", weight: 0,
    description: "Contribution is half of the highest embedded-URL score, capped at 40 points.",
    limitation: "Inherits every limitation of the URL rules." },
};

const URGENCY = ["urgent", "immediately", "act now", "within 24 hours", "within 48 hours", "final notice", "last warning", "will be suspended", "has been suspended",
  "will be closed", "expires today", "verify immediately", "failure to comply"];
const CREDENTIAL = [/\b(verify|confirm|update|validate|re-?enter)\s+(your\s+)?(account|password|identity|login|credentials|payment|billing)/i,
  /\benter\s+your\s+(password|pin|credentials)/i, /\b(reset|change)\s+your\s+password/i, /\b(social security|ssn|card number|cvv|security code)\b/i];
const PAYMENT = [/\bgift\s*cards?\b/i, /\bwire\s+transfer\b/i, /\bbitcoin\b|\bcrypto(currency)?\s+wallet\b/i, /\bbank\s+details\b/i, /\b(pay|payment).{0,20}\boverdue\b|\boverdue.{0,20}\b(invoice|payment)\b/i];

export interface EmailFeatures {
  fromAddress: string; fromDomain: string; displayName: string; replyToDomain: string;
  text: string; anchors: Anchor[];
  auth: { spf: AuthResult; dkim: AuthResult; dmarc: AuthResult };
  maxUrlScore: number; hasHeaders: boolean;
}

function f(rule: RuleDef, observed: string, weight = rule.weight): Finding {
  return { ruleId: rule.id, title: rule.title, weight, observed, explanation: rule.description };
}

/** Pure function of the features. Same features give the same findings in the same order. */
export function evaluateEmailRules(x: EmailFeatures): Finding[] {
  const R = EMAIL_RULES;
  const out: Finding[] = [];
  const fromReg = x.fromDomain ? registrableDomain(x.fromDomain) : "";
  if (x.replyToDomain && fromReg && registrableDomain(x.replyToDomain) !== fromReg) out.push(f(R["E-REPLYTO-MISMATCH"], `From ${x.fromDomain}, Reply-To ${x.replyToDomain}`));

  const dn = x.displayName.toLowerCase();
  const dnAddr = /[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/.exec(dn) ?? /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/.exec(dn);
  if (dnAddr && fromReg && registrableDomain(dnAddr[1]) !== fromReg) out.push(f(R["E-DISPLAY-NAME-DOMAIN"], `display name mentions ${dnAddr[1]}, sender domain is ${x.fromDomain}`));
  const compact = dn.replace(/[^a-z0-9]/g, "");
  const brands = BRAND_KEYWORDS.filter((b) => compact.includes(b) && !x.fromDomain.includes(b));
  if (brands.length) out.push(f(R["E-DISPLAY-BRAND"], `display name mentions ${brands.join(", ")}; sender domain is ${x.fromDomain || "unknown"}`));

  const mismatches: string[] = [];
  for (const a of x.anchors) {
    const t = /(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(a.text);
    const target = parseUrlInput(a.href);
    if (t && target.ok && registrableDomain(t[1].toLowerCase()) !== registrableDomain(target.features.host)) mismatches.push(`"${a.text.slice(0, 40)}" -> ${target.features.host}`);
  }
  if (mismatches.length) out.push(f(R["E-LINK-TEXT-MISMATCH"], mismatches.slice(0, 3).join("; ")));

  const lower = x.text.toLowerCase();
  const urgent = URGENCY.filter((p) => lower.includes(p));
  if (urgent.length >= 2) out.push(f(R["E-URGENCY"], `phrases: ${urgent.join(", ")}`));
  const cred = CREDENTIAL.map((r) => r.exec(x.text)?.[0]).filter((s): s is string => Boolean(s));
  if (cred.length) out.push(f(R["E-CREDENTIAL-REQUEST"], `wording: "${cred[0].toLowerCase()}"`));
  const pay = PAYMENT.map((r) => r.exec(x.text)?.[0]).filter((s): s is string => Boolean(s));
  if (pay.length) out.push(f(R["E-PAYMENT-REQUEST"], `wording: "${pay[0].toLowerCase()}"`));

  const { spf, dkim, dmarc } = x.auth;
  if (spf === "fail" || spf === "softfail") out.push(f(R["E-AUTH-SPF-FAIL"], `spf=${spf}`));
  if (dkim === "fail") out.push(f(R["E-AUTH-DKIM-FAIL"], "dkim=fail"));
  if (dmarc === "fail") out.push(f(R["E-AUTH-DMARC-FAIL"], "dmarc=fail"));
  if (dmarc === "pass") out.push(f(R["E-AUTH-DMARC-PASS"], "dmarc=pass"));
  if (spf === "not_present" && dkim === "not_present" && dmarc === "not_present")
    out.push(f(R["E-AUTH-ABSENT"], x.hasHeaders ? "headers contain no SPF/DKIM/DMARC results" : "pasted text has no headers"));

  if (x.maxUrlScore > 0) {
    const w = Math.min(40, Math.round(x.maxUrlScore / 2));
    if (w > 0) out.push(f(R["E-EMBEDDED-URL-RISK"], `highest embedded URL score ${x.maxUrlScore}`, w));
  }
  return out;
}
