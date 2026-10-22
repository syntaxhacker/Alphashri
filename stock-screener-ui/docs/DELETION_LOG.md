# Code Deletion Log

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
