# Paper Trading Replay — Off-Hours Testing Plan

## Problem
The live paper trading pipeline (`MultiStrategyRunner`) only works during NSE market hours (9:15-15:30 IST). Signal generators depend on `fetch_intraday_data_v3()` which only returns today's candles. All time checks use `datetime.now()` directly. This blocks development and testing outside market hours.

## Goal
Two-phase approach:
1. **Phase 1**: Standalone replay script (zero changes to existing files) — iterate fast
2. **Phase 2**: Runner replay mode (minimal changes to 6 files) — full pipeline testing

---

## Phase 1: Standalone Replay Script

### File: `experiments/replay_trading_day.py`

Self-contained script that feeds historical candles through the same signal generators, risk manager, and portfolio that the live runner uses.

### Usage
```bash
python experiments/replay_trading_day.py --date 2026-04-09
python experiments/replay_trading_day.py --date 2026-04-09 --symbols RELIANCE,TCS,INFY
python experiments/replay_trading_day.py --date 2026-04-09 --strategy ORB
python experiments/replay_trading_day.py --date 2026-04-09 --strategy ALL --verbose
```

### Data Caching
- Fetch via `fetch_historical_data_v3(symbol, 'minutes', 1, from_date, to_date)` (works off-hours)
- Cache to `experiments/data/replay_cache/{date}/{symbol}.pkl`
- Reuse cached files on subsequent runs
- CLI flag `--refresh-cache` to force re-fetch

### Watchlist / Symbol Source
Priority order:
1. `--symbols` CLI arg (comma-separated)
2. `experiments/data/orb_symbols.json` (existing autoresearch cache, 23 volatile stocks)
3. `DEFAULT_WATCHLIST` from `runner_core.py` (20 large-caps)

No screener needed — replay uses a static symbol list.

### Architecture

The script does NOT modify any existing files. It imports and calls existing components directly:

```
replay_trading_day.py
  |
  |-- imports signal generators (no changes needed)
  |   |-- ORBSignalGenerator.check_breakout(symbol, current_price, or_levels)
  |   |-- SRBreakoutSignalGenerator.check_entry(symbol, market_data)
  |   |-- EMACrossSignalGenerator.check_entry(symbol, ema_data)
  |   |-- Week52ChaserSignalGenerator.check_entry(symbol, market_data)
  |   |-- Week52TargetSignalGenerator.check_entry(symbol, market_data)
  |
  |-- imports risk manager (no changes needed)
  |   |-- GlobalRiskManager.validate_trade(...)
  |
  |-- imports portfolio (no changes needed)
  |   |-- SharedPortfolioManager.open_position(...)
  |   |-- SharedPortfolioManager.close_position(...)
  |   |-- SharedPortfolioManager.update_prices(...)
  |
  |-- imports costs (no changes needed)
  |   |-- calculate_trading_costs(...)
  |
  |-- controls time externally
      |-- simulated_time: advances per candle
      |-- cooldowns: tracked in local dict with simulated time
      |-- entry/exit times: passed explicitly to portfolio methods
```

### Detailed Flow

```
1. INITIALIZATION
   |-- Parse CLI args (date, symbols, strategy, verbose)
   |-- Load or fetch 1-min candles for all symbols
   |-- Cache to disk if fresh fetch
   |-- Group 1-min candles into 5-min candles per symbol
   |-- Instantiate components:
   |   |-- GlobalRiskManager (with default config)
   |   |-- SharedPortfolioManager (initial_capital=1_000_000)
   |   |-- Signal generators per strategy (with config dicts)
   |-- Load strategy configs from DB (or use defaults)

2. PRE-MARKET (candles before 10:00 IST)
   |-- Skip signal generation (same as live runner behavior)
   |-- For 52W strategies: run check_entry() once with previous daily data
   |   |-- fetch_historical_data_v3(symbol, 'days', 1, from_date=-400d, to_date=replay_date)
   |   |-- For valid signals → validate → open position

3. TRADING HOURS (candles 10:00-15:30 IST)
   |-- For each 1-min candle (chronological):
   |   |-- simulated_time = candle timestamp
   |   |
   |   |-- IF 5-min boundary (minute % 5 == 0):
   |   |   |-- Update 5-min candle groups for each symbol
   |   |   |-- For ORB strategy (after OR period, i.e., after first 9 candles):
   |   |   |   |-- Compute OR levels from first 9 five-min candles (45 min)
   |   |   |   |-- current_price = latest 1-min candle close
   |   |   |   |-- signal = gen.check_breakout(symbol, current_price, or_levels)
   |   |   |   |-- If signal: validate_trade → open_position (with simulated entry_time)
   |   |   |
   |   |   |-- For SR_BREAKOUT strategy:
   |   |   |   |-- Use pre-computed pivot points (from previous day data)
   |   |   |   |-- current_price = latest 1-min candle close
   |   |   |   |-- signal = gen.check_entry(symbol, {current_price, pivot_points})
   |   |   |   |-- If signal: validate_trade → open_position
   |   |   |
   |   |   |-- For EMA_CROSS strategy:
   |   |   |   |-- Compute EMAs from 5-min candle closes
   |   |   |   |-- signal = gen.check_entry(symbol, {current_price, ema_fast_current, ema_fast_prev, ema_slow_current, ema_slow_prev})
   |   |   |   |-- If signal: validate_trade → open_position
   |   |
   |   |-- MONITOR OPEN POSITIONS (every candle):
   |   |   |-- For each open position:
   |   |   |   |-- candle_high, candle_low = current candle H/L
   |   |   |   |-- IF BUY side:
   |   |   |   |   |-- IF candle_low <= stop_loss → close at stop_loss
   |   |   |   |   |-- ELIF candle_high >= take_profit → close at take_profit
   |   |   |   |-- IF SELL side:
   |   |   |   |   |-- IF candle_high >= stop_loss → close at stop_loss
   |   |   |   |   |-- ELIF candle_low <= take_profit → close at take_profit
   |   |   |   |-- Calculate costs via calculate_trading_costs()
   |   |   |   |-- Record trade in local list (symbol, side, entry, exit, pnl, reason)
   |   |   |   |-- Track cooldown: cooldowns[symbol] = simulated_time + cooldown_minutes
   |   |
   |   |-- EOD FORCE EXIT (candle time >= strategy's eod_exit_hour:minute):
   |   |   |-- Close all remaining open positions at current_price
   |   |   |-- Record trades

4. POST-MARKET (after 15:30)
   |-- Force close any remaining positions
   |-- Print summary

5. SUMMARY OUTPUT
   |-- Table: symbol | side | entry | exit | pnl | pnl% | reason | duration
   |-- Aggregates: total_trades, win_rate, profit_factor, net_pnl, max_drawdown
   |-- Per-strategy breakdown
   |-- Compare with backtest results (if available)
```

### Cooldown Tracking

Live runner tracks cooldowns via `datetime.now()` in `runner_signals.py`. Replay script handles this externally:

```python
cooldowns: dict[str, datetime] = {}  # symbol -> cooldown_end_time

# Before checking entry:
if symbol in cooldowns and simulated_time < cooldowns[symbol]:
    skip  # still in cooldown

# After exit:
cooldowns[symbol] = simulated_time + timedelta(minutes=cooldown_minutes)
```

### Position Exit — SL/TP vs Signal Generator

The live runner uses `signal_generator.check_exit()` for swing strategies but does manual SL/TP checks for intraday strategies. Replay follows the same pattern:

- **ORB**: Manual SL/TP check per candle (no `check_exit()` call needed — ORB only exits via SL/TP/EOD)
- **SR_BREAKOUT**: Manual SL/TP check + `gen.check_exit(timestamp=simulated_time)` for strategy-specific exits
- **EMA_CROSS**: Manual SL/TP check + `gen.check_exit(timestamp=simulated_time)` for strategy-specific exits
- **52W_CHASER/TARGET**: `gen.check_exit(days_held=..., ...)` for max_holding_days etc.

Note: `check_exit()` on SR_BREAKOUT and EMA_CROSS already accept `timestamp=` kwarg — pass `simulated_time`.

### ORB Signal Generator — No `check_exit()` Needed

`orb_signals.py:check_exit()` (line 285-312) only checks:
1. EOD force exit (time-based) — handled by the replay script's EOD logic
2. Stop loss hit — handled by manual candle H/L check
3. Take profit hit — handled by manual candle H/L check

So the replay script never needs to call `ORBSignalGenerator.check_exit()`. This avoids the `datetime.now()` calls in `orb_signals.py` entirely.

### Strategy Config

Replay loads strategy configs to match live behavior:

```python
# From DB (if available)
from trading.config_loader import get_all_strategies
strategies = get_all_strategies()

# Fallback defaults matching seed_qa_data.py
STRATEGY_DEFAULTS = {
    "ORB Best": {"sl_pct": 1.0, "tp_pct": 1.5, "breakout_buffer_pct": 0.3, ...},
    "ORB Conservative": {"sl_pct": 0.4, "tp_pct": 1.2, ...},
    ...
}
```

### Output Comparison with Backtest

The replay uses the same signal generators and risk manager as live trading. The backtest uses different strategy classes in `backtest/strategies/`. Differences to expect:

| Aspect | Replay | Backtest |
|--------|--------|----------|
| Signal generator | `trading/orb_signals.py` (live) | `backtest/strategies/orb.py` (separate) |
| Risk manager | `GlobalRiskManager` (live) | Basic sizing in engine |
| Costs | `calculate_trading_costs()` | `calculate_trading_costs()` (same) |
| EOD exit | Strategy-specific (14:45/15:00/15:15) | Fixed 15:15 |
| Cooldown | Per-strategy from config | Per-config in engine |

Replay results should be more accurate than backtest for predicting live behavior since it uses the exact same code path.

### Files Created (Phase 1)
- `experiments/replay_trading_day.py` — main script
- `experiments/data/replay_cache/` — cached candle data directory (gitignored)

### Files Imported (unchanged)
- `trading/orb_signals.py` — `ORBSignalGenerator`
- `trading/sr_breakout_signals.py` — `SRBreakoutSignalGenerator`
- `trading/ema_cross_signals.py` — `EMACrossSignalGenerator`
- `trading/week52_chaser_signals.py` — `Week52ChaserSignalGenerator`
- `trading/week52_target_signals.py` — `Week52TargetSignalGenerator`
- `trading/global_risk_manager.py` — `GlobalRiskManager`
- `trading/portfolio/portfolio_core.py` — `SharedPortfolioManager`
- `trading/config_loader.py` — `StrategyConfigData`
- `backtest/costs.py` — `calculate_trading_costs`

---

## Phase 2: Runner Replay Mode

Only after Phase 1 proves correct and we're confident in the approach.

### Changes (6 files, minimal and decoupled)

#### 2.1 `trading/runner_core.py` — Clock injection + data injection

**`_ist_now()` becomes overridable:**
```python
def __init__(self, ..., replay_date: str = None):
    self._replay_date = replay_date
    self._replay_time = None  # advances during replay

def _ist_now(self) -> datetime:
    if self._replay_time:
        return self._replay_time
    return datetime.now(IST)
```

**`run()` loop changes:**
- If `replay_date`: skip `is_market_open()` check
- Replace `time.sleep(interval)` with `self._advance_replay_clock(interval)`
- Pass `replay_date` down to signal scan and position monitor

**Snapshot/display:** use `_ist_now()` instead of `datetime.now(IST)` (already done since they call `_ist_now()`)

#### 2.2 `trading/runner_signals.py` — 7 `datetime.now()` calls

Replace with `self._ist_now()` (inherited from `RunnerSignalsMixin` which inherits from `MultiStrategyRunner`):

| Line | Current | Change to |
|------|---------|-----------|
| 67 | `datetime.now(IST) < cooldown_end` | `self._ist_now() < cooldown_end` |
| 209 | `runner.last_scan_time = datetime.now(IST)` | `runner.last_scan_time = self._ist_now()` |
| 233 | `datetime.now(IST) < cooldown_end` | `self._ist_now() < cooldown_end` |
| 279 | `runner.last_scan_time = datetime.now(IST)` | `runner.last_scan_time = self._ist_now()` |
| 375 | `entry_time=datetime.now(IST)` | `entry_time=self._ist_now()` |
| 470 | `(datetime.now(IST) - pos.entry_time).days` | `(self._ist_now() - pos.entry_time).days` |
| 555 | `self.cooldown_stocks[symbol] = datetime.now(IST)` | `self.cooldown_stocks[symbol] = self._ist_now()` |

**Data fetch changes:** In replay mode, data fetch methods call `fetch_historical_data_v3()` instead of `fetch_intraday_data_v3()`:
- `_fetch_or_data()`: `fetch_historical_data_v3(symbol, 'minutes', 5, from_date, to_date=replay_date)`
- `_fetch_ema_data()`: same pattern
- `_monitor_data_fetch()`: `fetch_historical_data_v3(symbol, 'minutes', 1, from_date, to_date=replay_date)`

These are already in `runner_risk.py` and `runner_signals.py`. The change is: if `self._replay_date`, use historical API instead of intraday API, and slice to the current simulated time.

#### 2.3 `trading/runner_risk.py` — 4 `datetime.now()` calls

Replace with a `get_current_date()` helper that checks replay mode:

| Line | Current | Change to |
|------|---------|-----------|
| 84 | `datetime.now(IST).strftime('%Y-%m-%d')` | `self._get_to_date()` |
| 85 | `(datetime.now(IST) - td(days=400))` | `(self._get_to_date() - td(days=400))` |
| 145 | `datetime.now(IST).strftime('%Y-%m-%d')` | `self._get_to_date()` |
| 146 | `(datetime.now(IST) - td(days=10))` | `(self._get_to_date() - td(days=10))` |

#### 2.4 `trading/base_signals.py` — `create_signal()` timestamp

Add optional `timestamp` parameter:
```python
def create_signal(self, ..., timestamp: datetime = None, **extra_fields):
    return ORBSignal(
        ...
        timestamp=timestamp or datetime.now(config.IST),
        ...
    )
```

Callers in `runner_signals.py` pass `self._ist_now()` when creating signals from scan results.

#### 2.5 `trading/orb_signals.py` — 4 `datetime.now()` calls (also fix missing timezone bug)

| Line | Current | Change to |
|------|---------|-----------|
| 235 | `timestamp=datetime.now()` | `timestamp=datetime.now(config.IST)` |
| 259 | `timestamp=datetime.now()` | `timestamp=datetime.now(config.IST)` |
| 292 | `now = datetime.now()` | Accept `timestamp` kwarg (like SR/EMA already do) |
| 452 | `timestamp=datetime.now()` | `timestamp=datetime.now(config.IST)` |

Lines 235, 259, 452 are existing bugs (missing timezone). Fix regardless of replay mode.
Line 292: make `check_exit()` accept `timestamp=` kwarg like EMA/SR already do.

#### 2.6 `trading/portfolio/portfolio_core.py` — 3 `datetime.now()` calls

Add optional `timestamp` parameter to `open_position()` and `close_position()`:
```python
def open_position(self, ..., entry_time: datetime = None):
    entry_time = entry_time or datetime.now(config.IST)

def close_position(self, ..., exit_time: datetime = None):
    exit_time = exit_time or datetime.now(config.IST)
```

`day_start` initialization: accept optional `simulated_date` parameter.

### What Does NOT Change
- `telegram_notifier.py` — Telegram timestamps show real time (acceptable for replay debugging)
- `paper/paper_portfolio.py` — not used in replay (use `SharedPortfolioManager` instead)
- `journal/` files — replay writes to a separate output, not the live journal
- Signal generator logic — identical code path whether live or replay
- Risk manager logic — identical validation whether live or replay

### Runner Replay CLI/API

```bash
# CLI
python -m trading.runner_cli --bot-id 1 --replay-date 2026-04-09

# API
POST /api/bots/1/start?replay_date=2026-04-09
```

---

## Phase 2: Runner Replay Mode (Replaces Phase 1 Standalone)

Use the **exact same `MultiStrategyRunner` code path** as live trading, just with historical data and simulated time. Same DB configs, same signal generators, same risk manager, same portfolio manager, same hardcoded filters.

### Architecture

```
POST /api/replay/run {date, symbols, strategy}
  ↓
api/replay_api.py → run_replay(date, symbols, strategy, on_event)
  ↓
MultiStrategyRunner(replay_mode=True, replay_date=date)
  ├── Loads strategies from DB (same as live)
  ├── ReplayDataProvider replaces _data_fetcher.upstox_api
  ├── Pre-computes overlays → emits SSE events
  └── Minute-by-minute loop (9:15 → 15:30):
      ├── _ist_now() returns simulated time
      ├── scan_for_signals() → same code as live
      ├── monitor_positions() → same code as live
      └── Hooks emit trade_open/trade_close SSE events
```

### ReplayDataProvider (new: `trading/replay_data_provider.py`)

Duck-typed replacement for `upstox_api`. Pre-loads all data via `market_data.fetch_candles()`.

| Method | Live Returns | Replay Returns |
|--------|-------------|----------------|
| `fetch_intraday_data_v3(symbol, interval)` | Today's candles via Upstox API | 1m candles sliced to `_replay_time`, resampled to requested interval |
| `fetch_historical_data_v3(symbol, unit, interval, from_date, to_date)` | Historical via Upstox API | Pre-loaded daily data (400 days) |

Both return `Optional[pd.DataFrame]` with columns `[open, high, low, close, volume, oi]`.
Time slicing via `get_current_time_fn` callback.

### Files Changed (8 files)

#### Wave 1: Foundation (independent, parallel)

**1. `trading/portfolio/portfolio_core.py`** — Accept optional timestamps
- `__init__(..., simulated_date=None)` — use for `day_start` (line 47)
- `open_position(..., entry_time=None)` — use provided or `datetime.now(config.IST)` (line 131)
- `close_position(..., exit_time=None)` — use provided or `datetime.now(config.IST)` (line 180)

**2. `trading/base_signals.py`** — Accept optional timestamp
- `create_signal(..., timestamp=None)` — use provided or `datetime.now(config.IST)` (line 70)

**3. `trading/orb_signals.py`** — Bug fix + timestamp kwarg
- Fix 4 bare `datetime.now()` → `datetime.now(config.IST)` (lines 235, 259, 292, 452)
- Add `**kwargs` to `check_exit()` signature
- Accept `timestamp` kwarg like SR/EMA already do

**4. `trading/replay_data_provider.py`** — New file
- Pre-loads all 1m candles + 400-day daily data via `market_data.fetch_candles()`
- `fetch_intraday_data_v3(symbol, interval)` — slices to sim time, resamples via `resample_candles()`
- `fetch_historical_data_v3(symbol, ...)` — returns pre-loaded daily data

#### Wave 2: Runner modifications (depends on Wave 1)

**5. `trading/runner_core.py`** — Clock + sleep injection
- Add `replay_mode`, `replay_date`, `_replay_time`, `_replay_on_event` to `__init__`
- Override `_ist_now()`: return `_replay_time` if set
- Add `_get_to_date()` → `self._ist_now()` (for runner_risk)
- Add `run_replay(symbols, strategy_filter, on_event)` method:
  1. Create ReplayDataProvider, assign to `self._data_fetcher`
  2. `_load_strategies()` from DB, filter by strategy
  3. Pre-compute overlays → emit SSE events
  4. Loop: advance `_replay_time` 1min at a time, call scan + monitor
  5. Emit summary + done

**6. `trading/runner_signals.py`** — 7 `datetime.now(IST)` → `self._ist_now()`
| Line | Context |
|------|---------|
| 67 | Cooldown check in `_scan_intraday_strategy()` |
| 209 | After intraday scan completes |
| 233 | Cooldown check in `_scan_swing_strategy()` |
| 279 | After swing scan completes |
| 375 | `entry_time` in `execute_signal()` |
| 470 | `days_in_position` in `monitor_positions()` |
| 555 | Cooldown set after close |

Plus replay hooks:
- `execute_signal()`: if replay_mode, emit `trade_open` SSE; skip DB persist + Telegram
- `monitor_positions()`: if replay_mode, emit `trade_close` SSE; skip journal/DB/Telegram

**7. `trading/runner_risk.py`** — 4 `datetime.now(IST)` → `self._get_to_date()`
| Line | Context |
|------|---------|
| 84 | `fetch_daily_data()` to_date |
| 85 | `fetch_daily_data()` from_date (400 days back) |
| 145 | `fetch_previous_day_data()` to_date |
| 146 | `fetch_previous_day_data()` from_date (10 days back) |

#### Wave 3: Integration

**8. `api/replay_api.py`** — Use MultiStrategyRunner instead of standalone replay
- Replace `_do_replay()` call with `runner.run_replay()`
- Keep same SSE streaming mechanism (asyncio.Queue + ThreadPoolExecutor)
- Keep same ReplayRequest model

**9. Cleanup**
- Delete `experiments/replay_trading_day.py`
- Update AGENTS.md Replay Trading section

### What Does NOT Change
- Signal generator logic — identical code path
- Risk manager — identical validation
- Frontend code — SSE event contract is identical (same 12 event types)
- `telegram_notifier.py` — calls skipped in replay, not modified
- Hardcoded filters (`day_change_pct > 2.0`, `0.8` loss multiplier) — same as live
- `monitor_positions()` SL/TP priority — SL checked before TP (matching live)

### Design Decisions
1. **Overlays pre-computed at start** — pivot_levels, 52w_high, ema_series emitted before main loop. or_levels emitted during first scan.
2. **DB persistence skipped** — `_persist_position_to_db()` returns early when `replay_mode`
3. **Telegram skipped** — `send_trade_entry()`/`send_trade_exit()` skipped in replay hooks
4. **Journal skipped** — `self.journal.log_trade()` and `save_journal()` skipped
5. **Same SL/TP check** — SL before TP, matching `monitor_positions()` lines 424-453
6. **No frontend changes** — all 12 SSE event types have identical payloads

---

## Phase 3 (Future, Not Planned Yet)

- Trend filter implementation (above_ema10, bullish_N) — researched but not implemented
- `day_change_pct > 2.0` ORB skip filter — could become configurable
- ADX/RSI thresholds for 52W Chaser — could become configurable
- Daily loss alert `0.8` multiplier — could become configurable

---

## Existing Bugs Found During Analysis

These should be fixed regardless of replay work:

1. **`orb_signals.py` — 3x `datetime.now()` without `config.IST`** (lines 235, 259, 452)
   - Creates naive datetime signals while rest of codebase uses timezone-aware
   - Fix: add `config.IST` argument

2. **`orb_signals.py:292` — `check_exit()` doesn't accept `timestamp` kwarg**
   - `sr_breakout_signals.py` and `ema_cross_signals.py` already support this
   - ORB's `check_exit()` uses `datetime.now()` directly — inconsistent with siblings

---

## Validation Checklist

After Phase 1 is built, verify:
- [x] Replay produces trades for ORB on a known active day
- [x] Replay SL/TP triggers match expected candle H/L values
- [x] Replay EOD exit closes all positions at correct time
- [x] Cooldown prevents re-entry after exit
- [x] Risk manager correctly rejects trades that exceed limits
- [x] `calculate_trading_costs()` produces same costs as live
- [ ] 52W strategies run once per day, not per candle
- [ ] Output matches backtest results closely (expected small differences due to different code paths)
- [x] All 5 strategies produce signals on appropriate days

After Phase 2 is built, verify:
- [ ] Runner completes a full day replay without errors
- [ ] Replay results match standalone replay results (same trades on same date)
- [ ] DB strategies are loaded (not hardcoded STRATEGY_CONFIGS)
- [ ] No changes to live (non-replay) behavior
- [ ] All 5 strategies produce signals
- [ ] Cooldown, risk validation, SL/TP behave identically to live

## Additional Improvements (completed beyond original plan)

- [x] **Frontend UI**: Replay page with chart (ECharts), trade log, per-strategy summary, query param sync
- [x] **Per-TF EMA**: Backend computes EMA for 1m/5m/15m/1h timeframes with historical seed data
- [x] **Overlay lines**: OR levels, pivot points (PP/R1/R2/S1/S2), 52W high, EMA — strategy-aware, with price labels
- [x] **Universal `fetch_candles()`**: `market_data/market_data.py` — single source of truth for Upstox V3 data
- [x] **SR Breakout R2/S2 TP**: Uses R2 as TP (with fallback to tp_pct), S2 for shorts
- [x] **Late-entry guard**: Blocks entries within 30 min of EOD exit (eliminates cost-only trades)
- [x] **min_rr_ratio UI**: Visible in Strategies table/form and Replay summary breakdown
- [x] **Alembic migration**: SR Breakout min_rr_ratio 2.0 → 1.0
- [x] **ORB Best params validated**: Parameter sweep across 13 days, current config (SL1.0/TP1.5) is optimal
- [x] **31 backend tests** for `fetch_candles`, `resample_candles`, `_compute_ema_per_tf`
- [x] **1305 frontend tests** passing, 0 lint errors
