"""Train the URL model and save artefacts.

    python -m src.train_model --synthetic
    python -m src.train_model --csv data/raw/PhiUSIIL_Phishing_URL_Dataset.csv --url-col URL --label-col label --scheme uci
"""
from __future__ import annotations

import argparse
from pathlib import Path

from sklearn.metrics import roc_auc_score

from . import classifier, data_io, risk_engine
from .config import MODELS_DIR, model_paths


def run(csv: str | None, synthetic: bool, url_col: str, label_col: str, scheme: str, seed: int = 42) -> dict:
    if csv:
        ds = data_io.load_csv(Path(csv), url_col, label_col, scheme)
    elif synthetic:
        ds = data_io.load_synthetic()
    else:
        raise SystemExit("Provide --csv PATH or --synthetic")
    train, val, test = data_io.split(ds.df, seed=seed)
    pipe = classifier.train(train, seed)
    info = {"seed": seed, "train": len(train), "val": len(val), "test": len(test), "strategy": "stratified, URL-deduplicated"}
    p_val = pipe.predict_proba(val.url.tolist())[:, 1]
    th = risk_engine.fit_ml_thresholds(val.label.values, p_val)  # validation only
    path, meta_path = model_paths(bool(ds.provenance.get("synthetic")))
    meta = classifier.save(pipe, ds.provenance, info, path=path, meta_path=meta_path,
                           extra={"thresholds": th.to_dict(), "val_auc": float(roc_auc_score(val.label.values, p_val))})
    data_io.write_json(MODELS_DIR / ("dataset_provenance.json" if ds.provenance.get("synthetic")
                                     else "dataset_provenance_phiusiil.json"), ds.provenance)
    return meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--url-col", default="URL")
    ap.add_argument("--label-col", default="label")
    ap.add_argument("--scheme", default="uci", choices=sorted(data_io.LABEL_SCHEMES))
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    meta = run(a.csv, a.synthetic, a.url_col, a.label_col, a.scheme, a.seed)
    print("Saved model:", meta["model_version"], "sha256", meta["artifact_sha256"][:12], "synthetic:", meta["trained_on_synthetic"])


if __name__ == "__main__":
    main()
