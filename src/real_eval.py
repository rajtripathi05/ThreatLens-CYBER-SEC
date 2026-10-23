"""Real-data classifier evaluation on the UCI PhiUSIIL URL column.

Everything here is an EMPIRICAL result on that dataset only (a URL-string classifier). It is not
an email-body result and not a threat-intelligence result. Thresholds are chosen on the
validation split; the test split is used once per run for reporting.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve

from . import classifier, data_io, risk_engine, run_registry
from .config import ROOT

REAL_DIR = ROOT / "experiments" / "results" / "real_data" / "classifier"
DEFAULT_CFG = {
    "name": "real_data_classifier", "csv": "data/raw/PhiUSIIL_Phishing_URL_Dataset.csv", "url_col": "URL",
    "label_col": "label", "label_scheme": "uci", "seeds": [42, 43, 44],
    "protocols": ["stratified", "host_grouped"], "variants": ["raw_url", "scheme_www_stripped"],
    "bootstrap": 300, "ece_bins": 10, "latency_items": 200,
}


def ece(y, p, bins: int = 10) -> tuple[float, list[dict]]:
    y, p = np.asarray(y, float), np.asarray(p, float)
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1]), 0, bins - 1)
    total, rows = 0.0, []
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        conf, acc = float(p[m].mean()), float(y[m].mean())
        total += m.mean() * abs(conf - acc)
        rows.append({"bin": b, "n": int(m.sum()), "mean_predicted": conf, "observed_rate": acc})
    return float(total), rows


def _binary_metrics(y, p, t) -> dict:
    pred = p >= t
    tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
    fn, tn = int((~pred & (y == 1)).sum()), int((~pred & (y == 0)).sum())
    div = lambda a, b: a / b if b else float("nan")  # noqa: E731
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "precision": div(tp, tp + fp), "recall": div(tp, tp + fn),
            "f1": div(2 * tp, 2 * tp + fp + fn), "fpr": div(fp, fp + tn)}


def _bootstrap(y, p, t, n: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        m = _binary_metrics(y[i], p[i], t)
        m["roc_auc"] = float(roc_auc_score(y[i], p[i]))
        rows.append(m)
    df = pd.DataFrame(rows)
    return {k: [float(df[k].quantile(0.025)), float(df[k].quantile(0.975))]
            for k in ("precision", "recall", "f1", "fpr", "roc_auc")}


def _prep(df: pd.DataFrame, variant: str) -> pd.DataFrame:
    if variant == "raw_url":
        return df
    if variant == "scheme_www_stripped":
        out = df.copy()
        out["url"] = out.url.map(data_io.strip_scheme_www)
        return out.drop_duplicates("url").reset_index(drop=True)
    raise ValueError(f"unknown variant {variant}")


def evaluate_one(df: pd.DataFrame, protocol: str, variant: str, seed: int, cfg: dict) -> dict:
    d = _prep(df, variant)
    splitter = {"stratified": data_io.split, "host_grouped": data_io.split_grouped}[protocol]
    train, val, test = splitter(d, seed=seed)
    t0 = time.perf_counter()
    pipe = classifier.train(train, seed)
    train_s = time.perf_counter() - t0
    p_val = pipe.predict_proba(val.url.tolist())[:, 1]
    p_test = pipe.predict_proba(test.url.tolist())[:, 1]
    yv, yt = val.label.values, test.label.values
    if roc_auc_score(yt, p_test) < 0.5:
        raise RuntimeError("Test ROC-AUC < 0.5: label orientation is probably inverted. Aborting.")
    th = risk_engine.fit_ml_thresholds(yv, p_val)          # validation only
    m = _binary_metrics(yt, p_test, th.t_hi)
    fpr_c, tpr_c, _ = roc_curve(yt, p_test)
    keep = np.unique(np.linspace(0, len(fpr_c) - 1, 120).astype(int))
    iso = IsotonicRegression(out_of_bounds="clip").fit(p_val, yv)  # calibration fit on validation only
    p_cal = iso.predict(p_test)
    e_raw, bins_raw = ece(yt, p_test, cfg["ece_bins"])
    e_cal, _ = ece(yt, p_cal, cfg["ece_bins"])
    lat = classifier.measure_latency_ms(pipe, test.url.tolist(), cfg["latency_items"])
    return {
        "protocol": protocol, "variant": variant, "seed": seed,
        "n_train": len(train), "n_val": len(val), "n_test": len(test),
        "phishing_rate": {"train": float(train.label.mean()), "val": float(yv.mean()), "test": float(yt.mean())},
        "threshold_t_hi": th.t_hi, "threshold_t_low": th.t_low, **m,
        "roc_auc": float(roc_auc_score(yt, p_test)), "pr_auc": float(average_precision_score(yt, p_test)),
        "brier": float(np.mean((p_test - yt) ** 2)), "brier_calibrated": float(np.mean((p_cal - yt) ** 2)),
        "ece": e_raw, "ece_isotonic_val_fit": e_cal, "reliability_bins": bins_raw,
        "roc_curve": {"fpr": fpr_c[keep].round(5).tolist(), "tpr": tpr_c[keep].round(5).tolist()},
        "ci95": _bootstrap(yt, p_test, th.t_hi, cfg["bootstrap"], seed),
        "latency_ms_per_url": round(lat, 3), "train_seconds": round(train_s, 1),
        "leakage_audit": data_io.audit_overlap(train, test),
    }


def run(cfg: dict | None = None, out_dir: Path | None = None) -> dict:
    cfg = {**DEFAULT_CFG, **(cfg or {})}
    out_dir = Path(out_dir or REAL_DIR)
    csv = Path(cfg["csv"]) if Path(cfg["csv"]).is_absolute() else ROOT / cfg["csv"]
    if not csv.exists():
        raise FileNotFoundError(f"{csv} not found. Run: python scripts/download_phiusiil.py")
    ds = data_io.load_csv(csv, cfg["url_col"], cfg["label_col"], cfg["label_scheme"])
    run_id = run_registry.new_run_id("real-clf")
    started = datetime.now(timezone.utc)
    archived = run_registry.archive_previous(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    runs = []
    for protocol in cfg["protocols"]:
        for variant in cfg["variants"]:
            for seed in cfg["seeds"]:
                print(f"[{protocol}/{variant}/seed {seed}] ...", flush=True)
                runs.append(evaluate_one(ds.df, protocol, variant, seed, cfg))
    flat = pd.DataFrame([{k: v for k, v in r.items() if not isinstance(v, (dict, list))} for r in runs])
    flat.to_csv(out_dir / "classifier_runs.csv", index=False)
    cols = ["precision", "recall", "f1", "fpr", "roc_auc", "pr_auc", "brier", "ece", "ece_isotonic_val_fit",
            "latency_ms_per_url"]
    agg = flat.groupby(["protocol", "variant"])[cols].agg(["mean", "std"])
    agg.columns = [f"{a}_{b}" for a, b in agg.columns]
    agg.reset_index().to_csv(out_dir / "classifier_summary.csv", index=False)
    meta = {
        "run_id": run_id, "kind": "real_data_classifier", "is_synthetic": False,
        "evidence_level": "A: empirical classifier evaluation on PhiUSIIL (URL strings only)",
        "started_utc": started.isoformat(timespec="seconds"),
        "finished_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": run_registry.git_commit(ROOT), "versions": run_registry.versions(),
        "preprocessing_version": run_registry.PREPROCESSING_VERSION, "config": cfg,
        "data_provenance": ds.provenance, "archived_previous_to": str(archived) if archived else None,
        "model": "TF-IDF char 3-5 gram + LogisticRegression(C=3)",
        "threshold_policy": "t_hi = best-F1 threshold on the validation split; test split never used for tuning",
        "positive_label": "phishing (project label 1; UCI source label 0)",
        "split_protocols": {"stratified": "stratified 60/20/20 on de-duplicated URLs",
                            "host_grouped": "GroupShuffleSplit 60/20/20; no host in >1 partition (class balance not enforced)"},
        "runs": runs,
    }
    (out_dir / "run_metadata.json").write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    return meta
