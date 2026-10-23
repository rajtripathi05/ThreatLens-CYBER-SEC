"""ThreatLens AI HTTP API.  Run:  uvicorn api.main:app --reload --port 8000

Design rules: no endpoint fetches a URL, trains a model or starts an experiment.
"""
from __future__ import annotations

import hashlib
import secrets
import time
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from src import case_store, reporting
from src.config import DISCLAIMER

from . import experiments_store, services
from .models import AnalysisResponse, EmailRequest, IncidentCreate, IncidentPatch, UrlRequest
from .settings import Settings, get_settings

API_VERSION = "1.0.0"
_started = time.time()


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or get_settings()
    reg = services.Registry(s)
    app = FastAPI(title="ThreatLens AI API", version=API_VERSION,
                  description="Research prototype. Triage hints only; URLs are never fetched.")
    app.state.settings, app.state.registry = s, reg

    app.add_middleware(CORSMiddleware, allow_origins=s.allowed_origins, allow_origin_regex=s.allowed_origin_regex,
                       allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                       allow_headers=["Content-Type", "X-ThreatLens-Token"], max_age=600)

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > s.max_body_bytes:
            return JSONResponse(status_code=413, content={"error": {"code": "payload_too_large",
                                "message": f"Request body exceeds {s.max_body_bytes} bytes."}})
        return await call_next(request)

    def err(status: int, code: str, message: str) -> HTTPException:
        return HTTPException(status_code=status, detail={"code": code, "message": message})

    @app.exception_handler(HTTPException)
    async def http_exc(_: Request, exc: HTTPException):
        d = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={"error": d})

    @app.exception_handler(RequestValidationError)
    async def validation_exc(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(x) for x in first.get("loc", [])[1:])
        return JSONResponse(status_code=422, content={"error": {
            "code": "validation_error", "message": f"{loc}: {first.get('msg', 'invalid request')}".strip(": ")}})

    def incident_guard(x_threatlens_token: str | None = Header(default=None)) -> None:
        if not s.incidents_enabled:
            raise err(403, "incidents_disabled", "Incident storage is disabled on this deployment.")
        if s.incident_token and not secrets.compare_digest(x_threatlens_token or "", s.incident_token):
            raise err(401, "token_required", "This deployment requires a valid X-ThreatLens-Token for incident access.")

    # ------------------------------------------------------------------ health / status
    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok", "version": API_VERSION, "time_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}

    @app.get("/api/v1/status", tags=["meta"])
    def status():
        model = reg.model_info()
        _, snap = reg.snapshot()
        from src.config import ROOT
        prov = ROOT / "data" / "raw" / "download_provenance.json"
        dataset: dict = {"phiusiil_present": prov.exists()}
        if prov.exists():
            import json
            p = json.loads(prov.read_text(encoding="utf-8"))
            dataset.update(sha256=p.get("sha256"), rows=p.get("rows"), downloaded_utc=p.get("downloaded_utc"))
        sets = experiments_store.list_sets(s.results_dir)
        return {
            "api_version": API_VERSION, "uptime_seconds": int(time.time() - _started), "model": model.model_dump(),
            "dataset": dataset, "threat_intel": snap,
            "experiments": [{k: v[k] for k in ("id", "available", "run_id", "is_synthetic", "title")} for v in sets],
            "incidents": {"enabled": s.incidents_enabled, "token_required": bool(s.incident_token),
                          "raw_storage_allowed": s.allow_raw_storage,
                          "persistence_note": "SQLite file; on free/ephemeral hosts it may be wiped on redeploy or sleep."},
            "disclaimer": DISCLAIMER,
        }

    # ------------------------------------------------------------------ analysis
    def _run(fn, *a):
        try:
            return fn(reg, *a)
        except services.ModelUnavailable as exc:
            raise err(503, "model_unavailable", str(exc))
        except services.InvalidInput as exc:
            raise err(422, "invalid_input", str(exc))

    @app.post("/api/v1/analyze/url", response_model=AnalysisResponse, tags=["analysis"])
    def analyze_url(req: UrlRequest):
        return _run(services.analyze_url, req.url, req.use_threat_intel)

    @app.post("/api/v1/analyze/email", response_model=AnalysisResponse, tags=["analysis"])
    def analyze_email(req: EmailRequest):
        return _run(services.analyze_email, req.eml, req.body, req.use_threat_intel)

    # ------------------------------------------------------------------ experiments (read-only)
    @app.get("/api/v1/experiments/results", tags=["experiments"])
    def experiment_sets():
        return {"sets": experiments_store.list_sets(s.results_dir)}

    @app.get("/api/v1/experiments/results/{set_id}", tags=["experiments"])
    def experiment_set(set_id: str):
        out = experiments_store.load_set(s.results_dir, set_id)
        if out is None:
            raise err(404, "results_not_found", f"No saved results for '{set_id}'. Results are produced by CLI runs only.")
        return out

    # ------------------------------------------------------------------ incidents
    def _severity(verdict: str) -> str:
        return {"phishing": "high", "review": "medium"}.get(verdict, "low")

    def _summary(row: dict) -> dict:
        rec = case_store.get_case(row["case_id"], s.db_path) or {}
        urls = rec.get("urls") or []
        return {"case_id": row["case_id"], "created_utc": row["created_utc"], "input_kind": row["input_kind"],
                "verdict": row["verdict"], "severity": _severity(row["verdict"]), "status": row["status"],
                "score": row["score"], "n_urls": row["n_urls"], "raw_saved": bool(row["raw_saved"]),
                "model_version": row["model_version"], "model_trained_on_synthetic": rec.get("model_trained_on_synthetic"),
                "first_url": urls[0]["url"] if urls else None, "origin": "saved"}

    @app.get("/api/v1/incidents", tags=["incidents"], dependencies=[Depends(incident_guard)])
    def list_incidents(q: str | None = None, verdict: str | None = None, status: str | None = None,
                       sort: str = Query("newest", pattern="^(newest|oldest|severity|score)$")):
        items = [_summary(r) for r in case_store.list_cases(s.db_path)]
        if verdict:
            items = [i for i in items if i["verdict"] == verdict]
        if status:
            items = [i for i in items if i["status"] == status]
        if q:
            ql = q.lower()
            items = [i for i in items if ql in i["case_id"].lower() or ql in (i["first_url"] or "").lower()]
        rank = {"high": 0, "medium": 1, "low": 2}
        if sort == "oldest":
            items.sort(key=lambda i: i["created_utc"])
        elif sort == "severity":
            items.sort(key=lambda i: (rank[i["severity"]], -i["score"]))
        elif sort == "score":
            items.sort(key=lambda i: -i["score"])
        return {"items": items, "total": len(items), "persistence_note":
                "Stored in a local SQLite file. Free hosts may erase it on restart/redeploy."}

    @app.post("/api/v1/incidents", status_code=201, tags=["incidents"], dependencies=[Depends(incident_guard)])
    def create_incident(req: IncidentCreate):
        cached = reg.cache.get(req.analysis_id)
        if cached is None:
            raise err(404, "analysis_not_found", "Analysis expired or unknown. Re-run the analysis, then save it.")
        if req.store_raw_body and not s.allow_raw_storage:
            raise err(403, "raw_storage_disabled", "Raw email body storage is disabled on this deployment.")
        if req.store_raw_body and not cached.get("raw"):
            raise err(422, "no_raw_body", "This analysis has no raw email body to store.")
        out = cached["result"]
        rec = reporting.build_case_record(cached["case_result"], {"model_version": out["model"].get("version"),
                                                                  "trained_on_synthetic": out["model"].get("trained_on_synthetic")})
        rec["status"], rec["note"] = "open", req.note
        rec["ti_source"] = out["ti_source"]
        rec["evidence"] = {u["url"]: u["evidence"] for u in out["urls"]}
        rec["raw_body_stored"] = bool(req.store_raw_body)
        case_store.save_case(rec, raw_body=cached.get("raw"), save_raw=req.store_raw_body, db=s.db_path)
        return {"case_id": rec["case_id"], "raw_body_stored": bool(req.store_raw_body)}

    @app.get("/api/v1/incidents/{case_id}", tags=["incidents"], dependencies=[Depends(incident_guard)])
    def get_incident(case_id: str):
        rec = case_store.get_case(case_id, s.db_path)
        if rec is None:
            raise err(404, "incident_not_found", f"Incident {case_id} was not found (it may have been deleted).")
        rec["severity"] = _severity(rec["verdict"])
        rec["origin"] = "saved"
        return rec

    @app.patch("/api/v1/incidents/{case_id}", tags=["incidents"], dependencies=[Depends(incident_guard)])
    def patch_incident(case_id: str, req: IncidentPatch):
        if not case_store.update_case(case_id, req.status, req.note, s.db_path):
            raise err(404, "incident_not_found", f"Incident {case_id} was not found.")
        return {"case_id": case_id, "updated": True}

    @app.delete("/api/v1/incidents/{case_id}", tags=["incidents"], dependencies=[Depends(incident_guard)])
    def delete_incident(case_id: str):
        if not case_store.delete_case(case_id, s.db_path):
            raise err(404, "incident_not_found", f"Incident {case_id} was not found.")
        return {"deleted": case_id}

    @app.delete("/api/v1/incidents", tags=["incidents"], dependencies=[Depends(incident_guard)])
    def clear_incidents(confirm: bool = False):
        if not confirm:
            raise err(400, "confirmation_required", "Pass ?confirm=true to delete ALL stored incidents and raw bodies.")
        return {"deleted_count": case_store.clear_all(s.db_path)}

    @app.get("/api/v1/incidents/{case_id}/export", tags=["incidents"], dependencies=[Depends(incident_guard)])
    def export_incident(case_id: str, format: str = Query("json", pattern="^(json|pdf)$")):
        rec = case_store.get_case(case_id, s.db_path)
        if rec is None:
            raise err(404, "incident_not_found", f"Incident {case_id} was not found.")
        if format == "pdf":
            return Response(reporting.to_pdf_bytes(rec), media_type="application/pdf",
                            headers={"Content-Disposition": f'attachment; filename="{case_id}.pdf"'})
        return Response(reporting.to_json_bytes(rec), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{case_id}.json"'})

    return app


app = create_app()
