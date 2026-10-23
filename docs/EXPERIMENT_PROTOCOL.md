# Experiment protocol

| Run | Command | Output dir | `is_synthetic` | Evidence |
|---|---|---|---|---|
| Classifier on PhiUSIIL | `python experiments/run_real_data.py` | `experiments/results/real_data/classifier/` | false | empirical |
| Synthetic simulation | `python experiments/run_experiments.py` | `.../synthetic/` | true | simulation |
| Oracle feed, raw URLs | `... --config experiments/configs/real_oracle.json` | `.../real_data/ti_simulation_oracle/` | false | simulation (upper bound) |
| Oracle feed, stripped URLs | `... real_oracle_stripped.json` | `.../ti_simulation_oracle_stripped/` | false | simulation |
| Proxy feed | `... real_proxy.json` | `.../ti_simulation_proxy/` | false | simulation |

Each run writes `run_metadata.json` (run_id, timestamp, config, seeds, dataset SHA-256, split, preprocessing version, dependency versions, thresholds, `feed_overlap`, git commit or "unavailable"). Starting a run **archives** the previous contents to `_archive/<timestamp>/`; nothing is overwritten. Outputs are produced only by these CLI commands; the API never runs them.

Order of operations: download → validate (columns, counts, label orientation) → de-duplicate → split → fit on train → tune thresholds on validation → evaluate on test once → write results. A test ROC-AUC < 0.5 aborts the run (label-inversion guard). Reproduce with the same seeds and dataset hash; latency numbers are machine-specific.
