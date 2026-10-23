"""Controlled experiments: ML-only vs naive fusion vs reliability-aware triage under SIMULATED
threat-intelligence degradation. Same test items and same simulated feed for every method.

Everything here is a simulation. It says nothing about the real-world quality of any TI provider.
"""
from __future__ import annotations

import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn

from . import classifier, data_io, evaluation, risk_engine, run_registry
from .config import EXPERIMENT_CONFIG, RESULTS_DIR, ROOT, model_paths
from .indicator_rules import heuristic_score
from .schemas import TIState
from .threat_intelligence import (TIRecord, TISnapshot, age_entries, inject_false_matches, lookup,
                                  subsample_coverage)
from .url_features import normalize_url, parse_url

SIMULATION_LABEL = "SIMULATED TI degradation (synthetic corruption; not real provider data quality)"
FEED_MODES = {
    "oracle_test_labels": "ORACLE upper bound: the feed is sampled from the held-out phishing TEST URLs (uses ground truth). "
                          "Not a deployable defence and not independent threat intelligence.",
    "proxy_train_domains": "PROXY feed: hosts of TRAIN-split phishing URLs as domain indicators. Disjoint from test URLs by "
                           "construction; matches only via shared hosts. Dataset-derived, not independent real-world TI.",
}
METHODS = ["dummy_always_benign", "dummy_random_prior", "heuristics_only", "ml_only", "naive_fusion",
           "reliability_aware"]
METRIC_COLS = ["precision", "recall", "f1", "fpr", "fnr", "review_rate", "recall_incl_review",
               "fpr_incl_review", "roc_auc", "pr_auc"]


def load_config(path: Path | None = None) -> dict:
    return json.loads(Path(path or EXPERIMENT_CONFIG).read_text(encoding="utf-8"))


def build_reference_feed(urls, y, phish_coverage: float, seed: int, ref_time: datetime) -> TISnapshot:
    """Reference feed: a seeded fraction of the phishing test URLs, all fresh. Simulation only."""
    rng = np.random.default_rng(seed)
    phish = sorted({normalize_url(u) for u, lab in zip(urls, y) if lab == 1})
    k = int(round(len(phish) * phish_coverage))
    picks = rng.choice(len(phish), size=k, replace=False) if k else []
    recs = [TIRecord(phish[int(i)], "url", "SIMULATED-FEED", ref_time - pd.Timedelta(days=int(rng.integers(1, 20))))
            for i in picks]
    return TISnapshot.from_records(recs, name="simulated-reference", collected_at=ref_time)


def build_proxy_feed(train_urls, train_y, coverage: float, seed: int, ref_time: datetime) -> TISnapshot:
    """Domain indicators from training-split phishing hosts (never from the evaluated items)."""
    rng = np.random.default_rng(seed)
    hosts = sorted({parse_url(u).host for u, lab in zip(train_urls, train_y) if lab == 1} - {""})
    k = int(round(len(hosts) * coverage))
    picks = rng.choice(len(hosts), size=k, replace=False) if k else []
    recs = [TIRecord(hosts[int(i)], "domain", "PROXY-TRAIN-DOMAINS",
                     ref_time - pd.Timedelta(days=int(rng.integers(1, 20)))) for i in picks]
    return TISnapshot.from_records(recs, name="proxy-train-domains", collected_at=ref_time)


def scenario_grid(cfg: dict) -> list[dict]:
    sc: list[dict] = []
    for cov in cfg["coverage_levels"]:
        for noise in cfg["false_match_shares"]:
            for vis in (["unlabelled"] if noise == 0 else ["unlabelled", "labelled"]):
                sc.append(dict(group="coverage_noise", coverage=cov, noise=noise, visibility=vis,
                               stale=0.0, outage=0.0, control="none"))
    for s in cfg["stale_fractions"]:
        sc.append(dict(group="stale", coverage=1.0, noise=0.0, visibility="unlabelled", stale=s, outage=0.0, control="none"))
    for o in cfg["outage_fractions"]:
        sc.append(dict(group="outage", coverage=1.0, noise=0.0, visibility="unlabelled", stale=0.0, outage=o, control="none"))
    for noise in (0.0, 0.1):
        sc.append(dict(group="control_shuffled", coverage=1.0, noise=noise, visibility="unlabelled",
                       stale=0.0, outage=0.0, control="shuffled"))
    for i, s in enumerate(sc):
        s["scenario_id"] = f"S{i:02d}"
    return sc


def _build_snapshot(base: TISnapshot, benign_urls, sc: dict, seed: int) -> TISnapshot:
    snap = base
    if sc["coverage"] < 1.0:
        snap = subsample_coverage(snap, sc["coverage"], seed + 1)
    if sc["stale"] > 0:
        snap = age_entries(snap, sc["stale"], seed + 2)
    return inject_false_matches(snap, benign_urls, sc["noise"], seed + 3,
                                label_synthetic=(sc["visibility"] == "labelled"))


def _decide_all(urls, p, ti_list, h_scores, th, h_t, rng_prior, prior):
    n = len(urls)
    out = {m: {"decision": [], "score": []} for m in METHODS}
    rand_scores = rng_prior.random(n)
    for i in range(n):
        ti = ti_list[i]
        a = risk_engine.ml_only(p[i], th)
        b = risk_engine.naive_fusion(p[i], ti, th)
        c = risk_engine.reliability_triage(p[i], ti, th)
        out["ml_only"]["decision"].append(a.decision.value); out["ml_only"]["score"].append(a.score)
        out["naive_fusion"]["decision"].append(b.decision.value); out["naive_fusion"]["score"].append(b.score)
        out["reliability_aware"]["decision"].append(c.decision.value); out["reliability_aware"]["score"].append(c.score)
        out["heuristics_only"]["decision"].append("phishing" if h_scores[i] >= h_t else "benign")
        out["heuristics_only"]["score"].append(h_scores[i])
        out["dummy_always_benign"]["decision"].append("benign"); out["dummy_always_benign"]["score"].append(0.0)
        out["dummy_random_prior"]["decision"].append("phishing" if rand_scores[i] < prior else "benign")
        out["dummy_random_prior"]["score"].append(rand_scores[i])
    return out


def _write_status(out_dir: Path, **kw) -> None:
    f = out_dir / "run_status.json"
    cur = json.loads(f.read_text()) if f.exists() else {}
    cur.update(kw, updated_utc=datetime.now(timezone.utc).isoformat())
    f.write_text(json.dumps(cur, indent=2), encoding="utf-8")


def run(cfg: dict | None = None, out_dir: Path | None = None) -> dict:
    cfg = cfg or load_config()
    default_out = ROOT / cfg.get("out_dir", "experiments/results/synthetic")
    out_dir = Path(out_dir or default_out)
    cfg.setdefault("feed_mode", "oracle_test_labels")
    if cfg["feed_mode"] not in FEED_MODES:
        raise ValueError(f"feed_mode must be one of {sorted(FEED_MODES)}")
    archived = run_registry.archive_previous(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "figures").mkdir(exist_ok=True)
    _write_status(out_dir, state="running", started_utc=datetime.now(timezone.utc).isoformat(), progress=0.0, error=None)
    try:
        return _run(cfg, out_dir, archived)
    except Exception as exc:  # record failure for the UI
        _write_status(out_dir, state="failed", error=f"{type(exc).__name__}: {exc}")
        raise


def _run(cfg: dict, out_dir: Path, archived=None) -> dict:
    t_start = time.time()
    started = datetime.now(timezone.utc)
    feed_mode = cfg["feed_mode"]
    d = cfg["data"]
    csv_path = (Path(d["csv"]) if d.get("csv") and Path(d["csv"]).is_absolute() else ROOT / d["csv"]) if d.get("csv") else None
    ds = (data_io.load_csv(csv_path, d["url_col"], d["label_col"], d["label_scheme"])
          if d.get("csv") else data_io.load_synthetic())
    variant = d.get("url_variant", "raw_url")
    if variant == "scheme_www_stripped":   # ablation: remove a known dataset artefact (scheme / 'www.')
        df = ds.df.copy()
        df["url"] = df.url.map(data_io.strip_scheme_www)
        ds.df = df.drop_duplicates("url").reset_index(drop=True)
        ds.provenance = {**ds.provenance, "url_variant": variant, "final_rows": int(len(ds.df))}
    elif variant != "raw_url":
        raise ValueError(f"unknown url_variant {variant}")
    train, val, test = data_io.split(ds.df, seed=cfg["split_seed"])

    # Reuse the saved model only if it was trained on exactly this data and split.
    try:
        mp, mm = model_paths(bool(ds.provenance.get("synthetic")))
        bundle = classifier.load(mp, mm)
        ok = (bundle.meta["data_provenance"].get("sha256") == ds.provenance["sha256"]
              and bundle.meta["split"].get("seed") == cfg["split_seed"]
              and bundle.meta["data_provenance"].get("url_variant", "raw_url") == variant)
    except Exception:
        ok = False
    if not ok:
        bundle = classifier.ModelBundle(classifier.train(train, cfg["split_seed"]), {})
    model_source = "loaded" if ok else "trained_in_runner"

    max_n = cfg["max_test_items"]
    if len(test) > max_n:
        n_all = len(test)
        test = pd.concat([g.sample(n=int(round(max_n * len(g) / n_all)), random_state=cfg["split_seed"])
                          for _, g in test.groupby("label")]).reset_index(drop=True)
    urls, y = test.url.tolist(), test.label.values
    p_val = bundle.predict_proba(val.url.tolist())
    p_test = bundle.predict_proba(urls)
    ref_time = datetime.fromisoformat(cfg["reference_time"])
    benign_urls = [u for u, lab in zip(urls, y) if lab == 0]

    # ---- thresholds: validation only ------------------------------------------------
    th = risk_engine.fit_ml_thresholds(val.label.values, p_val, cfg["target_recall_for_low_threshold"])
    def make_base(items_urls, items_y, seed):
        if feed_mode == "oracle_test_labels":
            return build_reference_feed(items_urls, items_y, cfg["reference_feed_phishing_coverage"], seed, ref_time)
        return build_proxy_feed(train.url.tolist(), train.label.values, cfg["reference_feed_phishing_coverage"], seed, ref_time)

    val_base = make_base(val.url.tolist(), val.label.values, 0)
    val_ti = [lookup(u, val_base) for u in val.url]
    naive_val = np.array([risk_engine.naive_fusion(p, t, th).score for p, t in zip(p_val, val_ti)])
    th.naive_t = risk_engine.best_f1_threshold(val.label.values, naive_val)
    h_val = np.array([heuristic_score(u) for u in val.url])
    h_t = risk_engine.best_f1_threshold(val.label.values, h_val)
    h_test = np.array([heuristic_score(u) for u in urls])
    prior = float(train.label.mean())

    scenarios = scenario_grid(cfg)
    seeds = cfg["seeds"]
    raw_frames, metric_rows = [], []
    total = len(scenarios) * len(seeds)
    done = 0
    for sc in scenarios:
        for seed in seeds:
            base = make_base(urls, y, seed)
            snap = _build_snapshot(base, benign_urls, sc, seed)
            rng = np.random.default_rng(seed + 4)
            outage = rng.random(len(urls)) < sc["outage"]
            ti_list = [lookup(u, snap, available=not outage[i]) for i, u in enumerate(urls)]
            if sc["control"] == "shuffled":  # break the item<->indicator link, keep state mix
                ti_list = [ti_list[j] for j in rng.permutation(len(ti_list))]
            res = _decide_all(urls, p_test, ti_list, h_test, th, h_t, np.random.default_rng(seed + 5), prior)
            for m in METHODS:
                met = evaluation.triage_metrics(y, res[m]["decision"], res[m]["score"],
                                                probability=(m == "ml_only"))
                metric_rows.append({**{k: sc[k] for k in ("scenario_id", "group", "coverage", "noise", "visibility",
                                                          "stale", "outage", "control")},
                                    "seed": seed, "method": m, **met})
            raw_frames.append(pd.DataFrame({
                "scenario_id": sc["scenario_id"], "seed": seed, "item": range(len(urls)), "url": urls, "y_true": y,
                "ml_p": p_test, "ti_state": [t.state.value for t in ti_list],
                "naive_score": res["naive_fusion"]["score"], "naive_decision": res["naive_fusion"]["decision"],
                "ra_score": res["reliability_aware"]["score"], "ra_decision": res["reliability_aware"]["decision"]}))
            done += 1
            _write_status(out_dir, progress=round(done / total, 3), current=f"{sc['scenario_id']} seed {seed}")

    # ---- review/coverage trade-off sweep (one scenario, first seed) --------------------
    seed0 = seeds[0]
    dg = cfg["degraded_scenario"]
    sc0 = dict(coverage=dg["coverage"], noise=dg["noise"], visibility="unlabelled", stale=0.0, outage=0.0)
    snap0 = _build_snapshot(make_base(urls, y, seed0), benign_urls, sc0, seed0)
    ti0 = [lookup(u, snap0) for u in urls]
    feed0 = make_base(urls, y, seed0)
    base0 = [lookup(u, feed0) for u in urls]
    is_match = np.array([t.state in risk_engine.MATCH_STATES for t in base0])
    feed_overlap = {"seed": seed0, "feed_entries_before_degradation": len(feed0),
                    "test_phishing_with_match": int((is_match & (y == 1)).sum()), "test_phishing": int((y == 1).sum()),
                    "test_legitimate_with_match": int((is_match & (y == 0)).sum()), "test_legitimate": int((y == 0).sum()),
                    "phishing_match_rate": float((is_match & (y == 1)).sum() / max((y == 1).sum(), 1)),
                    "legitimate_match_rate": float((is_match & (y == 0)).sum() / max((y == 0).sum(), 1))}
    tradeoff = []
    for tr in cfg["tradeoff_target_recalls"]:
        th_v = risk_engine.Thresholds(th.t_hi, min(risk_engine.low_threshold(val.label.values, p_val, tr), th.t_hi), th.naive_t)
        dec = [risk_engine.reliability_triage(p_test[i], ti0[i], th_v).decision.value for i in range(len(urls))]
        m = evaluation.triage_metrics(y, dec)
        tradeoff.append({"target_recall_low": tr, "t_low": th_v.t_low, **{k: m[k] for k in
                         ("review_rate", "recall", "recall_incl_review", "fpr", "fpr_incl_review")}})
    pd.DataFrame(tradeoff).to_csv(out_dir / "review_tradeoff.csv", index=False)

    # ---- latency -------------------------------------------------------------------------
    n_lat = min(cfg["latency_items"], len(urls))
    ml_ms = classifier.measure_latency_ms(bundle.pipeline, urls, n_lat)
    t0 = time.perf_counter()
    for i in range(n_lat):
        ti = lookup(urls[i], snap0)
        risk_engine.naive_fusion(p_test[i], ti, th)
        risk_engine.reliability_triage(p_test[i], ti, th)
    fusion_ms = (time.perf_counter() - t0) * 1000 / max(n_lat, 1)

    # ---- save ---------------------------------------------------------------------------
    metrics = pd.DataFrame(metric_rows)
    metrics.to_csv(out_dir / "metrics_by_run.csv", index=False)
    keys = ["scenario_id", "group", "coverage", "noise", "visibility", "stale", "outage", "control", "method"]
    agg = metrics.groupby(keys)[METRIC_COLS].agg(["mean", "std"])
    agg.columns = [f"{a}_{b}" for a, b in agg.columns]
    agg = agg.reset_index()
    agg.to_csv(out_dir / "metrics_summary.csv", index=False)
    pd.concat(raw_frames).to_csv(out_dir / "raw_decisions.csv.gz", index=False)

    is_synth = bool(ds.provenance.get("synthetic"))
    meta = {
        "run_id": run_registry.new_run_id("synth-sim" if is_synth else "real-ti-sim"), "kind": "ti_degradation_simulation",
        "is_synthetic": is_synth, "is_simulation": True, "feed_mode": feed_mode, "feed_mode_description": FEED_MODES[feed_mode],
        "evidence_level": ("C: controlled synthetic feed degradation (SIMULATION)" +
                           (" on synthetic URLs" if is_synth else " on PhiUSIIL URLs")),
        "started_utc": started.isoformat(timespec="seconds"), "git_commit": run_registry.git_commit(ROOT),
        "preprocessing_version": run_registry.PREPROCESSING_VERSION, "archived_previous_to": str(archived) if archived else None,
        "feed_overlap": feed_overlap,
        "status": "complete", "simulation_label": SIMULATION_LABEL, "config": cfg,
        "finished_utc": datetime.now(timezone.utc).isoformat(), "runtime_seconds": round(time.time() - t_start, 1),
        "data_provenance": ds.provenance, "synthetic_data": bool(ds.provenance.get("synthetic")),
        "results_warning": ("Computed on SYNTHETIC demo data; do not report as research results."
                            if ds.provenance.get("synthetic") else None),
        "split": {"seed": cfg["split_seed"], "train": len(train), "val": len(val), "test_used": len(urls)},
        "model_source": model_source,
        "thresholds_fit_on_validation": {**th.to_dict(), "heuristic_t": h_t},
        "scenario_count": len(scenarios), "seeds": seeds, "n_runs": total,
        "latency_ms_per_item": {"url_model": round(ml_ms, 3), "ti_lookup_plus_both_fusion_policies": round(fusion_ms, 4)},
        "versions": run_registry.versions(),
        "dummy_prior": prior,
    }
    (out_dir / "run_metadata.json").write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    from . import plots
    plots.make_all(out_dir)
    _write_status(out_dir, state="complete", progress=1.0, error=None)
    return meta
