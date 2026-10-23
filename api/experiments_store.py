"""Read-only access to saved experiment outputs. Never starts or schedules an experiment."""
from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

# id -> (relative dir, kind, short title)
SETS = {
    "synthetic": ("synthetic", "ti_simulation", "SIMULATION on synthetic URLs"),
    "real-classifier": ("real_data/classifier", "classifier", "Empirical: PhiUSIIL URL classifier"),
    "real-ti-oracle": ("real_data/ti_simulation_oracle", "ti_simulation", "SIMULATION on PhiUSIIL URLs (oracle feed)"),
    "real-ti-oracle-stripped": ("real_data/ti_simulation_oracle_stripped", "ti_simulation", "SIMULATION on PhiUSIIL URLs, scheme/www stripped (oracle feed)"),
    "real-ti-proxy": ("real_data/ti_simulation_proxy", "ti_simulation", "SIMULATION on PhiUSIIL URLs (train-domain proxy feed)"),
}


def _clean(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _rows(path: Path) -> list[dict]:
    df = pd.read_csv(path)
    return [{k: _clean(v) for k, v in r.items()} for r in df.to_dict("records")]


_BY_RUN_COLS = ["scenario_id", "group", "coverage", "noise", "visibility", "stale", "outage", "control", "seed", "method", "n",
                "precision", "recall", "f1", "fpr", "review_rate", "roc_auc"]


def _by_run(path: Path) -> list[dict]:
    """Per-seed observations (lets the UI filter by seed). Same numbers as the saved CSV, rounded to 6 d.p."""
    if not path.exists():
        return []
    df = pd.read_csv(path)
    df = df[[c for c in _BY_RUN_COLS if c in df.columns]]
    return [{k: _clean(round(v, 6) if isinstance(v, float) else v) for k, v in r.items()} for r in df.to_dict("records")]


def _meta(d: Path) -> dict | None:
    f = d / "run_metadata.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def list_sets(results_dir: Path) -> list[dict]:
    out = []
    for sid, (rel, kind, title) in SETS.items():
        d = results_dir / rel
        m = _meta(d)
        out.append({
            "id": sid, "kind": kind, "title": title, "available": m is not None,
            "run_id": m.get("run_id") if m else None,
            "is_synthetic": m.get("is_synthetic") if m else None,
            "is_simulation": (m.get("is_simulation", kind == "ti_simulation")) if m else None,
            "finished_utc": (m.get("finished_utc") or m.get("started_utc")) if m else None,
            "evidence_level": m.get("evidence_level") if m else None,
            "hint": None if m else ("Run: python experiments/run_real_data.py" if kind == "classifier" else
                                    "Run: python experiments/run_experiments.py --config experiments/configs/"
                                    + ("default.json" if sid == "synthetic" else
                                       "real_oracle.json" if sid.endswith("oracle") else "real_oracle_stripped.json" if sid.endswith("stripped") else "real_proxy.json")),
        })
    return out


def load_set(results_dir: Path, set_id: str) -> dict | None:
    if set_id not in SETS:
        return None
    rel, kind, title = SETS[set_id]
    d = results_dir / rel
    m = _meta(d)
    if m is None:
        return None
    out: dict = {"id": set_id, "kind": kind, "title": title, "metadata": m}
    if kind == "classifier":
        # runs are embedded in metadata; also provide the aggregated table
        out["summary"] = _rows(d / "classifier_summary.csv") if (d / "classifier_summary.csv").exists() else []
    else:
        out["summary"] = _rows(d / "metrics_summary.csv")
        out["tradeoff"] = _rows(d / "review_tradeoff.csv") if (d / "review_tradeoff.csv").exists() else []
        out["by_run"] = _by_run(d / "metrics_by_run.csv")
        if "config" in m:
            out["filters"] = {k: m["config"][k] for k in ("coverage_levels", "false_match_shares", "stale_fractions",
                                                           "outage_fractions", "seeds")}
    return out
