# Trading Strategies Overview

## Architecture Overview

The multi-strategy system runs multiple trading strategies concurrently from a single bot instance. A `SharedPortfolioManager` holds a unified capital pool, while each strategy receives a proportional allocation. The `MultiStrategyRunner` orchestrates scanning, signal generation, risk validation, and position monitoring in a continuous loop during market hours.

Strategies are classified into two categories — **Intraday** (enter and exit within the same trading day) and **Swing** (hold positions across multiple days). Each category shares scanning cadence, candle timeframe, and exit semantics, but differs in risk parameters and position duration.

## Strategy Classification

```mermaid
graph TD
    A[Trading Strategies] --> B[Intraday Strategies]
    A --> C[Swing Strategies]

    B --> B1[ORB]
    B --> B2[SR_BREAKOUT]
    B --> B3[EMA_CROSS]

    C --> C1[52W_CHASER]
    C --> C2[52W_TARGET]

    subgraph Intraday
        direction LR
        B1
        B2
        B3
    end

    subgraph Swing
        direction LR
        C1
        C2
    end

    style Intraday fill:#e1f5fe,stroke:#0277bd
    style Swing fill:#f3e5f5,stroke:#7b1fa2
```

| Category | Scan Cadence | Candle Timeframe | Exit Policy |
|----------|-------------|-----------------|-------------|
| Intraday | Every cycle (~1 min) | 5-minute | EOD forced exit |
| Swing | Every 30 cycles (~30 min) | Daily | Multi-day hold |

## Strategy Comparison Table

| Strategy | Type | Direction | Entry Logic | Default SL | Default TP | Timeframe | Key Feature |
|----------|------|-----------|-------------|------------|------------|-----------|-------------|
| ORB | Intraday | Long + Short | Opening Range breakout | 0.4% | 1.2% | 5 min | Opening range detection |
| SR_BREAKOUT | Intraday | Long + Short | Pivot breakout | 0.5% | 1.5% | Daily → Intraday | Support/Resistance levels |
| EMA_CROSS | Intraday | Long + Short | EMA crossover | 0.5% | 1.5% | 5 min | Trend following |
| 52W_CHASER | Swing | Long Only | 52-week high proximity | 3% | 5% | Daily | Optional trailing stop |
| 52W_TARGET | Swing | Long Only | 52-week high proximity | 2% | None (trailing) | Daily | Always-on trailing stop |

## Signal Generator Hierarchy

All signal generators inherit from `BaseSignalGenerator`, which defines the contract via two abstract methods: `check_entry` and `check_exit`. Each concrete generator implements strategy-specific logic and shares the `ORBSignal` data class for uniform signal representation.

```mermaid
classDiagram
    class BaseSignalGenerator {
        <<abstract>>
        +str strategy_type
        +float sl_pct
        +float tp_pct
        +check_entry(symbol, market_data) ORBSignal*
        +check_exit(symbol, position_side, entry_price, stop_loss, take_profit, current_price, **kwargs) ORBSignal*
        +create_signal(symbol, signal_type, price, stop_loss, take_profit, notes, **extra_fields) ORBSignal
    }

    class ORBSignal {
        +str symbol
        +SignalType signal_type
        +float price
        +float stop_loss
        +float take_profit
        +float or_high
        +float or_low
        +float or_range
        +float or_range_pct
        +datetime timestamp
        +float atr_pct
        +float adx
        +float rsi
        +float score
        +str notes
    }

    class SignalType {
        <<enumeration>>
        BUY
        SELL
        EXIT
    }

    class ORBSignalGenerator {
        +check_entry(symbol, market_data) ORBSignal
        +check_exit(symbol, ...) ORBSignal
    }

    class SRBreakoutSignalGenerator {
        +check_entry(symbol, market_data) ORBSignal
        +check_exit(symbol, ...) ORBSignal
    }

    class EMACrossSignalGenerator {
        +check_entry(symbol, market_data) ORBSignal
        +check_exit(symbol, ...) ORBSignal
    }

    class Week52ChaserSignalGenerator {
        +check_entry(symbol, market_data) ORBSignal
        +check_exit(symbol, ...) ORBSignal
    }

    class Week52TargetSignalGenerator {
        +check_entry(symbol, market_data) ORBSignal
        +check_exit(symbol, ...) ORBSignal
    }

    BaseSignalGenerator <|-- ORBSignalGenerator
    BaseSignalGenerator <|-- SRBreakoutSignalGenerator
    BaseSignalGenerator <|-- EMACrossSignalGenerator
    BaseSignalGenerator <|-- Week52ChaserSignalGenerator
    BaseSignalGenerator <|-- Week52TargetSignalGenerator
    BaseSignalGenerator ..> ORBSignal : creates
    ORBSignal ..> SignalType : uses
```

## Multi-Strategy Runner Flow

The main loop in `MultiStrategyRunner` runs continuously during market hours. It differentiates between intraday and swing strategies, applying different scan cadences.

```mermaid
flowchart TD
    START([Start Loop]) --> MARKET_OPEN{Market Open?}
    MARKET_OPEN -- No --> SLEEP[Sleep 60s]
    SLEEP --> START

    MARKET_OPEN -- Yes --> WATCHLIST{Cycle % 10 == 0?}
    WATCHLIST -- Yes --> REFRESH[Refresh Watchlist]
    WATCHLIST -- No --> SCAN
    REFRESH --> SCAN

    SCAN[For Each Strategy] --> TYPE{Strategy Type?}

    TYPE -- Intraday --> INTRA[_scan_intraday_strategy]
    TYPE -- Swing --> SWING_CHECK{Cycle % 30 == 0?}
    SWING_CHECK -- Yes --> SWING[_scan_swing_strategy]
    SWING_CHECK -- No --> SCAN

    INTRA --> SIGNALS{Signals Generated?}
    SWING --> SIGNALS

    SIGNALS -- Yes --> RISK[Execute Signals<br/>via Risk Manager]
    SIGNALS -- No --> MONITOR

    RISK --> MONITOR[Monitor Open Positions]
    MONITOR --> EOD{EOD?}
    EOD -- Yes --> EXIT[Force Close Intraday]
    EOD -- No --> SNAPSHOT

    EXIT --> SNAPSHOT[Save Portfolio Snapshot]
    SNAPSHOT --> LOOP_SLEEP[Sleep Until Next Cycle]
    LOOP_SLEEP --> START

    subgraph Market Hours Guard
        MARKET_OPEN
    end

    subgraph Strategy Scanning
        SCAN
        TYPE
        INTRA
        SWING_CHECK
        SWING
    end

    subgraph Execution & Monitoring
        SIGNALS
        RISK
        MONITOR
        EOD
        EXIT
    end
```

## Capital Allocation

`SharedPortfolioManager` holds a single capital pool. Each strategy is assigned an `allocation_pct` of the total capital. When a strategy opens a position, the required margin is deducted from the shared cash pool, ensuring strategies compete for capital and total exposure stays within limits.

```mermaid
graph TD
    BOT[Bot Instance] --> TOTAL[Total Capital<br/>e.g. ₹10,00,000]

    TOTAL --> SPM[SharedPortfolioManager]
    SPM --> CASH[Available Cash Pool]
    SPM --> MAX_CAP[max_total_capital_pct = 80%]
    SPM --> MAX_POS[max_total_positions = 10]
    SPM --> MAX_SYM[max_symbol_exposure_pct = 20%]

    subgraph Strategy Allocations
        SPM --> A1[ORB<br/>allocation_pct]
        SPM --> A2[SR_BREAKOUT<br/>allocation_pct]
        SPM --> A3[EMA_CROSS<br/>allocation_pct]
        SPM --> A4[52W_CHASER<br/>allocation_pct]
        SPM --> A5[52W_TARGET<br/>allocation_pct]
    end

    A1 --> P1[Position 1]
    A1 --> P2[Position 2]
    A3 --> P3[Position 3]
    A4 --> P4[Position 4]

    P1 -.->|margin deducted| CASH
    P2 -.->|margin deducted| CASH
    P3 -.->|margin deducted| CASH
    P4 -.->|margin deducted| CASH

    subgraph Exposure Guards
        MAX_CAP
        MAX_POS
        MAX_SYM
    end

    style SharedPortfolioManager fill:#fff3e0,stroke:#e65100
    style Exposure Guards fill:#fce4ec,stroke:#c62828
```

## Position Lifecycle

Every position follows a deterministic lifecycle from signal generation through closure and cooldown.

```mermaid
stateDiagram-v2
    [*] --> available

    available --> signal_generated : Signal detected
    signal_generated --> risk_validated : Passes global + portfolio risk checks
    risk_validated --> position_opened : Order executed
    position_opened --> monitoring : Tracking P&L, SL, TP

    monitoring --> sl_hit : Stop-loss triggered
    monitoring --> tp_hit : Take-profit triggered
    monitoring --> trailing_stop : Trailing stop activated
    monitoring --> eod_exit : EOD forced exit

    sl_hit --> position_closed
    tp_hit --> position_closed
    trailing_stop --> position_closed
    eod_exit --> position_closed

    position_closed --> cooldown : Cooldown period
    cooldown --> available : Ready for new signals
```

## Risk Management Layers

Risk is enforced at three distinct layers, each with progressively narrower scope. A signal must pass all layers before a position is opened.

```mermaid
flowchart TD
    SIGNAL[Raw Signal] --> L1

    subgraph Layer1 ["Layer 1 — GlobalRiskManager"]
        direction TB
        L1{Total positions<br/>within limit?}
        L1 -- No --> REJECT1[Reject Signal]
        L1 -- Yes --> L1B{Total capital<br/>usage within limit?}
        L1B -- No --> REJECT1
        L1B -- Yes --> L2
    end

    subgraph Layer2 ["Layer 2 — SharedPortfolioManager"]
        direction TB
        L2{Strategy position<br/>limit reached?}
        L2 -- Yes --> REJECT2[Reject Signal]
        L2 -- No --> L2B{Symbol exposure<br/>within limit?}
        L2B -- No --> REJECT2
        L2B -- Yes --> L2C{Strategy capital<br/>allocation available?}
        L2C -- No --> REJECT2
        L2C -- Yes --> L3
    end

    subgraph Layer3 ["Layer 3 — Signal Generator"]
        direction TB
        L3{Strategy-specific<br/>SL/TP valid?}
        L3 -- No --> REJECT3[Reject Signal]
        L3 -- Yes --> EXEC[Execute Order]
    end

    style Layer1 fill:#e8f5e9,stroke:#2e7d32
    style Layer2 fill:#e3f2fd,stroke:#1565c0
    style Layer3 fill:#fff8e1,stroke:#f57f17
    style REJECT1 fill:#ffcdd2,stroke:#c62828
    style REJECT2 fill:#ffcdd2,stroke:#c62828
    style REJECT3 fill:#ffcdd2,stroke:#c62828
    style EXEC fill:#c8e6c9,stroke:#2e7d32
```

## Strategy Links

- [ORB Strategy](strategy-orb.md)
- [S/R Breakout Strategy](strategy-sr-breakout.md)
- [52-Week Chaser Strategy](strategy-52w-chaser.md)
- [52-Week Target Strategy](strategy-52w-target.md)
- [EMA Crossover Strategy](strategy-ema-cross.md)
