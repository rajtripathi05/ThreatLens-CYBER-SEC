# Operating modes, local rule-based fallback and offline use

ThreatLens has three clearly separated modes. The active one is always shown in the top bar, and a persistent banner appears whenever local fallback is active.

| Mode | When | Who produces results | Label |
|---|---|---|---|
| **A. Backend-connected** | `GET {VITE_API_BASE_URL}/health` answered 2xx | FastAPI service: ML URL classifier, API threat intel, remote incidents, research API | "Backend connected" |
| **B. Local deterministic** | Health check failed / timed out (3 s), or a request hit a network failure/timeout | A rule engine running **in the browser** | "BACKEND UNAVAILABLE · LOCAL RULE-BASED MODE ACTIVE" |
| **C. Demo fixture** | The user picks **Demo** | Precomputed fixtures and copies of saved result files bundled with the site | "DEMO FIXTURE" |

Fixtures are never substituted for a failed request, and switching to Demo is never automatic.

## Connectivity (`frontend/src/lib/connectivity.ts`)
- States `CHECKING`, `CONNECTED`, `UNAVAILABLE`. One health check at start-up, one on **Retry Connection**, one when the browser fires `online`. **No polling.**
- Concurrent checks share one request. A failure reported during an analysis supersedes an older in-flight health result.
- Only a genuine network failure or timeout (status 0) triggers local fallback for an analysis. HTTP errors (e.g. 422 validation, 5xx) are shown as errors.
- After fallback, local mode stays latched. If the network returns by itself the banner offers **Resume backend mode**; a successful manual **Retry Connection** resumes immediately. Local incidents are never uploaded automatically.
- The analysis runs only on submit, never per keystroke.

## What the local rules do (`frontend/src/lib/localAnalysis/`)
`urlParse` (standard `URL` parser + validation) → `urlRules` / `emailParse` / `emailRules` (documented weights) → `engine` (sum, clamp 0-100, verdict) → `threatSnapshot` (optional exact lookup). Every score contribution maps to one rule in `URL_RULES` / `EMAIL_RULES`; the full table (weight, description, what the rule *cannot* establish) is in the Analyzer under **About local analysis**.

- Verdicts: `HIGHER RISK` (>= 60), `SUSPICIOUS` (>= 25), `INSUFFICIENT EVIDENCE`. There is no "safe" verdict.
- The score is a **heuristic**, not a probability: uncalibrated, not trained, not validated, not part of the research experiments, and not a research baseline.
- Deterministic: no randomness, no clock, no network. Same input + `RULE_SET_VERSION` (`local-rules-1.0.0`) + snapshot → identical output. Bump the version whenever a rule, weight, threshold or wording changes.
- Missing HTTPS, long URLs, IP hosts and deep subdomains are weak signals with small weights; none alone reaches `SUSPICIOUS`.
- Absent SPF/DKIM/DMARC results are reported as "not present" (weight 0), never as failure. Only explicit `fail`/`softfail` results score. A DMARC pass lowers the score by 5 and is documented as not proving safety.
- Email wording rules are plain phrase matches with no scientific validation.
- URLs are never fetched, resolved or followed. Page content, redirects, certificates, domain age and DNS are explicitly listed as "not examined" in the evidence ledger.

### Cannot establish
Maliciousness or safety. Brand look-alike detection uses a short keyword list and a naive registrable-domain guess (no public-suffix list). Legitimate sites trip individual rules; attacker domains that avoid them score 0.

## Threat-intelligence snapshot
States: `MATCH` (exact indicator in the bundled snapshot), `NO_MATCH` (snapshot present, indicator absent), `UNKNOWN` (no snapshot, unreadable/invalid snapshot, or lookup switched off).

**No snapshot is bundled today**, so local mode reports `UNKNOWN`. The synthetic demo feed in `data/cti_snapshot.csv` is deliberately not shipped for this purpose. To add a real one see `frontend/public/ti/PROVENANCE.md` (schema, exact-match semantics, licence caveat). The UI shows the snapshot source/version/retrieval date and warns when it is older than 30 days or undated. A snapshot is never described as a live feed.

## Privacy and local storage
- Local analysis sends nothing anywhere, including email contents.
- Incident saving is an explicit button. Records go to **IndexedDB in this browser** (`threatlens-local`) and are labelled "Local only". Only a summary is stored: verdict, score, rule IDs, rule-set version, first URL, intel state, your note. Subject/sender are **not** stored.
- Raw message text is stored only if you tick "Also store the raw message text" (off by default).
- Incidents page → **Clear local data** deletes everything, including opted-in raw text; individual records can be deleted.
- No credentials are stored. The optional backend incident token stays in `sessionStorage` as before.
- Local records are not synchronised. If sync is ever added it must be an explicit, documented action.

## Reports
Local analyses export **JSON** and **print-friendly HTML** (no scripts or external resources; user text is escaped). Both state: local deterministic mode, rule-set version, generation time, findings and explanations, threat-intel state, limitations, `demo_fixture: false`, and "not a validated ML prediction". **PDF is not generated locally** (no PDF library is bundled): open the HTML and use the browser's Print → Save as PDF. The backend PDF export is unchanged and only available when connected.

## Research Lab offline
Saved experiment results are served by the backend; copies ship with the site and are browsable in Demo mode with their provenance labels (real-data evaluation, synthetic simulation, oracle upper bound, demo fixture). In live mode without the backend the Research Lab shows an explicit unavailable state. The local rule engine produced none of these results.

## Offline use (PWA)
`public/sw.js` + `manifest.webmanifest` + icons. The build plugin in `vite.config.ts` stamps the worker with a content-hash cache version and the list of built shell files (files > 1 MB, source maps, `demo/` and `ti/` are excluded from precaching; the demo bundle and snapshot are cached on first use).

- Cached: the app shell and hashed assets, same-origin only. **Never** cached or intercepted: cross-origin requests (the API, Google Fonts), `/api/*`, `/health`, non-GET requests, HTML "missing file" fallbacks, `no-store` responses, anything > 3 MB. User input is never stored by the worker, and API results are never served stale.
- Updates: a new worker waits; the footer shows "update available: reload" and activates only on click. Old caches are deleted on activation.
- Fonts come from Google Fonts and are not cached; offline, the system fonts are used.

> **A Netlify-hosted site cannot be opened for the first time with no internet connection.** The browser must load it once online (and the service worker must install) before it can reopen offline; clearing site data removes the cache. A true first-launch-offline application would be a separate packaging project (e.g. a desktop shell bundling these assets) and is not provided here.

### Verify offline functionality
1. `npm --prefix frontend run build && npx --prefix frontend vite preview` (service workers run on `localhost` or HTTPS only).
2. Open the site, wait for "offline-ready" in the footer (or DevTools → Application → Service Workers: *activated*, Cache Storage: `threatlens-shell-…`).
3. DevTools → Network → *Offline* (or stop the API/the preview server), reload. The app opens; with the API down the banner appears and the Analyzer works.
4. Automated checks (`npm test`) cover the worker source in a simulated Cache Storage; they are not a substitute for step 3 in a real browser.

## Restoring backend connectivity
Start/redeploy the API (see `DEPLOYMENT.md`), confirm `VITE_API_BASE_URL` and CORS (`THREATLENS_ALLOWED_ORIGINS`), then press **Retry Connection**. Free hosts that sleep can take 30-60 s to wake; retry once awake.

## Testing reproducibility
`npm --prefix frontend test` includes `localEngine.test.ts`, which analyses the same URL/email repeatedly (and under different faked system clocks) and requires byte-identical JSON. To check by hand, analyse the same input twice in local mode, export both JSON reports and diff them: only `generated_utc` may differ.
