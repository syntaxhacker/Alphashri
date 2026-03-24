# Faster Backtesting Plan

> A detailed plan to replace NautilusTrader with a loop-based backtester and add a VectorBT screening endpoint. Zero impact on paper trading.

---

## Current Architecture: Where NautilusTrader Sits

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ALPHASHRI SYSTEM MAP                         │
│                                                                         │
│  API ENDPOINTS                                                           │
│  ═════════════                                                           │
│                                                                         │
│  POST /api/backtest/run                                                  │
│  ├── Uses: NautilusTrader BacktestEngine                                 │
│  ├── Speed: ~600ms for 5 stocks                                          │
│  ├── Accuracy: High (bar-by-bar, close-based TP/SL)                     │
│  └── THIS IS THE ONLY THING USING NAUTILUSTRADER                         │
│                                                                         │
│  GET /api/screener                                                        │
│  ├── Uses: Custom trending_upside module                                 │
│  ├── Speed: ~50ms (Redis cached, 300s TTL)                             │
│  └── Does NOT run backtests. Just filters stocks by technicals.          │
│                                                                         │
│  GET /api/paper/signals                                                  │
│  ├── Uses: ORBStockScreener.screen()                                    │
│  ├── Speed: Depends on Upstox API call                                 │
│  └── Quick signal scan, NOT a backtest                                  │
│                                                                         │
│  POST /api/paper/bot/start                                               │
│  ├── Uses: Custom PaperTrader + custom signal generators                   │
│  ├── Speed: Upstox API bound (60s poll loop)                            │
│  └── ZERO NautilusTrader dependency                                     │
│                                                                         │
│  POST /api/bots/{id}/start                                               │
│  ├── Uses: Custom signal generators + SharedPortfolioManager             │
│  ├── Speed: Upstox API bound (60s poll loop)                            │
│  └── ZERO NautilusTrader dependency                                     │
│                                                                         │
│  ══════════════════════════════════════════════════════════════════════  │
│                                                                         │
│  CODE DEPENDENCIES                                                       │
│  ══════════════                                                       │
│                                                                         │
│  Files that import NautilusTrader (13 files):                            │
│  ├── backtest/strategies/orb.py          (864 lines)  ← CORE            │
│  ├── backtest/strategies/ema_cross.py     (652 lines)  ← CORE            │
│  ├── backtest/strategies/sr_breakout.py   (796 lines)  ← CORE            │
│  ├── backtest/strategies/week52_chaser.py  (813 lines)  ← CORE            │
│  ├── backtest/strategies/week52_target.py  (646 lines)  ← CORE            │
│  ├── tests/ (6 test files)                                      ← TESTS   │
│  ├── tests/integration/conftest.py (mocks 18 NT modules)        ← TESTS   │
│  └── profile_phases.py (standalone script)                   ← SCRIPT   │
│                                                                         │
│  Files that DO NOT touch NautilusTrader:                                  │
│  ├── trading/ (ALL 14 files — paper trader, risk, journal, signals)       │
│  ├── api/ (ALL route modules — except strategies router import check)       │
│  ├── backtest/engine.py (thin wrapper, no NT imports)                    │
│  ├── backtest/api.py (request handler, no NT imports)                    │
│  ├── backtest/strategies/base.py (abstract class, no NT imports)          │
│  ├── backtest/strategies/__init__.py (registry, no NT imports)           │
│  ├── backtest/costs.py (pure math, no NT imports)                        │
│  ├── backtest/chart_data.py (pandas, no NT imports)                      │
│  ├── backtest/utils.py (Upstox client, no NT imports)                    │
│  ├── db/ (all models, no NT imports)                                     │
│  ├── cache/ (Redis, no NT imports)                                      │
│  ├── services/ (all, no NT imports)                                      │
│  ├── run_daily_trading.py (subprocess, no NT imports)                    │
│  └── src/ (entire React frontend, obviously no NT)                        │
│                                                                         │
│  Paper trading has DUPLICATE strategy implementations:                      │
│  ├── trading/orb_signals.py          (NOT backtest/strategies/orb.py)     │
│  ├── trading/ema_cross_signals.py   (NOT backtest/strategies/ema_cross.py)│
│  ├── trading/sr_breakout_signals.py(NOT backtest/strategies/sr_breakout)│
│  ├── trading/week52_chaser_signals.py (NOT backtest/strategies/52w)    │
│  └── trading/week52_target_signals.py (NOT backtest/strategies/52w)    │
│                                                                         │
│  These two systems share ONLY:                                           │
│  ├── Database config (StrategyConfig model)                              │
│  └── Journal (TradeJournal for logging)                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## What NautilusTrader Actually Does Here (The Wasteful Part)

For each stock, the current flow is:

```
STEP 1: FETCH DATA from Upstox API (~200ms network I/O)
         |
STEP 2: CONVERT DataFrame to Nautilus Bar objects (~7ms)
         |   BarDataWrangler.process(df) converts pandas to Nautilus types
         |   This is needed because NautilusTrader requires its own Bar class
         |
STEP 3: CREATE NautilusTrader BacktestEngine (~29ms)
         |   engine = BacktestEngine(config=BacktestEngineConfig(...))
         |   engine.add_venue(...)     <-- register simulated exchange
         |   engine.add_instrument(...) <-- register stock
         |   engine.add_data(bars)   <-- load bar data
         |   engine.sort_data()     <-- sort all bars by timestamp
         |   engine.add_strategy(...) <-- attach strategy class
         |
STEP 4: RUN engine.run() (~83ms)
         |   NautilusTrader's internal event loop:
         |   |-- For each bar (20,000 bars):
         |   |   |-- Update simulated order book
         |   |   |-- Check if any orders match
         |   |   |-- Fill matching orders
         |   |   |-- Call strategy.on_bar(bar)  <-- YOUR LOGIC HERE
         |   |   |-- Run simulation modules
         |   |   '-- Check timers
         |   '-- Total: NautilusTrader overhead dominates
         |       Your on_bar() logic: ~0.1ms per stock
         |       NautilusTrader dispatch: ~83ms per stock
         |       Ratio: 830:1 overhead to actual work
         |
STEP 5: DISPOSE engine (~29ms)
         |   engine.dispose()
         |   Free up internal state, caches, message bus
         |
STEP 6: BUILD RESULT dict (~6ms)
         |   Collect trades, compute PnL, format output
         '-- Return {symbol, trades, result, candles, trade_list}

Total per stock: ~150ms (of which ~120ms is NautilusTrader overhead)
Total for 5 stocks: ~600ms (with multiprocessing: ~150ms on 4 cores)
```

**The key insight**: NautilusTrader is a battleship for a fishing trip. It has:

- Order book simulation (L2/L3 depth) -- we use bar data only
- Fill models with slippage probability -- we use instant market fills
- Queue position tracking -- we track positions ourselves in Python
- Message bus between components -- single-threaded, adds latency
- Cache system -- we build our own result dict anyway

We use maybe 5% of NautilusTrader's features. The other 95% is overhead.

---

## Why Not VectorBT for the Main Backtest

VectorBT checks TP/SL on bar **high/low** (simulating intrabar stop execution). Your ORB strategy checks only on bar **close**. This produces materially different results:

```
Scenario: Entry at 100, SL at 98, TP at 103
Bar data: open=100.5, high=97.5, low=96.0, close=101.0

CURRENT (NautilusTrader / loop-based):
  close 101.0 > 98 --> SL not hit
  close 101.0 < 103 --> TP not hit
  Result: HOLD

VectorBT (from_signals with stop_loss/take_profit):
  low 97.5 < 98 --> SL TRIGGERED on intrabar wick
  Result: EXIT with loss
```

VectorBT will show more stop-loss exits and fewer wins because it reacts to wicks that the current strategy ignores. Trade count, win rate, and PnL would all change.

This is acceptable for **screening** (finding promising candidates) but NOT for **verification** (the final accurate check the user trusts).

---

## Plan: Replace NautilusTrader with a Loop-Based Backtester

### What It Is

Instead of converting DataFrames to Nautilus Bar objects and running through a full trading engine simulation, just iterate over the DataFrame rows directly:

```
CURRENT (NautilusTrader):
─────────────────────────
df -> BarDataWrangler -> List[Bar] -> BacktestEngine -> on_bar() -> trades
         ~7ms              ~1ms         ~29ms init     ~83ms run    ~6ms

PROPOSED (loop-based):
─────────────────────
df -> for row in df.itertuples() -> same logic -> trades
              ~0ms                 ~0.1ms      ~0ms
```

### Why This Works

The strategies already do most of the work themselves. Look at what `on_bar()` actually does:

```python
def on_bar(self, bar):
    # 1. Extract data from bar object (Nautilus FFI call)
    ist_sec = (bar.ts_event + 19800000000000) // 1000000000
    cur_min = (ist_sec % 86400) // 60
    close_f = float(bar.close)   # FFI call
    high_f = float(bar.high)     # FFI call
    low_f = float(bar.low)       # FFI call

    # 2. Check time-of-day conditions
    if cur_min < or_end: ...

    # 3. Check entry/exit conditions
    if close_f > self._or_high: ...

    # 4. Track state (position_side, entry_price, etc.)
    self._position_side = "LONG"

    # 5. "Place order" (actually just updates internal state)
    self.submit_order(order)   # In backtest, this just updates cache
```

Steps 1-4 are pure Python operations on numbers. Step 5 in backtest mode just updates an in-memory cache -- there is no real exchange, no order matching, no other participant.

All of this can work on a plain pandas DataFrame row instead of a Nautilus Bar object.

### The Implementation Pattern (orb.py example)

```python
# backtest/strategies/orb.py (AFTER changes)

# REMOVED:
# from nautilus_trader.backtest.config import BacktestEngineConfig
# from nautilus_trader.backtest.engine import BacktestEngine
# from nautilus_trader.trading.strategy import Strategy
# from nautilus_trader.config import StrategyConfig
# from nautilus_trader.model.objects import Price, Quantity
# (all other nautilus_trader imports)

# KEPT:
from datetime import datetime
import numpy as np
import pandas as pd
from .base import BaseStrategy, StrategyParam
from ..costs import calculate_total_cost

# REMOVED: ORBNautilusStrategy class (Nautilus Strategy subclass)
# REMOVED: ORBConfig class (Nautilus StrategyConfig subclass)
# KEPT: ORBStrategy class (BaseStrategy subclass) -- run(), get_visuals(), etc.


def _compute_or_levels(df, or_minutes):
    """Vectorized opening range computation. Runs once per DataFrame."""
    ist_offset_ns = 19_800_000_000_000
    ist_sec = (df.index.values.astype(np.int64) + ist_offset_ns) // 1_000_000_000
    minute_of_day = (ist_sec % 86400) // 60
    day_number = ist_sec // 86400

    mkt_open = 9 * 60 + 15
    or_end = mkt_open + or_minutes

    or_high = pd.Series(np.nan, index=df.index)
    or_low = pd.Series(np.nan, index=df.index)
    for day in np.unique(day_number):
        mask = (day_number == day) & (minute_of_day >= mkt_open) & (minute_of_day < or_end)
        if mask.any():
            or_high[mask] = df["high"].loc[mask].expanding().max()
            or_low[mask] = df["low"].loc[mask].expanding().min()

    return or_high.ffill(), or_low.ffill(), ist_sec


def run_single_stock_backtest(args):
    """Run backtest for a single stock using direct DataFrame iteration."""
    symbol, params, days, access_token = args

    # STEP 1: Fetch data (unchanged -- this is Upstox API, not NautilusTrader)
    df = fetch_historical_data(symbol, days)
    if df is None:
        return {"symbol": symbol, "success": False, "error": "No data"}

    # STEP 2: Compute OR levels (vectorized, runs ONCE for entire DataFrame)
    or_high, or_low, ist_sec = _compute_or_levels(df, int(params.get("or_minutes", 45)))

    # STEP 3: Run strategy logic row-by-row (replaces NautilusTrader engine)
    trades = []
    position_side = None
    entry_price = None
    entry_ist_sec = 0
    bar_number = 0
    last_exit_bar = -999
    position_peak = None
    position_low = None
    cooldown = int(params.get("cooldown_bars", 3))
    sl_pct = float(params.get("stop_loss_pct", 0.4))
    tp_pct = float(params.get("take_profit_pct", 1.2))
    enable_shorts = bool(params.get("enable_shorts", False))

    or_minutes_val = int(params.get("or_minutes", 45))
    mkt_open = 9 * 60 + 15
    or_end_val = mkt_open + or_minutes_val
    eod_min = 14 * 60 + 45

    for i in range(len(df)):
        cur_min = (ist_sec[i] % 86400) // 60
        close_f = df["close"].iloc[i]
        high_f = df["high"].iloc[i]
        low_f = df["low"].iloc[i]
        bar_number += 1

        if cur_min >= eod_min:
            if position_side is not None:
                trades.append(_make_trade(
                    position_side, entry_price, close_f, entry_ist_sec, ist_sec[i],
                    "EOD", position_peak, position_low, or_high.iloc[i], or_low.iloc[i],
                ))
                position_side = None
                entry_price = None
                last_exit_bar = bar_number
                position_peak = None
                position_low = None
            continue

        if cur_min < or_end_val:
            continue

        if position_side is not None:
            if position_side == "LONG":
                pnl_pct = ((close_f - entry_price) / entry_price) * 100
            else:
                pnl_pct = ((entry_price - close_f) / entry_price) * 100

            position_peak = max(position_peak, high_f)
            position_low = min(position_low, low_f)

            if pnl_pct >= tp_pct or pnl_pct <= -sl_pct:
                reason = "TP" if pnl_pct >= tp_pct else "SL"
                trades.append(_make_trade(
                    position_side, entry_price, close_f, entry_ist_sec, ist_sec[i],
                    reason, position_peak, position_low, or_high.iloc[i], or_low.iloc[i],
                ))
                position_side = None
                entry_price = None
                last_exit_bar = bar_number
                position_peak = None
                position_low = None
        else:
            if (bar_number - last_exit_bar) < cooldown:
                continue
            if enable_shorts and close_f < or_low.iloc[i]:
                position_side = "SHORT"
                entry_price = close_f
                entry_ist_sec = ist_sec[i]
                position_peak = close_f
                position_low = close_f
            elif close_f > or_high.iloc[i]:
                position_side = "LONG"
                entry_price = close_f
                entry_ist_sec = ist_sec[i]
                position_peak = close_f
                position_low = close_f

    # STEP 4: Build result dict (unchanged format)
    return _build_result(symbol, trades, df, bool(params.get("include_costs", True)))
```

### Speed Comparison

```
                    CURRENT          PROPOSED          SPEEDUP
                    (NautilusTrader)  (loop-based)

Per stock:
  Data fetch            ~200ms            ~200ms            1x (network I/O)
  Data conversion       ~7ms              ~0ms             eliminated
  Engine init           ~29ms             ~0ms             eliminated
  Strategy execution    ~0.1ms            ~0.1ms           1x (same logic)
  Engine dispatch      ~83ms             ~0ms             eliminated
  Engine dispose        ~29ms             ~0ms             eliminated
  OR computation       ~0.5ms            ~2ms             0.25x (vectorized)
  Result building       ~6ms              ~6ms             1x
                    ------            ------
                    ~355ms            ~208ms            1.7x

5 stocks sequential:
  Current:             ~600ms
  Proposed:             ~200ms (data fetch) + 10ms (strategy) = ~210ms
  Speedup:              ~2.9x

5 stocks with multiprocessing (4 cores):
  Current:             ~150ms
  Proposed:             ~60ms (data fetch in parallel) + 3ms = ~63ms
  Speedup:              ~2.4x

LOCAL TESTING (mocked data, like autoresearch.sh):
  Current:             ~600ms (all NT overhead)
  Proposed:             ~10ms (just computation)
  Speedup:              ~60x
```

Note: The real-world speedup is smaller because Upstox API data fetching dominates (200ms per stock is network I/O, not computation). But for local testing, benchmarking, and CI, the speedup is dramatic.

### What Stays the Same

The **entire output format is unchanged**:

- Same 18-field trade dict (entry_price, exit_price, side, or_high, or_low, peak_price, low_price, etc.)
- Same result dict (trades, wins, losses, win_rate, gross_pnl, net_pnl, pf, tp_exits, sl_exits, eod_exits)
- Same candle dict format
- Same aggregated totals format
- Same progress callback mechanism
- Same Redis caching (same cache key format)
- Same journal logging

The **API layer is unchanged**:

- `POST /api/backtest/run` works identically
- Frontend gets the same JSON response
- Chart data, trade history table, performance stats -- all identical

The **BaseStrategy interface is unchanged**:

- `run(symbols, days, params, progress_callback) -> Dict`
- `get_visuals(trades, params) -> List[Dict]`
- `validate_params(params) -> List[str]`

**Multiprocessing works the same way**:

- `Pool(processes=min(4, cpu_count()))` with `imap_unordered`
- Each worker calls `run_single_stock_backtest(args)`
- Workers do not need NautilusTrader installed

### What Changes

Only the **internal implementation** of `run_single_stock_backtest()` in each of the 5 strategy files:

| File | What Changes | What Stays |
|------|-------------|------------|
| `orb.py` | `run_single_stock_backtest()` | `ORBStrategy.run()`, `_build_result()`, `get_visuals()`, all imports except NT |
| `ema_cross.py` | `run_single_stock_backtest()` | Same pattern |
| `sr_breakout.py` | `run_single_stock_backtest()` | Same pattern |
| `week52_chaser.py` | `run_single_stock_backtest()` | Same pattern |
| `week52_target.py` | `run_single_stock_backtest()` | Same pattern |

### What Gets Removed

- `from nautilus_trader.*` imports in strategy files
- `BacktestEngine`, `BacktestEngineConfig` usage
- `BarDataWrangler.process()` calls
- `Equity`, `InstrumentId`, `BarType`, `Venue`, `TraderId`, `INR`, `Price`, `Quantity` usage
- `ORBNautilusStrategy` class (the Nautilus Strategy subclass)
- `ORBConfig` class (the Nautilus StrategyConfig subclass)
- `submit_order()`, `close_all_positions()`, `cache.positions_open()` calls
- The `run_batch_backtest()` function in orb.py (batch engine mode)

### What Gets Added

- `import numpy as np` and `import pandas as pd` (already available, no new deps)
- Vectorized OR computation (groupby + expanding max/min) -- runs once per DataFrame instead of per-bar
- Direct DataFrame row iteration instead of Nautilus bar iteration
- The strategy logic moves from `on_bar()` method to a plain function

### Additional Optimization: Vectorized OR Computation

The current ORB strategy computes opening ranges inside `on_bar()`, one bar at a time:

```python
# CURRENT: per-bar OR computation (runs 20,000 times per stock)
if cur_min < or_end:
    if self._or_high is None:
        self._or_high = high_f
        self._or_low = low_f
    else:
        self._or_high = max(self._or_high, high_f)
        self._or_low = min(self._or_low, low_f)
```

The proposed approach computes OR levels **once** for the entire DataFrame using pandas vectorized operations:

```python
# PROPOSED: vectorized OR computation (runs ONCE per stock)
or_high = pd.Series(np.nan, index=df.index)
or_low = pd.Series(np.nan, index=df.index)
for day in np.unique(day_number):
    mask = (day_number == day) & (minute_of_day >= mkt_open) & (minute_of_day < or_end)
    if mask.any():
        or_high[mask] = df["high"].loc[mask].expanding().max()
        or_low[mask] = df["low"].loc[mask].expanding().min()
or_high = or_high.ffill()
or_low = or_low.ffill()
```

Then in the loop, just look up the pre-computed value:

```python
# In the loop: just a dict/array lookup (O(1))
current_or_high = or_high.iloc[i]
current_or_low = or_low.iloc[i]
```

---

## Plan: Add VectorBT Screening Endpoint

### What It Does

A new `POST /api/backtest/screen` endpoint that uses VectorBT for ultra-fast parameter sweeps. This is for the "I want to test 500 stocks with 20 parameter combinations" use case.

### How It Differs from Current Backtest

```
POST /api/backtest/run (EXISTING -- stays as-is after loop-based replacement)
|-- Purpose: Accurate backtest for 5-10 stocks
|-- Speed: ~210ms for 5 stocks
|-- Accuracy: High (close-based TP/SL, exact match)
|-- Output: Full trade details, chart data, journal logging
'-- Use case: "I picked my stocks, now verify the strategy"

POST /api/backtest/screen (NEW)
|-- Purpose: Rough screening of 100-500 stocks
|-- Speed: ~2 seconds for 500 stocks x 20 params = 10,000 backtests
|-- Accuracy: Good (but VectorBT checks TP/SL on high/low, not close)
|-- Output: Ranked list of (symbol, params, sharpe, return, max_drawdown)
'-- Use case: "Which stocks and parameters look promising?"
```

### The TP/SL Behavioral Difference (Why Screening Is Different)

```
Scenario: Entry at 100, SL at 98, TP at 103
Bar data: open=100.5, high=97.5, low=96.0, close=101.0

CURRENT (NautilusTrader / loop-based):
  close 101.0 > 98 --> SL not hit
  close 101.0 < 103 --> TP not hit
  Result: HOLD

VectorBT (from_signals with stop_loss/take_profit):
  low 97.5 < 98 --> SL TRIGGERED on intrabar wick
  Result: EXIT with loss

This means VectorBT will show:
  - More stop-loss exits (reacts to wicks)
  - Fewer winning trades (some winners turn into losers due to wick SL hits)
  - Lower win rate but potentially better risk management
  - Trade COUNT will differ
```

This is acceptable for **screening** (finding promising candidates) but NOT for **verification** (the final accurate check).

### The Screening Workflow

```
USER CLICKS "SCREEN" (500 stocks, 20 parameter combos)
                    |
                    v
POST /api/backtest/screen
|-- Input: symbols=[500 stocks], params_grid={or_minutes: [15,30,45,60],
|                                         tp_pct: [0.8,1.0,1.2,1.5],
|                                         sl_pct: [0.3,0.4,0.5]}
|-- VectorBT processes ALL stocks in one DataFrame call
|-- Returns: Top 50 (symbol, params, sharpe, total_return) sorted by sharpe
'-- Time: ~2 seconds

USER CLICKS "BACKTEST" on top 5 results
                    |
                    v
POST /api/backtest/run
|-- Input: symbols=[top 5], params=[best params per stock]
|-- Loop-based backtester with exact close-based TP/SL
|-- Returns: Full trade details, chart data, journal logging
'-- Time: ~210ms
```

---

## Impact on Paper Trading

**None. Zero. Zilch.**

The paper trading system has its own signal generators (`trading/orb_signals.py`, etc.) and its own execution engine (`trading/paper_trader.py`). It does not import, call, or reference any backtest code.

Removing or replacing NautilusTrader in the backtest layer has **zero impact** on:

- Paper trading order execution
- Paper trading signal generation
- Paper trading risk management
- Paper trading position tracking
- Paper trading journal logging
- Paper trading portfolio management
- Multi-strategy bot runner
- Any live trading functionality

The two systems are completely separate parallel tracks that share only database configuration and journal logging.

---

## Implementation Steps

### Phase 1: Loop-Based Backtester (Replace NautilusTrader in POST /api/backtest/run)

**Effort**: ~2-3 days
**Risk**: Low (same output format, easy to verify)
**Speed gain**: ~3x for API calls, ~60x for local/mock data

1. Create `backtest/strategies/runner.py` -- shared helper for common loop-based patterns
2. Rewrite `run_single_stock_backtest()` in `orb.py` using loop-based approach
3. Rewrite `run_single_stock_backtest()` in `ema_cross.py`
4. Rewrite `run_single_stock_backtest()` in `sr_breakout.py`
5. Rewrite `run_single_stock_backtest()` in `week52_chaser.py`
6. Rewrite `run_single_stock_backtest()` in `week52_target.py`
7. Remove NautilusTrader-specific classes (NautilusStrategy, Config) from each file
8. Update `tests/strategy_test_helpers.py` to remove Nautilus types
9. Update integration test mocks (remove NT module mocks)
10. Remove or update `profile_phases.py`
11. Run full test suite to verify identical output
12. Remove `nautilus_trader` from `api/requirements.txt`

**Verification**: Run both old and new implementations on same data, compare trade lists. Trade count, PnL, and win rate should be identical.

### Phase 2: VectorBT Screening Endpoint (New POST /api/backtest/screen)

**Effort**: ~1-2 days
**Risk**: Low (new endpoint, does not touch existing code)
**Speed gain**: Enables 500-stock parameter sweeps that were not practical before

1. Add `vectorbt` to `api/requirements.txt`
2. Create `backtest/screening.py` -- VectorBT-based screening logic
3. Create `api/screening_routes.py` -- new FastAPI router
4. Register router in `api_server_fastapi.py`
5. Add frontend "Screen" button (optional, can be done later)
6. Write tests for screening endpoint

**Verification**: Compare screening results with accurate backtest results on top 5 picks. Accept that VectorBT shows ~5-15% fewer trades due to intrabar SL differences.

### Phase 3: Cleanup (Optional)

**Effort**: ~0.5 days
**Risk**: Very low

1. Remove `try/except` NautilusTrader import check in `api_server_fastapi.py`
2. Clean up integration test mocks
3. Update `AGENTS.md` if needed

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Different trade count | Very Low | High | Run comparison tests before deploying |
| Different PnL | Very Low | High | Same comparison tests |
| Missing trade field | Low | Medium | Type-check against existing tests |
| Performance regression | Low | Low | Benchmark before/after |
| Breaking paper trading | Impossible | N/A | Paper trading has zero NT dependency |
| Breaking journal | Very Low | Low | Journal format is string-based, not NT-typed |

---

## Summary

| What | Current | After Phase 1 | After Phase 2 |
|------|---------|---------------|---------------|
| Backtest speed (5 stocks) | 600ms | ~210ms (3x) | N/A |
| Backtest speed (mock data) | 600ms | ~10ms (60x) | N/A |
| Screening (500 stocks x 20 params) | Not practical | Not practical | ~2 seconds |
| Accuracy (TP/SL) | Close-based | Close-based (same) | High/Low-based (different) |
| Dependencies | NautilusTrader (~50MB) | pandas + numpy (already installed) | + VectorBT (~30MB) |
| Paper trading | Unaffected | Unaffected | Unaffected |
| API changes | None | None | New endpoint added |
| Frontend changes | None | None | New screen button (optional) |
