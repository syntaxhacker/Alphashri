# Backtesting Module Integration Plan

## Overview
Integrate the ORB (Opening Range Breakout) backtesting strategy into the Stock Screener UI with a dedicated sidemenu, allowing users to run backtests, view results, and eventually add more strategies.

**Key Feature:** Interactive ECharts candlestick charts showing:
- OHLC price data with ORB zones
- Trade entry/exit markers with hover tooltips
- Per-symbol chart tabs for detailed analysis

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              STOCK SCREENER UI                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  ┌──────────────┐    ┌────────────────────────────────────────────────────────────────────┐    │
│  │   SIDEMENU   │    │                        MAIN CONTENT                               │    │
│  │              │    │                                                                │    │
│  │  ┌────────┐  │    │  ┌─────────────────────────────────────────────────────────────┐  │    │
│  │  │Screener│  │    │  │                                                             │  │    │
│  │  │ (live) │  │    │  │         Current: Screener View                              │  │    │
│  │  └────────┘  │    │  │         (existing functionality)                            │  │    │
│  │              │    │  │                                                             │  │    │
│  │  ┌────────┐  │    │  │    OR                                                       │  │    │
│  │  │Backtest│  │    │  │                                                             │  │    │
│  │  │  (new) │◄─┼────┼──│         Backtest View (new)                                 │  │    │
│  │  └────────┘  │    │  │         ┌─────────────────────────────────────────────┐     │  │    │
│  │              │    │  │         │  📊 ECharts Candlestick + Trades View      │     │  │    │
│  │              │    │  │         │  - ORB Zone High/Low lines                  │     │  │    │
│  │              │    │  │         │  - Entry markers (🟢 buy)                   │     │  │    │
│  │              │    │  │         │  - Exit markers (🟢TP/🔴SL/🟡EOD)          │     │  │    │
│  │              │    │  │         │  - Hover tooltip with trade details        │     │  │    │
│  │              │    │  │         │  - Per-symbol tabs                          │     │  │    │
│  │              │    │  │         └─────────────────────────────────────────────┘     │  │    │
│  │              │    │  │                                                             │  │    │
│  └──────────────┘    │  └─────────────────────────────────────────────────────────────┘  │    │
│                      └────────────────────────────────────────────────────────────────────┘    │
│                                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Structure

### Backend (Python)

```
earner/
├── stock-screener-ui/
│   ├── api_server.py              # Existing API server
│   │
│   └── backtest/                   # NEW: Backtest module
│       ├── __init__.py
│       ├── engine.py               # Backtest engine wrapper
│       ├── strategies/             # Strategy definitions
│       │   ├── __init__.py
│       │   ├── base.py             # Base strategy class
│       │   ├── orb.py              # ORB strategy (current)
│       │   ├── vwap.py             # Future: VWAP strategy
│       │   └── momentum.py         # Future: Momentum strategy
│       │
│       ├── costs.py                # Indian trading costs calculator
│       └── api.py                  # Backtest API endpoints
```

### Frontend (TypeScript)

```
src/
├── components/
│   ├── header.ts                   # Existing
│   ├── sidemenu.ts                 # NEW: Side navigation
│   └── backtest/                   # NEW: Backtest components
│       ├── strategySelector.ts     # Strategy dropdown
│       ├── paramConfig.ts          # Parameter configuration form
│       ├── resultsTable.ts         # Backtest results table
│       ├── tradeHistory.ts         # Individual trade list
│       └── costBreakdown.ts        # Trading costs breakdown
│
├── api/
│   ├── index.ts                    # Existing API
│   └── backtest.ts                 # NEW: Backtest API calls
│
├── state/
│   ├── index.ts                    # Existing state
│   └── backtest.ts                 # NEW: Backtest state
│
└── types/
    ├── index.ts                    # Existing types
    └── backtest.ts                 # NEW: Backtest types
```

---

## UI Layout Design

### Sidemenu Component
```
┌─────────────────────┐
│      🚀 Screener    │
│  ─────────────────  │
│      📊 Backtest    │
│                     │
│  ┌───────────────┐  │
│  │ Live Screener │  │  <- Active view indicator
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │   Backtest    │  │
│  └───────────────┘  │
│                     │
│                     │
│  ─────────────────  │
│  v1.0.0             │
└─────────────────────┘
```

### Backtest Main View
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  📊 Backtesting                                                                 │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ STRATEGY CONFIG                                                          │   │
│  │                                                                          │   │
│  │  Strategy:  [▼ ORB - Opening Range Breakout          ]                   │   │
│  │                                                                          │   │
│  │  ┌──────────────────────┐  ┌──────────────────────┐                    │   │
│  │  │ Stocks               │  │ Timeframe            │                    │   │
│  │  │ [NETWEB            ] │  │ [▼ 5 minutes        ] │                    │   │
│  │  │ [TCS                ] │  └──────────────────────┘                    │   │
│  │  │ [COCHINSHIP         ] │                                              │   │
│  │  │ [SBILIFE            ] │  ┌──────────────────────┐                    │   │
│  │  │ [ICICIBANK          ] │  │ Days: [180          ] │                    │   │
│  │  │ [+ Add Stock        ] │  └──────────────────────┘                    │   │
│  │  └──────────────────────┘                                              │   │
│  │                                                                          │   │
│  │  ┌──────────────────────┐  ┌──────────────────────┐                    │   │
│  │  │ OR Period (min)      │  │ Stop Loss %          │                    │   │
│  │  │ [    45            ] │  │ [    0.5           ] │                    │   │
│  │  └──────────────────────┘  └──────────────────────┘                    │   │
│  │                                                                          │   │
│  │  ┌──────────────────────┐  ┌──────────────────────┐                    │   │
│  │  │ Take Profit %        │  │ Trade Size           │                    │   │
│  │  │ [    1.0           ] │  │ [    100           ] │                    │   │
│  │  └──────────────────────┘  └──────────────────────┘                    │   │
│  │                                                                          │   │
│  │  [☑] Include Trading Costs (Brokerage, STT, GST, etc.)                  │   │
│  │                                                                          │   │
│  │                                    [▶ RUN BACKTEST]  [Reset]            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ RESULTS                                           [Running... 45%]      │   │
│  │                                                                          │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │   │
│  │  │ Summary                                                          │    │   │
│  │  │ Gross PnL: ₹100,500 | Costs: ₹37,582 | Net PnL: ₹62,918         │    │   │
│  │  │ Win Rate: 45.8% | Trades: 284 | Avg Cost/Trade: ₹132            │    │   │
│  │  └─────────────────────────────────────────────────────────────────┘    │   │
│  │                                                                          │   │
│  │  Symbol       │ Net PnL  │ Gross PnL│ Costs  │ Trades │ WR%  │ PF     │   │
│  │  ─────────────┼──────────┼──────────┼────────┼────────┼──────┼─────── │   │
│  │  NETWEB       │ ₹43,403  │ ₹58,530  │₹15,127 │   94   │ 45.7 │ 1.32   │   │
│  │  COCHINSHIP   │ ₹9,838   │ ₹15,730  │ ₹5,892 │   55   │ 41.8 │ 1.27   │   │
│  │  TCS          │ ₹7,269   │ ₹14,100  │ ₹6,831 │   44   │ 47.7 │ 1.24   │   │
│  │  SBILIFE      │ ₹1,350   │ ₹7,030   │ ₹5,680 │   49   │ 51.0 │ 1.06   │   │
│  │  ICICIBANK    │ ₹1,058   │ ₹5,110   │ ₹4,052 │   42   │ 42.9 │ 1.08   │   │
│  │                                                                          │   │
│  │  [Show Trade History]  [Export CSV]                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Trade History Modal
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Trade History - NETWEB                                              [✕ Close] │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                  │
│  Filter: [▼ All Exits ▼]  [▼ All Dates ▼]                                       │
│                                                                                  │
│  Date       │ Entry   │ Exit    │ Gross PnL│ Costs │ Net PnL│ Exit │           │
│  ───────────┼─────────┼─────────┼──────────┼───────┼────────┼───── │           │
│  2026-02-20 │ ₹1,850  │ ₹1,869  │   +₹190  │  ₹45  │  +₹145 │ TP   │           │
│  2026-02-19 │ ₹1,820  │ ₹1,811  │    -₹90  │  ₹43  │  -₹133 │ SL   │           │
│  2026-02-18 │ ₹1,790  │ ₹1,808  │   +₹180  │  ₹42  │  +₹138 │ TP   │           │
│  2026-02-17 │ ₹1,760  │ ₹1,751  │    -₹90  │  ₹41  │  -₹131 │ SL   │           │
│  ...                                                                             │
│                                                                                  │
│  Page: [1] [2] [3] ... [10]    Total: 94 trades                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## ECharts Candlestick & Trade Visualization

### Chart View Layout (After Results)
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│  📈 CHARTS                                                        [Show/Hide]   │
│  ─────────────────────────────────────────────────────────────────────────────────────────────  │
│                                                                                                  │
│  Symbol Tabs:  [NETWEB] [TCS] [COCHINSHIP] [SBILIFE] [ICICIBANK]                               │
│                ────────                                                                          │
│                                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  NETWEB - 180 Days Backtest                                     ▼ Zoom: [All] [30D] [7D]│  │
│  │                                                                                           │  │
│  │  ₹2,000 ┬──────────────────────────────────────────────────────────────────────────────  │  │
│  │         │                ╭────╮        ╭──╮                                              │  │
│  │  ₹1,900 ├────────────────│    │────────│  │──────────────────────────────────────────   │  │
│  │         │     ╭──╮       │    │   ╭──╮ │  │  ╭──╮                                        │  │
│  │  ₹1,800 ├─────│  │───────│    │───│  │─│  │──│  │─────────────────────────────────────  │  │
│  │         │     │  │  ╭──╮ │    │   │  │ │  │  │  │  ╭──╮                                  │  │
│  │  ₹1,700 ├─────│  │──│  │─│    │───│  │─│  │──│  │──│  │───────────────────────────────  │  │
│  │         │  ╭──╯  ╰──╯  │ ╰╮╭──╯   ╰──╯ ╰──╯  ╰╮╭╯  ╰──╯     ╭──╮                         │  │
│  │  ₹1,600 ├──╯           │  │╰──────────────────╯╰────────────│  │───────────────────────  │  │
│  │         │              ╰──╯                                 ╰──╯                        │  │
│  │  ₹1,500 ├─────────────────────────────────────────────────────────────────────────────  │  │
│  │         │                                                                                 │  │
│  │         ├─────│─────│─────│─────│─────│─────│─────│─────│─────│─────│─────│─────│─────   │  │
│  │         0    10    20    30    40    50    60    70    80    90   100   110   120         │  │
│  │                                      Trading Days                                         │  │
│  │                                                                                           │  │
│  │  LEGEND: ━━━ ORB High  ━━━ ORB Low  🟢 Entry (Buy)  🟢 TP Exit  🔴 SL Exit  🟡 EOD Exit  │  │
│  │                                                                                           │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  TRADE DETAILS ON HOVER                                                                  │  │
│  │  ┌─────────────────────────────────────────────────────────────────────────────────────┐ │  │
│  │  │  Trade #23 - 2026-02-15 09:45                                                       │ │  │
│  │  │  ─────────────────────────────────                                                  │ │  │
│  │  │  Entry: ₹1,850.00  │  Exit: ₹1,868.50  │  Qty: 100                                  │ │  │
│  │  │  Gross PnL: +₹1,850 │  Costs: ₹45      │  Net PnL: +₹1,805                          │ │  │
│  │  │  Exit Reason: TP (Take Profit at 1.0%)                                              │ │  │
│  │  │  OR High: ₹1,845    │  OR Low: ₹1,820   │  OR Period: 45 min                        │ │  │
│  │  │  Hold Time: 2h 15m  │  Return: +1.0%                                                │ │  │
│  │  └─────────────────────────────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Single Day Zoomed View (Detailed)
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│  NETWEB - 2026-02-15 (Zoomed)                                                    [← Back]      │
│  ─────────────────────────────────────────────────────────────────────────────────────────────  │
│                                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                    ORB Zone Visualization                                │  │
│  │                                                                                           │  │
│  │  ₹1,870 ┬──────────────────────────────────────────────────────────────────────────────  │  │
│  │         │                              ╭──╮                            █ TP Hit (₹1,869) │  │
│  │  ₹1,860 ├──────────────────────────────│  │────────────────────────────█───────────────  │  │
│  │         │                      ╭──╮    │  │   ╭──╮                      █                │  │
│  │  ₹1,850 ├──────────────────────│██│────│  │───│  │──────────────────────█───────────────  │  │
│  │         │              ╭──╮    │██│    │  │   │  │  ╭──╮                 █                │  │
│  │  ₹1,840 ├──────────────│  │────│██│────│  │───│  │──│  │────────────────█───────────────  │  │
│  │         │      ╭──╮    │  │╭──╯  ╰╮╭──╯██│   │  │  │  │╭──╮            █                │  │
│  │  ₹1,830 ├──────│  │────│  ││     ││    │╰──╮ │  │  │  ││  │────────────█───────────────  │  │
│  │         │  ╭──╮│  │╭──╮│  ││     ││    │   │╰╮│  │  │  ││  │            █                │  │
│  │  ₹1,820 ├──│██││  ││  ││  ╰╯     ╰╯    │   │ ╰╯  │  │  ╰╯  │   ─ ─ ─ ─ ─ █ ─ ─ ─ OR Low│  │
│  │         │  │██││  ╰╯  ╰╯              │   │     ╰──╯      │              █                │  │
│  │  ₹1,810 ├──│██│╰╯                    │   │             ╭──╯ ─ ─ ─ ─ ─ ─ █ ─ ─ ─ OR High│  │
│  │         │  │██│                      ╰───│─────────────│                   █             │  │
│  │  ₹1,800 ├──╰██╯──────────────────────────╰─────────────╰───────────────────█───────────  │  │
│  │         │                                                                                 │  │
│  │         ├─────│─────│─────│─────│─────│─────│─────│─────│─────│─────│─────│─────│─────   │  │
│  │        9:15  9:30  9:45  10:00 10:15 10:30 10:45 11:00 11:15 11:30 11:45 12:00 12:15    │  │
│  │                                       Time (IST)                                          │  │
│  │                                                                                           │  │
│  │  ┌─────────────────────────────────────────────────────────────────────────────────────┐ │  │
│  │  │  ━━━━━━ ORB HIGH (₹1,845.50) - Breakout level                                       │ │  │
│  │  │  ━━━━━━ ORB LOW (₹1,822.00) - 45-min opening range                                  │ │  │
│  │  │  ▲ Entry: 10:05 @ ₹1,846 (Breakout above OR High + 0.1%)                           │ │  │
│  │  │  ● Exit: 12:20 @ ₹1,868.50 (TP Hit +1.0%)                                           │ │  │
│  │  └─────────────────────────────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Chart Markers & Interactions

```
MARKER LEGEND:
─────────────────────────────────────────────────────────────
  Symbol    │ Color  │ Shape    │ Meaning
─────────────────────────────────────────────────────────────
  Entry     │ 🟢     │ ▲ Triangle│ Buy/Long entry point
  TP Exit   │ 🟢     │ ● Circle  │ Take Profit hit (+green)
  SL Exit   │ 🔴     │ ● Circle  │ Stop Loss hit (-red)
  EOD Exit  │ 🟡     │ ● Circle  │ End of Day exit (neutral)
─────────────────────────────────────────────────────────────

LINE OVERLAYS:
─────────────────────────────────────────────────────────────
  Line Type     │ Color    │ Style     │ Description
─────────────────────────────────────────────────────────────
  ORB High      │ #4CAF50  │ Dashed    │ 45-min OR high level
  ORB Low       │ #F44336  │ Dashed    │ 45-min OR low level
  Entry Price   │ #2196F3  │ Solid     │ Horizontal at entry
  Stop Loss     │ #F44336  │ Dotted    │ SL price level
  Take Profit   │ #4CAF50  │ Dotted    │ TP price level
─────────────────────────────────────────────────────────────

HOVER TOOLTIP CONTENT:
─────────────────────────────────────────────────────────────
When hovering over a trade marker, show:

┌─────────────────────────────────────────────┐
│  Trade #23                                  │
│  ─────────────────                          │
│  📅 Date: 2026-02-15 10:05 IST              │
│  📊 Symbol: NETWEB                          │
│  ─────────────────                          │
│  Entry:  ₹1,846.00                          │
│  Exit:   ₹1,868.50                          │
│  Qty:    100 shares                         │
│  ─────────────────                          │
│  Gross PnL:  +₹2,250                        │
│  Costs:      -₹45                           │
│  Net PnL:    +₹2,205                        │
│  Return:     +1.21%                         │
│  ─────────────────                          │
│  Exit: TP (Take Profit)                     │
│  Hold: 2h 15m                               │
│  OR High: ₹1,845.50                         │
│  OR Low:  ₹1,822.00                         │
└─────────────────────────────────────────────┘
```

### ECharts Configuration Structure

```typescript
// types/backtest.ts - Chart data structures

export interface CandleData {
  time: string        // ISO timestamp
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ORBZone {
  date: string        // Trading date
  or_high: number     // Opening Range High
  or_low: number      // Opening Range Low
  or_end_time: string // When OR period ends (e.g., "10:00")
}

export interface ChartTrade {
  trade_id: number
  date: string
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  quantity: number
  gross_pnl: number
  trading_costs: number
  net_pnl: number
  net_pnl_pct: number
  exit_reason: 'TP' | 'SL' | 'EOD'
  orb_zone: ORBZone
  hold_duration_minutes: number
}

export interface SymbolChartData {
  symbol: string
  candles: CandleData[]
  orb_zones: ORBZone[]
  trades: ChartTrade[]
}

export interface ChartOptions {
  show_orb_zones: boolean
  show_entry_markers: boolean
  show_exit_markers: boolean
  show_sl_tp_lines: boolean
  date_range: 'all' | '30d' | '7d' | '1d'
}
```

### ECharts Option Configuration

```typescript
// components/backtest/chartConfig.ts

export function buildCandlestickOption(data: SymbolChartData, options: ChartOptions) {
  return {
    title: {
      text: `${data.symbol} - Backtest Results`,
      left: 'center'
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: function(params: any) {
        // Custom formatter for candlestick + trade markers
      }
    },
    legend: {
      data: ['Price', 'ORB High', 'ORB Low', 'Entry', 'TP Exit', 'SL Exit', 'EOD Exit'],
      bottom: 10
    },
    grid: {
      left: '10%',
      right: '10%',
      bottom: '15%'
    },
    xAxis: {
      type: 'category',
      data: data.candles.map(c => c.time),
      scale: true
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitArea: { show: true }
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', show: true, start: 0, end: 100 }
    ],
    series: [
      // Candlestick series
      {
        name: 'Price',
        type: 'candlestick',
        data: data.candles.map(c => [c.open, c.close, c.low, c.high]),
        itemStyle: {
          color: '#4CAF50',      // Bullish candle
          color0: '#F44336',     // Bearish candle
          borderColor: '#4CAF50',
          borderColor0: '#F44336'
        }
      },
      // ORB High line (markLine)
      {
        name: 'ORB High',
        type: 'line',
        data: data.orb_zones.map(z => ({
          value: z.or_high,
          xAxis: z.date,
          yAxis: z.or_high
        })),
        lineStyle: { type: 'dashed', color: '#4CAF50', width: 1 },
        symbol: 'none',
        step: 'end'
      },
      // Entry markers (scatter)
      {
        name: 'Entry',
        type: 'scatter',
        data: data.trades.map(t => ({
          value: [t.entry_time, t.entry_price],
          itemStyle: { color: '#2196F3' },
          symbol: 'triangle',
          symbolSize: 12,
          trade: t  // Attach trade data for tooltip
        }))
      },
      // TP Exit markers
      {
        name: 'TP Exit',
        type: 'scatter',
        data: data.trades.filter(t => t.exit_reason === 'TP').map(t => ({
          value: [t.exit_time, t.exit_price],
          itemStyle: { color: '#4CAF50' },
          symbol: 'circle',
          symbolSize: 10,
          trade: t
        }))
      },
      // SL Exit markers
      {
        name: 'SL Exit',
        type: 'scatter',
        data: data.trades.filter(t => t.exit_reason === 'SL').map(t => ({
          value: [t.exit_time, t.exit_price],
          itemStyle: { color: '#F44336' },
          symbol: 'circle',
          symbolSize: 10,
          trade: t
        }))
      },
      // EOD Exit markers
      {
        name: 'EOD Exit',
        type: 'scatter',
        data: data.trades.filter(t => t.exit_reason === 'EOD').map(t => ({
          value: [t.exit_time, t.exit_price],
          itemStyle: { color: '#FFC107' },
          symbol: 'circle',
          symbolSize: 10,
          trade: t
        }))
      }
    ]
  }
}
```

### New API Endpoint for Chart Data

```
GET /api/backtest/chart/{symbol}
    Query params:
      - run_id: string (backtest run identifier)
      - start_date: string (optional, ISO date)
      - end_date: string (optional, ISO date)

    Response: {
      symbol: string,
      candles: CandleData[],
      orb_zones: ORBZone[],
      trades: ChartTrade[],
      date_range: { start: string, end: string }
    }
```

### Frontend Components for Charts

```
src/components/backtest/
├── chartContainer.ts      # Main chart wrapper with tabs
├── candlestickChart.ts    # ECharts candlestick implementation
├── chartTooltip.ts        # Custom tooltip renderer
├── chartControls.ts       # Zoom, date range controls
└── tradeMarker.ts         # Trade marker utilities
```

### Chart Interaction Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER INTERACTION FLOW                             │
└─────────────────────────────────────────────────────────────────────────────┘

    User clicks on symbol tab
            │
            ▼
    ┌───────────────────┐
    │ Load chart data   │
    │ GET /api/backtest │
    │     /chart/NETWEB │
    └─────────┬─────────┘
              │
              ▼
    ┌───────────────────┐
    │ Build ECharts     │
    │ option config     │
    │ - Candlestick     │
    │ - ORB zones       │
    │ - Trade markers   │
    └─────────┬─────────┘
              │
              ▼
    ┌───────────────────┐
    │ Render chart      │
    │ with datazoom     │
    │ and tooltips      │
    └─────────┬─────────┘
              │
              ▼
    ┌───────────────────────────────────────┐
    │           USER HOVERS                  │
    │                                        │
    │  Over candle → OHLC tooltip            │
    │  Over marker → Trade details tooltip   │
    │  Over ORB line → Zone info tooltip     │
    └───────────────────────────────────────┘
```

### Dependencies to Add

```json
// package.json
{
  "dependencies": {
    "echarts": "^5.5.0"
  }
}
```

Or use CDN in index.html:
```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
```

---

## API Endpoints

### New Endpoints to Add

```
GET  /api/backtest/strategies
     - Returns list of available strategies with their parameter schemas

POST /api/backtest/run
     Body: {
       strategy: "orb",
       symbols: ["NETWEB", "TCS"],
       params: {
         or_minutes: 45,
         stop_loss_pct: 0.5,
         take_profit_pct: 1.0,
         trade_size: 100,
         days: 180,
         include_costs: true
       }
     }
     - Runs backtest and returns results

GET  /api/backtest/history/{run_id}
     - Returns detailed trade history for a specific run

GET  /api/backtest/costs
     - Returns current cost structure (brokerage, STT, etc.)

GET  /api/backtest/chart/{symbol}
     Query params:
       - run_id: string (backtest run identifier)
       - start_date: string (optional, ISO date)
       - end_date: string (optional, ISO date)
     - Returns candlestick data, ORB zones, and trade markers for chart rendering
     Response: {
       symbol: string,
       candles: CandleData[],
       orb_zones: ORBZone[],
       trades: ChartTrade[],
       date_range: { start: string, end: string }
     }
```

---

## Data Flow

```
┌─────────────┐     POST /api/backtest/run     ┌─────────────────┐
│             │ ──────────────────────────────►│                 │
│   Frontend  │                                 │   api_server.py │
│             │◄────────────────────────────── │                 │
└─────────────┘     Results JSON               └────────┬────────┘
                                                        │
                                           calls backtest module
                                                        │
                                                        ▼
┌─────────────────┐       fetch data         ┌─────────────────┐
│                 │◄─────────────────────────│                 │
│  Upstox API     │                          │  backtest/      │
│  (historical)   │──────────────────────────►│  engine.py      │
│                 │       OHLCV bars          │                 │
└─────────────────┘                           └────────┬────────┘
                                                       │
                                          runs NautilusTrader
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │  strategies/    │
                                              │  orb.py         │
                                              │                 │
                                              │  costs.py       │
                                              └─────────────────┘
```

---

## Implementation Phases

### Phase 1: Backend Foundation
1. Create `backtest/` module structure
2. Extract ORB strategy into `strategies/orb.py`
3. Create `costs.py` with Indian trading costs
4. Add API endpoints to `api_server.py`
5. Create `backtest/api.py` for endpoint handlers

### Phase 2: Frontend UI
1. Create sidemenu component with view switching
2. Create backtest state management
3. Build strategy config form
4. Build results table component
5. Build trade history modal

### Phase 3: Integration
1. Wire up API calls from frontend
2. Add progress indication for long backtests
3. Add CSV export functionality
4. Add result caching (optional)

### Phase 4: Future Strategies
1. Create `strategies/base.py` with abstract interface
2. Add VWAP strategy
3. Add Momentum strategy
4. Add strategy comparison view

---

## Strategy Interface

```python
# backtest/strategies/base.py
from abc import ABC, abstractmethod
from typing import Dict, List, Any
from dataclasses import dataclass

@dataclass
class StrategyParam:
    key: str
    label: str
    type: str  # 'number', 'select', 'boolean'
    default: Any
    min: float = None
    max: float = None
    step: float = None
    options: List[str] = None

class BaseStrategy(ABC):
    @classmethod
    @abstractmethod
    def get_name(cls) -> str:
        """Return strategy name"""
        pass

    @classmethod
    @abstractmethod
    def get_description(cls) -> str:
        """Return strategy description"""
        pass

    @classmethod
    @abstractmethod
    def get_params(cls) -> List[StrategyParam]:
        """Return list of configurable parameters"""
        pass

    @abstractmethod
    def run(self, symbols: List[str], days: int, params: Dict) -> Dict:
        """Run backtest and return results"""
        pass
```

---

## Types (TypeScript)

```typescript
// types/backtest.ts

export interface StrategyParam {
  key: string
  label: string
  type: 'number' | 'select' | 'boolean'
  default: number | string | boolean
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export interface Strategy {
  id: string
  name: string
  description: string
  params: StrategyParam[]
}

export interface BacktestConfig {
  strategy: string
  symbols: string[]
  params: Record<string, number | string | boolean>
  days: number
  include_costs: boolean
}

export interface BacktestResult {
  symbol: string
  trades: number
  wins: number
  losses: number
  win_rate: number
  gross_pnl: number
  total_costs: number
  net_pnl: number
  profit_factor: number
  tp_exits: number
  sl_exits: number
}

export interface BacktestResponse {
  strategy: string
  config: BacktestConfig
  results: BacktestResult[]
  totals: {
    gross_pnl: number
    total_costs: number
    net_pnl: number
    trades: number
    win_rate: number
  }
  run_time: string
  duration_seconds: number
}

export interface Trade {
  trade_id: number
  date: string
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  quantity: number
  gross_pnl: number
  trading_costs: number
  net_pnl: number
  net_pnl_pct: number
  exit_reason: 'TP' | 'SL' | 'EOD'
  hold_duration_minutes: number
}

// Chart-specific types
export interface CandleData {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ORBZone {
  date: string
  or_high: number
  or_low: number
  or_end_time: string
}

export interface ChartTrade extends Trade {
  orb_zone: ORBZone
}

export interface SymbolChartData {
  symbol: string
  candles: CandleData[]
  orb_zones: ORBZone[]
  trades: ChartTrade[]
}

export interface ChartOptions {
  show_orb_zones: boolean
  show_entry_markers: boolean
  show_exit_markers: boolean
  show_sl_tp_lines: boolean
  date_range: 'all' | '30d' | '7d' | '1d'
}
```

---

## State Management

```typescript
// state/backtest.ts

export interface BacktestState {
  // View
  currentView: 'screener' | 'backtest'

  // Available strategies
  strategies: Strategy[]
  strategiesLoading: boolean

  // Current config
  selectedStrategy: string
  selectedSymbols: string[]
  params: Record<string, number | string | boolean>
  days: number
  includeCosts: boolean

  // Results
  results: BacktestResult[] | null
  totals: BacktestResponse['totals'] | null
  isRunning: boolean
  progress: number

  // Trade history
  tradeHistory: Trade[] | null
  tradeHistorySymbol: string | null

  // Chart state
  showCharts: boolean
  selectedChartSymbol: string | null
  chartData: Map<string, SymbolChartData>  // Cached chart data per symbol
  chartLoading: boolean
  chartOptions: ChartOptions

  // Error
  error: string | null
}

export const initialBacktestState: BacktestState = {
  currentView: 'screener',
  strategies: [],
  strategiesLoading: false,
  selectedStrategy: 'orb',
  selectedSymbols: ['NETWEB', 'TCS', 'COCHINSHIP', 'SBILIFE', 'ICICIBANK'],
  params: {
    or_minutes: 45,
    stop_loss_pct: 0.5,
    take_profit_pct: 1.0,
    trade_size: 100,
  },
  days: 180,
  includeCosts: true,
  results: null,
  totals: null,
  isRunning: false,
  progress: 0,
  tradeHistory: null,
  tradeHistorySymbol: null,
  showCharts: true,
  selectedChartSymbol: null,
  chartData: new Map(),
  chartLoading: false,
  chartOptions: {
    show_orb_zones: true,
    show_entry_markers: true,
    show_exit_markers: true,
    show_sl_tp_lines: true,
    date_range: 'all'
  },
  error: null,
}
```

---

## File Changes Summary

### New Files to Create
| File | Purpose |
|------|---------|
| `backtest/__init__.py` | Module init |
| `backtest/engine.py` | NautilusTrader wrapper |
| `backtest/strategies/__init__.py` | Strategies init |
| `backtest/strategies/base.py` | Base strategy class |
| `backtest/strategies/orb.py` | ORB strategy implementation |
| `backtest/costs.py` | Indian trading costs |
| `backtest/api.py` | Backtest API handlers |
| `backtest/chart_data.py` | Chart data formatter (candles, ORB zones, trades) |
| `src/components/sidemenu.ts` | Sidemenu component |
| `src/components/backtest/*.ts` | Backtest components |
| `src/components/backtest/chartContainer.ts` | Chart wrapper with symbol tabs |
| `src/components/backtest/candlestickChart.ts` | ECharts candlestick implementation |
| `src/components/backtest/chartTooltip.ts` | Custom tooltip renderer |
| `src/components/backtest/chartControls.ts` | Zoom, date range controls |
| `src/api/backtest.ts` | Backtest API calls |
| `src/state/backtest.ts` | Backtest state |
| `src/types/backtest.ts` | Backtest types |

### Files to Modify
| File | Changes |
|------|---------|
| `api_server.py` | Import and register backtest routes |
| `src/main.ts` | Add view switching logic |
| `src/state/index.ts` | Import backtest state |
| `src/api/index.ts` | Import backtest API |

---

## Next Steps

1. **Review this plan** - Confirm architecture and approach
2. **Create backend module** - Start with `backtest/` folder structure
3. **Extract ORB strategy** - Move from `run_orb_custom_test.py` to modular structure
4. **Add API endpoints** - Extend `api_server.py`
5. **Build frontend** - Sidemenu + backtest view
6. **Test integration** - End-to-end testing
7. **Document** - Update README with backtest usage

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Backend Foundation | 2-3 hours |
| Backend Chart Data API | 1-2 hours |
| Frontend UI (Forms + Tables) | 3-4 hours |
| Frontend Charts (ECharts) | 2-3 hours |
| Integration | 1-2 hours |
| Testing & Polish | 1-2 hours |
| **Total** | **10-16 hours** |

---

## Dependencies

### Frontend
```json
{
  "dependencies": {
    "echarts": "^5.5.0"
  }
}
```

Or via CDN in `index.html`:
```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
```

### Backend
No new dependencies (uses existing NautilusTrader, pandas, numpy)

---

## Notes

- Backtests can take 30-60 seconds for 180 days on 5 stocks
- Chart data can be large (10,000+ candles per symbol) - consider:
  - Downsampling for "all" view (show daily candles)
  - Loading full 5-min data only when zoomed to single day
- Consider adding WebSocket for real-time progress updates
- Results could be cached by config hash for instant re-display
- ORB zones should be rendered as dashed horizontal lines per trading day
- Trade markers should be interactive with rich tooltips
- Future: Add equity curve chart visualization
