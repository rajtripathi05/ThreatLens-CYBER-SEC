"""Shared data structures."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class TIState(str, Enum):
    MATCH_FRESH = "MATCH_FRESH"
    MATCH_STALE = "MATCH_STALE"
    SYNTHETIC_MATCH = "SYNTHETIC_MATCH"
    NO_MATCH = "NO_MATCH"
    UNKNOWN = "UNKNOWN"


class Decision(str, Enum):
    PHISHING = "phishing"
    BENIGN = "benign"
    REVIEW = "review"


DECISION_LABELS = {
    Decision.PHISHING: "Likely phishing - escalate",
    Decision.BENIGN: "No strong evidence - not verified safe",
    Decision.REVIEW: "Needs human review",
}


@dataclass
class TIResult:
    state: TIState
    indicator: str = ""
    source: str = ""
    observed_at: datetime | None = None
    expires_at: datetime | None = None
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state.value,
            "indicator": self.indicator,
            "source": self.source,
            "observed_at": self.observed_at.isoformat() if self.observed_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "detail": self.detail,
        }


@dataclass
class Signal:
    name: str
    detail: str
    severity: str = "info"  # info | warn

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Contribution:
    name: str
    value: float
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class UrlAnalysis:
    url: str
    normalized: str
    ml_probability: float
    ml_top_terms: list[dict[str, Any]]
    signals: list[Signal]
    ti: TIResult
    decision: Decision
    risk_score: float
    contributions: list[Contribution]
    rationale: str
    source: str = "input"

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "normalized": self.normalized,
            "ml_probability": round(self.ml_probability, 4),
            "ml_top_terms": self.ml_top_terms,
            "signals": [s.to_dict() for s in self.signals],
            "ti": self.ti.to_dict(),
            "decision": self.decision.value,
            "risk_score": round(self.risk_score, 4),
            "contributions": [c.to_dict() for c in self.contributions],
            "rationale": self.rationale,
            "source": self.source,
        }


@dataclass
class ExtractedUrl:
    url: str
    source: str  # text | html_href | input
    anchor_text: str = ""


@dataclass
class ParsedEmail:
    subject: str = ""
    from_header: str = ""
    reply_to: str = ""
    return_path: str = ""
    date: str = ""
    message_id: str = ""
    auth: dict[str, str] = field(default_factory=dict)
    text_body: str = ""
    html_body: str = ""
    attachments: list[dict[str, Any]] = field(default_factory=list)
    urls: list[ExtractedUrl] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
