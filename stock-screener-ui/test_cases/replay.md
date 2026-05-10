# Replay — Test Checklist

## ReplayPage
- [x] Renders page with data-testid
- [x] Renders title and description text
- [x] Renders ReplayConfigBar component
- [x] Renders ReplayStats component
- [x] Renders ReplayPositions when open positions exist
- [x] Hides ReplayPositions when no open positions
- [x] Renders ReplayMainView component
- [x] Renders ReplaySummaryPanel when summary exists
- [x] Hides ReplaySummaryPanel when summary is null
- [x] Auto-selects first trade on replay completion
- [ ] Trade click highlights trade and zooms chart

## ReplayConfig
- [x] Renders config bar with data-testid
- [x] Bot Select loads bots on mount
- [x] Bot Select allows clearing (default bot)
- [x] Bot Select is searchable
- [x] Date TradingDatePicker renders with maxDate constraint (yesterday)
- [x] Strategy Select options: All, ORB, SR, EMA, 52W
- [x] Symbols Select options: Default, Top 25 Volatile
- [x] Refresh Cache Switch toggles boolean state
- [x] Run Replay button is disabled when no date selected
- [x] Run Replay button calls startReplay
- [x] Stop button shows when isRunning is true
- [x] Stop button calls stopReplay
- [x] Reset button shows when not running and date is set
- [x] Reset button calls reset
- [ ] Run button shows loader when isRunning
- [x] Holiday warning Alert shows when selected date is a trading holiday
- [x] Holiday warning shows holiday description
- [x] Clears holiday warning when date changed to non-holiday
- [x] Clears holiday warning when date cleared

## ReplayStats
- [x] Shows "Run a replay to see stats" when no trades and not running
- [x] Shows Total Trades stat
- [x] Shows Win Rate percentage with green/red tone
- [x] Shows Profit Factor with green/dimmed/red tone
- [x] Shows Net P&L with sign and color
- [x] Shows Winners / Losers count
- [x] Shows Progress stat (candle / total) when running with progress
- [x] Shows Progress bar when running and totalCandles > 0
- [x] Calculates win rate from trades when summary is null
- [x] Calculates profit factor from trades when summary is null
- [x] Calculates net P&L from trades when summary is null
- [x] Calculates winners/losers from trades when summary is null
- [x] Net P&L formatted with INR currency and signDisplay

## ReplayPositions
- [x] Returns null when positions array is empty
- [x] Renders wrapper with data-testid
- [x] Shows "Open Positions" title with count badge
- [x] Renders striped highlightOnHover Table
- [x] Renders header columns: Symbol, Side, Qty, Entry Price, SL, TP, Strategy, Entry Time
- [x] Renders each position row
- [ ] Row key is composite (symbol-strategy-id)
- [x] Shows SideBadge for each position's side
- [x] Shows quantity centered
- [x] Entry price formatted to 2 decimals
- [x] SL in red color, formatted to 2 decimals
- [x] TP in green color, formatted to 2 decimals
- [x] Strategy name displayed as text
- [x] Entry time formatted via formatTimeOnly

## ReplaySummary (ReplaySummaryPanel)
- [x] Returns null when summary is null
- [x] Renders CompactPanel with title "Per-Strategy Breakdown"
- [x] Renders table with Strategy, Trades, Win Rate, Net P&L, PF columns
- [x] Renders one row per strategy in breakdown
- [x] Win rate shown with 1 decimal + %
- [x] Net P&L shown with sign, 2 decimals, and color
- [x] PF shown with 2 decimals, green if >1, red if <1, dimmed if N/A
- [x] Total row with bold font and top border
- [x] Total row shows summary totals

## ReplayTradeLog
- [x] Renders with data-testid
- [x] Shows "Trade Log" title
- [x] Strategy filter Select with "All Strategies" + unique strategy names
- [x] Strategy filter Select filters trades by strategy
- [x] Symbol filter Select with "All Symbols" + unique symbol names
- [x] Symbol filter Select filters trades by symbol
- [x] Shows filtered trade count text
- [x] Filters combine (strategy AND symbol)
- [x] Renders ScrollArea with table
- [x] Table is striped and highlightOnHover
- [x] Renders header columns: #, Symbol, Side, Qty, Entry, Exit, Hold, Entry Price, Exit Price, P&L, Net, Strategy, Reason
- [x] Sortable headers for Symbol, Side, Entry, Exit, P&L, Net
- [x] Clicking sortable header toggles sort direction
- [x] Clicking same sortable header toggles asc/desc
- [x] Shows "No trades yet" empty state when filtered trades empty
- [x] Renders trade rows with index number
- [x] Shows SideBadge for each trade side
- [x] Shows entry/exit times formatted via formatTimeOnly
- [x] Shows hold duration formatted via formatDuration
- [x] Shows entry/exit prices to 2 decimals
- [x] Shows P&L and Net P&L with sign and color
- [x] Strategy name as clickable Anchor that filters by strategy
- [x] Exit reason as Badge with color based on reason (TP=green, SL=red, EOD=orange, FORCE_CLOSE=gray)
- [x] Falls back to gray for unknown exit reasons
- [x] Highlights row when highlightedTradeId matches
- [x] Calls onTradeClick when row clicked
- [x] Auto-scrolls to bottom when isRunning and filter matches

## ReplayMainView
- [x] Renders container with fixed height (500px)
- [x] Flex layout: 60% chart, 40% trade log
- [x] Passes all props to ReplayChart
- [x] Passes all props to ReplayTradeLog

## ReplayChart
- [x] Shows empty state message when no symbols available
- [x] Renders symbol badges for each symbol in candlesBySymbol
- [x] Clicking symbol badge sets selectedSymbol
- [x] Active symbol badge has filled variant with teal color
- [x] Inactive symbols have light variant with gray color
- [x] TF preset buttons: 1m, 5m, 15m, 1h, 1D
- [x] Clicking TF preset changes aggregation interval
- [x] Active TF preset has filled variant
- [x] Show All Trades switch toggles chartOptions.show_all_trades
- [x] Show Markers switch (disabled, always on)
- [x] Show ORB switch toggles chartOptions.show_orb_zones
- [x] Show Pivot switch toggles chartOptions.show_pivot_levels
- [x] Show 52W switch toggles chartOptions.show_52w_high
- [x] Show EMA switch toggles chartOptions.show_ema
- [x] Candles are aggregated by active time frame
- [x] Aggregation groups candles into interval buckets
- [x] 1m returns raw candles unchanged
- [x] aggregateCandles sorts aggregated groups by time
- [x] Normalizes replay data via normalizeReplay
- [ ] Renders TradingChart with normalized input
- [ ] Trade click on chart sets highlighted trade
- [ ] zoomToTrade imperative handle delegates to TradingChart
- [x] setTimeframe imperative handle changes active TF

## Backend API (Replay)
- [ ] POST /api/replay/start initiates replay with config
- [ ] POST /api/replay/stop stops running replay
- [ ] GET /api/replay/state streams replay progress
- [ ] GET /api/replay/chart/{symbol} returns chart data for symbol
- [ ] GET /api/replay/trades returns completed trades
- [ ] GET /api/replay/summary returns aggregated summary
- [ ] GET /api/replay/positions returns open positions
- [ ] POST /api/replay/reset clears current replay state
- [ ] Cache layer reads/writes from experiments/data/replay_cache
- [ ] Cache TTL or invalidation on refresh_cache flag
