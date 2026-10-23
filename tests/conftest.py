import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import classifier, data_io  # noqa: E402
from src.threat_intelligence import TIRecord, TISnapshot  # noqa: E402

COLLECTED = datetime(2026, 1, 1, tzinfo=timezone.utc)


def dt(y, m, d):
    return datetime(y, m, d, tzinfo=timezone.utc)


@pytest.fixture(scope="session")
def small_data():
    ds = data_io.load_synthetic(n_per_class=500, seed=3)
    return ds


@pytest.fixture(scope="session")
def bundle(small_data):
    train, _, _ = data_io.split(small_data.df, seed=1)
    return classifier.ModelBundle(classifier.train(train, 1), {"model_version": "test", "trained_on_synthetic": True})


@pytest.fixture()
def snapshot():
    recs = [
        TIRecord("fresh.example/p", "url", "SRC", dt(2025, 12, 25)),
        TIRecord("stale.example/p", "url", "SRC", dt(2025, 6, 1)),
        TIRecord("expired.example/p", "url", "SRC", dt(2025, 12, 25), dt(2025, 12, 30)),
        TIRecord("noprov.example/p", "url", "", None),
        TIRecord("synthetic.example/p", "url", "SIM", dt(2025, 12, 25), synthetic=True),
        TIRecord("baddomain.example", "domain", "SRC", dt(2025, 12, 25)),
    ]
    return TISnapshot.from_records(recs, name="t", collected_at=COLLECTED)
