"""CLI: python experiments/run_experiments.py [--config PATH] [--out DIR]"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import experiment_runner  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    cfg = experiment_runner.load_config(Path(a.config) if a.config else None)
    meta = experiment_runner.run(cfg, Path(a.out) if a.out else None)
    print(f"Done in {meta['runtime_seconds']}s -> {a.out or 'experiments/results'}")
    if meta.get("results_warning"):
        print("WARNING:", meta["results_warning"])


if __name__ == "__main__":
    main()
