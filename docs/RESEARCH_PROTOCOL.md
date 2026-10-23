# Research protocol

## Research question

How do missing and noisy threat-intelligence (TI) indicators affect phishing-URL triage, and does a reliability-aware
decision policy behave more robustly than naive signal fusion?

## Hypotheses (to be tested, not assumed)

- **H1** As TI coverage falls, naive fusion's recall advantage over ML-only shrinks toward zero.
- **H2** As the false-match share rises, naive fusion's false-positive rate rises faster than the reliability-aware policy's.
- **H3** The reliability-aware policy pays for H2 with a higher manual-review rate; the trade-off is reported, not hidden.
- **H4** The shuffled-indicator control removes any benefit that relies on a genuine item-to-indicator link.

## Methods (same test items and same simulated feed for all)

| ID | Method | Output |
|---|---|---|
| A | URL-only model (char n-gram TF-IDF + logistic regression). Flag if `p >= t_hi`. | phishing / benign |
| B | Naive fusion: `score = clip(p + 0.30)` for any match (fresh, stale or synthetic); `clip(p - 0.10)` for **no-match and unknown alike**. Flag if `score >= naive_t`. Heuristic, not a probability. | phishing / benign |
| C | Reliability-aware triage (table below). | phishing / benign / review |
| ctrl | Always-benign; random with training prior; lexical-heuristics-only (ablation: no ML, no TI). | |

### Policy C

`t_hi`: validation F1-optimal threshold for A. `t_low`: largest threshold keeping >= 98% of validation phishing at or above it.

| TI state | `p >= t_hi` | `t_low <= p < t_hi` | `p < t_low` |
|---|---|---|---|
| MATCH_FRESH | phishing | phishing (+0.25 shown) | **review** (conflict) |
| MATCH_STALE | phishing | review | review (provenance uncertain) |
| SYNTHETIC_MATCH (labelled) | phishing | review | benign (evidence ignored) |
| NO_MATCH / UNKNOWN | phishing | review | benign* |

\*"benign" here means "no strong evidence", and is shown as "not verified safe". NO_MATCH and UNKNOWN contribute exactly 0.

### TI freshness rule

Match is `MATCH_FRESH` only if it has a source, an `observed_at`, the snapshot has a `collected_at`, the entry is not
expired at collection time, and `collected_at - observed_at <= 30 days`. Otherwise `MATCH_STALE`. Entries injected by a
labelled corruption scenario are `SYNTHETIC_MATCH`.

## Experimental matrix (`experiments/configs/default.json`)

- Seeds: 11, 22, 33 (feed construction, corruption and random baselines). Split seed 42.
- Reference feed: a seeded 60% of phishing test URLs, fresh timestamps (simulation).
- Coverage retained: 100/75/50/25%. False-match share (of final feed entries): 0/5/10/20%, run both **unlabelled**
  (false entries look like ordinary fresh matches; realistic) and **labelled** (flagged SYNTHETIC_MATCH; optimistic bound).
- Stale: 25/50% of entries aged beyond the limit. Outage: 25/50% of lookups return UNKNOWN.
- Negative control: TI results permuted across items (noise 0% and 10%).
- Aggregation: mean and SD over seeds (n = 3; SD is rough with so few seeds).

## Metrics

Precision, recall, F1 (phishing verdicts only), FPR, FNR, review rate, recall/FPR counting review as flagged, ROC-AUC and
PR-AUC of each method's score (heuristic scores for B/C), per-item latency. Brier score is computed only for ML-only (the
only probabilistic output) and is not claimed calibrated. Figures: recall/F1 vs coverage, FPR vs noise,
detection vs review rate, method comparison.

## Caveats on interpretation

The simulated feed is derived from test labels (the reference feed knows 60% of the phishing items). It is a controlled
stress test, not an estimate of real feed behaviour. Threshold selection uses a clean reference feed on validation data,
then thresholds stay fixed under degradation, as they would after deployment.
