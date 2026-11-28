# LevelBook Phase 3 — additive `/api/levels` read

Phase 3 of the single-source levels roadmap described in
[`LEVELS_ARCHITECTURE.md`](./LEVELS_ARCHITECTURE.md). This phase exposes the
fused `LevelBook` through **one new endpoint** and nothing else.

**Non-negotiable contract:** the endpoint fuses levels *on top of* the existing
52W screener columns and the original S/R in `chart_patterns/levels.py`. It
never replaces, rewrites or gates either one. No existing consumer is migrated.

## Roadmap

| Phase | State | Scope |
| --- | --- | --- |
| 1 — foundation | done | Frozen `Level`/`LevelBook`, registry, pure fusion, four wrapping detectors (price action, pivot, GEX, walls), parity tests, deterministic benchmark. Zero consumers. |
| 2 — trendline | done | Segment-geometry trendline detector joins the same registry; no consumer migration. |
| **3 — additive API** | **this phase** | `GET /api/levels/{symbol}` is the only new consumer of `build_level_book`. No source, column, route handler or UI payload changes. |
| 4 — migration/retirement | future | Optional consumer migration behind a feature flag, with byte-identical existing payloads; retire leftover standalone level plumbing once every consumer is moved. |

Phase 3 deliberately does **not** turn the fused book into the default source
for any chart, report or screener. That is Phase 4 and needs its own brief.

## What stays untouched

- `api/screener_api/screener_scan.py` — every existing 52W column keeps its
  name, value, rounding and ordering: `high_52w`, `to_52w_high`, `touched_52w`,
  `days_ago`, `time_to_52w`, `source`, and the `/api/52w-range`,
  `/api/52w-range/bulk` responses.
- `chart_patterns/levels.py` — `compute_sr_zones` and the chart/report payloads
  that call it are unchanged. The GEX/wall/pivot lanes keep wrapping those
  functions; no formula is duplicated or swapped.
- Existing route handlers — the only app change is one `_include_api(...)` line
  and one OpenAPI tag registration. No handler body is edited.
- Consumers — no `src/**` file is changed; no UI re-fuses, re-ranks or re-merges
  levels. Fusion happens once, backend-side.

## Endpoint contract

`GET /api/levels/{symbol}`

Follows the existing read-only market-data shape (e.g.
`/api/chart-patterns/symbol/{symbol}` in `openapi.yaml`): a path `symbol`, a
`timeframe` query param, a JSON body, `200`/`422` from FastAPI plus explicit
`400`/`404`. It is a **public read** — no bearer token and no broker OAuth,
matching the chart-patterns symbol read. It is not a write/admin route.

| Input | Type | Default | Notes |
| --- | --- | --- | --- |
| `symbol` | path `str` | required | Trimmed and upper-cased; blank → `400 {"detail":"symbol required"}`. |
| `timeframe` | query `str` | `1D` | Registered timeframe id (`1D`, `1h`, `15m`, …), forwarded to `fetch_for_timeframe`. |
| `lookback_bars` | query `int` | `null` | `>= 1`. Limits the candle window passed to the detectors; unset lets each detector use its own lookback. |

Status codes: `200` fused snapshot · `400` blank symbol / invalid lookback ·
`404` no candle data for the symbol/timeframe · `422` FastAPI query validation.

Success body (all keys always present; `null` where a field does not apply):

```json
{
  "schema_version": 1,
  "symbol": "RELIANCE",
  "timeframe": "1D",
  "as_of": "2026-11-28",
  "spot": 1423.5,
  "candle_count": 400,
  "sources": ["price_action", "trendline"],
  "levels": [
    {
      "id": "12-char sha1",
      "symbol": "RELIANCE",
      "timeframe": "1D",
      "as_of": "2026-11-28",
      "kind": "support",
      "source": "price_action",
      "geometry": "zone",
      "side": "below",
      "strength": 0.75,
      "touches": 3,
      "price": null,
      "bottom": 1400.0,
      "top": 1410.5,
      "start_price": null,
      "end_price": null,
      "start_as_of": null,
      "end_as_of": null,
      "evidence": {},
      "detector_version": "1",
      "schema_version": 1
    }
  ]
}
```

Field semantics:

- `as_of`, `start_as_of`, `end_as_of` are IST calendar dates (never the UTC
  bar date). `spot` is the last completed close of the fetched frame.
- `geometry` is `horizontal` (uses `price`), `zone` (`bottom`/`top`) or
  `segment` (`start_price`/`end_price` + both dates). Non-applicable geometry
  fields are emitted as `null` so one consumer shape covers all three.
- `source` is the detector's source (`price_action`, `pivot`, `gex`, `oi`,
  `session`, `trendline`); `kind` is its semantic role (`support`,
  `resistance`, `fuel`, `wall`, `max_pain`, `trendline`, `pivot`).
- `side` is `below` / `above` / `inside` relative to `spot`, or `null` when
  spot cannot resolve it. Explicit upstream sides are preserved.
- `sources` is the de-duplicated set of sources present in `levels`, in that
  order. `levels` are already fused and ranked by the backend: source
  precedence → strength → distance from spot → `id`. No cross-source merge:
  a price-action zone and a GEX level at the same price stay separate.
- `evidence` is copied from the `Level`; provenance is immutable. `id` is the
  stable 12-char hash used by fusion dedupe.

## Implementation shape

```
GET /api/levels/{symbol}
  → api/levels_api/router.py        validate path/query, map None → 404
  → api/levels_api/service.py       build_levels_payload / project_book
      → chart_patterns.candles.fetch_for_timeframe   (shared cache/session rules)
      → market_levels.build_level_book               (registered lanes + fusion, once)
  → api.utils._sanitize_for_json    JSON-safe projection
```

The router is mounted with one `_include_api("api.levels_api.router", ...)` line
in `api_server_fastapi.py`, next to the other additive routers. It declares
`tags=["levels"]`, a summary and a description; the `levels` tag is registered
in `OPENAPI_TAGS`. No router imports another router's handler and no detector
is changed.

Because `openapi.yaml` is generated, adding this route must be followed by the
standard export step before the contract drift test is run:

```bash
.venv/bin/python scripts/export_openapi.py
.venv/bin/python -m pytest tests/contract/test_openapi_sync.py -q
```

## Parity guard

`tests/test_levels_api.py` pins the additive contract with `TestClient` over a
minimal `FastAPI()` app (no server) and a synthetic OHLC frame:

- **No scan call.** `screener_scan.fetch_screener_data` is patched to raise;
  calling the endpoint must not invoke it.
- **No output change.** The 52W row from `screener_scan._build_stock_data` and
  the raw `chart_levels.compute_sr_zones` result are deep-copied before the
  request and compared field-for-field after it — both must be unchanged.
- **No function replacement.** Identity checks on `compute_sr_zones`,
  `_build_stock_data` and `fetch_screener_data` survive import + use of the
  endpoint.
- **No column leakage.** The response shape contains only the levels contract;
  none of `high_52w` / `to_52w_high` / `touched_52w` / `days_ago` appear in it,
  while `_build_stock_data` still emits all four.
- **Well-formed book.** `200` yields non-empty `levels`, the documented level
  keys, allowed source/geometry/side values and the `trendline` lane on top of
  S/R; blank symbol is `400`, no candles is `404`.

Run:

```bash
CI_MODE=1 .venv/bin/python -m pytest tests/test_levels_api.py -q
```

## Scope discipline / risks

- No new math lives in the API layer; it only fetches, projects and fuses via
  the existing service. A future consumer must not re-implement fusion.
- `lookback_bars` uses the candle cache's `lb{n}` variant, so a custom window
  cannot poison the default cache entry.
- The endpoint reads the last completed session (`include_partial_today=False`);
  it never mutates today's chart cache.
- Phase 4 is intentionally out of scope: no UI reads `/api/levels` yet, so
  parity is currently enforced by tests, not by a live consumer.
