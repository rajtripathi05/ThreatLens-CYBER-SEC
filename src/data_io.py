"""Dataset loading, label normalisation, de-duplication and leakage-aware splitting."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from sklearn.model_selection import GroupShuffleSplit, train_test_split

from .url_features import parse_url

from . import synthetic_data

# Label schemes: value in the source column that means "phishing".
LABEL_SCHEMES = {
    "uci": {"phishing_value": 0, "note": "UCI PhiUSIIL: 1 = legitimate, 0 = phishing"},
    "phish1": {"phishing_value": 1, "note": "1 = phishing, 0 = legitimate"},
}


def normalize_labels(series: pd.Series, scheme: str = "uci") -> pd.Series:
    """Map a source label column to the project convention 1 = phishing, 0 = legitimate."""
    if scheme not in LABEL_SCHEMES:
        raise ValueError(f"Unknown label scheme '{scheme}'. Known: {sorted(LABEL_SCHEMES)}")
    vals = set(pd.unique(series.dropna()))
    if not vals <= {0, 1}:
        raise ValueError(f"Expected binary labels in {{0,1}}, found {sorted(vals)}")
    if series.isna().any():
        raise ValueError("Label column contains missing values")
    phish_val = LABEL_SCHEMES[scheme]["phishing_value"]
    return (series.astype(int) == phish_val).astype(int)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class Dataset:
    df: pd.DataFrame            # columns: url, label (1 = phishing)
    provenance: dict


def load_csv(path: Path, url_col: str = "URL", label_col: str = "label", scheme: str = "uci") -> Dataset:
    raw = pd.read_csv(path)
    for c in (url_col, label_col):
        if c not in raw.columns:
            raise KeyError(f"Column '{c}' not in {list(raw.columns)[:10]}...")
    df = pd.DataFrame({"url": raw[url_col].astype(str).str.strip(), "label": normalize_labels(raw[label_col], scheme)})
    n0 = len(df)
    df = df[df.url != ""]
    n_empty = n0 - len(df)
    # Drop exact URL duplicates (and URLs appearing with conflicting labels) before splitting.
    conflicts = df.groupby("url")["label"].nunique()
    conflicting = set(conflicts[conflicts > 1].index)
    df = df[~df.url.isin(conflicting)]
    n_exact_dups = int(df.url.duplicated().sum())
    df = df.drop_duplicates("url").reset_index(drop=True)
    prov = {
        "source": str(path), "sha256": sha256_file(path), "original_rows": int(n0),
        "original_columns": int(raw.shape[1]), "url_col": url_col, "label_col": label_col,
        "label_scheme": scheme, "label_note": LABEL_SCHEMES[scheme]["note"],
        "dropped_empty_urls": int(n_empty), "dropped_conflicting_urls": len(conflicting),
        "dropped_exact_duplicate_rows": n_exact_dups, "final_rows": int(len(df)),
        "phishing_rate": float(df.label.mean()), "synthetic": False,
    }
    return Dataset(df, prov)


def load_synthetic(n_per_class: int = 3000, seed: int = 7) -> Dataset:
    df = synthetic_data.generate(n_per_class, seed)
    prov = {"source": "synthetic_data.generate", "sha256": hashlib.sha256(
        "\n".join(df.url).encode()).hexdigest(), "original_rows": int(len(df)), "original_columns": 2,
        "label_scheme": "phish1", "final_rows": int(len(df)), "phishing_rate": float(df.label.mean()),
        "synthetic": True, "seed": seed,
        "warning": "SYNTHETIC DEMO DATA. Metrics are NOT research results."}
    return Dataset(df, prov)


def split(df: pd.DataFrame, seed: int = 42, val_size: float = 0.2, test_size: float = 0.2):
    """Stratified train/val/test split on de-duplicated URLs."""
    if df.url.duplicated().any():
        raise ValueError("Duplicate URLs must be removed before splitting")
    train_val, test = train_test_split(df, test_size=test_size, stratify=df.label, random_state=seed)
    rel_val = val_size / (1 - test_size)
    train, val = train_test_split(train_val, test_size=rel_val, stratify=train_val.label, random_state=seed)
    return train.reset_index(drop=True), val.reset_index(drop=True), test.reset_index(drop=True)


def write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")


# ---------------------------------------------------------------- host-grouped split & audits
def host_group(url: str) -> str:
    """Grouping key for the host-held-out split: lower-case host without a leading 'www.'.

    This is a conservative proxy for 'same site'. It does not use the public-suffix list, so
    sibling subdomains (a.example.com vs b.example.com) are different groups.
    """
    h = parse_url(url).host or str(url).lower()
    return h[4:] if h.startswith("www.") else h


def split_grouped(df: pd.DataFrame, seed: int = 42, val_size: float = 0.2, test_size: float = 0.2):
    """Train/val/test split where no host appears in more than one partition (sensitivity analysis).

    Sizes are approximate (whole host groups are assigned). Class balance is NOT enforced and
    is reported by the caller.
    """
    if df.url.duplicated().any():
        raise ValueError("Duplicate URLs must be removed before splitting")
    groups = df.url.map(host_group).values
    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    tv_idx, te_idx = next(gss.split(df, groups=groups))
    tv, test = df.iloc[tv_idx], df.iloc[te_idx]
    gss2 = GroupShuffleSplit(n_splits=1, test_size=val_size / (1 - test_size), random_state=seed)
    tr_idx, va_idx = next(gss2.split(tv, groups=groups[tv_idx]))
    return tv.iloc[tr_idx].reset_index(drop=True), tv.iloc[va_idx].reset_index(drop=True), test.reset_index(drop=True)


def near_duplicate_key(url: str) -> str:
    """Scheme-, 'www.'- and trailing-slash-insensitive key used to count near-duplicates."""
    p = parse_url(url)
    if not p.valid:
        return str(url).strip().lower()
    host = p.host[4:] if p.host.startswith("www.") else p.host
    path = p.path.rstrip("/")
    return f"{host}{path}" + (f"?{p.query}" if p.query else "")


def audit_overlap(train: pd.DataFrame, test: pd.DataFrame) -> dict:
    """Leakage audit between two partitions of the same dataset."""
    tr_host, te_host = train.url.map(host_group), test.url.map(host_group)
    tr_near, te_near = train.url.map(near_duplicate_key), test.url.map(near_duplicate_key)
    return {
        "test_items_with_host_seen_in_train": int(te_host.isin(set(tr_host)).sum()),
        "test_items_with_near_duplicate_in_train": int(te_near.isin(set(tr_near)).sum()),
        "test_size": int(len(test)),
        "frac_test_host_seen_in_train": float(te_host.isin(set(tr_host)).mean()),
        "frac_test_near_duplicate_in_train": float(te_near.isin(set(tr_near)).mean()),
    }


def strip_scheme_www(url: str) -> str:
    """Preprocessing ablation: remove the scheme and leading 'www.' (removes a known dataset artefact)."""
    u = str(url).strip()
    u = u.split("://", 1)[1] if "://" in u else u
    return u[4:] if u.lower().startswith("www.") else u
