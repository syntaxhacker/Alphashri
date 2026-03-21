# ORB - Opening Range Breakout Strategy

## Overview

ORB (Opening Range Breakout) is an intraday strategy that identifies the high and low of the first N minutes after market open (the "opening range"), then enters a position when price breaks out above or below that range. The strategy uses fixed percentage-based stop loss and take profit, with an end-of-day force exit to ensure no overnight exposure.

## Strategy Type

- **Type**: Intraday
- **Time-bound**: Yes — all positions are closed before market close
- **Directional**: Long by default, optional short
- **Market**: Indian equities (NSE), 5-minute timeframe
- **Entry window**: After OR period completes (e.g., after 10:00 AM IST) until 14:45 IST
- **Force exit**: 14:45 IST — all open positions closed

## Parameters

| Parameter | Key | Default | Range | Description |
|---|---|---|---|---|
| OR Period | `or_minutes` | 45 | 15–120 | Duration (minutes) of the opening range starting at 9:15 IST |
| Timeframe | `timeframe` | 5 | 1, 5, 15 | Candle interval in minutes for data and bar processing |
| Stop Loss % | `stop_loss_pct` / `sl_pct` | 0.4 | 0.1–2.0 | Fixed percentage SL from entry price |
| Take Profit % | `take_profit_pct` / `tp_pct` | 1.2 | 0.2–4.0 | Fixed percentage TP from entry price |
| Trade Size | `trade_size` | 100 | 1–5000 | Number of shares per trade |
| Min OR Range % | `min_or_range_pct` | 0.5 | — | Minimum opening range as % of price to generate signals |
| Max OR Range % | `max_or_range_pct` | 3.0 | — | Maximum opening range as % of price to generate signals |
| Cooldown Bars | `cooldown_bars` / `cooldown_minutes` | 3 | 0–20 | Bars (backtest) or minutes (live) to wait after exit before re-entry |
| Max Distance from OR % | `max_distance_from_or_pct` | 1.5 | — | Live-only filter: skip if price moved too far from OR level |
| Enable Shorts | `enable_shorts` | false | — | Allow short (SELL) entries on breakdown below OR low |

**Validation rules**:
- OR period must be at least 15 minutes
- Stop loss must be less than take profit
- Timeframe must be one of: 1, 5, 15

## Entry Conditions

### Long Entry

- Price closes **above OR high** after the OR period has completed
- OR range % must be within `[min_or_range_pct, max_or_range_pct]`
- Cooldown period must have elapsed since last exit
- Day change filter (live): day change from open must be <= 2.0%
- Price distance from OR (live): within `max_distance_from_or_pct`

```
Long SL  = entry_price * (1 - sl_pct / 100)
Long TP  = entry_price * (1 + tp_pct / 100)
```

### Short Entry (when enabled)

- Price closes **below OR low** after the OR period has completed
- OR range % must be within `[min_or_range_pct, max_or_range_pct]`
- Cooldown period must have elapsed since last exit
- Day change filter (live): day change from open must be <= 1.0% (avoids shorting in uptrend)

```
Short SL = entry_price * (1 + sl_pct / 100)
Short TP = entry_price * (1 - tp_pct / 100)
```

## Exit Conditions

| Condition | Description | Priority |
|---|---|---|
| **Take Profit** | PnL % >= `tp_pct` | 1 (checked first) |
| **Stop Loss** | PnL % <= `-sl_pct` | 2 |
| **EOD Force Exit** | Time >= 14:45 IST | 3 (non-negotiable) |

All exits are market orders. After exit, the cooldown timer starts before the same symbol can generate another signal.

## Flow Diagram

```mermaid
flowchart TD
    subgraph MarketOpen["Market Opens (9:15 IST)"]
        A(["9:15 AM - Start collecting OR candles"])
    end

    subgraph ORPhase["Opening Range Phase"]
        B["Accumulate candles within OR window"]
        B1{"Bar time < OR end?"}
        B2["Update OR high = max(all highs)"]
        B3["Update OR low = min(all lows)"]
    end

    subgraph ORComplete["OR Complete"]
        C{"OR period ended?"}
        D["OR levels defined"]
        D1{"OR range % within bounds?"}
        D2["Skip — range too narrow/wide"]
    end

    subgraph Watch["Watch for Breakout"]
        E{"Price > OR High?"}
        F{"Price < OR Low?"}
        G["No breakout — keep watching"]
    end

    subgraph Filters["Entry Filters (Live)"]
        H{"Cooldown elapsed?"}
        H1{"Day change filter OK?"}
        H2{"Max distance from OR OK?"}
    end

    subgraph Entry["Generate Signal"]
        I["Calculate SL & TP"]
        I1["LONG_ENTRY signal"]
        I2["SHORT_ENTRY signal"]
    end

    subgraph Position["In Position"]
        J{"Current time >= 14:45?"}
        K["EOD force exit"]
        L{"PnL >= TP %?"}
        M["TP exit"]
        N{"PnL <= -SL %?"}
        O["SL exit"]
        P["Hold — next bar"]
    end

    A --> B
    B --> B1
    B1 -- Yes --> B2 --> B3 --> B1
    B1 -- No --> C
    C -- Yes --> D
    D --> D1
    D1 -- No --> D2
    D1 -- Yes --> E
    E -- Yes --> H
    F -- Yes --> H
    E -- No --> F
    F -- No --> G --> E
    H -- No --> G
    H -- Yes --> H1
    H1 -- No --> G
    H1 -- Yes --> H2
    H2 -- No --> G
    H2 -- Yes --> I
    I --> I1
    I --> I2
    I1 --> J
    I2 --> J
    J -- Yes --> K
    J -- No --> L
    L -- Yes --> M
    L -- No --> N
    N -- Yes --> O
    N -- No --> P --> J
```

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> NoPosition : Market Open

    NoPosition --> WatchingOR : OR candles arriving

    WatchingOR --> WatchingOR : Update OR high/low
    WatchingOR --> ORDefined : OR period complete

    ORDefined --> ORDefined : Watching price
    ORDefined --> Skipped : OR range % out of bounds
    Skipped --> NoPosition : Next day reset

    ORDefined --> SignalGenerated : Price breaks OR high/low
    ORDefined --> NoPosition : Market close

    state "Entry Filters (Live)" as Filters {
        [*] --> CheckCooldown
        CheckCooldown --> CheckDayChange : Cooldown OK
        CheckDayChange --> CheckDistance : Day change OK
        CheckDistance --> [*] : All filters pass
        CheckCooldown --> NoSignal : Cooldown active
        CheckDayChange --> NoSignal : Day change too high
        CheckDistance --> NoSignal : Too far from OR
    }

    SignalGenerated --> InPosition : Order filled
    SignalGenerated --> NoSignal : Filter rejected

    InPosition --> InPosition : Monitor SL/TP each bar
    InPosition --> ExitedTP : PnL >= TP %
    InPosition --> ExitedSL : PnL <= -SL %
    InPosition --> ExitedEOD : Time >= 14:45

    ExitedTP --> Cooldown : Start cooldown
    ExitedSL --> Cooldown : Start cooldown
    ExitedEOD --> NoPosition : Day end

    Cooldown --> NoPosition : Cooldown elapsed / Next day
    NoSignal --> ORDefined : Next scan cycle
```

## Timing Diagram

```mermaid
sequenceDiagram
    participant MSR as MultiStrategyRunner
    participant OBB as ORBStockScreener
    participant OSG as ORBSignalGenerator
    participant SPM as SharedPortfolioManager

    loop Every Scan Interval
        MSR->>MSR: is_trading_hours()
        alt Outside trading hours
            MSR-->>MSR: Skip
        end

        loop For each symbol in watchlist
            MSR->>SPM: Check open positions
            alt Already in position
                MSR-->>MSR: Skip symbol
            else Check cooldown
                alt Cooldown active
                    MSR-->>MSR: Skip symbol
                end
            end

            MSR->>OBB: fetch_or_data(symbol)
            OBB-->>MSR: OR levels (high, low, range%, open, latest_price)

            MSR->>MSR: Validate OR range % bounds

            MSR->>OSG: check_breakout(symbol, price, or_levels)
            OSG->>OSG: current_price > or_high?
            OSG->>OSG: current_price < or_low?
            OSG->>OSG: Calculate SL/TP
            OSG-->>MSR: ORBSignal (LONG_ENTRY or SHORT_ENTRY or None)

            alt Signal generated
                MSR->>MSR: Day change filter
                MSR->>MSR: Max distance filter
                MSR->>SPM: Place order (signal)
                SPM-->>MSR: Order confirmed
                MSR-->>MSR: Log signal + update stats
            end
        end

        MSR-->>MSR: Return new_signals[]

        Note over MSR,SPM: Position Management Loop

        loop For each open position
            MSR->>OSG: check_exit(symbol, side, entry, SL, TP, price)
            OSG-->>MSR: Exit signal or None
            alt Exit triggered
                MSR->>SPM: Close position
                SPM-->>MSR: Position closed
                MSR->>MSR: Start cooldown timer
            end
        end
    end
```

## Risk Management

### Stop Loss & Take Profit

SL and TP are calculated as fixed percentages from entry price at the time of signal generation:

```
Long:
  SL = entry_price × (1 - sl_pct / 100)
  TP = entry_price × (1 + tp_pct / 100)

Short:
  SL = entry_price × (1 + sl_pct / 100)
  TP = entry_price × (1 - tp_pct / 100)
```

Default risk-reward ratio: `0.4% SL` / `1.2% TP` = **1:3 R:R**

### Max Distance from OR

Live-only filter (`max_distance_from_or_pct`, default 1.5%). If price has already moved too far from the OR breakout level by the time the scan runs, the signal is skipped to avoid chasing.

### Day Change Filters

Applied only in live trading to filter out unfavorable market conditions:

| Side | Condition | Threshold | Rationale |
|---|---|---|---|
| LONG | Day change % | > 2.0% | Stock already up significantly — risk of reversal |
| SHORT | Day change % | > 1.0% | Stock in uptrend — counter-trend short avoided |

```
day_change_pct = ((current_price - day_open) / day_open) × 100
```

### Cooldown Period

After any exit (SL, TP, or EOD), the strategy waits before generating a new signal for the same symbol:

- **Backtest**: `cooldown_bars` (default 3 bars) — number of candle bars to skip
- **Live**: `cooldown_minutes` (default 30 minutes) — wall-clock minutes to wait

### EOD Force Exit

All positions are force-closed at 14:45 IST (45 minutes before 15:30 market close) to eliminate overnight risk and closing volatility.

## Architecture

```mermaid
graph TD
    subgraph Frontend["Frontend (React)"]
        UI["Backtest UI\nStrategy Config"]
    end

    subgraph API["API Layer (FastAPI)"]
        BT["Backtest API\n/orb/run"]
        PT["Paper Trading API\n/orb/signals"]
    end

    subgraph Backtest["Backtest Engine"]
        ORBS["ORBStrategy\n(API wrapper)"]
        ORBN["ORBNautilusStrategy\n(Nautilus Trader)"]
        ORBC["ORBConfig"]
        PU["Parallel Worker Pool"]
    end

    subgraph LiveTrading["Live Trading"]
        MSR["MultiStrategyRunner"]
        OBB["ORBStockScreener"]
        SPM["SharedPortfolioManager"]
    end

    subgraph SignalGen["Signal Generation"]
        OSG["ORBSignalGenerator"]
        OS["ORBSignal\ndataclass"]
    end

    subgraph Data["Data Sources"]
        UP["Upstox API\n(Historical + Live)"]
        DB["SQLite / PostgreSQL"]
    end

    UI --> BT
    UI --> PT

    BT --> ORBS
    ORBS --> PU
    PU --> ORBN
    ORBC --> ORBN

    PT --> MSR
    MSR --> OBB
    MSR --> OSG
    MSR --> SPM

    OSG --> OS
    OBB --> UP
    ORBN --> UP
    SPM --> DB
    OSG --> DB

    UP -->|Historical data| ORBN
    UP -->|5-min candles| OBB
```

### Component Responsibilities

| Component | File | Role |
|---|---|---|
| `ORBStrategy` | `backtest/strategies/orb.py` | API-facing wrapper; defines params, validation, runs parallel backtests |
| `ORBNautilusStrategy` | `backtest/strategies/orb.py` | Nautilus Trader strategy; processes bars, manages OR levels, entries, exits |
| `ORBConfig` | `backtest/strategies/orb.py` | Pydantic config for Nautilus strategy (instrument, bar type, SL/TP, etc.) |
| `ORBSignalGenerator` | `trading/orb_signals.py` | Live signal generation; calculates OR levels from candles, checks breakouts, manages exits |
| `ORBStockScreener` | (via MultiStrategyRunner) | Fetches OR data (high, low, range%) for live symbols |
| `MultiStrategyRunner` | `trading/multi_strategy_runner.py` | Orchestrates live scanning loop; applies filters, delegates to signal generators, manages portfolio |
| `SharedPortfolioManager` | `trading/` | Tracks open positions, executes orders, manages cooldown timers |
| `create_entry_signal` | `trading/orb_signals.py` | Convenience function to manually construct an ORB signal |
