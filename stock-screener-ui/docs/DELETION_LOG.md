# Code Deletion Log

## 2026-10-22 Refactor Session — Nifty report + Deep Value (React/TS)

Scope: `src/pages/report/**`, `src/components/value/**`, `src/utils/**`.
Excluded by policy (another agent editing them concurrently):
`src/pages/report/NiftyReportPanel.tsx`, `niftyOiBursts.ts`,
`useNiftyOiAlerts.ts`, `NiftyVerdictStrip.tsx`, `src/api/reportNifty.ts`,
`src/types/niftyReport.ts`.

### Unused files deleted

- `src/pages/report/chartOverlays.ts` (355 lines) + `chartOverlays.test.ts`
  (300) — the whole module was orphaned: the only reference in the repo was
  its own test. Its types (`ChartLevel`, `OpeningRange`, `TradeMarker`,
  `WallZone`, `LevelSplit`, `VwapPoint`) had no consumer, and the live
  equivalents live in `src/utils/chart/*` and `src/patterns/builder/`.
- `src/utils/ui_schema.ts` (252) + `ui_schema.test.ts` (38) — the screener
  column ladder was superseded by `src/components/screener/columns/`; the
  module was referenced by nothing outside its own test.

### Dead code removed

- `src/pages/report/niftyOiHeatmap.ts` — `buildHeatmapTimeAxis()` and
  `heatmapBucketOf()` (superseded by the live bucketing in the same file),
  plus the `HeatmapTimeAxis` type.
- `src/utils/color.ts` — `themeAlpha()` (no callers) and the `muiAlpha`
  re-export (internal only).
- **146 dead exports** un-exported across the scope (props interfaces,
  file-local types and constants that nothing imported). Every one was
  re-checked repo-wide (`src`, `tests`, `docs`, `scripts`, `api`) before the
  `export` keyword was dropped; none was deleted outright, so no consumer
  breaks.

### Shared modules created

| Module | Lines | Home for |
|---|---|---|
| `src/pages/report/reportFormat.ts` | 296 | the report's numeric vocabulary — `formatReportNum`, `formatReportPct`, `formatReportRatio`, `formatReportCompact`, `formatReportOiCr`, `formatReportClock`, `formatReportPoints`, `REPORT_DASH`, `REPORT_MINUS` |
| `src/pages/report/reportFormat.test.ts` | 128 | parity tests pinning every formatter to the legacy per-panel output |
| `src/components/value/valueFormat.ts` | 76 | the Deep Value panel's percent / number / price / mcap formatters |
| `src/pages/report/tapeFormat.ts` | 295 | the tape's formatters, heat scale, session roll-up and change-flash diff |
| `src/pages/report/NiftyTapeColumns.tsx` | 376 | the tape's 12-column model |
| `src/pages/report/deskPlanTypes.ts` | 91 | the desk plan's data contract |
| `src/pages/report/deskPlanLevels.ts` | 195 | structural levels + the plan's thresholds |
| `src/pages/report/deskPlanReasons.ts` | 332 | one numeric sentence per reason bucket |
| `src/pages/report/niftyChartMath.ts` | 413 | the chart's pure maths — scale guard, mark lines, resampling, EMA |
| `src/pages/report/ReportLeaderStrip.tsx` | 147 | the daily report's breadth readout + leadership board |

### Number / percent formatting — 14 copies → 1 vocabulary

Each panel used to carry its own formatter and they had drifted: one printed
the Unicode minus `−` where another printed `-`, the compact K tier used 2
decimals in one panel and 1 in another, and the "no value" glyph was spelled
three different ways (`—`, `–`, `n/a`).

| Old helper | Panel | New home |
|---|---|---|
| `formatTapeCompact` / `formatTapePrice` / `formatTapeSigned` / `formatTapePct` / `formatTapeRatio` | tape | `reportFormat` (via `tapeFormat`) |
| `formatUnusualCompact` / `formatUnusualShare` | unusual volume | `reportFormat` |
| `formatProfileCompact` | volume profile | `reportFormat` |
| `compactOi` | OI heatmap | `reportFormat` |
| `fmtIntelSigned` / `fmtIntelInt` / `fmtIntelOi` / `fmtIntelPcr` | intel strip | `reportFormat` |
| `fmtCr` / `fmtFlipStrike` / `flipDistanceLabel` | delta positioning | `reportFormat` |
| `fmtDeskNum` / `fmtDeskOi` | desk plan | `reportFormat` |
| `fmtStrike` | depth map / heatmap | `reportReportNum` |
| `formatOiCompact` | depth map | `reportFormat.formatReportOiCr` |
| `fmtPct` / `fmtNum` | value columns + detail drawer | `valueFormat` |
| `fmtMedian` | value score cell | `valueFormat` |

Every migration is pinned by `reportFormat.test.ts`, which asserts the **exact
legacy string** for each replaced helper (including the Unicode minus, the
`"–"` vs `"n/a"` dash and the per-tier decimal counts).

### `hexToRgba` — 4 copies → 1

`src/utils/color.ts::hexToRgba` already existed but was unused; the report
panels each had a byte-identical private copy. MUI's `alpha()` was verified to
produce the identical `rgba(r, g, b, a)` string for every hex token in the
report palette, so the panel copies now call the shared helper. Removed the
copies in `NiftyTapeTable.tsx`, `NiftyUnusualVolume.tsx` and
`NiftyChartPanel.tsx`.

### IST clock — 2 copies → 1

`NiftyTapeTable.formatIstClock` and `NiftyUnusualVolume.clock` were the same
function; both now call `reportFormat.formatReportClock`.

### Sorting — 5 local sorts → the shared `ui-helpers.sortByField`

`sortByField` existed in `src/utils/ui-helpers.ts` but had no callers. It now
backs the strike/level sorts in `NiftyDepthMap.buildDepthRows`,
`niftyGex.buildGexProfile`, `niftyVolumeProfile.buildVolumeProfile`,
`DeltaProfileChart.buildDeltaProfile` and the wall ranking in
`NiftyChartPanel.buildMarkLines`.

### File splits (>800 lines → 200–400)

| File | Before | After | Extracted into |
|---|---|---|---|
| `src/pages/report/NiftyTapeTable.tsx` | 1,105 | 528 | `tapeFormat.ts` (295) + `NiftyTapeColumns.tsx` (376) |
| `src/pages/report/deskPlan.ts` | 944 | 401 | `deskPlanTypes.ts` (91) + `deskPlanLevels.ts` (195) + `deskPlanReasons.ts` (332) |
| `src/pages/report/NiftyChartPanel.tsx` | 791 | 412 | `niftyChartMath.ts` (413) |
| `src/pages/report/DailyReportPage.tsx` | 787 | 652 | `ReportLeaderStrip.tsx` (147) |

Every extracted module keeps the original export path working: the old
import sites (`from "./NiftyTapeTable"`, `from "./deskPlan"`,
`from "./NiftyChartPanel"`) still resolve, so no call site had to change.

### Impact

- Files deleted: **4** (655 + 290 lines of orphaned code).
- Files created: **10** (2,349 lines), of which 128 are parity tests.
- Dead exports un-exported: **146**; dead functions deleted: **4**.
- Duplicated formatter implementations removed: **24** across 11 panels.
- Largest in-scope file: 1,105 → **691 lines** (`NiftyDepthMap.tsx`); every
  file that was over the 800-line hard max is now under 530.

### Testing

- `npx vitest run src/pages/report/ src/components/value/ src/utils/` →
  **71 files, 1,501 tests passed**.
- `npx vitest run src/test/ui-guard.test.ts src/ui/inputs/inputs.w-h.test.tsx`
  → **2 files, 11 tests passed**.
- `npx vitest run --dir src --testTimeout=20000` → **420 files passed, 1
  failed**: `src/config/colors.test.ts` (2 assertions). **Pre-existing and
  not ours** — another agent changed `src/ui/palette.ts` (`CHART_BG`
  `#0D1117`→`#000000`, `TOOLTIP_BG` `#161B22`→`#111111`) without updating the
  test; both files are outside this session's scope.
- `bun run build` → **✓ built in 28.61s**, no errors.
- `bun run lint` → **140 warnings, 0 errors** (the only warnings inside the
  scope are two pre-existing ones in `src/utils/surgeNotifications.ts`).
- `tsc --noEmit` → **1,169 errors, down from the 1,184 baseline**; every
  remaining error in a touched file is the repo's pre-existing
  `UITextProps`/`UITooltipProps`/`CompactPanelProps` pattern, unchanged in
  count by this session.

### Left in place (reported, not removed)

- `src/pages/report/NiftyGexProfile.tsx::GEX_LEVEL_MAX_DIST_PCT` and
  `GEX_LEVEL_MIN_SHARE` have no importers inside `src`, but they are asserted
  by the co-located test — kept exported.
- `NiftyReportPanel.tsx` (3,474 lines) and `niftyOiBursts.ts` (965) are still
  over the 800-line hard max. Both are excluded from this session because
  another agent is editing them concurrently.
- `src/pages/report/niftyOiBursts.ts` and `useNiftyOiAlerts.ts` keep their
  own copy of the terminal palette constants; consolidating them with the
  tape's would need a shared terminal-palette module, and the panel they
  live in is not ours to edit.

## 2026-10-22 Refactor Session — desk/tooling layer (Python)

Scope: `scripts/**` and `options_paper/**`. Excluded by policy:
`scripts/watch_levels.py` (armed, waiting on a live trigger),
`options_paper/manual.py` (owned by another agent), `**/__pycache__/**`,
`reports/**`, `experiments/data/**`, `db/**`.

### Shared modules created

| Module | Lines | Home for |
|---|---|---|
| `scripts/upstox_common.py` | 198 | `token()`, `token_with_source()`, `rest_spot()`, `chain()`, `as_float()`, `data()`, `get()` |
| `scripts/indicators.py` | 249 | `atr_range()`, `atr_true()`, `candle_field()`, `build_bars()`, `detect_fvg()`, `swing_pivots()`, `detect_lrl()`, `prev_trading_day()`, `session_profile()` |
| `scripts/desk_common.py` | 41 | `today_ist()`, `db_path()`, `ist_hhmmss()` |

### Token loaders — 11 implementations → 1

Precedence is now canonical **DB (`broker_connections`) → `.upstox_token.json` →
`UPSTOX_ACCESS_TOKEN`**, matching `api/brokers.py` and
`db.models.broker.get_shared_broker_token`. Before this session each loader
had its own order, which is how a live desk 401s mid-session on a stale file
token.

| Old file | Old home | New home |
|---|---|---|
| `scripts/market_clock.py` | `_token`, `_get` | `upstox_common.token` / `.get` |
| `scripts/futures_volume.py` | `_token`, `_get_v2`, `_get_v3` | `upstox_common.token` / `.get` |
| `scripts/breakout_watch.py` | `_token` | `upstox_common.token` |
| `scripts/agent_desk_manager.py` | `_token`, `_chain` | `upstox_common.token` / `.chain` |
| `scripts/nifty_drivers.py` | `_token` | `upstox_common.token` |
| `scripts/upstox_intel.py` | `_token`, `_get` | `upstox_common.token` / `.get` |
| `scripts/upstox_contract.py` | `_token`, `_get` | `upstox_common.token` / `.get` |
| `scripts/paper_sensex.py` | `get_token` | `upstox_common.token` |
| `scripts/benchmark_upstox_data.py` | `get_token` | `upstox_common.token_with_source` |
| `scripts/trade_cost.py` | `get_token` | `upstox_common.token` |
| `scripts/desk_check.py` | `_upstox_token` | `upstox_common.token` |
| `options_paper/tape.py` | `upstox_token`, `live_option_quote` | `upstox_common.token` / `.rest_spot` |

`scripts/watch_levels.py` keeps its own loaders (excluded from this session).

### Indicator math — 6 copies → 1 module

`build_bars`, `atr`, `detect_fvg`, `swing_pivots`, `detect_lrl` were
**byte-identical** across `scripts/lrl_ifvg_check.py` and the five
`scripts/tmp_lrl_ifvg*` / `tmp_ctx_study` / `tmp_loss_study` studies.
`prev_trading_day` and `session_profile` were duplicated in two of them.

### Two different "ATR"s — kept, named, and documented

`scripts/desk_check.py:atr` and the LRL studies' `atr` are **not** the same
number and were never merged:

* `indicators.atr_range(bars, i, n)` — mean of `high - low`. **No
  previous-close term, so it is not a true range.** Used by the LRL/iFVG
  studies (they call it "ATR").
* `indicators.atr_true(candles, period)` — mean of **true range**, with the
  `|close - prev_close|` fallback for spot-only series. Used by the desk speed
  panel (`scripts/desk_check.py`).

### Option pricing — 4 Black-Scholes copies → 1

`scripts/paper_sensex_backtest.py`, `paper_sensex_hourly_backtest.py`,
`paper_sensex_orb_backtest.py` and `paper_sensex_scalp_backtest.py` each
carried their own Black-Scholes-on-spot implementation (and three copies of
the normal CDF). All four now call `options_paper.greeks.bs_price()` /
`norm_cdf()`. The rate stays a caller argument: these backtests priced with
5%, while `options_paper.greeks.RISK_FREE` is 6.5% — a shared default would
have silently re-priced historical results.

`options_paper.greeks.black76` is the **forward** model and is deliberately
kept separate.

### Unused files deleted

- `scripts/daily/daily_telegram.py` (59 lines) — 8 `notify_*` hooks with zero
  callers repo-wide (including runbooks). `trading/runner_core.py` and
  `trading/runner_signals.py` call `trading.telegram_notifier.send_*`
  directly, so this adapter layer was never wired up.

### Unused code removed

- `options_paper/greeks.py` — `_npdf()` (never called; the module uses `_ncdf`).
- `options_paper/panel.py` — `_manifest_expiry_map()`, `index_candles()`
  (zero callers; `sim.py` builds its candles inline in a different shape).
- `scripts/update_strategy_params.py` — `get_strategy_type()`.
- 13 unused imports across the touched files (`json`, `os`, `re`, `subprocess`,
  `urllib.parse`, `math`, `defaultdict`, `pandas`).
- 9 local `IST = timezone(timedelta(hours=5, minutes=30))` constants replaced
  by `config.IST` (the repo's single source of truth per `AGENTS.md`).
- `scripts/smc_ifvg_eval.py` + `smc_ifvg_test.py` — duplicate `ist()`
  formatter → `desk_common.ist_hhmmss()`.

### Impact

- Net lines: **≈ −600** (tracked files I was the sole editor of: −781;
  new shared modules: +488; deleted file: −59; untracked files edited: ≈ −250).
- Duplicated *implementations* removed: 11 token loaders, 5 REST helpers,
  4 `_as_float`, 2 `_data`, 5 `_today_ist`, 4 `_db_path`, 2 `_rest_spot`/`_chain`,
  5 indicators × 6 files, 2 helpers × 2 files, 4 Black-Scholes, 3 normal CDF.

### Testing

- `.venv/bin/python -m pytest tests/test_desk_check.py tests/test_agent_desk_manager.py tests/test_watch_levels.py -q` → **95 passed**.
- 13 further affected test files (upstox_intel/contract/rate, nifty_intel,
  market_clock, futures_volume, trade_cost, cas_close, options_paper,
  options_paper_sim, tape_pricing, tape_spot_reconcile, strategy_scripts) →
  **291 passed**.
- `py_compile` on all 31 touched files → clean.
- Import smoke test on all 31 touched modules → 0 failures.
- `--help` smoke run on all 25 touched CLIs → 0 failures.
- Live read-only Upstox smoke: token resolves from the DB, `/market/status/NSE`
  → `success`, `rest_spot()` → 22647.6, `chain()` → spot 22647.85 / 144 rows.
- Numerical parity checks: 200 synthetic bars, `atr` and `detect_lrl` — 0
  mismatches vs. the pre-migration implementations; 768 parameter combinations
  of Black-Scholes — 0 mismatches vs. all four originals.

### Left in place (reported, not removed)

- `options_paper/tape.py::live_option_quote` and
  `options_paper/costs.py::reprice_trade_costs` are unreferenced, but both
  files are being edited concurrently by another agent — not ours to prune.
- `scripts/htf_bias.py::bias_map` looked dead to a name-based scan but is
  referenced from `experiments/smc/bench.py`.
- `scripts/backtest_levels.py` and `scripts/eda_session_corr.py` still share
  an identical yfinance `fetch()`/`_clean()` pair; consolidating them needs a
  yfinance helper module, which was out of proportion to the 14 lines saved.
