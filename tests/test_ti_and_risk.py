import socket

import numpy as np
import pandas as pd
import pytest

from src import config, data_io, evaluation, risk_engine
from src.schemas import Decision, TIResult, TIState
from src.threat_intelligence import (TIRecord, TISnapshot, age_entries, inject_false_matches, lookup,
                                     subsample_coverage)
from tests.conftest import COLLECTED, dt


def test_label_mapping_uci_to_project_convention():
    uci = pd.Series([1, 0, 1, 0])  # UCI: 1 = legitimate, 0 = phishing
    assert data_io.normalize_labels(uci, "uci").tolist() == [0, 1, 0, 1]
    assert data_io.normalize_labels(uci, "phish1").tolist() == [1, 0, 1, 0]


def test_label_mapping_rejects_bad_values():
    with pytest.raises(ValueError):
        data_io.normalize_labels(pd.Series([0, 1, 2]), "uci")


def test_split_requires_dedup_and_is_disjoint(small_data):
    tr, va, te = data_io.split(small_data.df, seed=1)
    assert not (set(tr.url) & set(te.url)) and not (set(tr.url) & set(va.url)) and not (set(va.url) & set(te.url))
    with pytest.raises(ValueError):
        data_io.split(pd.concat([small_data.df, small_data.df.head(3)]), seed=1)


@pytest.mark.parametrize("url,state", [
    ("http://fresh.example/p", TIState.MATCH_FRESH),
    ("https://FRESH.example/p#x", TIState.MATCH_FRESH),
    ("http://stale.example/p", TIState.MATCH_STALE),
    ("http://expired.example/p", TIState.MATCH_STALE),
    ("http://noprov.example/p", TIState.MATCH_STALE),
    ("http://synthetic.example/p", TIState.SYNTHETIC_MATCH),
    ("http://sub.baddomain.example", TIState.NO_MATCH),   # exact host only, no suffix matching
    ("http://baddomain.example/anything", TIState.MATCH_FRESH),
    ("http://fresh.example/other", TIState.NO_MATCH),      # exact URL match only
])
def test_lookup_states(snapshot, url, state):
    assert lookup(url, snapshot).state == state


def test_missing_feed_is_unknown_not_no_match(snapshot):
    assert lookup("http://fresh.example/p", None).state == TIState.UNKNOWN
    assert lookup("http://fresh.example/p", snapshot, available=False).state == TIState.UNKNOWN


def test_unlabelled_synthetic_looks_fresh(snapshot):
    snapshot.label_synthetic = False
    assert lookup("http://synthetic.example/p", snapshot).state == TIState.MATCH_FRESH


def test_unknown_and_no_match_never_make_benign_by_ti():
    th = risk_engine.Thresholds(t_hi=0.5, t_low=0.2)
    for st in (TIState.UNKNOWN, TIState.NO_MATCH):
        t = risk_engine.reliability_triage(0.3, TIResult(st), th)
        assert t.decision == Decision.REVIEW           # uncertain ML band stays uncertain
        assert [c.value for c in t.contributions[1:]] == [0.0]  # TI contributes exactly nothing
    # naive baseline (by design) lets an unknown subtract risk
    n = risk_engine.naive_fusion(0.45, TIResult(TIState.UNKNOWN), risk_engine.Thresholds(naive_t=0.4))
    assert n.score < 0.45


def test_fresh_match_conflict_goes_to_review_not_phishing():
    th = risk_engine.Thresholds(t_hi=0.5, t_low=0.2)
    assert risk_engine.reliability_triage(0.05, TIResult(TIState.MATCH_FRESH), th).decision == Decision.REVIEW
    assert risk_engine.reliability_triage(0.3, TIResult(TIState.MATCH_FRESH), th).decision == Decision.PHISHING


def test_stale_and_synthetic_are_not_trusted_alone():
    th = risk_engine.Thresholds(t_hi=0.5, t_low=0.2)
    assert risk_engine.reliability_triage(0.3, TIResult(TIState.MATCH_STALE), th).decision == Decision.REVIEW
    assert risk_engine.reliability_triage(0.05, TIResult(TIState.SYNTHETIC_MATCH), th).decision == Decision.BENIGN
    assert risk_engine.reliability_triage(0.05, TIResult(TIState.SYNTHETIC_MATCH), th).score == pytest.approx(0.05)


@pytest.mark.parametrize("p", [0.0, 0.01, 0.5, 0.99, 1.0])
@pytest.mark.parametrize("st", list(TIState))
def test_score_bounds(p, st):
    th = risk_engine.Thresholds()
    for t in (risk_engine.naive_fusion(p, TIResult(st), th), risk_engine.reliability_triage(p, TIResult(st), th),
              risk_engine.ml_only(p, th)):
        assert 0.0 <= t.score <= 1.0


def _feed(n=100):
    recs = [TIRecord(f"h{i}.example/p", "url", "S", dt(2025, 12, 20)) for i in range(n)]
    return TISnapshot.from_records(recs, name="f", collected_at=COLLECTED)


def test_corruption_is_deterministic_and_seed_sensitive():
    f = _feed()
    a, b, c = (subsample_coverage(f, 0.5, s) for s in (1, 1, 2))
    assert sorted(a.entries) == sorted(b.entries) and len(a) == 50 and sorted(a.entries) != sorted(c.entries)
    benign = [f"http://b{i}.example/x" for i in range(200)]
    n1 = inject_false_matches(f, benign, 0.2, 5, True)
    n2 = inject_false_matches(f, benign, 0.2, 5, True)
    assert sorted(n1.entries) == sorted(n2.entries)
    assert sum(r.synthetic for r in n1.entries.values()) == 25            # 25/125 = 20% false share
    assert age_entries(f, 0.3, 4).entries == age_entries(f, 0.3, 4).entries


def test_aged_entries_become_stale():
    aged = age_entries(_feed(10), 1.0, 1)
    assert all(lookup(f"http://h{i}.example/p", aged).state == TIState.MATCH_STALE for i in range(10))


def test_metrics_known_values():
    y = [1, 1, 0, 0, 1, 0]
    d = ["phishing", "benign", "phishing", "review", "review", "benign"]
    m = evaluation.triage_metrics(y, d, [.9, .2, .8, .5, .4, .1])
    assert (m["tp"], m["fp"], m["fn"], m["tn"]) == (1, 1, 2, 2)
    assert m["precision"] == pytest.approx(.5) and m["recall"] == pytest.approx(1 / 3)
    assert m["review_rate"] == pytest.approx(2 / 6) and m["recall_incl_review"] == pytest.approx(2 / 3)
    assert 0 <= m["roc_auc"] <= 1


def test_threshold_helpers_use_only_given_data():
    y = np.array([0] * 50 + [1] * 50)
    p = np.concatenate([np.linspace(0, .45, 50), np.linspace(.4, 1, 50)])
    t = risk_engine.best_f1_threshold(y, p)
    assert 0.35 < t < 0.6
    assert risk_engine.low_threshold(y, p, 0.98) <= t


def test_no_network_during_analysis(monkeypatch, bundle, snapshot):
    def boom(*a, **k):
        raise AssertionError("network access attempted")
    monkeypatch.setattr(socket.socket, "connect", boom)
    monkeypatch.setattr(socket, "getaddrinfo", boom)
    monkeypatch.setattr(socket, "create_connection", boom)
    from src import email_parser
    a = risk_engine.analyze_url("http://fresh.example/p", bundle, snapshot, risk_engine.Thresholds())
    p = email_parser.parse_eml(b"Subject: x\r\n\r\nvisit http://fresh.example/p now")
    c = risk_engine.analyze_email(p, email_parser.email_signals(p), bundle, snapshot, risk_engine.Thresholds())
    assert a.ti.state == TIState.MATCH_FRESH and len(c.urls) == 1


def test_disclaimer_present():
    assert "not an operational security gateway" in config.DISCLAIMER
