"""Synthetic URL generator for demo fixtures and tests.

The output is SYNTHETIC. Models trained on it are demo models; their metrics must never be
reported as research results. Vocabulary overlaps between classes on purpose, so the task is
not trivially separable.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

WORDS = ["river", "stone", "garden", "north", "blue", "forest", "bright", "market", "cloud", "data",
         "pixel", "harbor", "maple", "summit", "orbit", "delta", "lumen", "nova", "atlas", "cedar",
         "bakery", "clinic", "studio", "travel", "books", "sports", "energy", "health", "learn", "news"]
BRANDS = ["paypal", "microsoft", "apple", "amazon", "netflix", "dhl", "chase", "google", "dropbox", "docusign"]
LURE = ["login", "verify", "secure", "account", "update", "confirm", "signin", "password", "billing", "support"]
# Reserved TLDs (example/test) appear in both classes so demo fixtures are not keyed on them.
GOOD_TLDS = ["com", "org", "net", "edu", "io", "co.uk", "de", "info", "example", "test"]
BAD_TLDS = ["xyz", "top", "click", "tk", "ml", "icu", "buzz", "work", "com", "net", "info", "example", "test"]
PATH_WORDS = ["index", "about", "contact", "blog", "products", "docs", "help", "news", "team", "pricing"]
SHORTS = ["bit.ly", "tinyurl.com", "t.co", "rb.gy"]


def _rand_token(rng, n):
    alphabet = list("abcdefghijklmnopqrstuvwxyz0123456789")
    return "".join(rng.choice(alphabet, size=n))


def _legit(rng) -> str:
    host = f"{rng.choice(WORDS)}{rng.choice(['', '-'])}{rng.choice(WORDS)}.{rng.choice(GOOD_TLDS)}"
    if rng.random() < 0.08:
        host = f"{rng.choice(BRANDS)}.com"
    if rng.random() < 0.4:
        host = "www." + host
    elif rng.random() < 0.1:
        host = f"{rng.choice(['accounts', 'login', 'support', 'mail'])}.{host}"
    path = "/".join(rng.choice(PATH_WORDS, size=int(rng.integers(0, 4))))
    url = f"{rng.choice(['https', 'https', 'https', 'http'])}://{host}/{path}"
    if rng.random() < 0.2:
        url += f"?id={int(rng.integers(1, 99999))}&page={int(rng.integers(1, 20))}"
    if rng.random() < 0.05:
        url += "/" + _rand_token(rng, int(rng.integers(12, 30)))
    return url


def _phish(rng) -> str:
    kind = rng.random()
    brand, lure = rng.choice(BRANDS), rng.choice(LURE)
    if kind < 0.40:  # lure keywords + brand in look-alike host
        host = f"{brand}-{lure}.{rng.choice(BAD_TLDS)}"
        if rng.random() < 0.5:
            host = f"{lure}.{brand}-{rng.choice(WORDS)}.{rng.choice(BAD_TLDS)}"
    elif kind < 0.55:  # IP host
        host = ".".join(str(int(x)) for x in rng.integers(1, 255, size=4))
    elif kind < 0.65:  # deep subdomains
        host = f"{lure}.{brand}.{rng.choice(WORDS)}.{rng.choice(WORDS)}-{lure}.{rng.choice(BAD_TLDS)}"
    elif kind < 0.72:  # shortener
        return f"https://{rng.choice(SHORTS)}/{_rand_token(rng, 7)}"
    else:  # clean-looking host (overlaps with legit)
        host = f"{rng.choice(WORDS)}{rng.choice(WORDS)}.{rng.choice(GOOD_TLDS)}"
    path_kind = rng.random()
    if path_kind < 0.4:
        path = f"{lure}/{_rand_token(rng, int(rng.integers(8, 24)))}"
    elif path_kind < 0.7:
        path = "/".join(rng.choice(PATH_WORDS, size=int(rng.integers(0, 3))))
    else:
        path = f"wp-content/{_rand_token(rng, 10)}/{lure}.php"
    url = f"{rng.choice(['http', 'https'])}://{host}/{path}"
    if rng.random() < 0.3:
        url += f"?{rng.choice(['session', 'token', 'ref'])}={_rand_token(rng, 16)}"
    return url


def generate(n_per_class: int = 3000, seed: int = 7) -> pd.DataFrame:
    """Return DataFrame[url, label] with label 1 = phishing, 0 = legitimate (project convention)."""
    rng = np.random.default_rng(seed)
    rows = [(_legit(rng), 0) for _ in range(n_per_class)] + [(_phish(rng), 1) for _ in range(n_per_class)]
    df = pd.DataFrame(rows, columns=["url", "label"]).drop_duplicates("url").reset_index(drop=True)
    return df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
