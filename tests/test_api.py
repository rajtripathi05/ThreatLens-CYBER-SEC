"""API tests. The model is injected (small synthetic one) so tests never depend on local artefacts."""
import json
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.models import ModelInfo
from api.settings import Settings
from src import data_io, risk_engine
from src.config import DEMO_SNAPSHOT_PATH

FRESH = "http://secure-paypal-login.example/verify/a1b2c3"   # in the demo snapshot
UNLISTED = "https://river-garden.example/news"


def make_client(tmp_path, bundle, *, model=True, ti_path=DEMO_SNAPSHOT_PATH, **kw):
    s = Settings(db_path=tmp_path / "c.db", ti_snapshot_path=Path(ti_path), results_dir=tmp_path / "results",
                 model_dir=tmp_path / "models", **kw)
    app = create_app(s)
    reg = app.state.registry
    if model:
        reg._bundle = bundle
        reg._th = risk_engine.Thresholds()
        reg._info = ModelInfo(kind="synthetic_demo", version="test", trained_on_synthetic=True)
    else:
        reg._info = ModelInfo(kind="unavailable", detail="no model")
    return TestClient(app)


@pytest.fixture()
def client(tmp_path, bundle):
    return make_client(tmp_path, bundle)


def test_health_and_status(client):
    assert client.get("/health").json()["status"] == "ok"
    st = client.get("/api/v1/status").json()
    assert st["model"]["kind"] == "synthetic_demo" and st["threat_intel"]["loaded"] is True
    assert st["incidents"]["raw_storage_allowed"] is True


def test_valid_url_has_separate_evidence_kinds(client):
    r = client.post("/api/v1/analyze/url", json={"url": FRESH})
    assert r.status_code == 200
    body = r.json()
    u = body["urls"][0]
    assert u["ti"]["state"] == "MATCH_FRESH"
    kinds = {e["kind"] for e in u["evidence"]}
    assert {"model", "threat_intel", "missing"} <= kinds
    assert "URL strings only" in body["scope_note"]
    assert body["model"]["trained_on_synthetic"] is True


def test_no_match_is_not_safe_and_unknown_differs(tmp_path, bundle, client):
    r = client.post("/api/v1/analyze/url", json={"url": UNLISTED}).json()["urls"][0]
    assert r["ti"]["state"] == "NO_MATCH"
    assert "not" in r["ti"]["detail"].lower() and "safe" in r["ti"]["detail"].lower()
    off = client.post("/api/v1/analyze/url", json={"url": UNLISTED, "use_threat_intel": False}).json()["urls"][0]
    assert off["ti"]["state"] == "UNKNOWN"
    # missing feed file -> UNKNOWN, never NO_MATCH
    c2 = make_client(tmp_path, bundle, ti_path=tmp_path / "missing.csv")
    assert c2.get("/api/v1/status").json()["threat_intel"]["loaded"] is False
    assert c2.post("/api/v1/analyze/url", json={"url": UNLISTED}).json()["urls"][0]["ti"]["state"] == "UNKNOWN"


@pytest.mark.parametrize("bad", ["", "   ", "not a url", "ftp://example.com/x", "http://", "javascript:alert(1)"])
def test_invalid_urls_rejected(client, bad):
    r = client.post("/api/v1/analyze/url", json={"url": bad})
    assert r.status_code == 422
    assert r.json()["error"]["code"] in ("invalid_input", "validation_error")


def test_missing_model_returns_503_and_does_not_train(tmp_path, bundle):
    c = make_client(tmp_path, bundle, model=False)
    r = c.post("/api/v1/analyze/url", json={"url": FRESH})
    assert r.status_code == 503 and r.json()["error"]["code"] == "model_unavailable"
    assert c.get("/api/v1/status").json()["model"]["kind"] == "unavailable"


def test_missing_results_are_reported_not_invented(client):
    st = client.get("/api/v1/status").json()
    assert all(e["available"] is False for e in st["experiments"])      # empty results dir
    r = client.get("/api/v1/experiments/results/real-classifier")
    assert r.status_code == 404 and r.json()["error"]["code"] == "results_not_found"


def test_email_flow_and_scope(client):
    eml = ("From: a@x.example\r\nReply-To: b@y.example\r\nSubject: Urgent: verify your account\r\n"
           f"Content-Type: text/plain\r\n\r\nPlease verify {FRESH} now")
    r = client.post("/api/v1/analyze/email", json={"eml": eml})
    assert r.status_code == 200
    b = r.json()
    assert b["input_kind"] == "email" and len(b["urls"]) == 1
    assert any(e["kind"] == "email_heuristic" for e in b["email_evidence"])
    assert client.post("/api/v1/analyze/email", json={}).status_code == 422


def test_oversized_body_rejected(tmp_path, bundle):
    c = make_client(tmp_path, bundle, max_body_bytes=1000)
    r = c.post("/api/v1/analyze/email", json={"body": "x" * 5000})
    assert r.status_code == 413


def test_incident_lifecycle_and_privacy(client):
    a = client.post("/api/v1/analyze/email", json={"body": f"secret text {FRESH}"}).json()
    # default: raw body NOT stored
    cid = client.post("/api/v1/incidents", json={"analysis_id": a["analysis_id"]}).json()["case_id"]
    rec = client.get(f"/api/v1/incidents/{cid}").json()
    assert rec["raw_saved"] is False and "secret text" not in json.dumps(rec)
    # explicit opt-in stores it (in the DB, not echoed in the record JSON)
    cid2 = client.post("/api/v1/incidents", json={"analysis_id": a["analysis_id"], "store_raw_body": True}).json()["case_id"]
    assert client.get(f"/api/v1/incidents/{cid2}").json()["raw_saved"] is True
    assert client.get("/api/v1/incidents").json()["total"] == 2
    assert client.get("/api/v1/incidents", params={"q": "paypal"}).json()["total"] == 2
    assert client.patch(f"/api/v1/incidents/{cid}", json={"status": "closed"}).status_code == 200
    ex = client.get(f"/api/v1/incidents/{cid}/export", params={"format": "json"})
    assert ex.status_code == 200 and json.loads(ex.content)["case_id"] == cid
    pdf = client.get(f"/api/v1/incidents/{cid}/export", params={"format": "pdf"})
    assert pdf.content[:4] == b"%PDF"
    assert client.delete(f"/api/v1/incidents/{cid}").status_code == 200
    assert client.get(f"/api/v1/incidents/{cid}").status_code == 404
    assert client.delete("/api/v1/incidents").status_code == 400            # needs confirm
    assert client.delete("/api/v1/incidents", params={"confirm": True}).json()["deleted_count"] == 1
    assert client.get("/api/v1/incidents").json()["total"] == 0


def test_raw_storage_can_be_disabled_and_unknown_analysis(tmp_path, bundle):
    c = make_client(tmp_path, bundle, allow_raw_storage=False)
    a = c.post("/api/v1/analyze/email", json={"body": f"x {FRESH}"}).json()
    r = c.post("/api/v1/incidents", json={"analysis_id": a["analysis_id"], "store_raw_body": True})
    assert r.status_code == 403
    assert c.post("/api/v1/incidents", json={"analysis_id": "doesnotexist"}).status_code == 404


def test_incident_token_and_disable(tmp_path, bundle):
    c = make_client(tmp_path, bundle, incident_token="s3cret")
    assert c.get("/api/v1/incidents").status_code == 401
    assert c.get("/api/v1/incidents", headers={"X-ThreatLens-Token": "s3cret"}).status_code == 200
    c2 = make_client(tmp_path, bundle, incidents_enabled=False)
    assert c2.get("/api/v1/incidents").status_code == 403


def test_cors_restricted(tmp_path, bundle):
    c = make_client(tmp_path, bundle, allowed_origins=["https://good.example"])
    ok = c.get("/health", headers={"Origin": "https://good.example"})
    bad = c.get("/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "https://good.example"
    assert "access-control-allow-origin" not in bad.headers


def test_no_training_or_experiment_endpoints(client):
    paths = {r.path for r in client.app.routes}
    assert not any("train" in p or "/run" in p for p in paths)


def test_url_scoring_label_orientation(small_data, bundle):
    """Phishing-labelled synthetic URLs must score higher than legitimate ones (label=1 means phishing)."""
    _, _, test = data_io.split(small_data.df, seed=1)
    p = bundle.predict_proba(test.url.tolist())
    assert p[test.label.values == 1].mean() > p[test.label.values == 0].mean() + 0.2


def test_uci_label_mapping_inversion_is_caught():
    src = pd.Series([1, 1, 0])           # UCI: 1 = legitimate, 0 = phishing
    out = data_io.normalize_labels(src, "uci")
    assert out.tolist() == [0, 0, 1]
    assert data_io.normalize_labels(src, "phish1").tolist() != out.tolist()


def test_experiment_set_exposes_per_seed_rows(tmp_path):
    """The explorer's seed filter needs per-run rows; they must be the saved observations, not recomputed."""
    from api import experiments_store
    from src.config import RESULTS_DIR
    s = experiments_store.load_set(RESULTS_DIR, "synthetic")
    if s is None:
        import pytest
        pytest.skip("no saved synthetic results in this checkout")
    assert s["by_run"] and {"seed", "method", "f1", "fpr", "review_rate"} <= set(s["by_run"][0])
    assert {r["seed"] for r in s["by_run"]} == set(s["metadata"]["seeds"])
