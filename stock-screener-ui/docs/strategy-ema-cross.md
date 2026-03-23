# EMA Crossover Strategy

Intraday momentum strategy that generates long and short signals based on exponential moving average crossovers. Designed for 5-minute candle data on equity markets (NSE). The strategy enters when a fast EMA crosses above/below a slow EMA and manages positions with fixed stop-loss, take-profit, and end-of-day force exit.

**Strategy Type:** Intraday (5-min candles)
**Strategy ID:** `EMA_CROSS`
**Source:** `trading/ema_cross_signals.py`, `backtest/strategies/ema_cross.py`

---

## Parameters

| Parameter | Key | Default | Range | Description |
|-----------|-----|---------|-------|-------------|
| Fast EMA Period | `ema_fast_period` | `9` | 3–50 | Lookback period for the fast (responsive) EMA |
| Slow EMA Period | `ema_slow_period` | `21` | 10–200 | Lookback period for the slow (lagging) EMA |
| Stop Loss % | `sl_pct` | `0.5` | 0.1–3.0 | Percentage below/above entry for stop-loss |
| Take Profit % | `tp_pct` | `1.5` | 0.3–5.0 | Percentage above/below entry for take-profit |
| Candle Timeframe | `timeframe` | `5` | 1–60 | Candle interval in minutes |
| Trade Size | `trade_size` | `100` | 1–10000 | Number of shares per order |
| Enable Shorts | `enable_shorts` | `false` | bool | Allow short (SELL) entries on bearish crosses |
| Cooldown Bars | `cooldown_bars` | `3` | 1–20 | Number of bars to wait after exit before re-entry |
| Include Costs | `include_costs` | `true` | bool | Deduct brokerage/stamp duty/charges from P&L |

**Validation rules:**
- `ema_fast_period` must be strictly less than `ema_slow_period`
- `sl_pct` must be less than `tp_pct`
- All ranges enforced in `EMACrossStrategy.validate_params()`

---

## EMA Calculation

The Exponential Moving Average applies more weight to recent prices, making it more responsive than a simple moving average.

### Formula

```
multiplier = 2 / (period + 1)

EMA_0 = closes[0]                        # first value seeded with first close
EMA_t = close_t * multiplier + EMA_{t-1} * (1 - multiplier)
```

### Worked Example: 3-Period EMA

Given closes: `[100, 102, 105, 103, 108]`

```
multiplier = 2 / (3 + 1) = 0.5

EMA_0 = 100.00
EMA_1 = 102 * 0.5 + 100 * 0.5 = 51.0 + 50.0 = 101.00
EMA_2 = 105 * 0.5 + 101 * 0.5 = 52.5 + 50.5 = 103.00
EMA_3 = 103 * 0.5 + 103 * 0.5 = 51.5 + 51.5 = 103.00
EMA_4 = 108 * 0.5 + 103 * 0.5 = 54.0 + 51.5 = 105.50
```

The EMA reacts faster to the jump at close[4] (108) than an SMA would, because the multiplier weights the latest price at 50%.

---

## Entry Conditions

### Bullish (LONG)

```
fast_ema_prev  <=  slow_ema_prev
fast_ema_curr  >   slow_ema_curr
```

The fast EMA was at or below the slow EMA on the previous bar, and has moved above it on the current bar.

### Bearish (SHORT) — only when `enable_shorts = true`

```
fast_ema_prev  >=  slow_ema_prev
fast_ema_curr  <   slow_ema_curr
```

The fast EMA was at or above the slow EMA on the previous bar, and has dropped below it on the current bar.

### No Signal

When the fast EMA is already above the slow EMA (no new cross) or already below — no signal is generated. The strategy only fires on the **crossover bar itself**.

---

## Exit Conditions

| Exit Type | LONG Position | SHORT Position | Notes |
|-----------|---------------|----------------|-------|
| Stop Loss | `price <= entry * (1 - sl_pct/100)` | `price >= entry * (1 + sl_pct/100)` | Checked every bar |
| Take Profit | `price >= entry * (1 + tp_pct/100)` | `price <= entry * (1 - tp_pct/100)` | Checked every bar |
| EOD Force Exit | Always | Always | At 14:45 IST, all open positions are closed at market price |

### SL/TP Calculation Example

Entry at 1000 with `sl_pct=0.5`, `tp_pct=1.5`:

| Side | Stop Loss | Take Profit |
|------|-----------|-------------|
| LONG | 1000 * 0.995 = **995.00** | 1000 * 1.015 = **1015.00** |
| SHORT | 1000 * 1.005 = **1005.00** | 1000 * 0.985 = **985.00** |

---

## Crossover Detection

```mermaid
flowchart TD
    subgraph Input["Input: Two Consecutive Bars"]
        prev_bar["Previous Bar: ema_fast_prev, ema_slow_prev"]
        curr_bar["Current Bar: ema_fast_curr, ema_slow_curr"]
    end

    prev_bar --> compare{"Compare EMA values"}

    compare -->|"fast_prev <= slow_prev<br/>AND fast_curr > slow_curr"| bullish["🟢 Bullish Cross<br/>→ LONG signal"]
    compare -->|"fast_prev >= slow_prev<br/>AND fast_curr < slow_curr"| bearish["🔴 Bearish Cross<br/>→ SHORT signal"]
    compare -->|"No crossing condition met"| no_signal["⚪ No Cross<br/>fast EMA already above or below slow<br/>→ No signal"]

    subgraph Examples["Crossover Examples"]
        ex_bull["Bar 5: fast=100, slow=101<br/>Bar 6: fast=103, slow=102<br/>→ 100 <= 101 AND 103 > 102 ✓"]
        ex_bear["Bar 8: fast=105, slow=104<br/>Bar 9: fast=102, slow=103<br/>→ 105 >= 104 AND 102 < 103 ✓"]
        ex_none["Bar 3: fast=100, slow=99<br/>Bar 4: fast=101, slow=100<br/>→ fast was already above<br/>→ No cross ✗"]
    end

    bullish --- ex_bull
    bearish --- ex_bear
    no_signal --- ex_none
```

---

## Signal Generation Flow

```mermaid
flowchart TD
    subgraph Fetch["1. Data Fetch"]
        A["fetch_ema_data<br/>(intraday 5-min candles)"]
    end

    subgraph Compute["2. EMA Computation"]
        B["Build close price series"]
        C["Wait until<br/>len(closes) >= ema_slow_period"]
        B --> C
        C -->|Not enough data| SKIP["Skip bar"]
        C -->|Enough data| D["calculate_ema(closes, fast_period)<br/>calculate_ema(closes, slow_period)"]
    end

    subgraph Detect["3. Crossover Detection"]
        D --> E{"prev_ema values exist?"}
        E -->|No| F["Store as prev_ema<br/>Wait for next bar"]
        E -->|Yes| G{"Crossover detected?<br/>bullish OR bearish?"}
        G -->|No| H["Update prev_ema values<br/>Wait for next bar"]
        G -->|Yes| I{"Bearish AND shorts disabled?"}
        I -->|Yes| H
        I -->|No| J{"Cooldown active?<br/>bars_since_exit < cooldown_bars"}
    end

    subgraph Generate["4. Signal Generation"]
        J -->|Yes| H
        J -->|No| K["🟢 Generate LONG signal<br/>or 🔴 Generate SHORT signal<br/>with SL, TP, score"]
    end

    A --> B
```

---

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> NoPosition

    NoPosition --> EMAComputed : Receive bar<br/>Compute EMAs

    EMAComputed : Accumulate bars until<br/>len(closes) >= slow_period

    EMAComputed --> CrossoverDetected : Bullish or Bearish<br/>crossover on current bar

    CrossoverDetected --> InCooldown : Cooldown active<br/>Skip entry
    CrossoverDetected --> InPosition : Enter LONG or SHORT

    InCooldown --> NoPosition : After cooldown_bars<br/>bars have passed

    InPosition : Position open with<br/>SL & TP levels set

    InPosition --> Exited : SL hit
    InPosition --> Exited : TP hit
    InPosition --> Exited : EOD 14:45<br/>force exit

    Exited --> InCooldown : Record exit bar

    state InPosition {
        [*] --> Monitoring
        Monitoring --> SLHit : price <= SL<br/>or price >= SL
        Monitoring --> TPHit : price >= TP<br/>or price <= TP
        Monitoring --> EODExit : time >= 14:45 IST
    }
```

---

## Visual Example — Price Chart with EMA Crossovers

```mermaid
graph LR
    subgraph Price["Price Action + EMA Lines (conceptual)"]
        direction LR

        B1["Bar 1<br/>Close: 100<br/>EMA9: 100<br/>EMA21: 100"]
        B2["Bar 2<br/>Close: 101<br/>EMA9: 100.5<br/>EMA21: 100.05"]
        B3["Bar 3<br/>Close: 102<br/>EMA9: 101.25<br/>EMA21: 100.24"]
        B4["Bar 4<br/>Close: 104<br/>EMA9: 102.63<br/>EMA21: 100.62"]
        B5["Bar 5<br/>Close: 106<br/>EMA9: 104.31<br/>EMA21: 101.12"]
        B6["Bar 6<br/>Close: 105<br/>EMA9: 104.66<br/>EMA21: 101.42"]
        B7["Bar 7<br/>Close: 103<br/>EMA9: 103.83<br/>EMA21: 101.58"]
        B8["Bar 8<br/>Close: 101<br/>EMA9: 102.42<br/>EMA21: 101.55"]
        B9["Bar 9<br/>Close: 99<br/>EMA9: 100.71<br/>EMA21: 101.24"]
        B10["Bar 10<br/>Close: 98<br/>EMA9: 99.35<br/>EMA21: 100.83"]
    end

    B1 ---|"trend up"| B2
    B2 --- B3
    B3 --- B4
    B4 --- B5
    B5 ---|"⚡ EMA9 crossed above EMA21<br/>between Bar 4-5"| B6
    B6 --- B7
    B7 --- B8
    B8 --- B9
    B9 ---|"⚡ EMA9 crossed below EMA21<br/>between Bar 8-9"| B10

    subgraph Signals["Generated Signals"]
        S1["🟢 LONG @ Bar 5<br/>Entry: 106, SL: 105.47, TP: 107.59"]
        S2["🔴 SHORT @ Bar 9<br/>Entry: 99, SL: 99.50, TP: 97.52"]
    end

    B5 -.->|"bullish cross"| S1
    B9 -.->|"bearish cross"| S2
```

---

## Timing Diagram — Component Interaction

```mermaid
sequenceDiagram
    participant Runner as MultiStrategyRunner
    participant Fetcher as fetch_ema_data
    participant Generator as EMACrossSignalGenerator
    participant Portfolio as SharedPortfolioManager

    loop Every 5 minutes (market hours)
        Runner->>Fetcher: fetch_ema_data(symbol, timeframe=5)
        Fetcher-->>Runner: market_data<br/>{current_price, ema_fast_current,<br/>ema_fast_prev, ema_slow_current, ema_slow_prev}

        Runner->>Generator: check_entry(symbol, market_data)
        alt Bullish crossover detected
            Generator-->>Runner: LONG_ENTRY signal<br/>{price, stop_loss, take_profit}
            Runner->>Portfolio: place_order(symbol, BUY, qty)
            Portfolio-->>Runner: order confirmation
        else Bearish crossover detected
            Generator-->>Runner: SHORT_ENTRY signal<br/>{price, stop_loss, take_profit}
            Runner->>Portfolio: place_order(symbol, SELL, qty)
            Portfolio-->>Runner: order confirmation
        else No crossover
            Generator-->>Runner: null (no signal)
        end

        Note over Runner,Portfolio: If position is open...

        Runner->>Generator: check_exit(symbol, side,<br/>entry_price, sl, tp, current_price)
        alt SL or TP hit
            Generator-->>Runner: EXIT signal
            Runner->>Portfolio: close_position(symbol)
            Portfolio-->>Runner: position closed
        else EOD (14:45)
            Generator-->>Runner: EOD EXIT signal
            Runner->>Portfolio: close_position(symbol)
            Portfolio-->>Runner: position closed
        end
    end
```

---

## Risk Management

### Stop Loss

- **LONG:** `entry_price * (1 - sl_pct/100)` — triggers when price falls by `sl_pct`%
- **SHORT:** `entry_price * (1 + sl_pct/100)` — triggers when price rises by `sl_pct`%
- Checked on every bar's close price

### Take Profit

- **LONG:** `entry_price * (1 + tp_pct/100)` — triggers when price rises by `tp_pct`%
- **SHORT:** `entry_price * (1 - tp_pct/100)` — triggers when price falls by `tp_pct`%
- Checked on every bar's close price

### Risk-Reward Ratio

With defaults (`sl_pct=0.5`, `tp_pct=1.5`):

```
Risk : Reward = 0.5 : 1.5 = 1 : 3
```

### Cooldown After Exit

After any exit (SL, TP, or EOD), the strategy waits `cooldown_bars` (default: 3) consecutive bars before entering a new position. This prevents churning in volatile, sideways markets where EMA crossovers may fire repeatedly.

```
bars_since_exit = current_bar_number - last_exit_bar_number
if bars_since_exit < cooldown_bars:
    skip entry
```

### EOD Force Exit

All open positions are forcibly closed at **14:45 IST** to avoid overnight exposure. This is checked in both the live signal generator (`EMACrossSignalGenerator.check_exit`) and the backtest engine (`EMACrossNautilusStrategy.on_bar`).

### Trading Costs

When `include_costs=true`, the backtest deducts brokerage, STT, exchange charges, stamp duty, and GST via `calculate_trading_costs(entry_price, exit_price, quantity)`. Net P&L is:

```
net_pnl = gross_pnl - total_trading_costs
```

---

## Architecture

```mermaid
flowchart TB
    subgraph Live["Live Trading"]
        Runner["MultiStrategyRunner"]
        Runner --> Gen["EMACrossSignalGenerator<br/>trading/ema_cross_signals.py"]
        Gen --> Base["BaseSignalGenerator<br/>trading/base_signals.py"]
        Gen --> Signals["SignalType<br/>LONG_ENTRY / SHORT_ENTRY<br/>LONG_EXIT / SHORT_EXIT"]
        Runner --> Portfolio["SharedPortfolioManager<br/>Order execution & position tracking"]
    end

    subgraph Backtest["Backtest Engine"]
        API["EMACrossStrategy<br/>backtest/strategies/ema_cross.py<br/>API wrapper (BaseStrategy)"]
        API --> Runner2["run() → parallel Pool"]
        Runner2 --> Single["run_single_stock_backtest()"]
        Single --> Config["EMACrossConfig<br/>(StrategyConfig)"]
        Single --> Naut["EMACrossNautilusStrategy<br/>(NautilusTrader Strategy)"]
        Naut --> Engine["BacktestEngine<br/>(NautilusTrader)"]
        Naut --> Costs["calculate_trading_costs()"]
    end

    subgraph Shared["Shared Logic"]
        EMA["calculate_ema()<br/>multiplier = 2/(period+1)"]
        Cross["Crossover Detection<br/>bullish: fast_prev <= slow_prev AND fast_curr > slow_curr<br/>bearish: fast_prev >= slow_prev AND fast_curr < slow_curr"]
        Risk["Risk Management<br/>SL / TP / EOD 14:45 / Cooldown"]
    end

    Gen -.-> EMA
    Naut -.-> EMA
    Gen -.-> Cross
    Naut -.-> Cross
    Gen -.-> Risk
    Naut -.-> Risk

    subgraph Data["Data Sources"]
        Upstox["Upstox API<br/>Historical + Intraday candles"]
        Screener["TVScreenerUsage<br/>fetch_historical_data_v3<br/>fetch_intraday_data_v3"]
    end

    Screener --> Upstox
    Single --> Screener
    Runner --> Upstox
```

---

## Key Files

| File | Purpose |
|------|---------|
| `trading/ema_cross_signals.py` | Live signal generator — `EMACrossSignalGenerator` with `check_entry()` and `check_exit()` |
| `trading/base_signals.py` | Base class `BaseSignalGenerator` providing `create_signal()` and SL/TP defaults |
| `trading/orb_signals.py` | Shared `SignalType` enum and `ORBSignal` model |
| `backtest/strategies/ema_cross.py` | Backtest strategy — `EMACrossNautilusStrategy` (NautilusTrader), `EMACrossStrategy` (API wrapper), `EMACrossConfig` |
| `backtest/strategies/base.py` | `BaseStrategy` and `StrategyParam` definitions |
| `backtest/costs.py` | `calculate_trading_costs()` for brokerage and charges |
