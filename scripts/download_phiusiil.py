"""Download the UCI PhiUSIIL Phishing URL dataset (id 967) into data/raw/ and record provenance.

    python scripts/download_phiusiil.py            # official UCI access via ucimlrepo
    python scripts/download_phiusiil.py --force    # replace an existing non-empty file
    python scripts/download_phiusiil.py --from-file PATH   # manual-download fallback (validate + register)

Never writes synthetic data under the real filename. Exit code 1 on any failure.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import data_io  # noqa: E402

UCI_ID = 967
RAW_DIR = ROOT / "data" / "raw"
CSV_PATH = RAW_DIR / "PhiUSIIL_Phishing_URL_Dataset.csv"
PROV_PATH = RAW_DIR / "download_provenance.json"
SOURCE_URL = "https://archive.ics.uci.edu/dataset/967/phiusiil+phishing+url+dataset"
CITATION = ("Prasad, A. and Chandra, S. (2024). PhiUSIIL: Phishing URL (Website) Dataset. "
            "UCI Machine Learning Repository. https://doi.org/10.1016/j.cose.2023.103545")
EXPECTED = {"rows": 235_795, "legitimate(label=1)": 134_850, "phishing(label=0)": 100_945}


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def fetch_via_uci():
    try:
        from ucimlrepo import fetch_ucirepo
    except ImportError:
        fail("ucimlrepo not installed (pip install ucimlrepo), or use --from-file.")
    try:
        ds = fetch_ucirepo(id=UCI_ID)
    except Exception as exc:  # network / endpoint failures
        fail(f"UCI fetch failed ({type(exc).__name__}: {exc}). Download manually from {SOURCE_URL} "
             f"and run with --from-file PATH.")
    import pandas as pd
    X, y = ds.data.features, ds.data.targets
    if len(X) != len(y):
        fail("features/targets length mismatch")
    df = pd.concat([X.reset_index(drop=True), y.reset_index(drop=True)], axis=1)
    return df, getattr(ds, "metadata", None)


def validate(df) -> dict:
    for col in ("URL", "label"):
        if col not in df.columns:
            fail(f"expected column '{col}' missing; found {list(df.columns)[:8]}...")
    vals = set(df["label"].dropna().unique())
    if not vals <= {0, 1}:
        fail(f"label has non-binary values {sorted(vals)}")
    counts = df["label"].value_counts().to_dict()
    report = {"rows": int(len(df)), "columns": int(df.shape[1]),
              "label_counts": {str(k): int(v) for k, v in sorted(counts.items())},
              "matches_documented_counts": (len(df) == EXPECTED["rows"]
                                            and counts.get(1) == EXPECTED["legitimate(label=1)"]
                                            and counts.get(0) == EXPECTED["phishing(label=0)"])}
    # Orientation sanity: UCI says 1 = legitimate (the larger class). Warn if the majority class isn't 1.
    if counts.get(1, 0) < counts.get(0, 0):
        print("WARNING: label=1 is not the majority class; check label orientation (UCI: 1 = legitimate).")
    if not report["matches_documented_counts"]:
        print(f"WARNING: counts differ from documented {EXPECTED}; recording actual values.")
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--from-file", help="manually downloaded CSV to validate and register")
    a = ap.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    if CSV_PATH.exists() and CSV_PATH.stat().st_size > 0 and not a.force and not a.from_file:
        fail(f"{CSV_PATH} already exists and is non-empty. Use --force to replace it.")

    import pandas as pd
    meta = None
    if a.from_file:
        df = pd.read_csv(a.from_file)
        method = "manual-download"
    else:
        df, meta = fetch_via_uci()
        method = "ucimlrepo.fetch_ucirepo(id=967)"
    report = validate(df)
    if a.from_file and (CSV_PATH.exists() and CSV_PATH.stat().st_size > 0 and not a.force):
        fail(f"{CSV_PATH} exists; use --force to replace.")
    tmp = CSV_PATH.with_suffix(".csv.tmp")
    df.to_csv(tmp, index=False)
    shutil.move(str(tmp), CSV_PATH)
    prov = {"dataset": "PhiUSIIL Phishing URL (Website) Dataset", "uci_id": UCI_ID, "source_url": SOURCE_URL,
            "citation": CITATION, "licence": "CC BY 4.0 (as stated by UCI)", "method": method,
            "downloaded_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "file": str(CSV_PATH.relative_to(ROOT)), "sha256": data_io.sha256_file(CSV_PATH),
            "label_meaning": "1 = legitimate, 0 = phishing (source convention)", **report,
            "uci_metadata_keys": sorted(meta.keys()) if isinstance(meta, dict) else None}
    PROV_PATH.write_text(json.dumps(prov, indent=2, default=str), encoding="utf-8")
    print(f"Saved {CSV_PATH} shape={df.shape}")
    print("Label distribution:", report["label_counts"])
    print("SHA-256:", prov["sha256"])
    print("Provenance ->", PROV_PATH)


if __name__ == "__main__":
    main()
