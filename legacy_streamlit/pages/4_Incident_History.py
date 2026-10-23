import pandas as pd
import streamlit as st

from src import case_store, reporting, ui

ui.setup("Incident History", "🗂️")
st.title("Incident History")
st.caption("Case metadata is stored locally in SQLite. Raw email content is NOT stored unless you opt in below.")

case = st.session_state.get("case")
parsed = st.session_state.get("parsed_email")

st.subheader("Current analysis")
if case is None:
    st.info("No current analysis. Run one on the Analyzer page.")
else:
    record = st.session_state.get("record")
    if record is None or st.session_state.get("record_for") is not case:
        record = reporting.build_case_record(case, ui.get_model().meta)
        st.session_state["record"], st.session_state["record_for"] = record, case
    st.write(f"**Case ID:** {record['case_id']}  |  **Outcome:** {record['verdict_label']}  |  **UTC:** {record['created_utc']}")
    save_raw = False
    if parsed is not None:
        save_raw = st.checkbox("Also store the raw email text body in the local database",
                               help="Off by default. The body may contain personal data; it stays in data/cases.db on this machine only.")
        if save_raw:
            st.warning("The plain-text body will be stored locally. Delete the case later to remove it.")
    c1, c2, c3 = st.columns(3)
    if c1.button("Save case", type="primary"):
        case_store.save_case(record, raw_body=(parsed.text_body if parsed else None), save_raw=save_raw)
        st.success(f"Saved {record['case_id']}" + (" (with raw body)" if save_raw and parsed else " (metadata only)"))
    c2.download_button("Download JSON", reporting.to_json_bytes(record), f"{record['case_id']}.json", "application/json")
    c3.download_button("Download PDF", reporting.to_pdf_bytes(record), f"{record['case_id']}.pdf", "application/pdf")

st.subheader("Saved cases")
rows = case_store.list_cases()
if not rows:
    st.write("No saved cases yet.")
else:
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
    cid = st.selectbox("Case", [r["case_id"] for r in rows])
    rec = case_store.get_case(cid)
    d1, d2, d3 = st.columns(3)
    d1.download_button("JSON", reporting.to_json_bytes(rec), f"{cid}.json", "application/json", key="sj")
    d2.download_button("PDF", reporting.to_pdf_bytes(rec), f"{cid}.pdf", "application/pdf", key="sp")
    if d3.button("Delete case"):
        case_store.delete_case(cid)
        st.rerun()
