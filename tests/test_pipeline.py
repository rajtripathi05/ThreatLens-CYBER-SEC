import json
import sqlite3

import pandas as pd

from src import case_store, email_parser, experiment_runner, reporting, risk_engine


def _case(bundle, snapshot):
    p = email_parser.parse_eml(b"Subject: s\r\nFrom: a@b.example\r\n\r\nSecret body http://fresh.example/p")
    return risk_engine.analyze_email(p, email_parser.email_signals(p), bundle, snapshot, risk_engine.Thresholds())


def test_report_schema(bundle, snapshot):
    rec = reporting.build_case_record(_case(bundle, snapshot), bundle.meta)
    assert set(reporting.REPORT_KEYS) <= set(rec)
    assert rec["case_id"].startswith("TL-") and rec["created_utc"].endswith("+00:00")
    assert "not a calibrated" in rec["score_semantics"].lower() or "NOT a calibrated" in rec["score_semantics"]
    assert json.loads(reporting.to_json_bytes(rec))["case_id"] == rec["case_id"]
    assert reporting.to_pdf_bytes(rec)[:4] == b"%PDF"


def test_raw_email_not_stored_unless_explicit(bundle, snapshot, tmp_path):
    db = tmp_path / "c.db"
    rec = reporting.build_case_record(_case(bundle, snapshot), bundle.meta)
    case_store.save_case(rec, raw_body="Secret body", save_raw=False, db=db)
    assert case_store.get_raw_body(rec["case_id"], db) is None
    assert "Secret body" not in sqlite3.connect(db).execute("SELECT record_json FROM cases").fetchone()[0]
    rec2 = reporting.build_case_record(_case(bundle, snapshot), bundle.meta)
    case_store.save_case(rec2, raw_body="Secret body", save_raw=True, db=db)
    assert case_store.get_raw_body(rec2["case_id"], db) == "Secret body"
    assert len(case_store.list_cases(db)) == 2
    case_store.delete_case(rec2["case_id"], db)
    assert len(case_store.list_cases(db)) == 1


def test_experiment_outputs_and_reproducibility(tmp_path):
    cfg = experiment_runner.load_config()
    cfg.update(seeds=[1, 2], max_test_items=300, coverage_levels=[1.0, 0.5], false_match_shares=[0.0, 0.2],
               stale_fractions=[0.5], outage_fractions=[0.5], latency_items=10, tradeoff_target_recalls=[0.9, 0.98],
               degraded_scenario={"coverage": 0.5, "noise": 0.2})
    cfg["data"] = {"csv": None, "synthetic": True, "url_col": "URL", "label_col": "label", "label_scheme": "uci"}
    out1, out2 = tmp_path / "a", tmp_path / "b"
    m1 = experiment_runner.run(cfg, out1)
    experiment_runner.run(cfg, out2)
    for f in ("metrics_by_run.csv", "metrics_summary.csv", "raw_decisions.csv.gz", "review_tradeoff.csv",
              "run_metadata.json", "run_status.json"):
        assert (out1 / f).exists(), f
    assert len(list((out1 / "figures").glob("*.png"))) >= 4
    assert "SIMULATED" in m1["simulation_label"] and m1["synthetic_data"] is True
    a, b = pd.read_csv(out1 / "metrics_by_run.csv"), pd.read_csv(out2 / "metrics_by_run.csv")
    pd.testing.assert_frame_equal(a, b)     # fixed seeds -> identical metrics
    methods = set(a.method)
    assert {"ml_only", "naive_fusion", "reliability_aware", "dummy_always_benign", "dummy_random_prior"} <= methods
    assert {"control_shuffled", "coverage_noise", "stale", "outage"} <= set(a.group)
    # same items for every method in a run
    assert a.groupby(["scenario_id", "seed", "method"]).n.first().nunique() == 1
    raw = pd.read_csv(out1 / "raw_decisions.csv.gz")
    assert set(raw.ti_state) <= {"MATCH_FRESH", "MATCH_STALE", "SYNTHETIC_MATCH", "NO_MATCH", "UNKNOWN"}
    assert json.loads((out1 / "run_status.json").read_text())["state"] == "complete"
