# Table Placement & Alignment Checklist — Alphashri

Branch: fix/table-alignment  |  Shared component: `src/components/common/TanStackTable.tsx`

## Behavior (implemented in shared TanStackTable)
1. **Header aligns with cell text** — `th` defaults to left (browser default is center, which misaligned headers over left-aligned cells).
2. **Numeric columns right-align automatically** — columns whose sample values are all numbers get `right` on both header and cells; text columns stay `left`.
3. **`meta: { align }` overrides** the auto behavior per column.
4. **Theme-aware card backgrounds** — no more white boxes in dark mode (`light-dark(...)`).

## Table placement map (all 25 use the shared TanStackTable — NO custom tables)

### `/` — Screener
- ScreenerTable.tsx — dynamic columns (col.key) | text+numbers mixed | auto-align ✓

### `/backtest` — Backtest
- BacktestHistory.tsx — created_at(text/date), strategy_name(text), symbols(text)
- BacktestResultsTable.tsx — symbol(text), net_pnl(num), trades(num), win_rate(num), pf(num)
- TradeHistoryTable.tsx — entry_time/exit_time (dates, left)

### `/bots` — Bots
- BotsPage.tsx — name(text), max_total_positions(num), max_total_capital_pct(num)
- BotHelpers.tsx — 16 cols: symbol/side(text), quantity/entry_price/current_price/net_pnl(num), etc.
- StrategyPerformance.tsx — strategy_name(text), trades/wins/losses/win_rate/net_pnl(num) ✅ VERIFIED in browser

### `/experiments` — Experiments
- ExperimentsResultsTable.tsx — symbol(text), run(label) | has explicit meta.align

### `/options` — Options
- PositionsPanel.tsx — trading_symbol/option_type(text), strike_price/quantity/average_price/current_price/pnl(num)

### `/paper` — Paper Trading
- AggregatedDashboard.tsx — 16 cols (3 tables): bot/symbol(text), trades/win_rate/pf/hold/net_pnl(num)
- PaperHistoryTable2.tsx — 11 cols: symbol/side(text), qty/prices/hold/sl/tp/pnl(num)
- PositionsHelpers.tsx — symbol/name(text), count/marginUsed/totalPnl(num)
- WatchlistScan2.tsx — symbol/side/strategy/reason(text), price(num), timestamp(date)

### `/replay` — Replay
- ReplayPositions.tsx — symbol/side/strategy(text), qty/prices/sl/tp(num), entry_time(date)
- ReplaySummary.tsx — name(text), trades/win_rate/net_pnl/profit_factor(num)
- ReplayTradeLog.tsx — symbol/side(text), qty/prices/pnl/net(num), times(dates)

### `/sector` — Sector
- IntervalMoversTable.tsx — symbol(text), prev_change/change/delta(num) | has explicit meta.align
- SectorCorrelationTab.tsx — name(text), relative_strength_*/beta/rank(num) | has explicit meta.align
- SectorTable.tsx — sector(text), avg_change/avg_adx(num), top_movers(text)

### `/strategies` — Strategies
- PerformanceView.tsx — strategy_name(text), total_trades/win_rate/net_pnl(num)

### `/strategy-runner` — Strategy Runner
- StrategyRunnerTabs.tsx — 18 cols across 4 tabs: names/text, trades/win_rate/net_pnl/pf/price(num)

### `/admin` — Admin
- LLMStatsPanel.tsx — url/model/status(text), cost_usd/response_time_ms(num), created_at(date)
- RecentRunsTable.tsx — same shape

### `/heatmap` — Heatmap
- HeatmapListView.tsx — symbol/name/sector(text), pe_ratio/market_cap/price/change_pct(num)
- TopBottomView.tsx — rank(num), symbol/name/sector(text), pe_ratio(num)

## Verification checklist (status)
- [x] Audit: no raw/custom tables remain in any screen (only TanStackTable + its sub-components)
- [x] TanStackTable unit tests: 22/22 (incl. numeric auto-align + meta override)
- [x] 128 tests across 8 table-consuming components (BotHelpers, PaperHistoryTable2, PerformanceView, SectorTable, ReplayPositions, ReplayTradeLog, IntervalMoversTable, PositionsHelpers)
- [x] Browser-verified: Strategy Performance (text left, numbers right, header aligned)
- [x] Browser-verified: StrategyPerformance summary card bg in light + dark mode
- [x] Build passes
- [x] Lint: 0 errors on changed files (1 pre-existing warning: unused `bots` param in StrategyRunnerTabs)

## Remaining eyeball checks (need real data / user confirmation)
- [ ] /sector tables with live data (auto-align on relative_strength/beta columns)
- [ ] /admin tables with real LLM run data
- [ ] /paper AggregatedDashboard 3-table layout with live trades
- [ ] /replay tables during an active replay
- [ ] /heatmap list + top/bottom views with data
- [ ] /strategy-runner 4 tabs with a run
