# Agri prices (Agmarknet mandi data)

The `/agri` page shows wholesale mandi prices: minimum, maximum and **modal**
price (the most-traded price, not a mean), plus arrivals, at
**state → district → market (mandi)** granularity with variety and grade kept
intact. Sources disagree sharply on coverage and freshness, so the app uses a
local cache rather than querying any of them from the browser.

## Source comparison

| Source | Coverage | Granularity / access | Verdict |
|---|---|---|---|
| **IndiaDataPortal CKAN — "APMC Arrivals And Prices"** ([resource](https://ckan.indiadataportal.com/dataset/agriculture-marketing/resource/13f9964a-9398-4d49-a7b8-2f57c2396c48), `13f9964a-9398-4d49-a7b8-2f57c2396c48`) | Exact daily rows **2025-10-27 → 2026-05-31** (measured in the local 765 MiB mirror: 3,861,467 rows, 217 dates); metadata says data last updated 2026-05-31 | Market-centre level, 22 columns, bulk CSV/Data API, ODbL | **Chosen for history.** Exact but ends 2026-05-31. |
| [CEDA Ashoka Agri Market Data](https://agmarknet.ceda.ashoka.edu.in/) | 2000–2025 (updated monthly) | Cleaned **monthly aggregates** at India/state/district level; JSON API | Rejected as primary: averages wash out mandi/variety detail and it is stale for current-day use. Useful as a cross-check. |
| **data.gov.in — "Variety-wise Daily Market Prices Data of Commodity"** (resource `35985678-0d79-46b4-9ed6-6f13308a1d24`) | **Exact daily rows from 2009-11-11 → 2026-11-21** (83,252,980 rows); day-by-day `filters[Arrival_Date]`, `limit ≤ 1000`, offset paging | Mandi level, JSON/CSV REST with a personal `api-key`; **uppercase field ids** (`Arrival_Date`, `Commodity`, `Min_Price`, …) | **Chosen for the production daily/backfill feed.** Requires `DATA_GOV_IN_API_KEY`; default `python-requests` UA hangs, use `curl/8.x`. |
| [data.gov.in — "Current Daily Price … (Mandi)"](https://www.data.gov.in/catalog/current-daily-price-various-commodities-various-markets-mandi) (resource `9ef84268-d588-465a-a308-a864a43d0070`) | **Current-day** only (42 rows observed); `filters[arrival_date]` is ignored | Mandi level, lowercase fields | Not used for history; kept as an optional same-day cross-check. |
| eNAM ([enam.gov.in](https://enam.gov.in/)) / Agmarknet web report | Current | HTML reports behind a **captcha**; no stable bulk API | Rejected: no reproducible automated pull. |
| FindsBest | Exact rows older than ~1 year | Web UI; **ToS disallows bulk download** | Rejected on licensing. |
| TGK | ~4-minute aggregate | Pre-aggregated feed | Rejected: loses mandi/variety/grade detail. |
| Private commercial vendors | Varies | Paywalled | Rejected: cost and redistribution terms. |

## Chosen architecture

```
CKAN bulk CSV (one-time seed, 7 months) ──scripts/market/agri_import.py──┐
data.gov.in historical (daily/backfill) ──scripts/market/agri_collect.py─┴─> reports/agri/agri_prices.db
                                                                    │ read-only
                                                  api/agri/router.py ──> GET /api/agri/filters
                                                                        GET /api/agri/prices
```

- `reports/agri/agri_prices.db` is a **local build artifact, not committed**. The
  router opens it read-only; a missing or empty cache returns
  `data_source: "empty"` and a warning — never a successful-looking empty load.
- Exact source spellings live once in `api/agri/registry.py`
  (`source_names` for CKAN, `aliases` for data.gov.in). Aliases are recognised
  on read but not bulk-imported under a different name.
- Upsert key: `(date, state, district, market, commodity, variety, grade)`, so
  re-running either script is idempotent; `source` tags rows as
  `agmarknet_ckan` or `agmarknet_daily`.
- `/api/agri/filters` reports `as_of` (max date in the cache) and
  `freshness_days`; the UI must show those rather than implying live prices.

### Units and freshness

- Prices are **₹ per quintal** (`INR/quintal`) in both sources; non-quintal
  published units are surfaced as a warning, never silently converted.
- Arrivals are normalised to **qtl**: source `Metric Tonnes` values are
  multiplied by 10 (a warning records the conversion).
- Variety and grade are part of the identity — an "Other/Local" onion quote and
  a "Chinchwad/Local" onion quote are different rows.
- "Fresh" means `as_of` relative to today in India time, not the wall clock of
  the last fetch. A daily collector run that returns zero records does not
  advance `as_of`.

## Commands

Run from `stock-screener-ui/` with the project venv.

```bash
# 1. Seed history once from the CKAN mirror (local file, not committed).
.venv/bin/python scripts/market/agri_import.py \
    --csv /tmp/opencode/apmc.csv \
    --db reports/agri/agri_prices.db

# 2. Preview one historical day — no DB or CSV writes.
export DATA_GOV_IN_API_KEY=...          # your own key; never commit it
.venv/bin/python scripts/market/agri_collect.py --dry-run

# 3. Collect a day (all tracked commodities, a subset, or an explicit date).
.venv/bin/python scripts/market/agri_collect.py --commodity onion,potato
.venv/bin/python scripts/market/agri_collect.py --date 21/11/2026

# 4. Regression suite for this feature (uses the committed fixture, not the DB).
.venv/bin/python -m pytest tests/api/test_agri -q
```

`--db` overrides the target on both scripts; `AGRI_DB_PATH` overrides the path
used by the API and scripts when `--db` is omitted. Cache files:

| Path | Contents | Committed? |
|---|---|---|
| `reports/agri/agri_prices.db` | SQLite cache, table `agri_mandi_prices` | No |
| `reports/agri/daily_prices.csv` | Append-only mirror of daily collector deliveries | No |
| `/tmp/opencode/apmc.csv` | Downloaded CKAN mirror (source CSV) | No |
| `tests/fixtures/agri_prices_sample.csv` | Deterministic 150-row test sample | **Yes** |

## Test fixture

`tests/fixtures/agri_prices_sample.csv` is a verbatim, UTF-8 slice of the CKAN
mirror: original 22-column header, all values unchanged, sorted by
`date, state_name, market_center_name, commodity_name` (+ district/variety/grade/id
as tie-breakers). Deterministic 15-row stride sample per available
(state, commodity) pair.

- **150 data rows**, 28 distinct dates, **2026-05-02 → 2026-05-31**.
- States: Maharashtra 90, Punjab 60.
- Commodities (exact CKAN names): Wheat 30, Rice 15, Onion 30, Potato 30,
  Tomato 30, `Red Gram/Arhar/Tur(Whole)` 15.
- Punjab has **no Rice and no `Red Gram/Arhar/Tur(Whole)`** rows in this
  30-day window; those 15-row buckets are Maharashtra-only. All other four
  commodities are represented in both states.

## Known limitations

- **CKAN history ends 2026-05-31.** Without the daily collector, `as_of` never
  moves past that date and freshness grows every day. This is a source limit,
  not a loader failure.
- **`DATA_GOV_IN_API_KEY` is required** for the official historical resource.
  A personal key allows `limit=1000`; the public Swagger sample key is capped at
  10 rows. Query one arrival date at a time (`filters[Arrival_Date]=dd/MM/YYYY`);
  range syntax is not supported by the API.
- **No invented MSP.** `api/agri/registry.py` sets `msp = None` for every
  commodity; `msp` and `distance_to_msp_pct` are `null` until a value is
  verified against an official MSP notification. Do not fill them from memory.
- Commodity names must match the CKAN spelling or a registered alias;
  unmatched names are skipped by the importer/collector.
- The mirror's CKAN `arrival_units` is predominantly `Metric Tonnes` and a few
  rows have blank coordinates/establishment years; those are preserved as-is.

## Citations

- [IndiaDataPortal CKAN — APMC Arrivals And Prices (resource)](https://ckan.indiadataportal.com/dataset/agriculture-marketing/resource/13f9964a-9398-4d49-a7b8-2f57c2396c48) · direct CSV: `ckan.indiadataportal.com/dataset/1749d812-35b4-4635-ac29-dd3116ed31b0/resource/13f9964a-9398-4d49-a7b8-2f57c2396c48/download/apmc-arrivals-and-prices.csv` (ODbL)
- [data.gov.in — Variety-wise Daily Market Prices Data of Commodity](https://www.data.gov.in/resource/variety-wise-daily-market-prices-data-commodity) · API resource `35985678-0d79-46b4-9ed6-6f13308a1d24` · [Swagger](https://www.data.gov.in/backend/dataapi/v1/swagger/35985678-0d79-46b4-9ed6-6f13308a1d24)
- [data.gov.in — Current Daily Price of Various Commodities from Various Markets (Mandi)](https://www.data.gov.in/catalog/current-daily-price-various-commodities-various-markets-mandi) · API resource `9ef84268-d588-465a-a308-a864a43d0070`
- [CEDA — Agri Market Data](https://agmarknet.ceda.ashoka.edu.in/) · [CEDA Data Portal](https://ceda.ashoka.edu.in/data-portal)
- [Agmarknet Daily Price and Arrival Report (captcha)](https://agmarknet.gov.in/daily-price-and-arrival-report) · [eNAM](https://enam.gov.in/)
