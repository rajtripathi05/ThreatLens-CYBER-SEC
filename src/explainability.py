"""Linear-model explanation: which character n-grams pushed the score up or down.

This is a description of the fitted model's arithmetic for one input, not a causal claim.
"""
from __future__ import annotations

import numpy as np

_NAMES_CACHE: dict[int, np.ndarray] = {}


def top_terms(pipe, url: str, k: int = 6) -> list[dict]:
    tfidf, lr = pipe.named_steps["tfidf"], pipe.named_steps["lr"]
    names = _NAMES_CACHE.get(id(tfidf))
    if names is None:
        names = tfidf.get_feature_names_out()
        _NAMES_CACHE[id(tfidf)] = names
    X = tfidf.transform([url])
    if X.nnz == 0:
        return []
    contrib = X.data * lr.coef_[0][X.indices]
    order = np.argsort(-np.abs(contrib))[:k]
    return [{"ngram": str(names[X.indices[i]]), "contribution": round(float(contrib[i]), 4),
             "direction": "toward phishing" if contrib[i] > 0 else "toward legitimate"} for i in order]
