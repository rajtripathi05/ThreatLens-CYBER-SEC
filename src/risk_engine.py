"""Decision policies A (ML-only), B (naive fusion) and C (reliability-aware triage).

All scores other than the raw ML probability are heuristic ranking values, not probabilities.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import config
from .explainability import top_terms
from .indicator_rules import evaluate_url_rules
from .schemas import (DECISION_LABELS, Contribution, Decision, ParsedEmail, Signal, TIResult, TIState,
                      UrlAnalysis)
from .threat_intelligence import TISnapshot, lookup
from .url_features import normalize_url

MATCH_STATES = (TIState.MATCH_FRESH, TIState.MATCH_STALE, TIState.SYNTHETIC_MATCH)


@dataclass
class Thresholds:
    t_hi: float = 0.5    # ML score at/above which the URL model alone is confident enough to flag
    t_low: float = 0.1   # ML score below which the URL model alone is confident enough to not flag
    naive_t: float = 0.5  # decision threshold for the naive fused score

    def to_dict(self) -> dict:
        return {"t_hi": self.t_hi, "t_low": self.t_low, "naive_t": self.naive_t}


@dataclass
class Triage:
    decision: Decision
    score: float
    contributions: list[Contribution]
    rationale: str


def _clip(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


# ---------------------------------------------------------------- A: ML only
def ml_only(p: float, th: Thresholds) -> Triage:
    d = Decision.PHISHING if p >= th.t_hi else Decision.BENIGN
    return Triage(d, _clip(p), [Contribution("URL model P(phishing)", p, "model output, uncalibrated")],
                  f"URL model score {p:.2f} vs threshold {th.t_hi:.2f}.")


# ---------------------------------------------------------------- B: naive fusion
def naive_fusion(p: float, ti: TIResult, th: Thresholds) -> Triage:
    """Heuristic: any match adds a bonus; anything else (no-match OR unknown) subtracts a penalty."""
    if ti.state in MATCH_STATES:
        adj, note = config.NAIVE_MATCH_BONUS, f"TI match ({ti.state.value}) treated as positive"
    else:
        adj, note = -config.NAIVE_MISS_PENALTY, f"{ti.state.value} treated as benign evidence (naive)"
    score = _clip(p + adj)
    d = Decision.PHISHING if score >= th.naive_t else Decision.BENIGN
    return Triage(d, score, [Contribution("URL model P(phishing)", p, "model output"),
                             Contribution("TI adjustment", adj, note)],
                  f"Naive heuristic score {score:.2f} vs threshold {th.naive_t:.2f}.")


# ---------------------------------------------------------------- C: reliability-aware
def reliability_triage(p: float, ti: TIResult, th: Thresholds) -> Triage:
    """Explicit policy per TI state (see docs/RESEARCH_PROTOCOL.md)."""
    contribs = [Contribution("URL model P(phishing)", p, "model output, uncalibrated")]
    s = ti.state
    ml_flag, ml_clear = p >= th.t_hi, p < th.t_low

    if s == TIState.MATCH_FRESH:
        if not ml_clear:
            contribs.append(Contribution("Fresh TI match", config.RA_FRESH_MATCH_BONUS,
                                         "exact match with source and timestamp; corroborated by non-benign model score"))
            return Triage(Decision.PHISHING, _clip(p + config.RA_FRESH_MATCH_BONUS), contribs,
                          "Fresh exact TI match, and the URL model does not contradict it.")
        contribs.append(Contribution("Fresh TI match (conflict)", 0.0,
                                     "model score is clearly low; match not allowed to override alone"))
        return Triage(Decision.REVIEW, _clip(max(p, th.t_low)), contribs,
                      "Fresh TI match conflicts with a clearly low URL-model score; routed to human review.")
    if s in (TIState.MATCH_STALE, TIState.SYNTHETIC_MATCH):
        bonus = config.RA_STALE_MATCH_BONUS if s == TIState.MATCH_STALE else 0.0
        contribs.append(Contribution(f"{s.value}", bonus,
                                     "stale/uncertain provenance: small weight" if bonus else "labelled synthetic: ignored"))
        score = _clip(p + bonus)
        if ml_flag:
            return Triage(Decision.PHISHING, score, contribs, "URL model flags it independently of the weak TI evidence.")
        if not ml_clear or s == TIState.MATCH_STALE:
            return Triage(Decision.REVIEW, score, contribs,
                          f"{s.value} evidence is not trusted on its own and the model is not confident; human review.")
        return Triage(Decision.BENIGN, score, contribs, "Weak TI evidence ignored; model score is low.")

    # NO_MATCH / UNKNOWN: no information from TI. Never treated as benign evidence.
    why = ("No exact match in an incomplete snapshot." if s == TIState.NO_MATCH
           else "Threat intelligence unavailable for this indicator.")
    contribs.append(Contribution(f"TI: {s.value}", 0.0, why + " Contributes nothing (not evidence of safety)."))
    if ml_flag:
        return Triage(Decision.PHISHING, _clip(p), contribs, "URL model score is above the flag threshold.")
    if ml_clear:
        return Triage(Decision.BENIGN, _clip(p), contribs,
                      "URL model score is low and no TI evidence either way. This is absence of evidence, not proof of safety.")
    return Triage(Decision.REVIEW, _clip(p), contribs, "URL model score is in the uncertain band; human review.")


# ---------------------------------------------------------------- threshold selection
def best_f1_threshold(y: np.ndarray, scores: np.ndarray, grid: int = 400) -> float:
    y = np.asarray(y).astype(int)
    cands = np.unique(np.quantile(scores, np.linspace(0.0, 1.0, grid)))
    best_t, best_f = 0.5, -1.0
    for t in cands:
        pred = scores >= t
        tp = int(((pred == 1) & (y == 1)).sum())
        fp = int(((pred == 1) & (y == 0)).sum())
        fn = int(((pred == 0) & (y == 1)).sum())
        f = 2 * tp / max(2 * tp + fp + fn, 1)
        if f > best_f:
            best_f, best_t = f, float(t)
    return best_t


def low_threshold(y: np.ndarray, p: np.ndarray, target_recall: float = 0.98) -> float:
    """Largest threshold such that at least ``target_recall`` of validation phishing scores >= it."""
    pos = np.sort(np.asarray(p)[np.asarray(y).astype(int) == 1])
    if len(pos) == 0:
        return 0.1
    k = int(np.floor((1 - target_recall) * len(pos)))
    return float(pos[k])


def fit_ml_thresholds(y_val, p_val, target_recall: float = 0.98) -> Thresholds:
    t_hi = best_f1_threshold(y_val, p_val)
    t_low = min(low_threshold(y_val, p_val, target_recall), t_hi)
    return Thresholds(t_hi=t_hi, t_low=t_low)


def load_thresholds(meta: dict) -> Thresholds:
    t = meta.get("thresholds") or {}
    return Thresholds(t.get("t_hi", 0.5), t.get("t_low", 0.1), t.get("naive_t", 0.5))


# ---------------------------------------------------------------- application-level analysis
@dataclass
class CaseResult:
    input_kind: str
    urls: list[UrlAnalysis]
    email_signals: list[Signal] = field(default_factory=list)
    email_meta: dict = field(default_factory=dict)
    overall: Decision = Decision.BENIGN
    overall_score: float = 0.0
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"input_kind": self.input_kind, "overall_decision": self.overall.value,
                "overall_label": DECISION_LABELS[self.overall], "overall_score": round(self.overall_score, 4),
                "score_semantics": config.SCORE_SEMANTICS, "email_meta": self.email_meta,
                "email_signals": [s.to_dict() for s in self.email_signals],
                "urls": [u.to_dict() for u in self.urls], "notes": self.notes}


def analyze_url(url: str, bundle, snapshot: TISnapshot | None, th: Thresholds, source: str = "input",
                ti_available: bool = True) -> UrlAnalysis:
    p = float(bundle.predict_proba([url])[0])
    ti = lookup(url, snapshot, available=ti_available)
    tri = reliability_triage(p, ti, th)
    return UrlAnalysis(url=url, normalized=normalize_url(url), ml_probability=p,
                       ml_top_terms=top_terms(bundle.pipeline, url), signals=evaluate_url_rules(url), ti=ti,
                       decision=tri.decision, risk_score=tri.score, contributions=tri.contributions,
                       rationale=tri.rationale, source=source)


_RANK = {Decision.BENIGN: 0, Decision.REVIEW: 1, Decision.PHISHING: 2}


def analyze_text_url(url: str, bundle, snapshot, th) -> CaseResult:
    a = analyze_url(url.strip(), bundle, snapshot, th)
    return CaseResult("url", [a], overall=a.decision, overall_score=a.risk_score)


def analyze_email(parsed: ParsedEmail, email_sigs: list[Signal], bundle, snapshot, th) -> CaseResult:
    analyses = [analyze_url(u.url, bundle, snapshot, th, source=u.source) for u in parsed.urls]
    overall = max((a.decision for a in analyses), key=_RANK.get, default=Decision.BENIGN)
    score = max((a.risk_score for a in analyses), default=0.0)
    notes = ["The URL classifier scores extracted URLs only. Header and text signals are separate heuristics "
             "and are not an email-semantic classifier."]
    warn = [s for s in email_sigs if s.severity == "warn"]
    if overall == Decision.BENIGN and (len(warn) >= 1 and (analyses or len(warn) >= 2)):
        overall = Decision.REVIEW
        notes.append("Escalated to review because header/text warnings were present.")
    if not analyses:
        notes.append("No URLs were found, so the URL classifier had nothing to score.")
    meta = {"subject": parsed.subject, "from": parsed.from_header, "reply_to": parsed.reply_to,
            "auth": parsed.auth, "n_attachments": len(parsed.attachments), "warnings": parsed.warnings}
    return CaseResult("email", analyses, email_sigs, meta, overall, score, notes)


def load_demo_thresholds(meta_path: Path = config.MODEL_META_PATH) -> Thresholds:
    try:
        return load_thresholds(json.loads(Path(meta_path).read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return Thresholds()
