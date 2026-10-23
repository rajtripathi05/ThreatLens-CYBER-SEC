# Local threat-intelligence snapshot - provenance

**Status: no snapshot is bundled with this build.**

Without `snapshot.json` in this folder, the browser-local rule engine reports threat-intelligence state `UNKNOWN`
for every input. It never invents a match and never reports `NO_MATCH` without a snapshot to compare against.

The demo feed in `data/cti_snapshot.csv` is synthetic (reserved `.example` names) and is deliberately NOT shipped here,
because it would make local mode look as if it consulted real intelligence.

## Adding a real snapshot (explicit, manual step)
Create `frontend/public/ti/snapshot.json` before building:

```json
{
  "source": "Name of the feed you obtained this from",
  "version": "feed version or export id (optional)",
  "retrieved_utc": "2026-01-01T00:00:00Z",
  "note": "Licence / terms, and any known coverage limits",
  "indicators": [
    { "indicator": "http://bad.example/path", "kind": "url" },
    { "indicator": "bad.example", "kind": "domain" }
  ]
}
```

- Matching is **exact**: a `url` indicator must equal the analysed URL (scheme, host, path and query, lower-cased host);
  a `domain` indicator must equal the host.
- `NO_MATCH` only means "not in this file". Snapshots are point-in-time, incomplete and go stale; the UI warns when
  `retrieved_utc` is older than 30 days or missing.
- A snapshot is **not** a live feed. Check the feed's licence before redistributing it.
