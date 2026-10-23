# Data provenance

## PhiUSIIL Phishing URL (Website) Dataset
| Item | Value |
|---|---|
| Source | https://archive.ics.uci.edu/dataset/967/phiusiil+phishing+url+dataset (fetched via `ucimlrepo.fetch_ucirepo(id=967)`) |
| Citation | Prasad, A. and Chandra, S. (2024). *PhiUSIIL: Phishing URL (Website) Dataset*. UCI ML Repository. https://doi.org/10.1016/j.cose.2023.103545 |
| Licence | CC BY 4.0 (as stated by UCI) – attribution required |
| Collection dates | Not supplied by UCI in the fetched metadata; none are asserted here |
| Local download | 2026-10-22 (UTC), by `scripts/download_phiusiil.py`; record in `data/raw/download_provenance.json` |
| File | `data/raw/PhiUSIIL_Phishing_URL_Dataset.csv` (git-ignored) |
| SHA-256 | `c03cfe13d32a600eb58404f9964c8a3b061b75f705364195d75ff0ef53b712f2` (of the CSV as written by the script) |
| Size verified | 235,795 rows × 55 columns (URL + 53 features + label…as delivered); label 1 = 134,850, label 0 = 100,945 — matches UCI's documented counts |
| Label meaning | **source 1 = legitimate, 0 = phishing**; project: 1 = phishing via `data_io.normalize_labels(..., "uci")` (unit-tested) |
| Columns used | `URL`, `label`. Ignored: all page-derived features (not computable from a URL string at inference) |
| Preprocessing | strip; drop empty (0), conflicting-label (0), exact duplicate rows (425) → **235,370** rows (phishing share 42.7 %) |
| Splits | stratified 60/20/20 and host-grouped 60/20/20; seeds 42–44; test sizes ≈ 47k |
| Ablation | scheme and leading `www.` removed (re-deduplicated → ≈46.7k test) |

Known bias/limits: single collection; label provenance defined by the dataset authors; strong scheme/`www.` artefact (see `LIMITATIONS.md`); no guarantee of representativeness of current traffic.

Manual fallback: download from the UCI page and run `python scripts/download_phiusiil.py --from-file PATH`.

## Threat-intelligence data
No real feed is bundled. `data/cti_snapshot.csv` is a hand-written DEMO snapshot on `.example` names. Simulations use synthetic feeds (see `RESEARCH_METHOD.md`). An independent feed must be documented here (source, date, licence, indicator type, overlap) before use.
