"""CLI: python experiments/run_real_data.py  -- real-data classifier evaluation (PhiUSIIL)."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import real_eval  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    cfg = json.loads(Path(a.config).read_text()) if a.config else None
    meta = real_eval.run(cfg, Path(a.out) if a.out else None)
    print("run_id", meta["run_id"], "runs", len(meta["runs"]))


if __name__ == "__main__":
    main()
