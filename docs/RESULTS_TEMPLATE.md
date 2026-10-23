# Results template

Fill this in **only** from files in `experiments/results/`. Do not type numbers from memory or from other runs.

## Run record

- Date / commit: 
- `run_metadata.json` -> `synthetic_data`: must be `false` for any reported result.
- Data: file, SHA-256 (from `data_provenance`), rows after de-duplication, split sizes:
- Config file used (attach `default.json`): 
- Seeds: 
- Thresholds (`thresholds_fit_on_validation`): 

## Table (copy rows from `metrics_summary.csv`, mean ± SD over seeds)

| Scenario | Method | Recall | FPR | Review rate | F1 |
|---|---|---|---|---|---|
| | | | | | |

## Observations

For each hypothesis H1-H4 write one of: *supported*, *not supported*, *inconclusive*, with the figure/table row you rely on.
Do not claim an effect that is smaller than the seed-to-seed SD. Report the shuffled-control result next to any claimed benefit.

## Anything surprising or suspicious

(Investigate before interpreting: identical metrics across methods, perfect scores, benefit surviving the shuffled control.)

## Limitations that apply to this run

Link to `docs/LIMITATIONS.md` and list any that were specifically relevant.
