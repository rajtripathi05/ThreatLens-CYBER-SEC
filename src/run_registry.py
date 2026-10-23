"""Run identifiers, environment capture and non-destructive archiving of previous results."""
from __future__ import annotations

import platform
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

PREPROCESSING_VERSION = "pp-1: strip, drop-empty, drop-conflicting-labels, exact-dedupe; char 3-5gram tfidf"
_KEEP = {"_archive", ".gitkeep"}


def new_run_id(prefix: str) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"


def git_commit(root: Path) -> str:
    try:
        out = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"], capture_output=True,
                             text=True, timeout=5)
        return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else "unavailable (not a git repository)"
    except (OSError, subprocess.SubprocessError):
        return "unavailable (git not found)"


def versions() -> dict:
    import numpy
    import pandas
    import sklearn
    return {"python": platform.python_version(), "sklearn": sklearn.__version__, "pandas": pandas.__version__,
            "numpy": numpy.__version__}


def archive_previous(out_dir: Path) -> Path | None:
    """Move any existing results in out_dir into out_dir/_archive/<timestamp>/ (never delete)."""
    out_dir = Path(out_dir)
    if not out_dir.exists():
        return None
    items = [p for p in out_dir.iterdir() if p.name not in _KEEP]
    if not items:
        return None
    dest = out_dir / "_archive" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest.mkdir(parents=True, exist_ok=True)
    for p in items:
        shutil.move(str(p), str(dest / p.name))
    return dest
