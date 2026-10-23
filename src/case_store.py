"""SQLite case history. Metadata only by default; raw email body requires an explicit flag."""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from .config import DB_PATH

_SCHEMA = """CREATE TABLE IF NOT EXISTS cases (
  case_id TEXT PRIMARY KEY, created_utc TEXT NOT NULL, model_version TEXT, input_kind TEXT,
  verdict TEXT, score REAL, n_urls INTEGER, record_json TEXT NOT NULL,
  raw_saved INTEGER NOT NULL DEFAULT 0, raw_body TEXT)"""


def _conn(db: Path | None = None) -> sqlite3.Connection:
    path = Path(db or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path)
    c.execute(_SCHEMA)
    cols = {r[1] for r in c.execute("PRAGMA table_info(cases)")}
    for col, ddl in (("status", "TEXT NOT NULL DEFAULT 'open'"), ("note", "TEXT NOT NULL DEFAULT ''")):
        if col not in cols:  # additive migration for databases created by the Streamlit-era schema
            c.execute(f"ALTER TABLE cases ADD COLUMN {col} {ddl}")
    return c


def save_case(record: dict, raw_body: str | None = None, save_raw: bool = False, db: Path | None = None) -> str:
    """Persist a case record. ``raw_body`` is stored only when ``save_raw`` is True."""
    body = raw_body if (save_raw and raw_body) else None
    with closing(_conn(db)) as c, c:
        c.execute("INSERT OR REPLACE INTO cases (case_id, created_utc, model_version, input_kind, verdict, score, "
                  "n_urls, record_json, raw_saved, raw_body, status, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                  (record["case_id"], record["created_utc"], record["model_version"], record["input_kind"],
                   record["verdict"], record["overall_score"], len(record["urls"]),
                   json.dumps(record), 1 if body else 0, body, record.get("status", "open"), record.get("note", "")))
    return record["case_id"]


def list_cases(db: Path | None = None) -> list[dict]:
    with closing(_conn(db)) as c:
        rows = c.execute("SELECT case_id, created_utc, input_kind, verdict, score, n_urls, raw_saved, model_version, "
                         "status, note FROM cases ORDER BY created_utc DESC").fetchall()
    keys = ["case_id", "created_utc", "input_kind", "verdict", "score", "n_urls", "raw_saved", "model_version",
            "status", "note"]
    return [dict(zip(keys, r)) for r in rows]


def get_case(case_id: str, db: Path | None = None) -> dict | None:
    with closing(_conn(db)) as c:
        r = c.execute("SELECT record_json, status, note, raw_saved FROM cases WHERE case_id=?", (case_id,)).fetchone()
    if not r:
        return None
    rec = json.loads(r[0])
    rec["status"], rec["note"], rec["raw_saved"] = r[1], r[2], bool(r[3])
    return rec


def update_case(case_id: str, status: str | None = None, note: str | None = None, db: Path | None = None) -> bool:
    with closing(_conn(db)) as c, c:
        cur = c.execute("UPDATE cases SET status=COALESCE(?, status), note=COALESCE(?, note) WHERE case_id=?",
                        (status, note, case_id))
    return cur.rowcount > 0


def clear_all(db: Path | None = None) -> int:
    """Delete every stored case (including any stored raw bodies). Returns the number removed."""
    with closing(_conn(db)) as c, c:
        n = c.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
        c.execute("DELETE FROM cases")
    return int(n)


def get_raw_body(case_id: str, db: Path | None = None) -> str | None:
    with closing(_conn(db)) as c:
        r = c.execute("SELECT raw_body FROM cases WHERE case_id=?", (case_id,)).fetchone()
    return r[0] if r else None


def delete_case(case_id: str, db: Path | None = None) -> bool:
    with closing(_conn(db)) as c, c:
        cur = c.execute("DELETE FROM cases WHERE case_id=?", (case_id,))
    return cur.rowcount > 0
