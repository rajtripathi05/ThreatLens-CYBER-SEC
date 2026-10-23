# Threat model

**Asset/goal:** help an analyst triage URLs (including those extracted from emails) as likely phishing / needs review / no strong evidence.
**Adversary:** phisher sending links with look-alike or compromised hosts; may exploit gaps in threat-intel coverage. Adaptive attacks on this classifier (obfuscation, scheme/host tricks) are out of scope and untested.
**Trust boundaries:** user-supplied URL/email text is untrusted. The tool parses text only: no fetching, DNS, redirects, rendering or attachment opening; displayed URLs are defanged; `.eml` size capped at 2 MB; request body capped (3 MB default); attachments listed only.
**API risks addressed:** restricted CORS; validation; no training/experiment endpoints; optional token for incident endpoints; raw email body stored only with explicit opt-in and server permission; deletion and clear-all supported; SHA-256/version check before unpickling a model (pickle is unsafe for untrusted files).
**Residual risks:** unauthenticated public incident store if no token is set; no rate limiting; in-memory analysis cache; model/dataset artefacts; small-scale only.
