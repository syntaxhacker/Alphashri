# Backtest

## BacktestConfig
- [x] Config form renders with data-testid
- [x] Variation select rendered with grouped data (Templates vs Your Variations)
- [x] Variation description shown when selected
- [x] Variation select is clearable and searchable
- [x] SymbolChips rendered with selected symbols
- [x] Chips visible for each selected symbol
- [x] Param inputs rendered when strategy has params
- [x] Placeholder text shown when no variation selected
- [x] Days input rendered with correct value
- [x] Include Costs checkbox rendered and reflects prop
- [x] Run button disabled when isRunning true
- [x] Run button disabled when no symbols selected
- [x] Run button enabled when not running and symbols selected
- [x] Clicking run button calls onRun
- [x] Run menu button opens menu with Run Backtest, Run & Save, Reset
- [x] "Run & Save to History" calls onSaveToHistoryChange + onRun
- [x] "Reset Config" calls onReset
- [x] Ctrl+Enter triggers onRun when conditions met
- [x] Ctrl+Enter does not run when isRunning true
- [x] Ctrl+Enter does not run when no symbols selected
- [x] Strategy param section shows tooltip with param.label

## BacktestResultsTable
- [x] Empty state rendered when no results
- [x] Table wrapper rendered when results present
- [x] Table headers show Symbol, Net PnL, Trades, WR%, PF, TP/SL
- [x] Rows rendered for each result with data-testid
- [x] Positive P&L formatted as +₹X.XK
- [x] Negative P&L formatted as ₹-X.XK
- [x] Trades count displayed
- [x] Win rate rounded to integer percent
- [x] Profit factor to one decimal
- [x] TP/SL exits displayed as e.g. 10/32
- [x] Undefined win_rate shows 0%
- [x] Undefined pf shows 0.0
- [x] Zero values formatted correctly
- [x] Row click calls onRowClick
- [x] Selected row highlighted with blue background
- [x] SortableHeader triggers onSort on click

## TradeHistoryTable
- [x] Renders nothing when trades empty/null
- [x] Header shows symbol name and trade count
- [x] Summary row shows P&L, WR, Wins/Total
- [x] Sortable headers for Entry, Exit, Side, Qty, Entry Price, Level Hi, Exit, P&L, %, Hold, Type
- [x] Level Hi column adapts to 52W vs ORB data
- [x] Level Lo column only rendered for non-52W strategies
- [x] Trade rows numbered (#)
- [x] P&L color coded based on value
- [x] % column shows sign (+/-)
- [x] Hold duration formatted
- [x] Exit reason badge color coded (TP green, SL red, TRAILING_STOP orange, other gray)
- [x] Row click calls onRowClick
- [x] Row background tinted red for losing trades
- [x] Close button calls onClose
- [x] sortTrades sorts by entry_time
- [x] sortTrades sorts by exit_time
- [x] sortTrades sorts by side
- [x] sortTrades sorts by quantity
- [x] sortTrades sorts by entry_price
- [x] sortTrades sorts by exit_price
- [x] sortTrades sorts by level_high (or_high/r1/52w_high)
- [x] sortTrades sorts by level_low (or_low/s1)
- [x] sortTrades sorts by net_pnl
- [x] sortTrades sorts by net_pnl_pct
- [x] sortTrades sorts by hold_duration_minutes
- [x] sortTrades sorts by exit_reason

## BacktestSummary
- [x] resolveTotals returns null when totals is null/undefined
- [x] resolveTotals maps totals correctly
- [x] resolveTotals handles undefined values with defaults
- [x] formatCosts formats in thousands with 1 decimal
- [x] formatCosts handles zero, large, fractional values
- [x] formatWinRate formats with no decimals
- [x] BacktestSummary renders nothing when totals null
- [x] BacktestSummary renders with data-testid
- [x] Net P&L displayed with correct formatting
- [x] Costs displayed in ₹X.XK format
- [x] Win rate displayed as integer %
- [x] Trades count displayed
- [x] Negative net P&L handled
- [x] Zero values handled
- [x] Labels shown: Net PnL, Costs, WR, Trades
- [x] Individual data-testids on stat items

## BacktestProgress
- [x] calcProgressPercent returns correct percentage
- [x] calcProgressPercent returns 0 when total is 0
- [x] calcProgressPercent returns 0 when current is 0
- [x] calcProgressPercent handles 100% completion
- [x] calcProgressPercent handles partial progress
- [x] Progress container rendered with data-testid
- [x] Counter displayed as current/total
- [x] Progress message displayed
- [x] Progress bar rendered
- [x] "Running..." title displayed
- [x] Different progress values rendered correctly

## ParamInput
- [x] NumberInput rendered for number type
- [x] Displays default value when value undefined
- [x] Displays provided value
- [x] Allows typing new value, calls onChange
- [x] Select rendered for select type
- [x] Select displays default value
- [x] Select displays provided value
- [x] Select rendered with all options
- [x] Checkbox rendered for boolean type
- [x] Checkbox displays default when undefined
- [x] Checkbox displays provided true/false
- [x] Checkbox calls onChange with boolean on click
- [x] Checkbox toggles correctly through rerender

## SymbolChips
- [x] Multi-select input rendered
- [x] No chips shown when no symbols
- [x] Chips rendered for selected symbols
- [x] Only MAX_VISIBLE_CHIPS (5) shown when not expanded
- [x] Expand button shows when overflow
- [x] Clicking expand button shows all chips + collapse button
- [x] Collapse button hides extra chips
- [x] Chip X button calls onSymbolsChange removing symbol
- [x] Clear all button shown when symbols selected
- [x] Clear all button hidden when no symbols
- [x] Clear all calls onSymbolsChange([])
- [x] Single chip renders without expand button
- [x] Many symbols (20) only show first 5 + expand

## Backtest State (backtest.ts)
- [x] getState returns current backtest state
- [x] setCurrentView changes view
- [x] setStrategies updates strategies
- [x] setStrategiesLoading updates loading
- [x] setVariations updates variations
- [x] setSelectedVariationId sets variation id
- [x] setSelectedVariation loads variation params, updates strategy/params
- [x] setSelectedStrategy sets defaults for that strategy
- [x] setSelectedSymbols updates symbols
- [x] addSymbol adds new symbol
- [x] removeSymbol removes symbol
- [x] setParam updates single param, clears variation
- [x] setParams sets all params
- [x] setParamsKeepVariation merges params
- [x] setDays updates days
- [x] setIncludeCosts toggles costs
- [x] setResults stores results, totals, resets progress/charts
- [x] setRunning updates isRunning
- [x] setProgress updates progress partial
- [x] setError sets error, stops running
- [x] setTradeHistory sets trades and symbol
- [x] setCostBreakdown sets costs
- [x] resetBacktestState resets to initial
- [x] setShowCharts toggles chart visibility
- [x] setSelectedChartSymbol sets chart symbol
- [x] setChartDataBatch updates multiple chart data entries
- [x] setChartData sets single chart data
- [x] setChartLoading sets loading
- [x] setChartOptions updates chart options

## useBacktestQueryParams
- [x] encodeConfig shortens keys and compresses JSON
- [x] decodeConfig decompresses and expands keys
- [x] configToPayload omits default values
- [x] configToPayload includes strategy when non-default
- [x] configToPayload includes variation when set
- [x] configToPayload includes non-default params
- [x] payloadToUrl returns null for empty payload
- [x] urlToPayload returns null when no encoded param
- [x] URL param 'p' contains compressed config
- [x] On mount, reads URL params and restores config
- [x] Restores strategy, symbols, days, includeCosts, params from URL
- [x] Restores variation when match found
- [x] Writes current config to URL on state changes
- [x] Does not write URL until initial sync done
- [x] Handles missing variation gracefully

## Backend (backtest/)
- [ ] Backtest engine runs for ORB strategy
- [ ] Backtest engine runs for SR Breakout strategy
- [ ] Backtest engine runs for 52W Chaser strategy
- [ ] Backtest engine runs for 52W Target strategy
- [ ] Backtest engine runs for EMA Cross strategy
- [ ] calculate_trading_costs computes brokerage, STT, exchange, SEBI, stamp, GST
- [ ] Backtest with includeCosts=true includes costs in P&L
- [ ] Backtest with includeCosts=false excludes costs
- [ ] Results include net_pnl, total_costs, win_rate, trades
- [ ] Per-symbol results returned with TP/SL counts
- [ ] Progress updates streamed during backtest run
- [ ] Chart data returned for backtest symbols
- [ ] Trade history accessible per symbol
- [ ] Backtest handles empty symbols gracefully
- [ ] Backtest handles invalid symbol gracefully

## Backtest E2E
- [x] Symbol multiselect displayed
- [x] Add symbol and run backtest
- [x] Strategy config section displayed
- [x] Days input displayed
- [x] Include costs checkbox displayed
- [x] Reset option in run menu
- [x] Backtest results table displayed after run
- [x] Results summary (Net PnL, Costs, WR, Trades) displayed
- [x] Results rows clickable
- [x] Trade history panel opens on result click
- [x] Trade history sorting works
- [ ] Backtest progress bar displayed during run
- [ ] Variation select shows templates and custom variations
- [ ] Variation select changes param defaults
- [x] URL params encode/decode strategy config
- [x] URL params restore variation on page load
- [x] URL params restore symbols on page load
- [x] URL params restore params on page load
- [ ] URL params cleared on reset
- [x] Chart visible for backtest results
- [ ] Chart toggle options functional (ORB zones, entry/exit markers, SL/TP lines)
