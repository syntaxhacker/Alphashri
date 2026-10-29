# Event Radar — scheduled corporate catalysts + intraday tripwire

> Tab inside the Screener page (`/?tab=events`). Backend `api/event_radar/`, frontend `src/components/events/`.

## Why this exists (the Oracle case)

On **2026-10-28** Oracle held an Investor Day. It was announced on **2026-10-23** — a public, dated,
scheduled catalyst five days ahead — and ORCL still ran from a $130.56 prior close to a $148.47
session high mid-afternoon.

The failure was not analysis. It was **memory**: nothing in the app carried "ORCL has an investor day
on the 28th", so the move arrived as an unexplained gap.

Measured after the fact from 1-minute bars:

| | |
|---|---|
| session high vs prior close | $148.47 vs $130.56 (~+12%) |
| volume | 51.5M (~2.5× normal) |
| first abnormal bar | 14:19 ET, **+1.23% on 1.3M shares** |

The first bar is what a tripwire can catch. The **+10%** only exists once you aggregate to 14:30 and
later, i.e. after the information is already in the price. So the tripwire floors at `1%`/bar and
fires on the first one, not the move.

## The four layers (and what each one honestly cannot do)

| # | Layer | Source | Catches | Cannot |
|---|---|---|---|---|
| 1 | Recurring-event memory | `event.recurring` + `seed` source precedence | the fact that a company holds a cadence (annual investor day), so next year is expected | invent a date the company never announced |
| 2 | SEC EDGAR full-text search | EDGAR FTS API + filing text | **scheduled** events for every US filer: investor/analyst/CMD/strategy/R&D day | non-filers, foreign issuers, anything not in a filing |
| 3 | Wire / IR watch | Yahoo per-symbol headline RSS | "Oracle to Host Investor Day on October 28" — the announcement with its own date | paywalled wires; it is mostly price commentary and must be filtered hard |
| 4 | Intraday tripwire | Yahoo 1-min bars (US), Upstox (India) | the unexplained 1-minute move, when no event is known | explain *why*; it only says "this moved, verify" |

Layer 2 is the product. TradingView has **no investor-day event type** and yfinance's
`Ticker.calendar` only carries earnings/dividend dates, so neither can answer "what is scheduled
that nobody has priced yet".

### EDGAR quality policy (learned the hard way)

The first cut returned **153 rows per 7-day window** for a handful of real events. Current rules, all
enforced in code and covered by tests:

- Only **scheduled-event** queries: investor / analyst / capital markets / strategy / R&D day.
  `guidance`, `business_update` and "annual meeting of stockholders" were **dropped** — they matched
  thousands of routine filings and produced noise, not catalysts.
- 8-K hits are filtered to `items` **7.01 / 8.01**; a 2.02-only earnings 8-K is not a scheduled event.
- The filing text is fetched to extract the **real future date + headline**. A date taken from the
  document is confidence **0.8**; falling back to the filed date is **0.4** with a "verify" note.
  `MAX_ENRICH_PER_RUN = 40` bounds the number of text fetches per run.
- Titles pass through `strip_filing_boilerplate`, which peels 8-K item captions
  (`Item 7.01 Regulation FD Disclosure`, `Section 7—…`, checkbox glyphs) and exhibit plumbing
  (`EX-99.1`, `*.htm`). A bare exhibit label is never returned.
- Result: **20** rows per 7-day window, zero bare-exhibit titles, ROIV dated 2026-12-09 and WDS
  2026-11-12 at confidence 0.8.

TradingView earnings are additionally filtered to `US_EXCHANGES = {NASDAQ, NYSE, AMEX, NYSE ARCA, ARCA}`
— the `america` market also returns OTC/foreign listings.

## API

All under `/api/events` (no auth dependency; same pragmatic call as the other research routers).

| Endpoint | Purpose |
|---|---|
| `GET /calendar?market=us&from=&to=&types=&symbols=&upcoming_only=&limit=` | the window, sorted by date then event-type priority |
| `GET /today` | today only, all markets, type-priority sorted (front-page use) |
| `GET /anomalies?date=YYYY-MM-DD` | tripwire rows for one session + the thresholds that produced them |
| `POST /refresh` | re-ingest sources, returns `{ok, inserted}` |

Failures are structured: an unreachable upstream is a `502/503` with a machine-readable detail
(`event_source_unavailable`), never an unhandled 500.

## Data model

`db/models/event.py`, migration `2026_10_29_1200-ev1a2b3c4d5e_add_corporate_events.py`
(`down_revision = tf2a2b3c4d5e`). `db/database.py` runs `alembic upgrade head` at startup, so a
normal `./start.sh` creates both tables — no manual step.

- `corporate_events` — one row per `(symbol, event_date, event_type)`, deduped by
  `SOURCE_PRECEDENCE` (`seed 5 > edgar 4 > ir 3 > wire 2 > tv 1`). Carries `announced_at`,
  `confidence`, `recurring`, `source_url`, `notes`.
- `event_anomalies` — `(symbol, ts)` unique, with `price`, `ret_pct`, `ret_sigma`, `vol_ratio`,
  `has_known_event`, `suspected`.

## Tripwire thresholds

Policy lives in `api/event_radar/contract.py` and is echoed to the UI so the tooltip never drifts
from the detector:

| Constant | Value | Meaning |
|---|---|---|
| `ANOMALY_RET_SIGMA` | `4.0` | robust sigma (MAD) multiplier |
| `ANOMALY_VOL_MULT` | `8.0` | vs the same-minute median |
| `ANOMALY_MIN_ABS_RET` | `1.0` % | floor, kills noise on quiet names |
| `ANOMALY_COOLDOWN_MIN` | `30` min | per symbol |
| `ANOMALY_BASELINE_SESSIONS` | `5` | Yahoo caps 1-min history at 8 days per request |

A real-data regression test (`tests/api/test_event_radar/`, fixture `orcl_8d_1m.csv`) proves the
detector fires on ORCL at **14:19–14:25 ET** with `ret_pct > 5`.

## Background poller

`api/event_radar/poller.py`, started from the FastAPI lifespan. Two clocks in one task:

- **calendar** — every `1800 s`, immediately on start so a restart backfills at once.
- **tripwire** — every `60 s`, only inside US cash hours (`13:30–20:00 UTC`, a deliberate DST
  approximation that never misses the open).

The digest goes out on the first tick at/after **07:30 ET**: before the US open and after the
European close, i.e. when the calendar is stable. Telegram only fires immediately on a **tripwire**
hit; the calendar is a digest (`MAX_DIGEST_LINES = 20`).

## Environment

| Variable | Default | Notes |
|---|---|---|
| `EVENT_RADAR_TRIPWIRE_SYMBOLS` | *(empty)* | comma-separated US tickers, e.g. `ORCL,MSFT,NVDA`. **Empty disables the tripwire** — opt-in by design |
| `EVENT_RADAR_MARKET` | `us` | `us` or `india` |
| `EVENT_RADAR_CONTACT` | repo default | User-Agent contact string SEC asks for |

## Frontend

`src/components/events/` — `EventsPanel` (layout + tripwire strip), `EventsFilters` (market, window,
alpha-only, type filters, refresh), `EventsTable` (shared `TanStackTable`, explicit
`meta.align` per column), `eventsColumns`, `EventTypeBadge`, `EventDetailDrawer`.

State is `src/state/events.ts` — one external store, `useSyncExternalStore`, generation-guarded
requests and a cache keyed by `buildEventsQuery`. Two invariants that cost time to learn:

1. **Use `useSyncExternalStore`, not `subscribe` + `forceUpdate`.** The manual version silently
   stopped re-rendering a lazy-mounted panel inside `Suspense`.
2. **Calendar and anomaly errors are separate slots.** They load in parallel; a shared field let a
   healthy anomaly response erase a calendar 500, which is how the error state "vanished".

## How to run / verify

```bash
./start.sh                                  # API (auto-migrates) + UI
# → http://localhost:5173/?tab=events

source .venv/bin/activate
python -m pytest tests/api/test_event_radar -q        # 319+ tests
python scripts/validate_migrations.py

npx vitest run src/api/events.test.ts src/state/events.test.ts \
  src/hooks/useEvents.test.tsx src/components/events/EventsPanel.test.tsx
npx vitest run src/test/ui-guard.test.ts src/ui/inputs/inputs.w-h.test.tsx
npx playwright test tests/e2e/events.spec.ts --workers=4
```

## Follow-ups (not in v1)

- **NSE tripwire + NSE event ingestion** — the current tripwire is US-only (`EVENT_RADAR_MARKET=india`
  routes to Upstox but is not wired into the digest yet).
- **Seed file for layer 1** — `seed` exists as a source and precedence level; there is no curated
  cadence file yet, so recurring memory is only as good as what EDGAR/wires re-report.
- **ORCL title cosmetics** — the enriched EDGAR title can pick a bullet from the press release
  ("Confirmed that growth will be self-funded beginning in FY29…") instead of a headline. Prose, not
  wrong, just not a title.
- **IR page scraping** — `ir` is a precedence level without an adapter; company event pages are
  heterogeneous enough to deserve their own pass.
