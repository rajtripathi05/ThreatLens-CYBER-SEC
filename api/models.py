"""Typed request/response schemas for the HTTP API."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Decision = Literal["phishing", "benign", "review"]
TIStateName = Literal["MATCH_FRESH", "MATCH_STALE", "SYNTHETIC_MATCH", "NO_MATCH", "UNKNOWN"]


class UrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096, description="URL string. It is NEVER fetched or opened.")
    use_threat_intel: bool = True


class EmailRequest(BaseModel):
    eml: str | None = Field(default=None, max_length=2_000_000, description="Raw RFC 822 message text")
    body: str | None = Field(default=None, max_length=500_000, description="Plain pasted email body")
    use_threat_intel: bool = True


class ModelInfo(BaseModel):
    kind: Literal["real_phiusiil", "synthetic_demo", "unavailable"]
    version: str | None = None
    trained_on_synthetic: bool | None = None
    artifact_sha256: str | None = None
    dataset_sha256: str | None = None
    thresholds: dict[str, float] | None = None
    detail: str = ""


class EvidenceItem(BaseModel):
    id: str
    kind: Literal["model", "heuristic", "threat_intel", "email_heuristic", "missing"]
    source: str
    finding: str
    observed_at: str | None = None
    confidence: float | None = Field(default=None, description="Only set where justified (raw model score).")
    confidence_note: str | None = None
    interpretation: str
    link: str | None = None
    influenced_decision: bool = False


class Contribution(BaseModel):
    name: str
    value: float
    note: str = ""


class TermContribution(BaseModel):
    ngram: str
    contribution: float
    direction: str


class UrlResult(BaseModel):
    url: str
    normalized: str
    source: str
    decision: Decision
    decision_label: str
    risk_score: float
    ml_probability: float
    ml_top_terms: list[TermContribution]
    ti: dict[str, Any]
    contributions: list[Contribution]
    rationale: str
    evidence: list[EvidenceItem]
    suggested_actions: list[str]


class AnalysisResponse(BaseModel):
    analysis_id: str
    created_utc: str
    input_kind: Literal["url", "email"]
    overall_decision: Decision
    overall_label: str
    overall_score: float
    score_semantics: str
    model: ModelInfo
    ti_source: dict[str, Any]
    urls: list[UrlResult]
    email_meta: dict[str, Any] = {}
    email_evidence: list[EvidenceItem] = []
    notes: list[str] = []
    scope_note: str
    disclaimer: str


class IncidentCreate(BaseModel):
    analysis_id: str = Field(min_length=4, max_length=64)
    store_raw_body: bool = False
    note: str = Field(default="", max_length=2000)


class IncidentPatch(BaseModel):
    status: Literal["open", "triaged", "closed"] | None = None
    note: str | None = Field(default=None, max_length=2000)


class IncidentSummary(BaseModel):
    case_id: str
    created_utc: str
    input_kind: str
    verdict: Decision
    severity: Literal["high", "medium", "low"]
    status: str
    score: float
    n_urls: int
    raw_saved: bool
    model_version: str | None = None
    model_trained_on_synthetic: bool | None = None
    first_url: str | None = None
    origin: Literal["saved"] = "saved"


class ErrorBody(BaseModel):
    code: str
    message: str
