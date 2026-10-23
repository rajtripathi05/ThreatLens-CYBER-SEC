import json
import subprocess
import sys

import pandas as pd
import streamlit as st

import ui
from src.config import RESULTS_DIR, ROOT
from src.experiment_runner import SIMULATION_LABEL
from src.plots import NAMES

ui.setup("Research Lab", "🧪")
st.title("Research Lab")
st.markdown(f'<div class="tl-sim"><b>{SIMULATION_LABEL}.</b> Feed coverage loss and false matches are '
            'seeded simulations, not estimates of any provider\'s real data quality.</div>', unsafe_allow_html=True)

status_f, meta_f, sum_f = (RESULTS_DIR / n for n in ("run_status.json", "run_metadata.json", "metrics_summary.csv"))
status = json.loads(status_f.read_text()) if status_f.exists() else {}

with st.sidebar:
    st.header("Run experiments")
    st.caption("Runs in a background process (~10-60 s on the demo data). The page only reads saved results.")
    if st.button("Run experiment now", width="stretch", disabled=status.get("state") == "running"):
        subprocess.Popen([sys.executable, str(ROOT / "experiments" / "run_experiments.py")], cwd=str(ROOT),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        st.toast("Experiment started. Press 'Refresh status'.")
    st.button("Refresh status", width="stretch")
    st.write(f"**Run status:** {status.get('state', 'no run yet')}")
    if status.get("state") == "running":
        st.progress(float(status.get("progress", 0)))
    if status.get("error"):
        st.error(status["error"])

if not (meta_f.exists() and sum_f.exists()):
    st.info("Run the experiment to generate results.")
    st.stop()

meta = json.loads(meta_f.read_text())
s = pd.read_csv(sum_f)
if meta.get("results_warning"):
    st.warning(meta["results_warning"])

st.subheader("Scenario")
c1, c2, c3 = st.columns(3)
cov = c1.select_slider("TI coverage retained", sorted(s[s.group == "coverage_noise"].coverage.unique(), reverse=True), value=1.0,
                       format_func=lambda x: f"{int(x * 100)}%")
noise = c2.select_slider("Synthetic false-match share", sorted(s[s.group == "coverage_noise"].noise.unique()), value=0.0,
                         format_func=lambda x: f"{int(x * 100)}%")
vis_opts = ["unlabelled", "labelled"] if noise > 0 else ["unlabelled"]
vis = c3.radio("False matches are", vis_opts, horizontal=True,
               help="unlabelled: look like ordinary fresh matches (realistic). labelled: flagged SYNTHETIC_MATCH (optimistic upper bound).")
sel = s[(s.group == "coverage_noise") & (s.coverage == cov) & (s.noise == noise) & (s.visibility == vis)]


def fmt(row, col, pct=True):
    m, sd = row[f"{col}_mean"], row[f"{col}_std"]
    if pd.isna(m):
        return "n/a"
    return f"{m * 100:.1f}% ± {0 if pd.isna(sd) else sd * 100:.1f}" if pct else f"{m:.3f} ± {0 if pd.isna(sd) else sd:.3f}"


rows = []
for m in ["dummy_always_benign", "dummy_random_prior", "heuristics_only", "ml_only", "naive_fusion", "reliability_aware"]:
    r = sel[sel.method == m].iloc[0]
    rows.append({"Method": NAMES.get(m, m), "Recall": fmt(r, "recall"), "Precision": fmt(r, "precision"),
                 "F1": fmt(r, "f1", False), "FPR": fmt(r, "fpr"), "Review rate": fmt(r, "review_rate"),
                 "Recall incl. review": fmt(r, "recall_incl_review"), "ROC-AUC": fmt(r, "roc_auc", False),
                 "PR-AUC": fmt(r, "pr_auc", False)})
st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
st.caption(f"Mean ± SD over {len(meta['seeds'])} seeds {meta['seeds']}. All methods see the same {meta['split']['test_used']} "
           "held-out test items and the same simulated feed. 'Recall' counts only phishing verdicts; review items are "
           "counted separately.")

st.subheader("Controls")
ctl = s[s.group == "control_shuffled"]
cr = []
for _, g in ctl.groupby("scenario_id"):
    for m in ("ml_only", "naive_fusion", "reliability_aware"):
        r = g[g.method == m].iloc[0]
        cr.append({"Control": f"shuffled TI, noise {int(r.noise * 100)}%", "Method": NAMES[m],
                   "Recall": fmt(r, "recall"), "FPR": fmt(r, "fpr"), "Review rate": fmt(r, "review_rate")})
st.dataframe(pd.DataFrame(cr), hide_index=True, width="stretch")
st.caption("Negative control: TI results are randomly permuted across items. Any benefit that depended on a real "
           "item-to-indicator link should vanish or reverse.")

st.subheader("Figures")
figs = RESULTS_DIR / "figures"
names = [("recall_vs_coverage.png", "Recall vs TI coverage"), ("fpr_vs_noise.png", "FPR vs false-match share"),
         ("detection_vs_review.png", "Detection vs manual review"), ("method_comparison.png", "Method comparison")]
cols = st.columns(2)
for i, (f, cap) in enumerate(names):
    if (figs / f).exists():
        cols[i % 2].image(str(figs / f), caption=cap, width="stretch")

with st.expander("Run metadata, split and configuration"):
    st.json({k: meta[k] for k in ("status", "finished_utc", "runtime_seconds", "split", "seeds", "model_source",
                                  "thresholds_fit_on_validation", "latency_ms_per_item", "synthetic_data", "versions")})
    st.json(meta["config"])
    st.json(meta["data_provenance"])
st.download_button("Download full summary CSV", sum_f.read_bytes(), "metrics_summary.csv", "text/csv")
