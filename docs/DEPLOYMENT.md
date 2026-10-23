# Deployment

Status: **configured, not deployed.** Nothing here has been published; deploying needs your Netlify/Render accounts.

## 1. Backend (Render example; any Python host works)
`render.yaml` is a blueprint. Equivalent manual settings:
- Build: `pip install -r requirements-api.txt`
- Start: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
- Health check path: `/health`
- Env vars (see `.env.example`):
  - `THREATLENS_ALLOWED_ORIGINS` = your exact Netlify origin, e.g. `https://your-site.netlify.app` (no trailing slash). For deploy previews use `THREATLENS_ALLOWED_ORIGIN_REGEX`.
  - `THREATLENS_ALLOW_SYNTHETIC_MODEL=false`, `THREATLENS_ALLOW_RAW_STORAGE=false` for a public demo.
  - `THREATLENS_INCIDENT_TOKEN` – if set, incident endpoints require header `X-ThreatLens-Token` (the Incidents page offers a token field).
  - `THREATLENS_DB` – SQLite path.

### Model artefact (important)
`models/*.joblib` is git-ignored. The host needs `models/url_model_phiusiil.joblib` + `.meta.json`, trained with the **same scikit-learn version** (the loader refuses mismatches and checks SHA-256). Options:
1. Commit the two files (~7 MB) to a private/deployment branch, after training locally with the pinned versions (simplest; do remove them from `.gitignore` for that branch).
2. Train at build time: `pip install -r requirements.txt && python scripts/download_phiusiil.py && python -m src.train_model --csv data/raw/PhiUSIIL_Phishing_URL_Dataset.csv --url-col URL --label-col label --scheme uci`. **Untested on a 512 MB free instance**; memory may be tight.
Without it `/api/v1/status` reports `model.kind = "unavailable"` and analysis returns 503.

### Experiment results
The API serves `experiments/results/**` read-only. Commit the result folders you want public (exclude `_archive/` and `raw_decisions.csv.gz`, already ignored) or run in Demo mode, which already embeds copies.

### Persistence caveat
Incidents live in SQLite. On free/ephemeral hosts the file is erased on redeploy/restart; use a paid persistent disk, or accept ephemerality (documented in the UI). Free instances also sleep: the first request can take ~30–60 s. Anyone who can reach an unprotected incident API can read saved cases; set `THREATLENS_INCIDENT_TOKEN` or `THREATLENS_INCIDENTS_ENABLED=false` for public deployments.

### Smoke test
```bash
curl https://YOUR-API/health
curl https://YOUR-API/api/v1/status
curl -X POST https://YOUR-API/api/v1/analyze/url -H "Content-Type: application/json" -d '{"url":"http://secure-paypal-login.example/verify/a1b2c3"}'
curl -H "Origin: https://your-site.netlify.app" -i https://YOUR-API/health   # expect access-control-allow-origin
```

## 2. Frontend (Netlify)
`netlify.toml` (repo root) sets base `frontend`, command `npm ci && npm run build`, publish `dist`, and the SPA fallback `/* -> /index.html 200`.
1. Netlify → Add new site → Import from Git → pick the repo (build settings are read from `netlify.toml`).
2. Site configuration → Environment variables → add **`VITE_API_BASE_URL`** = `https://YOUR-API` (no trailing slash). Redeploy (Vite bakes it at build time). It is public; never put secrets in `VITE_*`.
3. Open the site: the top bar shows **API online / unreachable**. If the API is asleep or unset, use **Demo** mode (clearly labelled fixtures).
4. Put the final Netlify URL into `THREATLENS_ALLOWED_ORIGINS` on the backend.

Local check: `npm --prefix frontend run build` then `npx vite preview`.

### Offline / PWA notes (Netlify)
`netlify.toml` also sets `Cache-Control: no-cache` on `/sw.js` and `/manifest.webmanifest` (so updates roll out) and long-lived immutable caching on `/assets/*`. The build stamps `dist/sw.js` with a content-hash cache version, so every deploy with changed assets produces a new cache and an "update available" prompt in the footer. After the first online visit the site reopens offline and falls back to the browser-local rule engine when the API is down; it cannot be opened for the first time offline. See `docs/LOCAL_MODE.md`.

## 3. Release reference (frontend)

| Item | Value |
|---|---|
| Prerequisites | Node 20, npm |
| Base directory | `frontend` |
| Build command | `npm ci && npm run build` (runs `tsc -b && vite build`) |
| Publish directory | `dist` (relative to the base, i.e. `frontend/dist`) |
| Local dev | `cd frontend && npm ci && npm run dev` |
| Tests / typecheck | `npm test` · `npm run typecheck` |
| Environment variables | `VITE_API_BASE_URL` only (public; no secrets). Optional: unset means the app uses local rules mode. |

**Routing.** `/*` → `/index.html` (200) is the SPA fallback, so `/`, `/campaigns`, `/campaigns/studio`, `/campaigns/intelligence`, `/analyzer`, `/evidence`, `/research`, `/incidents[/:id]`, `/methodology` and `/demo` survive a refresh. Netlify serves real files first, and `/assets/*` has an explicit 404 rule so a missing hashed asset is never answered with HTML.

**GitHub → Netlify.** Push to the production branch (`main`); Netlify builds from `netlify.toml`. Manual alternative: `npm run build` in `frontend`, then `npx netlify-cli deploy --prod --dir=dist` (requires your own Netlify login).

**Verify a deployment.** Open each route above directly (not via navigation) and refresh; check the browser console for errors; in Campaigns, build a URL in Studio, copy it, save it, and confirm it appears in Campaign Intelligence after a refresh; open "Open in Analyzer" and confirm the URL is prefilled but **not** analysed until you press Analyze.

**Current limitations.**
- Campaign records live in this browser's `localStorage` (max 5,000). They are not synced across devices, are not a backup, and disappear if site data is cleared. Export CSVs to keep them.
- There is no campaign analytics: no clicks, conversions, revenue or traffic. Campaign quality (tagging hygiene) is separate from, and says nothing about, URL safety.
- No authentication, cloud sync or live threat-intelligence feeds are part of the frontend deployment. The security Analyzer needs the separately hosted API for ML mode; otherwise it runs the labelled local rule engine.
- `npm audit` reports dev-tooling advisories (vitest/vite chain) and a moderate `react-router` advisory whose fix is the breaking v7 upgrade; the affected paths (SSR hydration, backslash redirect through user-controlled link targets) are not used by this client-only app. Revisit with a planned router upgrade.
