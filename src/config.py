"""Central configuration and constants."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
MODELS_DIR = ROOT / "models"
RESULTS_DIR = ROOT / "experiments" / "results"
EXPERIMENT_CONFIG = ROOT / "experiments" / "configs" / "default.json"

MODEL_PATH = MODELS_DIR / "url_model.joblib"            # synthetic DEMO model slot
MODEL_META_PATH = MODELS_DIR / "url_model.meta.json"
REAL_MODEL_PATH = MODELS_DIR / "url_model_phiusiil.joblib"  # trained on real PhiUSIIL data
REAL_MODEL_META_PATH = MODELS_DIR / "url_model_phiusiil.meta.json"


def model_paths(synthetic: bool) -> tuple[Path, Path]:
    """(artefact, metadata) paths for the synthetic-demo or real-data model slot."""
    return (MODEL_PATH, MODEL_META_PATH) if synthetic else (REAL_MODEL_PATH, REAL_MODEL_META_PATH)
DEMO_SNAPSHOT_PATH = DATA_DIR / "cti_snapshot.csv"
DEMO_EMAILS_PATH = DATA_DIR / "demo_emails.json"
DEMO_URLS_PATH = DATA_DIR / "demo_urls.csv"
DB_PATH = Path(os.environ.get("THREATLENS_DB", DATA_DIR / "cases.db"))

MODEL_VERSION = "threatlens-url-tfidf-lr-0.1"
POSITIVE_LABEL = 1  # project convention: 1 = phishing, 0 = legitimate

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_URLS_PER_MESSAGE = 50
TI_MAX_AGE_DAYS = 30

# Naive fusion constants (documented heuristic, not calibrated)
NAIVE_MATCH_BONUS = 0.30
NAIVE_MISS_PENALTY = 0.10
# Reliability-aware contributions (heuristic, not calibrated)
RA_FRESH_MATCH_BONUS = 0.25
RA_STALE_MATCH_BONUS = 0.05

SCORE_SEMANTICS = (
    "The overall risk score is a heuristic ranking value in [0, 1]. It is NOT a calibrated "
    "probability. Only the URL-model score is a model output, and it has not been calibrated "
    "on real-world traffic."
)
DISCLAIMER = (
    "ThreatLens AI is a research prototype, not an operational security gateway. "
    "Outputs are triage hints for human review, not confirmed verdicts."
)
