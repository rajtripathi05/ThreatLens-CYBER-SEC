# Limitations and threats to validity

- **Dataset artefact.** Raw-URL F1 ≈ 0.997 falls to ≈ 0.877 when the scheme and `www.` are removed; treat raw numbers as an upper bound on this dataset. Live model explanations are dominated by `http:`-type n-grams for the same reason.
- **Single collection / label noise.** One dataset; labels as supplied; no temporal split (collection dates unavailable).
- **Leakage.** Exact duplicates removed; the stratified split still has 7.7 % of test hosts and 2.0 % near-duplicates seen in training; the host-grouped split removes host overlap (sibling subdomains are separate groups).
- **No independent threat intelligence.** All TI evidence is simulated; the oracle feed uses test labels (upper bound); the proxy feed is dataset-derived. Nothing says how any real feed behaves.
- **Ceiling effect.** With the raw-URL model, TI has nothing to add; method comparisons mostly reflect noise handling.
- **Policy parameters.** Fusion constants are heuristic; naive fusion shows threshold fragility (proxy feed FPR 61 %). Policy C can send a large share to review (35–40 % in the harder settings).
- **Statistics.** 3 seeds; simulation seeds vary the feed, not the split; bootstrap CIs exclude split variance; ≤ 5,000 test items in simulations.
- **Calibration.** ECE ≈ 0.006 on the test split but live scores are uncalibrated; risk score is a heuristic.
- **Scope.** URL strings only. No email-body validation; header/wording rules are unvalidated heuristics. Exact matching only; no redirects, page content, WHOIS or TLS.
- **Operations.** Not a gateway; SQLite incident store is ephemeral on free hosts and unauthenticated unless a token is set; pickle model files require trusted provenance.

## Local rule-based fallback
The browser-local rules (`docs/LOCAL_MODE.md`) are transparent heuristics with hand-chosen weights. They are not trained, not calibrated, not evaluated on any labelled data, not a research baseline, and give no formal security guarantee. `INSUFFICIENT EVIDENCE` is not "safe". No threat-intelligence snapshot is bundled, so local intel state is `UNKNOWN`. Email-wording rules are plain phrase matches. The service worker is verified by simulation and unit tests, not yet by an automated real-browser offline test.

