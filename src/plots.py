"""PNG figures from saved experiment outputs. Every chart carries the simulation label."""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

SIM = "SIMULATED TI degradation - synthetic corruption, not real provider quality"
COLORS = {"ml_only": "#0072B2", "naive_fusion": "#D55E00", "reliability_aware": "#009E73",
          "heuristics_only": "#999999", "dummy_random_prior": "#CC79A7"}
NAMES = {"ml_only": "A: ML-only", "naive_fusion": "B: Naive fusion", "reliability_aware": "C: Reliability-aware",
         "heuristics_only": "Lexical heuristics", "dummy_random_prior": "Random (prior)"}
MAIN = ["ml_only", "naive_fusion", "reliability_aware"]


def _fig(title: str, ylabel: str, xlabel: str):
    fig, ax = plt.subplots(figsize=(7, 4.2), dpi=130)
    ax.set_title(title, fontsize=11, loc="left")
    fig.text(0.01, 0.01, SIM, fontsize=7, color="#B00020")
    ax.set_ylabel(ylabel); ax.set_xlabel(xlabel)
    ax.grid(alpha=.25); ax.spines[["top", "right"]].set_visible(False)
    return fig, ax


def _line(ax, df, x, col, method, label=None, ls="-"):
    d = df[df.method == method].sort_values(x)
    ax.errorbar(d[x], d[f"{col}_mean"], yerr=d[f"{col}_std"].fillna(0), marker="o", capsize=3, ms=4, ls=ls,
                color=COLORS[method], label=label or NAMES[method])


def make_all(out_dir: Path) -> None:
    out_dir = Path(out_dir); fig_dir = out_dir / "figures"; fig_dir.mkdir(exist_ok=True)
    s = pd.read_csv(out_dir / "metrics_summary.csv")
    md = json.loads((out_dir / "run_metadata.json").read_text())
    global SIM
    SIM = ("SIMULATION - " + ("synthetic URLs, " if md.get("is_synthetic") else "PhiUSIIL URLs, ") +
           f"feed={md.get('feed_mode', 'n/a')}; not real provider TI quality")
    dg = md["config"]["degraded_scenario"]
    dcov, dnoise = dg["coverage"], dg["noise"]
    dlabel = f"coverage {int(dcov * 100)}%, {int(dnoise * 100)}% false matches"
    cn = s[(s.group == "coverage_noise") & (s.control == "none")]

    # 1. performance vs coverage (no false matches)
    clean = cn[cn.noise == 0]
    for col, name in (("recall", "Recall (phishing verdicts)"), ("f1", "F1")):
        fig, ax = _fig(f"{name} vs TI coverage retained (0% false matches)", name, "TI coverage retained")
        for m in MAIN:
            _line(ax, clean, "coverage", col, m)
        ax.legend(fontsize=8); fig.tight_layout(rect=(0, .03, 1, 1))
        fig.savefig(fig_dir / f"{col}_vs_coverage.png"); plt.close(fig)

    # 2. FPR vs synthetic false-match share (coverage 100%)
    fig, ax = _fig("False-positive rate vs synthetic false-match share (coverage 100%)",
                   "False-positive rate (phishing verdicts)", "Share of feed entries that are false matches")
    full = cn[cn.coverage == 1.0]
    for m in MAIN:
        _line(ax, full[full.visibility == "unlabelled"], "noise", "fpr", m)
    _line(ax, full[full.visibility == "labelled"].assign(), "noise", "fpr", "reliability_aware",
          label="C (noise labelled SYNTHETIC)", ls="--")
    ax.legend(fontsize=8); fig.tight_layout(rect=(0, .03, 1, 1))
    fig.savefig(fig_dir / "fpr_vs_noise.png"); plt.close(fig)

    # 3. detection vs manual review
    t = pd.read_csv(out_dir / "review_tradeoff.csv")
    fig, ax = _fig(f"Detection vs manual-review load ({dlabel})",
                   "Recall incl. review", "Manual-review rate")
    ax.plot(t.review_rate, t.recall_incl_review, "o-", color=COLORS["reliability_aware"], label="C: sweep of t_low")
    for _, r in t.iterrows():
        ax.annotate(f"{r.target_recall_low:g}", (r.review_rate, r.recall_incl_review), fontsize=7, xytext=(3, -9),
                    textcoords="offset points")
    sc = s[(s.coverage == dcov) & (s.noise == dnoise) & (s.visibility == "unlabelled") & (s.control == "none")]
    for m in ("ml_only", "naive_fusion"):
        r = sc[sc.method == m]
        if len(r):
            ax.plot(r.review_rate_mean, r.recall_incl_review_mean, "s", color=COLORS[m], label=NAMES[m])
    ax.legend(fontsize=8); fig.tight_layout(rect=(0, .03, 1, 1))
    fig.savefig(fig_dir / "detection_vs_review.png"); plt.close(fig)

    # 4. method comparison bars with SD
    picks = [("Baseline: coverage 100%, 0% false matches", (1.0, 0.0)), (dlabel, (dcov, dnoise))]
    fig, axes = plt.subplots(1, 3, figsize=(10, 4), dpi=130)
    fig.suptitle("Method comparison (mean ± SD over seeds)", fontsize=11, x=0.01, ha="left")
    fig.text(0.01, 0.01, SIM, fontsize=7, color="#B00020")
    for ax, (col, nm) in zip(axes, (("recall", "Recall"), ("fpr", "FPR"), ("review_rate", "Review rate"))):
        w = 0.38
        for j, (lab, (cv, nz)) in enumerate(picks):
            d = cn[(cn.coverage == cv) & (cn.noise == nz) & (cn.visibility == "unlabelled")]
            vals = [d[d.method == m][f"{col}_mean"].iloc[0] for m in MAIN]
            errs = [d[d.method == m][f"{col}_std"].fillna(0).iloc[0] for m in MAIN]
            ax.bar([i + (j - .5) * w for i in range(3)], vals, w, yerr=errs, capsize=3,
                   alpha=.95 if j == 0 else .55, color=[COLORS[m] for m in MAIN], label=lab)
        ax.set_xticks(range(3)); ax.set_xticklabels(["A", "B", "C"]); ax.set_title(nm, fontsize=10)
        ax.spines[["top", "right"]].set_visible(False)
    from matplotlib.patches import Patch
    fig.legend(handles=[Patch(color="#555555", label=picks[0][0]), Patch(color="#555555", alpha=.5, label=f"Degraded: {dlabel}")],
               loc="lower center", ncol=2, fontsize=8, frameon=False, bbox_to_anchor=(0.5, 0.04))
    fig.tight_layout(rect=(0, .1, 1, .95))
    fig.savefig(fig_dir / "method_comparison.png"); plt.close(fig)
