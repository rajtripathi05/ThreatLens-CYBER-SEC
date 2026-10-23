"""Metric calculations shared by the experiment runner and tests."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score


def _div(a: float, b: float) -> float:
    return float(a / b) if b else float("nan")


def triage_metrics(y, decision, score=None, probability: bool = False) -> dict:
    """y: 1 = phishing. decision: array of 'phishing' | 'benign' | 'review'.

    Strict metrics treat only 'phishing' as a positive call. 'incl_review' variants count
    review as flagged. Review items are not hidden: review_rate is always reported.
    """
    y = np.asarray(y).astype(int)
    d = np.asarray(decision)
    phish, review = d == "phishing", d == "review"
    pos, neg = y == 1, y == 0
    tp, fp = int((phish & pos).sum()), int((phish & neg).sum())
    fn, tn = int((~phish & pos).sum()), int((~phish & neg).sum())
    prec, rec = _div(tp, tp + fp), _div(tp, tp + fn)
    f1 = _div(2 * tp, 2 * tp + fp + fn)
    flagged = phish | review
    out = {
        "n": int(len(y)), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": prec, "recall": rec, "f1": f1,
        "fpr": _div(fp, fp + tn), "fnr": _div(fn, fn + tp),
        "review_rate": float(review.mean()) if len(d) else float("nan"),
        "recall_incl_review": _div(int((flagged & pos).sum()), int(pos.sum())),
        "fpr_incl_review": _div(int((flagged & neg).sum()), int(neg.sum())),
        "roc_auc": float("nan"), "pr_auc": float("nan"), "brier": float("nan"),
    }
    if score is not None and len(np.unique(y)) == 2:
        s = np.asarray(score, dtype=float)
        if np.ptp(s) > 0:
            out["roc_auc"] = float(roc_auc_score(y, s))
            out["pr_auc"] = float(average_precision_score(y, s))
        if probability:
            out["brier"] = float(np.mean((s - y) ** 2))
    return out
