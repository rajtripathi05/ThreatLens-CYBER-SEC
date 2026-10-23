# ThreatLens AI: demo guide

## Start

```powershell
# terminal 1 (API)
python -m uvicorn api.main:app --port 8000
# terminal 2 (frontend)
cd frontend; npm install; npm run dev
```

Open the printed Vite URL. If the API is down, choose **Demo** in the header: the app then uses `frontend/public/demo/demo-bundle.json`
(regenerate with `python scripts/export_demo_fixtures.py`). Fixtures are never substituted automatically, and everything they feed is labelled **Demo fixture**.

## Evidence labels

| Label | Meaning |
|---|---|
| Real-data evaluation | Held-out PhiUSIIL URLs (classifier run `real-clf-*`). Valid for URL strings in that dataset only. |
| Synthetic simulation | The threat-intelligence feed is corrupted on purpose by the experiment. Tests a policy, not a provider. |
| Oracle upper bound | The feed is built from test labels: a best case, not independent intelligence. |
| Demo fixture | Loaded from the bundled file, not computed live. |

## Three-minute script (Overview → Start Research Demo)

1. **Analyze a URL.** Prepared `.example` URL, scored (not fetched). Point out: classifier score vs policy decision; scope note (URL strings only, not validated for email bodies).
2. **Inspect the evidence.** Ledger from classifier to final triage. MATCH = indicator found; NO_MATCH = feed consulted, nothing found (not safe); UNKNOWN = feed not consulted or unavailable (not safe). Open "Why did ThreatLens reach this decision?" (n-gram coefficient × TF-IDF; no SHAP).
3. **Shortcut learning.** F1 on raw URLs vs scheme/`www.` removed, read from the saved run. Suggests representation sensitivity; does not prove leakage or real-world failure.
4. **Degradation.** Baseline, 50% missing, 10% noise, shuffled control, oracle. Each row carries its label.
5. **Compare methods.** A ML-only, B naive fusion, C reliability-aware: F1, FPR and review rate together, with improved/matched/worsened computed from the numbers. The price of C is review load.
6. **Report.** Unsaved preview with JSON download. In live mode only, an explicit button saves a real incident (no raw content) and enables PDF. PDF needs the backend.
7. **Summary.** Findings computed from the saved files, then limitations. `Esc` exits; Restart resets.

## Notes for the presenter

- The proxy feed (train-domain hosts) with 10% noise injects more false matches (3,507) than there are legitimate test URLs (2,865), so FPR saturates at 100%. The explorer detects and warns about this; the 10% noise preset therefore uses the oracle-derived feed.
- Presets filter saved observations; they never launch an experiment. Seed filter switches between the mean ± SD and a single seed's saved row. ± values are spread over 3 seeds, not confidence intervals.
- Strict metrics count review items as not flagged. Thresholds are fit on validation per policy, so they differ across methods.

## Limitations

No real threat-intelligence feed is integrated; oracle results are an upper bound; the classifier reads URLs only (email heuristics unvalidated); the app has not been deployed or verified on hosted infrastructure and hosted incident storage may be ephemeral and unauthenticated. Course-module names and individual-contribution statements are intentionally not included.

## Checklist before presenting

- [ ] `python -m pytest -q` and `npm --prefix frontend test` pass.
- [ ] API badge in the header shows online with the real-data model (or Demo mode is chosen on purpose).
- [ ] Walk steps 1 to 7 once; confirm labels are visible.
