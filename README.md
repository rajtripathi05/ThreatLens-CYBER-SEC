# ThreatLens AI

Research prototype: **reliability-aware phishing-URL triage under degraded threat intelligence**.
React + TypeScript frontend (Netlify) · FastAPI backend (Render or similar) · Python ML/experiment pipeline.

> Research prototype, not a security gateway. URLs are never fetched or opened. A `NO_MATCH` or `UNKNOWN` threat-intel state never means "safe".

## Layout
| Path | Purpose |
|---|---|
| `src/` | ML + research core (classifier, TI matching, policies A/B/C, experiments, case store) |
| `api/` | FastAPI service wrapping `src/` (analysis, read-only experiment results, incidents) |
| `frontend/` | React/Vite/Tailwind app (Overview, Analyzer, Evidence Explorer, Research Lab, Incidents, Methodology) |
| `experiments/` | CLI runners + configs; results in `experiments/results/{synthetic,real_data/...}` |
| `scripts/` | `download_phiusiil.py`, `export_demo_fixtures.py` |
| `docs/` | provenance, method, protocol, threat model, limitations, deployment |
| `legacy_streamlit/` | superseded Streamlit UI (reference only, untested) |

## Quick start (local)
```powershell
pip install -r requirements.txt
python -m pytest -q                                   # backend/ML tests
cd frontend; npm test                                 # UI, local rule engine, connectivity, service worker
python scripts/download_phiusiil.py                   # official UCI download (+ provenance/SHA-256)
python -m src.train_model --csv data/raw/PhiUSIIL_Phishing_URL_Dataset.csv --url-col URL --label-col label --scheme uci
python experiments/run_real_data.py                   # empirical classifier evaluation (~20 min)
python experiments/run_experiments.py                 # synthetic simulation (~10 s)
python experiments/run_experiments.py --config experiments/configs/real_oracle.json
python experiments/run_experiments.py --config experiments/configs/real_proxy.json
python experiments/run_experiments.py --config experiments/configs/real_oracle_stripped.json
python scripts/export_demo_fixtures.py                # refresh the frontend demo bundle

uvicorn api.main:app --port 8000                      # backend
cd frontend; copy .env.example .env.local; npm ci; npm run dev   # http://localhost:5173
```
Without a trained model the API answers `503 model_unavailable`; it never trains on request. Without the API the site can be viewed in an explicitly labelled **Demo mode** (bundled fixtures + copies of the real saved result files).

## Operating modes (backend-aware fallback)
The top bar always shows the active mode: **Backend connected** (ML + API services), **Local rules** (backend unreachable: a deterministic, versioned, in-browser rule engine analyses your URL/email; heuristic score, *not* a probability, no ML, no live threat intel, threat intel `UNKNOWN` unless a snapshot is bundled) or **Demo fixtures** (`DEMO FIXTURE`, example data only). Local analyses make no network requests, store nothing unless you click "Save locally", and export JSON / printable HTML. The built site also installs a service worker so it can reopen offline **after one online visit**; a Netlify site cannot be opened for the first time without internet. Details, limits and verification steps: [docs/LOCAL_MODE.md](docs/LOCAL_MODE.md).

## Evidence levels (never mixed)
- **Empirical** – classifier on held-out PhiUSIIL URLs (`real_data/classifier`).
- **Simulation** – synthetic degradation of a feed (`synthetic`, `real_data/ti_simulation_*`). The *oracle* feed uses test labels: an upper bound only.
- **Independent real threat intelligence** – *not done yet*.

See `docs/RESEARCH_METHOD.md`, `docs/EXPERIMENT_PROTOCOL.md`, `docs/LIMITATIONS.md`, `docs/DEPLOYMENT.md`.

## Attribution
PhiUSIIL dataset: Prasad & Chandra (2024), UCI ML Repository, CC BY 4.0, https://doi.org/10.1016/j.cose.2023.103545. See `THIRD_PARTY_NOTICES.md`.

## Guided research demo

Open the app, choose **Start Research Demo** on the Overview. Full script, label definitions and caveats: [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).
