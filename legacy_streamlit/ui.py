"""Shared Streamlit helpers: styling, cached resources, small widgets."""
from __future__ import annotations

import streamlit as st

from src import classifier, risk_engine, train_model
from src.config import DEMO_SNAPSHOT_PATH, DISCLAIMER
from src.schemas import DECISION_LABELS, Decision
from src.threat_intelligence import TISnapshot

COLORS = {Decision.PHISHING: "#FF7B7B", Decision.REVIEW: "#F5B942", Decision.BENIGN: "#5BC0A0"}

_CSS = """
<style>
.block-container {padding-top: 2rem; max-width: 1100px;}
.tl-notice {background:#1a2a4a; border-left:4px solid #F5B942; padding:.55rem .9rem; border-radius:4px;
            font-size:.85rem; color:#E6EDF7; margin-bottom:1rem;}
.tl-card {background:#12203A; border:1px solid #223458; border-radius:8px; padding:1rem 1.2rem; margin-bottom:.8rem;}
.tl-badge {display:inline-block; padding:.25rem .7rem; border-radius:999px; font-weight:600; font-size:.9rem; color:#0B1426;}
.tl-sim {background:#3a1f2b; border-left:4px solid #FF7B7B; padding:.5rem .9rem; border-radius:4px; font-size:.85rem;}
.tl-muted {color:#9FB0CC; font-size:.85rem;}
</style>
"""


def setup(title: str, icon: str = "🛡️") -> None:
    st.set_page_config(page_title=f"ThreatLens AI - {title}", page_icon=icon, layout="wide")
    st.markdown(_CSS, unsafe_allow_html=True)
    st.markdown(f'<div class="tl-notice"><b>Research prototype</b> - not an operational security gateway. '
                f'{DISCLAIMER.split(". ", 1)[1]} No URL is ever visited or resolved.</div>', unsafe_allow_html=True)


def badge(decision: Decision) -> str:
    return (f'<span class="tl-badge" style="background:{COLORS[decision]}">{DECISION_LABELS[decision]}</span>')


@st.cache_resource(show_spinner="Loading URL model...")
def get_model() -> classifier.ModelBundle:
    """Load the local model; if none exists, train a clearly labelled SYNTHETIC demo model."""
    try:
        return classifier.load()
    except (FileNotFoundError, ValueError):
        train_model.run(None, True, "URL", "label", "phish1")
        return classifier.load()


@st.cache_resource
def get_snapshot() -> TISnapshot:
    return TISnapshot.from_csv(DEMO_SNAPSHOT_PATH)


def get_thresholds() -> risk_engine.Thresholds:
    return risk_engine.load_thresholds(get_model().meta)


def model_banner() -> None:
    meta = get_model().meta
    if meta.get("trained_on_synthetic"):
        st.caption("Model: demo model trained on SYNTHETIC URLs - for UI demonstration only. "
                   "TI snapshot: synthetic demo indicators (data/cti_snapshot.csv).")
    else:
        st.caption(f"Model: {meta.get('model_version')} | TI snapshot: data/cti_snapshot.csv")
