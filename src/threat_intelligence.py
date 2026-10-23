"""Offline threat-intelligence snapshot, exact-match lookup with explicit states, and
seeded corruption functions used by the controlled experiments.

Freshness is measured against the snapshot's own ``collected_at`` time (not the wall clock),
because an offline snapshot is a point-in-time artefact.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .config import TI_MAX_AGE_DAYS
from .schemas import TIResult, TIState
from .url_features import normalize_url, parse_url


def _parse_dt(s: str | None) -> datetime | None:
    if not s or not s.strip():
        return None
    try:
        dt = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class TIRecord:
    indicator: str          # normalised URL or lower-case host
    kind: str               # "url" | "domain"
    source: str = ""
    observed_at: datetime | None = None
    expires_at: datetime | None = None
    synthetic: bool = False  # injected by an experimental corruption scenario

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.indicator}"


@dataclass
class TISnapshot:
    name: str = "snapshot"
    collected_at: datetime | None = None
    entries: dict[str, TIRecord] = field(default_factory=dict)
    # If True, synthetic records are reported as SYNTHETIC_MATCH. If False they look like
    # ordinary matches (models undetected noise).
    label_synthetic: bool = True
    max_age_days: int = TI_MAX_AGE_DAYS

    def __len__(self) -> int:
        return len(self.entries)

    @classmethod
    def from_records(cls, records, **kw) -> "TISnapshot":
        return cls(entries={r.key: r for r in records}, **kw)

    @classmethod
    def from_csv(cls, path: Path, collected_at: datetime | None = None, name: str | None = None) -> "TISnapshot":
        """CSV columns: indicator,kind,source,observed_at,expires_at,synthetic. Header comment
        line ``# collected_at=<iso>`` is honoured."""
        recs: list[TIRecord] = []
        coll = collected_at
        with open(path, newline="", encoding="utf-8") as fh:
            lines = fh.readlines()
        body = []
        for line in lines:
            if line.startswith("#"):
                if "collected_at=" in line and coll is None:
                    coll = _parse_dt(line.split("collected_at=", 1)[1].strip())
                continue
            body.append(line)
        for row in csv.DictReader(body):
            ind = (row.get("indicator") or "").strip()
            if not ind:
                continue
            kind = (row.get("kind") or "url").strip().lower()
            ind = normalize_url(ind) if kind == "url" else ind.lower()
            recs.append(TIRecord(ind, kind, (row.get("source") or "").strip(),
                                 _parse_dt(row.get("observed_at")), _parse_dt(row.get("expires_at")),
                                 (row.get("synthetic") or "").strip().lower() in ("1", "true", "yes")))
        return cls.from_records(recs, name=name or Path(path).name, collected_at=coll)


def lookup(url: str, snapshot: TISnapshot | None, *, available: bool = True) -> TIResult:
    """Exact-match lookup. Never returns NO_MATCH when the feed was not actually consulted."""
    norm = normalize_url(url)
    if snapshot is None or not available:
        return TIResult(TIState.UNKNOWN, norm, detail="No snapshot available / lookup could not be performed. "
                        "This is NOT evidence of safety.")
    host = parse_url(url).host
    rec = snapshot.entries.get(f"url:{norm}") or (snapshot.entries.get(f"domain:{host}") if host else None)
    if rec is None:
        return TIResult(TIState.NO_MATCH, norm, source=snapshot.name,
                        detail="Checked against the snapshot; no exact match. Feeds are incomplete, so this is not "
                               "evidence of safety.")
    if rec.synthetic and snapshot.label_synthetic:
        return TIResult(TIState.SYNTHETIC_MATCH, rec.indicator, rec.source, rec.observed_at, rec.expires_at,
                        "Entry injected by a labelled experimental corruption scenario.")
    coll = snapshot.collected_at
    if not rec.source or rec.observed_at is None:
        return TIResult(TIState.MATCH_STALE, rec.indicator, rec.source, rec.observed_at, rec.expires_at,
                        "Match lacks source or timestamp provenance; treated as uncertain.")
    if coll is None:
        return TIResult(TIState.MATCH_STALE, rec.indicator, rec.source, rec.observed_at, rec.expires_at,
                        "Snapshot has no collection time, so freshness cannot be established.")
    if rec.expires_at is not None and rec.expires_at < coll:
        return TIResult(TIState.MATCH_STALE, rec.indicator, rec.source, rec.observed_at, rec.expires_at,
                        f"Entry expired {rec.expires_at.date()} before the snapshot was collected.")
    age = (coll - rec.observed_at).days
    if age > snapshot.max_age_days:
        return TIResult(TIState.MATCH_STALE, rec.indicator, rec.source, rec.observed_at, rec.expires_at,
                        f"Observation is {age} days old (limit {snapshot.max_age_days}).")
    return TIResult(TIState.MATCH_FRESH, rec.indicator, rec.source, rec.observed_at, rec.expires_at,
                    f"Exact {rec.kind} match; observed {age} day(s) before snapshot collection.")


# --------------------------------------------------------------------------------------
# Seeded corruption (simulation only; not an estimate of any provider's data quality)
# --------------------------------------------------------------------------------------

def _clone(snap: TISnapshot, entries: dict[str, TIRecord], **kw) -> TISnapshot:
    return TISnapshot(name=kw.get("name", snap.name), collected_at=snap.collected_at, entries=entries,
                      label_synthetic=kw.get("label_synthetic", snap.label_synthetic),
                      max_age_days=snap.max_age_days)


def subsample_coverage(snap: TISnapshot, keep_fraction: float, seed: int) -> TISnapshot:
    """Keep a seeded random ``keep_fraction`` of entries (simulated incomplete coverage)."""
    keys = sorted(snap.entries)
    n_keep = int(round(len(keys) * keep_fraction))
    rng = np.random.default_rng(seed)
    chosen = set(rng.choice(len(keys), size=n_keep, replace=False).tolist()) if keys else set()
    return _clone(snap, {k: snap.entries[k] for i, k in enumerate(keys) if i in chosen})


def inject_false_matches(snap: TISnapshot, benign_urls: list[str], false_share: float, seed: int,
                         label_synthetic: bool) -> TISnapshot:
    """Add benign URLs so that ``false_share`` of the resulting entries are false matches."""
    if false_share <= 0 or not benign_urls:
        return _clone(snap, dict(snap.entries), label_synthetic=label_synthetic)
    if false_share >= 1:
        raise ValueError("false_share must be < 1")
    n_true = len(snap.entries)
    n_false = int(round(n_true * false_share / (1 - false_share)))
    rng = np.random.default_rng(seed)
    pool = sorted({normalize_url(u) for u in benign_urls} - {r.indicator for r in snap.entries.values()})
    n_false = min(n_false, len(pool))
    picks = rng.choice(len(pool), size=n_false, replace=False) if n_false else []
    entries = dict(snap.entries)
    ref = snap.collected_at or datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i in picks:
        rec = TIRecord(pool[int(i)], "url", "SIMULATED-NOISE", ref - timedelta(days=int(rng.integers(1, 20))),
                       None, synthetic=True)
        entries[rec.key] = rec
    return _clone(snap, entries, label_synthetic=label_synthetic)


def age_entries(snap: TISnapshot, stale_fraction: float, seed: int, extra_days: int = 60) -> TISnapshot:
    """Make a seeded fraction of entries older than the freshness limit (simulated staleness)."""
    keys = sorted(snap.entries)
    rng = np.random.default_rng(seed)
    n = int(round(len(keys) * stale_fraction))
    idx = set(rng.choice(len(keys), size=n, replace=False).tolist()) if keys and n else set()
    ref = snap.collected_at or datetime(2026, 1, 1, tzinfo=timezone.utc)
    entries = {}
    for i, k in enumerate(keys):
        rec = snap.entries[k]
        if i in idx:
            rec = replace(rec, observed_at=ref - timedelta(days=snap.max_age_days + extra_days))
        entries[k] = rec
    return _clone(snap, entries)
