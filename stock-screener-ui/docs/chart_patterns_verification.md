# Chart Patterns — Verification Methodology

This document describes how the Chart Patterns feature is verified end-to-end:
the real-candle harness, the Playwright spec, and the manual visual pass. It is
the runbook for the contract checklist in
[`../chart_patterns/CONTRACT.md`](../chart_patterns/CONTRACT.md) §7.

> **Real data only.** Every candle in the harness comes from the production
> Upstox V3 transport. No canned/fixture candles are used for the harness. The
> Playwright spec mocks the HTTP layer only, because the frontend's job is DOM
> behaviour, not detection correctness.

---

## 1. Backend harness — `scripts/verify_chart_patterns.py`

Proves that every detector in the frozen catalog either fires or legitimately
never fires, for every timeframe, on real NSE candles.

### What it does

For each sampled `(symbol, timeframe)`:

1. Resolves the timeframe from `chart_patterns/timeframes.py` (`TIMEFRAMES` /
   `get_timeframe`). Falls back to the CONTRACT §1 ladder if the module is not
   importable yet.
2. Fetches candles through the real transport — `chart_patterns.candles.fetch_for_timeframe`
   when present, otherwise `market_data.market_data.fetch_candles` +
   `get_api_client`. Resampling to `3m/2h/3h` is performed locally when the
   transport lacks the rule.
3. Skips symbols below `min_bars` ("history needed") without failing the run.
4. Runs `chart_patterns.engine.detect_patterns(df, timeframe, symbol)` and records
   every `PatternHit`.

Missing token, Cloudflare 1015, expired OAuth, empty candles or a missing engine
module are all **recorded, not raised** — the report is still written.

### CLI

Run from the repo root with the project venv:

```bash
# Full ladder on three liquid names (bounded smoke run)
.venv/bin/python scripts/verify_chart_patterns.py \
    --symbols "RELIANCE,TCS,INFY" \
    --timeframes all \
    --limit 3 \
    --out reports/chart_patterns_verification

# Default sample (small liquid NSE_EQ set from the instruments file), 5 symbols
.venv/bin/python scripts/verify_chart_patterns.py --limit 5

# A single timeframe, strict mode (non-zero exit if engine missing / zero fetches)
.venv/bin/python scripts/verify_chart_patterns.py --symbols "RELIANCE,TCS" --timeframes 1D --strict
```

| Flag | Default | Meaning |
|---|---|---|
| `--symbols` | liquid NSE_EQ sample | Comma-separated symbols. Overrides the instruments sample. |
| `--timeframes` | `all` | `all` or comma-separated ids (`1D,1h,15m`). |
| `--limit` | `3` | Max symbols to scan (bounds the smoke run). |
| `--out` | `reports/chart_patterns_verification` | Output directory. |
| `--sleep` | `0.2` | Seconds between fetches. |
| `--min-bars` | TF spec | Override the minimum bars for detection. |
| `--quiet` | off | Suppress per-symbol progress lines. |
| `--strict` | off | Exit `3` if engine missing or no candle fetched. |

Exit codes: `0` normal (including zero hits / fetch failures), `3` strict
failure, `2` usage error (argparse).

### Outputs

| File | Contents |
|---|---|
| `report.json` | `meta` + `catalog` + raw `results`. Each result has `symbol`, `timeframe`, `bars`, `fetch_status`, `fetch_error`, `skip_reason`, `detect_error`, and `hits[]` (full `PatternHit` dict incl. trendlines). |
| `report.csv` | One row per hit: `symbol,tf,pattern_id,status,quality,confidence,rr,bars_ago`. Zero-hit patterns produce no rows — use `SUMMARY.md` for coverage. |
| `SUMMARY.md` | The human-readable verdict (below). |

### How to read `SUMMARY.md`

1. **"Patterns with ZERO hits"** — the headline. A pattern with zero hits across
   *every* symbol and timeframe is flagged as a **possible detector gap**. Inspect
   its detector for a strict threshold or a bug. Some patterns are genuinely rare
   on a 3-name sample, so re-run with more symbols before concluding a bug.
2. **Matrix `pattern_id × timeframe`** — cell = hit count, bracketed letters =
   statuses observed. Legend: `c`=confirmed, `f`=forming, `x`=failed,
   `m`=marginal. A pattern that only ever appears in one TF often indicates a
   lookback / `min_bars` mismatch for the others.
3. **Per-timeframe coverage table** — `fetched ok / skipped (history) / fetch
   failed / detect errors / median bars`. A high `skipped` count for a TF means
   `min_bars` or `max_lookback_days` is too aggressive. Any `fetch failed` row
   points at a token/V3 problem, not a detector problem.
4. **Fetch failures / Detector errors** — raw messages for triage.

### Prerequisites

- A valid Upstox token. Resolution order (see `market_data.get_api_client`):
  `UPSTOX_API_KEY`/`UPSTOX_API_SECRET` env → DB `broker_connections` (OAuth
  connect in Settings) → `.upstox_token.json` → `UPSTOX_ACCESS_TOKEN`.
- `pandas` (already a project dependency) for the local `2h/3h` resample.
- Network access to `api.upstox.com`. Cloudflare 1015/HTTP 429 shows up as
  `fetch failed` rows — wait or switch network, then re-run.

---

## 2. Frontend E2E — `tests/e2e/patterns.spec.ts`

Playwright coverage for the `/patterns` page. Auth uses the shared
`setupApiMocks` + `loginAsTestUser`; the `/api/chart-patterns/*` endpoints are
mocked in-spec with DTOs matching CONTRACT §5.

### What it asserts

- `patterns-page` renders.
- Universe bar (`patterns-universe-bar`) and scan-again (`patterns-scan-again`) are visible.
- Stat strip (`patterns-stats`) renders the summary values (`scanned/patterns/in_view/confirmed/bull_bear/data_through`).
- The timeframe select changes value.
- The filter rail filters the card grid (card count drops).
- At least one `patterns-card` renders.
- Clicking a card opens `patterns-detail-pane` and renders `patterns-detail-chart`.

The spec handles both native `<select>` and MUI `Select` for the timeframe
control, and tries checkbox/switch/radio/button/text/select/input strategies for
the filter rail — so it fails with a clear message if the page ships without a
recognisable filter control rather than a vague timeout.

### Run it

```bash
npx playwright test tests/e2e/patterns.spec.ts --workers=4 --output=/tmp/pw-patterns
```

Requirements: dev server on `http://localhost:5173` (or CI's webServer), and the
`/patterns` route registered in `src/App.tsx` (owned by the frontend agents). If
the dev server is not running, the targeted run will fail to connect — start it
with `bun run dev` or `./start.sh`, do **not** run the whole E2E suite.

---

## 3. Manual visual verification (chrome-devtools)

Build/lint do not catch alignment bugs, so after the frontend lands:

1. `bun run build && bun run lint` — must be clean (0 warnings/errors).
2. Start the app (`.venv` API + vite) and open `/patterns` in chrome-devtools at a
   real desktop viewport (e.g. 1440×900) **and** a `<lg` viewport to confirm the
   detail pane collapses below the card grid.
3. Screenshot matrix — capture one screenshot per timeframe and per pattern:
   - **Per TF:** switch `patterns-timeframe-select` through every server-provided
     timeframe and capture the card grid + stat strip each time (`1m`, `5m`,
     `15m`, `30m`, `1h`, `2h`, `3h`, `4h`, `1D`, `1W`, `1M` as available).
   - **Per pattern:** for each `pattern_id` that fired in the harness (and at
     least the zero-hit ones rendered in the picker), select a card and capture
     the detail pane so trendlines/neckline/target/stop **overlays render at the
     correct price levels**. Confirm the overlay geometry matches the candle
     swings — not just that a line exists.
   - **States:** empty (`patterns-empty`), loading (`patterns-loading`), and the
     429/queue-full scan path (enqueue more than `PATTERN_SCAN_MAX_QUEUE`).
4. Verify per UI rules: `@/ui` components only, palette tokens only, one border
   per section, 8pt grid, numbers right-aligned / badges centered (see
   `TABLE_CHECKLIST.md`).

### Visual confirmation checklist

- [ ] Detail-pane overlays align with the actual breakout/neckline candles per pattern.
- [ ] Target/stop levels in the detail pane match the card's DTO values.
- [ ] Every timeframe loads cards without layout shift; long TF labels don't wrap.
- [ ] Filter rail + card grid + detail pane 3-column desktop layout at `lg+`; stacked below.
- [ ] Empty and loading states are distinct and use the required testids.

---

## 4. Definition of done

- [ ] `scripts/verify_chart_patterns.py` runs on real candles for `--timeframes all` and writes `report.json`, `report.csv`, `SUMMARY.md`.
- [ ] No catalogued pattern is a surprising zero-hit across the sample (or each zero-hit is explained in `SUMMARY.md`).
- [ ] `npx playwright test tests/e2e/patterns.spec.ts --workers=4 --output=/tmp/pw-patterns` green.
- [ ] Visual screenshots captured per TF and per pattern; overlays verified.
- [ ] `bun run build`, `bun run lint`, `npx vitest run src/test/ui-guard.test.ts`, `npx vitest run src/ui/inputs/inputs.w-h.test.tsx` all pass.
