"""Case record construction and JSON / PDF export."""
from __future__ import annotations

import io
import json
import uuid
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from .config import DISCLAIMER, MODEL_VERSION, SCORE_SEMANTICS
from .risk_engine import CaseResult
from .schemas import DECISION_LABELS

REPORT_KEYS = ["case_id", "created_utc", "model_version", "model_trained_on_synthetic", "input_kind", "verdict",
               "verdict_label", "overall_score", "score_semantics", "email_meta", "email_signals", "urls",
               "notes", "disclaimer"]


def build_case_record(result: CaseResult, model_meta: dict | None = None) -> dict:
    d = result.to_dict()
    return {
        "case_id": f"TL-{uuid.uuid4().hex[:12].upper()}",
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model_version": (model_meta or {}).get("model_version", MODEL_VERSION),
        "model_trained_on_synthetic": bool((model_meta or {}).get("trained_on_synthetic", True)),
        "input_kind": d["input_kind"],
        "verdict": d["overall_decision"],
        "verdict_label": DECISION_LABELS[result.overall],
        "overall_score": d["overall_score"],
        "score_semantics": SCORE_SEMANTICS,
        "email_meta": d["email_meta"],
        "email_signals": d["email_signals"],
        "urls": d["urls"],
        "notes": d["notes"],
        "disclaimer": DISCLAIMER,
    }


def to_json_bytes(record: dict) -> bytes:
    return json.dumps(record, indent=2, ensure_ascii=False).encode("utf-8")


def to_pdf_bytes(record: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    ss = getSampleStyleSheet()
    small = ss["BodyText"].clone("small", fontSize=8, leading=10)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm,
                            bottomMargin=14 * mm, title=f"ThreatLens case {record['case_id']}")
    P = lambda t, st=ss["BodyText"]: Paragraph(escape(str(t)), st)  # noqa: E731
    el = [P("ThreatLens AI - Triage case report", ss["Title"]),
          P(f"Case ID: {record['case_id']}   |   Created (UTC): {record['created_utc']}"),
          P(f"Model: {record['model_version']}" + ("  (trained on SYNTHETIC demo data)" if record["model_trained_on_synthetic"] else "")),
          P(f"Input: {record['input_kind']}   |   Outcome: {record['verdict_label']}   |   Heuristic score: {record['overall_score']}"),
          Spacer(1, 4), P(record["score_semantics"], small), Spacer(1, 6)]
    if record["email_meta"]:
        m = record["email_meta"]
        el += [P("Email metadata", ss["Heading3"]),
               P(f"Subject: {m.get('subject', '')}"), P(f"From: {m.get('from', '')}   Reply-To: {m.get('reply_to', '') or 'not present'}"),
               P("Authentication: " + ", ".join(f"{k.upper()}={v}" for k, v in m.get("auth", {}).items()))]
    if record["email_signals"]:
        el.append(P("Header/text signals (separate heuristics)", ss["Heading3"]))
        el += [P(f"- {s['name']}: {s['detail']}", small) for s in record["email_signals"]]
    el.append(P("URL evidence", ss["Heading3"]))
    rows = [["URL", "Model P", "TI state", "Outcome"]]
    for u in record["urls"]:
        rows.append([Paragraph(escape(u["url"][:90]), small), f"{u['ml_probability']:.2f}", u["ti"]["state"], u["decision"]])
    t = Table(rows, colWidths=[90 * mm, 20 * mm, 38 * mm, 26 * mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#12203A")),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 8),
                           ("GRID", (0, 0), (-1, -1), .25, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el += [t, Spacer(1, 6)]
    for u in record["urls"]:
        el.append(P(f"{u['url'][:100]}", ss["Heading4"]))
        el.append(P(f"Why: {u['rationale']}", small))
        el.append(P("Contributions: " + "; ".join(f"{c['name']} {c['value']:+.2f}" for c in u["contributions"]), small))
        ti = u["ti"]
        el.append(P(f"TI: {ti['state']} | source={ti['source'] or '-'} | observed={ti['observed_at'] or '-'} | {ti['detail']}", small))
        for s in u["signals"]:
            el.append(P(f"Signal {s['name']}: {s['detail']}", small))
    for n in record["notes"]:
        el.append(P(n, small))
    el += [Spacer(1, 8), P("Limitations", ss["Heading3"]), P(record["disclaimer"], small),
           P("Feature attributions describe model arithmetic, not causes. A match-free result is not proof of safety.", small)]
    doc.build(el)
    return buf.getvalue()
