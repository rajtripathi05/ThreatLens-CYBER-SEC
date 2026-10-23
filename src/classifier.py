"""URL-string classifier: char n-gram TF-IDF + logistic regression. Label 1 = phishing."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from . import data_io
from .config import MODEL_META_PATH, MODEL_PATH, MODEL_VERSION


@dataclass
class ModelBundle:
    pipeline: Pipeline
    meta: dict

    def predict_proba(self, urls) -> np.ndarray:
        """P(phishing) for each URL string."""
        if isinstance(urls, str):
            raise TypeError("predict_proba expects a list of URL strings")
        return self.pipeline.predict_proba([str(u) for u in urls])[:, 1]


def build_pipeline(seed: int = 42) -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="char", ngram_range=(3, 5), min_df=2, max_features=200_000,
                                  sublinear_tf=True, lowercase=True, dtype=np.float32)),
        ("lr", LogisticRegression(max_iter=1000, C=3.0, random_state=seed)),
    ])


def train(train_df, seed: int = 42) -> Pipeline:
    pipe = build_pipeline(seed)
    pipe.fit(train_df.url.tolist(), train_df.label.values)  # vectoriser fit on training data only
    return pipe


def save(pipe: Pipeline, provenance: dict, split_info: dict, path: Path = MODEL_PATH,
         meta_path: Path = MODEL_META_PATH, extra: dict | None = None) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipe, path)
    meta = {"model_version": MODEL_VERSION, "sklearn_version": sklearn.__version__,
            "artifact_sha256": data_io.sha256_file(path), "positive_label": 1,
            "trained_on_synthetic": bool(provenance.get("synthetic")), "data_provenance": provenance,
            "split": split_info, "input": "list[str] of URL strings", **(extra or {})}
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    return meta


def load(path: Path = MODEL_PATH, meta_path: Path = MODEL_META_PATH) -> ModelBundle:
    """Load a locally trained model after checking checksum and library version."""
    if not path.exists() or not meta_path.exists():
        raise FileNotFoundError("Model not found. Run: python -m src.train_model --synthetic")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if data_io.sha256_file(path) != meta.get("artifact_sha256"):
        raise ValueError("Model checksum mismatch; refusing to load (joblib is pickle-based).")
    if meta.get("sklearn_version") != sklearn.__version__:
        raise ValueError(f"Model trained with scikit-learn {meta.get('sklearn_version')}, "
                         f"running {sklearn.__version__}. Retrain.")
    pipe = joblib.load(path)
    probe = pipe.predict_proba(["https://example.com/"])
    if probe.shape != (1, 2):
        raise ValueError("Unexpected model output shape")
    return ModelBundle(pipe, meta)


def measure_latency_ms(pipe: Pipeline, urls: list[str], n: int = 200) -> float:
    """Mean single-URL inference latency in milliseconds."""
    sample = urls[:n]
    t0 = time.perf_counter()
    for u in sample:
        pipe.predict_proba([u])
    return (time.perf_counter() - t0) * 1000 / max(len(sample), 1)
