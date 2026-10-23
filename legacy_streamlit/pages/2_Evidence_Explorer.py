import pandas as pd
import streamlit as st

import ui
from src.schemas import DECISION_LABELS, TIState

ui.setup("Evidence Explorer", "🧾")
st.title("Evidence Explorer")

case = st.session_state.get("case")
if case is None or not case.urls:
    st.info("Run an analysis on the Analyzer page first.")
    st.stop()

st.markdown(ui.badge(case.overall), unsafe_allow_html=True)
idx = st.selectbox("URL", range(len(case.urls)), format_func=lambda i: case.urls[i].url[:90])
a = case.urls[idx]

left, right = st.columns(2)
with left:
    st.subheader("URL model")
    st.metric("P(phishing), uncalibrated", f"{a.ml_probability:.3f}")
    if a.ml_top_terms:
        df = pd.DataFrame(a.ml_top_terms)
        st.bar_chart(df.set_index("ngram")["contribution"])
        st.dataframe(df, hide_index=True, width="stretch")
    st.caption("Character n-gram weights of a linear model for this input. They describe the model's arithmetic, "
               "not what causes a URL to be malicious.")
with right:
    st.subheader("Threat intelligence")
    ti = a.ti
    icon = {TIState.MATCH_FRESH: "🟥", TIState.MATCH_STALE: "🟧", TIState.SYNTHETIC_MATCH: "🟪",
            TIState.NO_MATCH: "⬜", TIState.UNKNOWN: "❔"}[ti.state]
    st.markdown(f"### {icon} {ti.state.value}")
    st.write(ti.detail)
    st.table(pd.DataFrame({"Field": ["Source", "Observed", "Expires", "Indicator"],
                           "Value": [ti.source or "-", ti.observed_at.date().isoformat() if ti.observed_at else "-",
                                     ti.expires_at.date().isoformat() if ti.expires_at else "-", ti.indicator or "-"]}))
    if ti.state in (TIState.NO_MATCH, TIState.UNKNOWN):
        st.warning("This is absence of evidence. Snapshots are incomplete, so it must not be read as 'safe'.")

st.subheader("Rule signals")
if a.signals:
    st.dataframe(pd.DataFrame([s.to_dict() for s in a.signals]), hide_index=True, width="stretch")
else:
    st.write("No lexical rules fired.")

st.subheader("Why this outcome")
st.markdown(f"**{DECISION_LABELS[a.decision]}** - {a.rationale}")
st.dataframe(pd.DataFrame([c.to_dict() for c in a.contributions]), hide_index=True, width="stretch")
st.caption(f"Heuristic risk score {a.risk_score:.2f} = clipped sum of the contributions above. Not a probability.")
