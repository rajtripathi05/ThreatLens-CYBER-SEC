/** Project-level limitations, shown on the Overview, in the guided demo and in every exported report. */
export const LIMITATIONS: string[] = [
  "No independent real threat-intelligence feed is integrated. Every threat-intelligence robustness result is a simulation.",
  "Oracle-feed results use held-out test labels to build the feed. They are an optimistic upper bound, not independent performance.",
  "The classifier reads URL strings only. Email parsing and its heuristics are not validated as an email-body classifier.",
  "High raw-URL scores on PhiUSIIL are partly formatting artefacts: removing the scheme and “www.” lowers F1 substantially.",
  "The app has not been deployed or verified on hosted infrastructure. Hosted incident storage may be ephemeral and unauthenticated unless configured.",
  "Research prototype: outputs are triage hints for a human, not verdicts. URLs are never fetched or opened.",
];
