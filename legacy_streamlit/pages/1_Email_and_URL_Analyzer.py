import csv
import json

import pandas as pd
import streamlit as st

from src import email_parser, risk_engine, ui
from src.config import DEMO_EMAILS_PATH, DEMO_URLS_PATH, MAX_UPLOAD_BYTES, SCORE_SEMANTICS
from src.schemas import DECISION_LABELS

ui.setup("Analyzer", "🔎")
st.title("Email and URL Analyzer")
ui.model_banner()

bundle, snapshot, th = ui.get_model(), ui.get_snapshot(), ui.get_thresholds()

with st.sidebar:
    st.header("Options")
    use_ti = st.toggle("TI snapshot available", value=True,
                       help="Switch off to simulate an unavailable feed: every lookup becomes UNKNOWN.")
    if st.button("Clear / reset analysis", width="stretch"):
        for k in ("case", "parsed_email", "case_input"):
            st.session_state.pop(k, None)
        st.rerun()

snap = snapshot if use_ti else None


def run_url(url: str):
    st.session_state["case"] = risk_engine.analyze_text_url(url, bundle, snap, th)
    st.session_state["parsed_email"] = None


def run_email(data: bytes):
    parsed = email_parser.parse_eml(data)
    st.session_state["parsed_email"] = parsed
    st.session_state["case"] = risk_engine.analyze_email(parsed, email_parser.email_signals(parsed), bundle, snap, th)


tab_url, tab_eml, tab_demo = st.tabs(["URL string", "Upload .eml", "Demo examples"])
with tab_url:
    url = st.text_input("URL to analyse (it will not be visited)", placeholder="http://example.test/login")
    if st.button("Analyse URL", type="primary") and url.strip():
        run_url(url)
with tab_eml:
    up = st.file_uploader("Email file (.eml, max 2 MB)", type=["eml"])
    if up is not None and st.button("Analyse email", type="primary"):
        if up.size > MAX_UPLOAD_BYTES:
            st.error(f"File too large ({up.size} bytes). Limit is {MAX_UPLOAD_BYTES} bytes.")
        else:
            try:
                run_email(up.getvalue())
            except email_parser.EmailTooLarge as e:
                st.error(str(e))
with tab_demo:
    st.caption("Everything below is SYNTHETIC: reserved .example domains and a hand-written demo feed.")
    demo_urls = list(csv.DictReader(open(DEMO_URLS_PATH, encoding="utf-8")))
    pick = st.selectbox("Demo URL", range(len(demo_urls)),
                        format_func=lambda i: f"{demo_urls[i]['name']}  -  {demo_urls[i]['what_it_demonstrates']}")
    if st.button("Analyse demo URL"):
        run_url(demo_urls[pick]["url"])
    demo_emails = json.load(open(DEMO_EMAILS_PATH, encoding="utf-8"))
    ei = st.selectbox("Demo email", range(len(demo_emails)), format_func=lambda i: demo_emails[i]["name"])
    if st.button("Analyse demo email"):
        run_email(demo_emails[ei]["eml"].encode("utf-8"))

case = st.session_state.get("case")
if case is None:
    st.info("Enter a URL, upload an .eml, or pick a demo example to begin.")
    st.stop()

st.divider()
st.markdown(ui.badge(case.overall), unsafe_allow_html=True)
c1, c2, c3 = st.columns(3)
c1.metric("URLs scored", len(case.urls))
top = max(case.urls, key=lambda a: a.ml_probability, default=None)
c2.metric("Highest URL-model score", f"{top.ml_probability:.2f}" if top else "n/a",
          help="Model output (uncalibrated) for the most suspicious URL.")
c3.metric("Heuristic risk score", f"{case.overall_score:.2f}", help=SCORE_SEMANTICS)
st.caption("Heuristic risk score is a ranking value, not a probability. Open **Evidence Explorer** for the full reasoning.")

for n in case.notes:
    st.markdown(f"<span class='tl-muted'>{n}</span>", unsafe_allow_html=True)

if case.input_kind == "email":
    m = case.email_meta
    with st.expander("Email headers and authentication", expanded=True):
        st.write(f"**Subject:** {m.get('subject') or 'not present'}")
        st.write(f"**From:** {m.get('from') or 'not present'}  |  **Reply-To:** {m.get('reply_to') or 'not present'}")
        st.write("**Authentication:** " + ", ".join(f"{k.upper()}: {v}" for k, v in m["auth"].items()))
        st.caption("'not available' means the header was absent. It does not mean the check failed.")
        for w in m.get("warnings", []):
            st.warning(w)
    if case.email_signals:
        with st.expander("Header/text heuristics (separate from the URL classifier)"):
            for s in case.email_signals:
                st.write(f"- **{s.name}** - {s.detail}")

if case.urls:
    st.subheader("URL results")
    st.dataframe(pd.DataFrame([{
        "URL": a.url[:80], "Model P(phishing)": round(a.ml_probability, 2), "TI state": a.ti.state.value,
        "Rule signals": len(a.signals), "Outcome": DECISION_LABELS[a.decision]} for a in case.urls]),
        width="stretch", hide_index=True)
    for a in case.urls:
        with st.expander(f"{a.url[:70]} - {DECISION_LABELS[a.decision]}"):
            st.write(a.rationale)
            for s in a.signals:
                st.write(f"- **{s.name}**: {s.detail}")
            st.write(f"- **TI {a.ti.state.value}**: {a.ti.detail}")
else:
    st.warning("No URLs were found in this input.")
