"""Service layer: model/TI registry and analysis. Reuses src/ modules; no logic is duplicated here.

Nothing in this module fetches a URL, resolves DNS or trains a model.
"""
from __future__ import annotations

import threading
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

from src import classifier, email_parser, risk_engine
from src.config import DISCLAIMER, MODEL_META_PATH, MODEL_PATH, REAL_MODEL_META_PATH, REAL_MODEL_PATH, SCORE_SEMANTICS
from src.schemas import DECISION_LABELS, Decision, TIState, UrlAnalysis
from src.threat_intelligence import TISnapshot
from src.url_features import normalize_url, parse_url

from .models import EvidenceItem, ModelInfo
from .settings import Settings

SCOPE_NOTE = ("The classifier scores URL strings only (trained/evaluated on PhiUSIIL URLs). It is not an email-body "
              "classifier and has not been validated on email text. Header and wording checks are separate heuristics.")

ACTIONS = {
    "phishing": ["Do not click the link or open it in a normal browser session.",
                 "Report the message/URL to your security team or the impersonated brand.",
                 "If it was already opened, change the relevant credentials and notify the account owner."],
    "review": ["Treat as untrusted until a human has checked it.",
               "Verify the sender and destination through an independent channel (not the message itself).",
               "Inspect the URL in an isolated analysis environment if your policy allows it."],
    "benign": ["No strong evidence was found by the available checks. This does not verify the URL is safe.",
               "Apply normal caution: confirm unexpected requests for credentials or payment."],
}


class AnalysisCache:
    """Small in-memory LRU so an incident can be saved from a server-computed analysis (not client-forged data)."""

    def __init__(self, cap: int = 200) -> None:
        self.cap, self._d, self._lock = cap, OrderedDict(), threading.Lock()

    def put(self, key: str, value: dict) -> None:
        with self._lock:
            self._d[key] = value
            while len(self._d) > self.cap:
                self._d.popitem(last=False)

    def get(self, key: str) -> dict | None:
        with self._lock:
            return self._d.get(key)


class Registry:
    """Lazily loads the model and TI snapshot; reports status without ever training."""

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self._bundle: classifier.ModelBundle | None = None
        self._info: ModelInfo | None = None
        self._th = risk_engine.Thresholds()
        self._snap: TISnapshot | None = None
        self._snap_info: dict | None = None
        self.cache = AnalysisCache()

    # ------------------------------------------------------------ model
    def _try_load(self, path: Path, meta_path: Path, kind: str) -> bool:
        if not path.exists() or not meta_path.exists():
            return False
        try:
            b = classifier.load(path, meta_path)
        except Exception as exc:  # checksum / version mismatch
            self._info = ModelInfo(kind="unavailable", detail=f"{kind} model found but refused: {exc}")
            return False
        m = b.meta
        self._bundle, self._th = b, risk_engine.load_thresholds(m)
        self._info = ModelInfo(
            kind="synthetic_demo" if m.get("trained_on_synthetic") else "real_phiusiil",
            version=m.get("model_version"), trained_on_synthetic=bool(m.get("trained_on_synthetic")),
            artifact_sha256=m.get("artifact_sha256"), dataset_sha256=(m.get("data_provenance") or {}).get("sha256"),
            thresholds=self._th.to_dict(),
            detail=("Trained on SYNTHETIC demo URLs; predictions are illustrative only." if m.get("trained_on_synthetic")
                    else "Trained on the UCI PhiUSIIL URL column (URL strings only)."))
        return True

    def load_model(self) -> None:
        if self._bundle is not None:
            return
        d = self.s.model_dir
        if self._try_load(d / REAL_MODEL_PATH.name, d / REAL_MODEL_META_PATH.name, "real"):
            return
        if self.s.allow_synthetic_model and self._try_load(d / MODEL_PATH.name, d / MODEL_META_PATH.name, "synthetic"):
            return
        if self._info is None or self._info.kind != "unavailable":
            self._info = ModelInfo(kind="unavailable", detail=(
                "No trained model found. Run: python scripts/download_phiusiil.py && python -m src.train_model --csv "
                "data/raw/PhiUSIIL_Phishing_URL_Dataset.csv --url-col URL --label-col label --scheme uci"))

    def model_info(self) -> ModelInfo:
        self.load_model()
        assert self._info is not None
        return self._info

    def bundle(self) -> classifier.ModelBundle | None:
        self.load_model()
        return self._bundle

    def thresholds(self) -> risk_engine.Thresholds:
        self.load_model()
        return self._th

    # ------------------------------------------------------------ threat intelligence
    def snapshot(self) -> tuple[TISnapshot | None, dict]:
        if self._snap_info is not None:
            return self._snap, self._snap_info
        path = self.s.ti_snapshot_path
        if not path.exists():
            self._snap, self._snap_info = None, {"loaded": False, "path": path.name, "entries": 0,
                                                   "detail": "No threat-intelligence snapshot found; lookups return UNKNOWN."}
        else:
            try:
                snap = TISnapshot.from_csv(path)
                head = path.read_text(encoding="utf-8", errors="replace")[:400]
                self._snap = snap
                self._snap_info = {"loaded": True, "name": snap.name, "entries": len(snap), "path": path.name,
                                   "collected_at": snap.collected_at.isoformat() if snap.collected_at else None,
                                   "is_demo": "DEMO" in head.upper() or "synthetic" in head.lower(),
                                   "max_age_days": snap.max_age_days,
                                   "detail": "Exact-match lookup against a local snapshot. Not live; coverage unknown."}
            except Exception as exc:
                self._snap, self._snap_info = None, {"loaded": False, "path": path.name, "entries": 0,
                                                       "detail": f"Snapshot could not be read: {exc}"}
        return self._snap, self._snap_info


# ---------------------------------------------------------------------------- evidence
def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def build_evidence(a: UrlAnalysis, model: ModelInfo, snap_info: dict, ti_requested: bool) -> list[EvidenceItem]:
    ev: list[EvidenceItem] = []
    flagged = a.decision == Decision.PHISHING
    ev.append(EvidenceItem(
        id="model", kind="model", source=f"url_model:{model.version}",
        finding=f"URL-model score P(phishing) = {a.ml_probability:.3f}",
        confidence=round(a.ml_probability, 4),
        confidence_note="Raw model output; not calibrated on real traffic. Check the Research Lab for calibration error.",
        interpretation=("Character n-gram logistic regression over the URL string. "
                        + ("Trained on synthetic demo data - illustrative only." if model.trained_on_synthetic else
                           "Trained on PhiUSIIL; may reflect dataset artefacts (e.g. scheme, 'www.').")),
        influenced_decision=True))
    for i, s in enumerate(a.signals):
        ev.append(EvidenceItem(id=f"rule-{i}", kind="heuristic", source="lexical_rule", finding=s.detail,
                               interpretation=("Warning-level lexical heuristic." if s.severity == "warn" else
                                               "Weak lexical hint; common in benign URLs too."),
                               influenced_decision=False))
    t = a.ti
    if not ti_requested:
        ev.append(EvidenceItem(id="ti", kind="missing", source="threat_intel", finding="Threat-intel lookup disabled for this request.",
                               interpretation="State is UNKNOWN. This is NOT evidence of safety.", influenced_decision=False))
    else:
        interp = {
            TIState.MATCH_FRESH: "Known indicator, recent observation. Corroborates the decision.",
            TIState.MATCH_STALE: "Known indicator but old/expired/without provenance; low weight.",
            TIState.SYNTHETIC_MATCH: "Entry labelled as synthetic by an experiment; ignored.",
            TIState.NO_MATCH: "The loaded snapshot has no exact match. Feeds are incomplete: NOT evidence of safety.",
            TIState.UNKNOWN: "Threat intelligence unavailable. NOT evidence of safety.",
        }[t.state]
        ev.append(EvidenceItem(
            id="ti", kind="threat_intel", source=t.source or snap_info.get("name") or "threat_intel",
            finding=f"{t.state.value}: {t.detail}", observed_at=_iso(t.observed_at), interpretation=interp,
            influenced_decision=t.state in (TIState.MATCH_FRESH, TIState.MATCH_STALE)))
    ev.append(EvidenceItem(
        id="missing-content", kind="missing", source="scope",
        finding="Not examined: page content, redirects, TLS certificate, domain age/WHOIS, reputation of hosting.",
        interpretation="These checks need network access, which this tool never performs. Absence is a limitation, not a clean result."))
    return ev


def _term_contribs(a: UrlAnalysis):
    return a.ml_top_terms


def url_result(a: UrlAnalysis, model: ModelInfo, snap_info: dict, ti_requested: bool) -> dict:
    d = a.to_dict()
    return {
        "url": d["url"], "normalized": d["normalized"], "source": d["source"], "decision": d["decision"],
        "decision_label": DECISION_LABELS[a.decision], "risk_score": d["risk_score"],
        "ml_probability": d["ml_probability"], "ml_top_terms": d["ml_top_terms"], "ti": d["ti"],
        "contributions": d["contributions"], "rationale": d["rationale"],
        "evidence": [e.model_dump() for e in build_evidence(a, model, snap_info, ti_requested)],
        "suggested_actions": ACTIONS[a.decision.value],
    }


class ModelUnavailable(RuntimeError):
    pass


class InvalidInput(ValueError):
    pass


def _require_model(reg: Registry):
    b = reg.bundle()
    if b is None:
        raise ModelUnavailable(reg.model_info().detail)
    return b


def validate_url(raw: str) -> str:
    u = raw.strip()
    if not u or any(ch in u for ch in "\r\n\t") or " " in u:
        raise InvalidInput("URL must be a single token without whitespace.")
    p = parse_url(u)
    if not p.valid or "." not in p.host and not p.host.replace(":", "").replace(".", "").isdigit():
        raise InvalidInput(f"Not a valid URL host: {p.error or 'host has no dot'}.")
    if p.scheme and p.scheme not in ("http", "https"):
        raise InvalidInput(f"Unsupported scheme '{p.scheme}'. Only http(s) URLs are analysed.")
    return u


def analyze_url(reg: Registry, url: str, use_ti: bool) -> dict:
    bundle = _require_model(reg)
    url = validate_url(url)
    snap, snap_info = reg.snapshot()
    res = risk_engine.analyze_text_url(url, bundle, snap if use_ti else None, reg.thresholds())
    if not use_ti:  # make the UNKNOWN reason explicit
        res.urls[0].ti.detail = "Threat-intel lookup was disabled for this request. This is NOT evidence of safety."
    return _finish(reg, res, "url", None, snap_info, use_ti)


def analyze_email(reg: Registry, eml: str | None, body: str | None, use_ti: bool) -> dict:
    bundle = _require_model(reg)
    if not (eml and eml.strip()) and not (body and body.strip()):
        raise InvalidInput("Provide a raw .eml message or a pasted email body.")
    try:
        if eml and eml.strip():
            parsed = email_parser.parse_eml(eml.encode("utf-8", "replace"))
            raw_text = eml
        else:
            wrapped = "Content-Type: text/plain; charset=utf-8\r\n\r\n" + body  # type: ignore[operator]
            parsed = email_parser.parse_eml(wrapped.encode("utf-8", "replace"))
            raw_text = body or ""
    except email_parser.EmailTooLarge as exc:
        raise InvalidInput(str(exc)) from exc
    sigs = email_parser.email_signals(parsed)
    snap, snap_info = reg.snapshot()
    res = risk_engine.analyze_email(parsed, sigs, bundle, snap if use_ti else None, reg.thresholds())
    return _finish(reg, res, "email", raw_text, snap_info, use_ti)


def _finish(reg: Registry, res: risk_engine.CaseResult, kind: str, raw: str | None, snap_info: dict, use_ti: bool) -> dict:
    model = reg.model_info()
    urls = [url_result(a, model, snap_info, use_ti) for a in res.urls]
    email_ev = [EvidenceItem(id=f"email-{i}", kind="email_heuristic", source="email_heuristic",
                             finding=s.detail, interpretation=("Warning-level header/text heuristic - not an email-body ML result."
                                                               if s.severity == "warn" else "Informational heuristic."),
                             influenced_decision=s.severity == "warn").model_dump() for i, s in enumerate(res.email_signals)]
    aid = uuid.uuid4().hex[:16]
    out = {
        "analysis_id": aid, "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "input_kind": kind, "overall_decision": res.overall.value, "overall_label": DECISION_LABELS[res.overall],
        "overall_score": round(res.overall_score, 4), "score_semantics": SCORE_SEMANTICS,
        "model": model.model_dump(), "ti_source": {**snap_info, "consulted": use_ti},
        "urls": urls, "email_meta": res.email_meta, "email_evidence": email_ev, "notes": res.notes,
        "scope_note": SCOPE_NOTE, "disclaimer": DISCLAIMER,
    }
    reg.cache.put(aid, {"result": out, "case_result": res, "raw": raw})
    return out
