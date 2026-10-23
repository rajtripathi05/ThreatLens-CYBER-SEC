# Research method

## Research questions
RQ1. How well does a URL-string classifier trained on PhiUSIIL generalise to held-out URLs and unseen hosts?
RQ2. How do missing, stale, noisy or unavailable threat-intelligence (TI) records change phishing-URL triage?
RQ3. Can a reliability-aware policy (C) reduce incorrect high-risk calls versus naive fusion (B) and ML-only (A)?
No novelty or publishability claim is made; that needs a literature review (not done).

## Evidence levels
- **A – empirical:** RQ1 on PhiUSIIL (`src/real_eval.py`).
- **B – independent TI:** *not performed.* No licensed, dated, independent feed is integrated; `TISnapshot.from_csv` is the intended interface and overlap must be measured before any claim.
- **C – simulation:** RQ2/RQ3 under seeded corruption (`src/experiment_runner.py`). Feed modes: `oracle_test_labels` (upper bound, uses test labels) and `proxy_train_domains` (hosts of training phishing URLs; disjoint from test URLs). Scenario families: coverage loss, synthetic false matches (unlabelled/labelled), stale entries, outage, shuffled negative control.

## Data, inclusion/exclusion
UCI PhiUSIIL (id 967), only `URL` and `label` used. Label mapped to 1 = phishing (source: 0 = phishing). Dropped: empty URLs (0), URLs with conflicting labels (0), exact duplicate rows (425). Final 235,370 URLs. See `DATA_PROVENANCE.md`.

## Methods
A ML-only (flag if p ≥ t_hi); B naive fusion (+0.30 on match, −0.10 otherwise, threshold tuned on validation); C reliability-aware (per-TI-state rules: fresh match trusted unless model clearly contradicts → review; stale/synthetic ≈ ignored; NO_MATCH/UNKNOWN contribute nothing; uncertain band → review). Baselines: always-benign, random-by-prior, lexical rules. Constants are heuristic, not calibrated. t_hi = best-F1 on validation; t_low = lowest score keeping 98 % validation recall.

## Splits and leakage controls
Stratified 60/20/20 on de-duplicated URLs, and a host-grouped 60/20/20 (no host in two partitions). Vectoriser/classifier fit on train only; thresholds on validation only; test used for reporting. Leakage audit reports share of test items whose host / near-duplicate (scheme-, `www.`- and slash-insensitive) appears in train. Ablation removes scheme and `www.`.

## Metrics, seeds, uncertainty
Precision, recall, F1, FPR, ROC-AUC, PR-AUC, Brier, ECE (10 bins; isotonic fit on validation as a diagnostic), review rate, latency. Classifier: seeds 42–44 (split + training) and 300 test-set bootstrap resamples (CI excludes split variance). Simulation: split seed 42, feed seeds 11/22/33 (variance is feed construction only), ≤5,000 test items.

## Results (as saved; see Research Lab for run IDs)
- Classifier (3-seed mean F1): stratified raw 0.9968, host-grouped raw 0.9967; with scheme/`www.` stripped 0.8772 (stratified), 0.8780 (host-grouped). Host-grouping did not hurt, so host overlap is not the main inflation source; the scheme/`www.` artefact is (top live n-grams are `http:`-style tokens).
- Simulation, raw-URL model: ML-only is near ceiling (F1 0.998), so TI cannot help. With 10 % false matches at 50 % coverage (oracle feed) naive fusion F1 0.982/FPR 2.5 % vs A and C 0.998/0.07 %; C pays 1.5 % review.
- Simulation, proxy feed: only 10.2 % of test phishing URLs match; naive fusion with a validation-tuned threshold of 0.070 reaches FPR 61 % at 10 % false matches (threshold-tuning fragility); C keeps FPR 0.07 % at 35 % review rate.
- Simulation, stripped model with oracle feed (harder task): F1 A 0.879, B 0.935, C 0.934 at full coverage (review 39 %); at 50 %/10 % noise B 0.898 vs C 0.898, FPR 5.7 % vs 4.9 %.
These are simulations unless labelled empirical; the review rates of C are large in the harder setting and are a cost, not a free gain.

## Validity threats
Dataset artefacts and single collection window; label noise; simulated feed assumptions; 3 seeds; threshold fragility of B; no independent TI; no email-body data; hyper-parameters not tuned.

## Proposed paper structure
1 Abstract · 2 Introduction · 3 Related work (to be researched) · 4 Threat model & problem · 5 System & methodology · 6 Dataset & provenance · 7 Experimental design · 8 Results · 9 Discussion & limitations · 10 Conclusion · 11 References. Insert numbers only from saved result files. Course-module mapping: **pending** (official titles not supplied).
