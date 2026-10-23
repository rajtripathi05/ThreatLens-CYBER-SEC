# Third-party notices

## Reference repositories (audited; no source code copied)

All ThreatLens code in `src/`, `pages/`, `experiments/` and `tests/` was written from scratch. The repositories below
were inspected (licence files read) and used only as **design references**. Nothing was vendored, adapted or copied, and
`references/` was left unmodified. If code is adapted later, add the files and the full licence text here first.

| Repository | URL | Licence (verified from LICENSE file) | Used for |
|---|---|---|---|
| Phishing-Detection-Tool | https://github.com/sharma-madhavv/Phishing-Detection-Tool | MIT (c) 2026 | Design reference for module split (email parser / indicators / risk scorer / report). Its README contains merge-conflict markers (2 found); its code was not run. |
| phishing-url-detector | https://github.com/Sarthakagrwal/phishing-url-detector | MIT (c) 2026 Sarthak Aggarwal | Design reference for URL-string features and tests. Its trained model artefact was **not** reused. |
| mitreattack-python | https://github.com/mitre-attack/mitreattack-python | Apache-2.0 | Not used. |
| attack-stix-data | https://github.com/mitre-attack/attack-stix-data | MITRE ATT&CK Terms of Use ("(c) 2026 The MITRE Corporation", licence must be reproduced on copies) | Not used. No ATT&CK data is included. |
| sanchitdangi/phishing-email-detection | https://github.com/sanchitdangi/phishing-email-detection | No licence found | Not used, not copied. |

## Dataset

UCI PhiUSIIL Phishing URL (Website) Dataset, CC BY 4.0, https://archive.ics.uci.edu/dataset/967 ,
DOI 10.1016/j.cose.2023.103545. **Not bundled** (git-ignored); downloaded locally on 2026-10-22 with `scripts/download_phiusiil.py`. If you use it, cite the paper
and keep the attribution. See `docs/DATA_PROVENANCE.md`.

## Runtime dependencies (installed via pip, not vendored)

fastapi (MIT), uvicorn (BSD-3), pydantic (MIT), ucimlrepo (MIT), httpx (BSD-3), scikit-learn (BSD-3-Clause), pandas (BSD-3-Clause), numpy (BSD-3-Clause),
matplotlib (PSF-based), reportlab (BSD-style), joblib (BSD-3-Clause), pytest (MIT).

## Bundled fixtures

`data/cti_snapshot.csv`, `data/demo_urls.csv`, `data/demo_emails.json` and the output of `src/synthetic_data.py` are
original, synthetic, use reserved `.example`/`.test` names, and contain no real threat intelligence.

## Frontend dependencies (npm, not vendored)
react, react-dom, react-router-dom, recharts, lucide-react, @radix-ui/* (MIT/ISC), tailwindcss (MIT), class-variance-authority, clsx, tailwind-merge, vite, vitest, @testing-library/* (MIT). Streamlit (Apache-2.0) is used only by `legacy_streamlit/`. The UI follows shadcn/ui-style patterns re-implemented locally; no shadcn source was copied.
