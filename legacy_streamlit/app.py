import streamlit as st

import ui
from src.config import SCORE_SEMANTICS

ui.setup("Home")
st.title("ThreatLens AI")
st.subheader("Reliability-aware phishing triage under incomplete and noisy threat intelligence")
st.markdown("""
**Research question.** How do missing and noisy threat-intelligence (TI) indicators affect phishing-URL triage,
and does a reliability-aware policy behave more robustly than naive signal fusion?

| Page | What it does |
|---|---|
| **1 Email and URL Analyzer** | Paste a URL or upload an `.eml`; get an explained triage outcome. |
| **2 Evidence Explorer** | Per-URL signals, model n-gram weights, TI state and the reasons for the decision. |
| **3 Research Lab** | Precomputed experiments comparing ML-only, naive fusion and reliability-aware triage under *simulated* TI degradation. |
| **4 Incident History** | Save case metadata to SQLite; export JSON or PDF. |
""")
st.markdown('<div class="tl-card"><b>How to read the output</b><br>'
            'Five TI states are kept distinct: <code>MATCH_FRESH</code>, <code>MATCH_STALE</code>, '
            '<code>SYNTHETIC_MATCH</code>, <code>NO_MATCH</code>, <code>UNKNOWN</code>. '
            'No match and unknown are <i>never</i> treated as evidence of safety.</div>', unsafe_allow_html=True)
st.caption(SCORE_SEMANTICS)
ui.model_banner()
