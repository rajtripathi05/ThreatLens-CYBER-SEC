"""Export the frontend's demo-mode bundle: frontend/public/demo/demo-bundle.json

Contents (all clearly labelled in the UI as DEMO FIXTURE):
  * analyses   - outputs of the SYNTHETIC demo model on reserved .example fixtures, produced by the real service code
  * experiments - a copy of the real saved result files (so demo mode shows genuine saved numbers with run IDs)
  * incidents  - sample incident records built from those analyses (ids prefixed DEMO-)

    python scripts/export_demo_fixtures.py
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import experiments_store, services  # noqa: E402
from api.settings import Settings  # noqa: E402
from src import reporting  # noqa: E402
from src.config import DEMO_EMAILS_PATH, DEMO_URLS_PATH, MODEL_META_PATH, MODEL_PATH, RESULTS_DIR  # noqa: E402

OUT = ROOT / "frontend" / "public" / "demo" / "demo-bundle.json"


def main() -> None:
    reg = services.Registry(Settings())
    if not reg._try_load(MODEL_PATH, MODEL_META_PATH, "synthetic"):   # always the synthetic DEMO model, never the real one
        raise SystemExit("Synthetic demo model missing. Run: python -m src.train_model --synthetic")
    reg._info.detail = "DEMO FIXTURE: " + reg._info.detail

    analyses, incidents = [], []
    with open(DEMO_URLS_PATH, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            try:
                a = services.analyze_url(reg, row["url"], True)
            except services.InvalidInput:
                continue   # e.g. the malformed-URL fixture is rejected by the API's validation, as it should be
            analyses.append({"name": row["name"], "description": row["what_it_demonstrates"], "analysis": a})
    for e in json.loads(Path(DEMO_EMAILS_PATH).read_text(encoding="utf-8")):
        a = services.analyze_email(reg, e["eml"], None, True)
        analyses.append({"name": e["name"], "description": "Sample email with extracted URLs (synthetic).", "analysis": a})

    picks = [a for a in analyses if a["analysis"]["input_kind"] == "email"] + [analyses[0], analyses[4]]
    for i, p in enumerate(picks, 1):
        cached = reg.cache.get(p["analysis"]["analysis_id"])
        rec = reporting.build_case_record(cached["case_result"], {"model_version": p["analysis"]["model"]["version"], "trained_on_synthetic": True})
        rec.update(case_id=f"DEMO-{i:03d}", status="open", note="Demo fixture - not a saved case.", raw_saved=False,
                   severity={"phishing": "high", "review": "medium"}.get(rec["verdict"], "low"), origin="demo-fixture")
        rec["evidence"] = {u["url"]: u["evidence"] for u in p["analysis"]["urls"]}
        incidents.append({
            "case_id": rec["case_id"], "created_utc": rec["created_utc"], "input_kind": rec["input_kind"], "verdict": rec["verdict"],
            "severity": rec["severity"], "status": "open", "score": rec["overall_score"], "n_urls": len(rec["urls"]),
            "raw_saved": False, "model_version": rec["model_version"], "model_trained_on_synthetic": True,
            "first_url": rec["urls"][0]["url"] if rec["urls"] else None, "origin": "demo-fixture", "record": rec})

    sets = experiments_store.list_sets(RESULTS_DIR)
    data = {s["id"]: experiments_store.load_set(RESULTS_DIR, s["id"]) for s in sets if s["available"]}
    bundle = {"generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "note": "DEMO FIXTURES. Analyses use the synthetic demo model. Experiment data are copies of saved result files.",
              "analyses": analyses, "experiments": {"sets": sets, "data": data}, "incidents": incidents}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, default=str, allow_nan=False), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KiB): {len(analyses)} analyses, {len(data)} result sets, {len(incidents)} incidents")


if __name__ == "__main__":
    main()
