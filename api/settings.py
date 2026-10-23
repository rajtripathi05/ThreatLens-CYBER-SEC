"""Runtime configuration from environment variables only. No secrets are stored in the repo."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from src.config import DATA_DIR, DEMO_SNAPSHOT_PATH, MODELS_DIR, RESULTS_DIR


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


def _origins() -> list[str]:
    raw = os.environ.get("THREATLENS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


@dataclass
class Settings:
    allowed_origins: list[str] = field(default_factory=_origins)
    # Optional regex, e.g. for Netlify deploy previews: https://.*--your-site\.netlify\.app
    allowed_origin_regex: str | None = field(default_factory=lambda: os.environ.get("THREATLENS_ALLOWED_ORIGIN_REGEX") or None)
    db_path: Path = field(default_factory=lambda: Path(os.environ.get("THREATLENS_DB", DATA_DIR / "cases.db")))
    ti_snapshot_path: Path = field(default_factory=lambda: Path(os.environ.get("THREATLENS_TI_SNAPSHOT", DEMO_SNAPSHOT_PATH)))
    model_dir: Path = field(default_factory=lambda: Path(os.environ.get("THREATLENS_MODEL_DIR", MODELS_DIR)))
    results_dir: Path = field(default_factory=lambda: Path(os.environ.get("THREATLENS_RESULTS_DIR", RESULTS_DIR)))
    allow_synthetic_model: bool = field(default_factory=lambda: _bool("THREATLENS_ALLOW_SYNTHETIC_MODEL", True))
    allow_raw_storage: bool = field(default_factory=lambda: _bool("THREATLENS_ALLOW_RAW_STORAGE", True))
    incidents_enabled: bool = field(default_factory=lambda: _bool("THREATLENS_INCIDENTS_ENABLED", True))
    # If set, incident endpoints require header X-ThreatLens-Token with this value.
    incident_token: str | None = field(default_factory=lambda: os.environ.get("THREATLENS_INCIDENT_TOKEN") or None)
    max_body_bytes: int = int(os.environ.get("THREATLENS_MAX_BODY_BYTES", 3 * 1024 * 1024))


def get_settings() -> Settings:
    return Settings()
