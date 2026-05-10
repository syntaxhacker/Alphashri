# E2E Spec Files & Test Scenarios

## tests/e2e/app.spec.ts — Alphashri / Paper Trading Settings

- [x] Main page loads with title containing "Alphashri"
- [x] Displays data table with rows
- [x] Displays mock stock data with correct symbol
- [x] Paper Trading: updates Max Positions to 4, saves, persists on refresh
- [x] Paper Trading: displays all settings sections (ORB Settings, Risk Management, Runner Settings, Trading Costs)
- [x] Paper Trading: settings have correct default values (SL=0.4, TP=1.2, cooldown=30)
- [x] Paper Trading: resets settings to defaults

## tests/e2e/auth.spec.ts — Authentication

- [x] Shows login form when not authenticated
- [x] Shows register link on login form
- [x] Logs in successfully with valid credentials
- [x] Shows error message with invalid credentials
- [x] Validates email format via HTML5 validation
- [x] Requires password field via HTML5 validation
- [x] Switches to register form
- [x] Registers new user successfully
- [x] Shows user info in navbar footer
- [x] Logs out when clicking sign out
- [x] Clears tokens on logout
- [x] Persists session on page refresh
- [x] Redirects to login when token expired

## tests/e2e/layout.spec.ts — Layout

- [x] App shell is visible on page load
- [x] App header is visible
- [x] App navbar is visible
- [x] App main is visible
- [x] Theme toggle button is visible in navbar
- [x] Clicking theme toggle toggles between light/dark mode
- [x] User menu trigger is visible in navbar footer
- [x] Clicking user menu opens dropdown
- [x] User avatar, display name, email are visible in dropdown
- [x] Clicking logout clears auth and redirects to root
- [x] Sidemenu contains all nav links
- [x] App header contains Alphashri logo
- [x] Navbar footer contains user button
- [x] Sidebar collapse toggle collapses sidebar and hides itself
- [x] When collapsed, navbar-links still exists
- [x] Market ticker is visible in header
- [x] Individual ticker items are present
- [x] Market ticker updated timestamp is visible

## tests/e2e/market-ticker.spec.ts — Market Ticker

- [x] Displays market ticker at the top of page
- [x] Displays all 6 ticker items (Nifty 50, Bank Nifty, Gold)
- [x] Displays correct ticker labels
- [x] Displays positive changes in green
- [x] Displays negative changes in red
- [x] Displays updated timestamp
- [x] Shows error state when API fails
- [x] Shows loading state initially
- [x] Auto-refreshes ticker data (skipped — 30s interval)

## tests/e2e/news.spec.ts — News

- [x] Shows news toggle button with "NEWS" text on page load
- [x] Opens panel when toggle button is clicked
- [x] Closes panel when close button is clicked
- [x] Closes panel when overlay is clicked
- [x] Displays news source selector
- [x] Displays refresh button
- [x] Displays news items
- [x] Shows headlines for news items
- [x] Marks unread items with visual indicator
- [x] Allows switching news sources
- [x] Reloads news when refresh button is clicked
- [x] Navigates to /news page
- [x] Displays news page header
- [x] Displays source selector on news page
- [x] Displays news list items
- [x] Displays BULLISH sentiment badge
- [x] Displays BEARISH sentiment badge
- [x] Displays impact score ring
- [x] Opens article detail on click
- [x] Displays summary in article detail
- [x] Displays "Key Takeaways" section
- [x] Displays "Trade Ideas" section
- [x] Displays LONG trade idea with green badge
- [x] Displays "Stocks mentioned" section
- [x] Shows close button in article detail on mobile
- [x] Returns to news list when clicking back on mobile
- [x] Filters news by search query
- [x] Filters news by source
- [x] Shows loading indicator while fetching news
- [x] Responsive: mobile viewport (375x667)
- [x] Responsive: tablet viewport (768x1024)
- [x] Responsive: desktop viewport (1920x1080)

## tests/e2e/bots.spec.ts — Bots View

- [x] Navigates to bots view via sidebar
- [x] Loads bots view from URL
- [x] Displays list of bots (skipped — CI timeout)
- [x] Shows bot status for each bot (skipped — CI timeout)
- [x] Shows strategies count for each bot
- [x] Shows PID for running bots
- [x] Create bot button is visible
- [x] Opens create bot modal
- [x] Creates new bot
- [x] Edit button is visible for each bot
- [x] Opens edit modal with current values pre-filled
- [x] Saves edited bot
- [x] Delete button is visible for each bot
- [x] Confirms before deleting
- [x] Removes bot from list after delete
- [x] Shows Start Bot button when bot is not running
- [x] Shows Stop Bot button when bot is running
- [x] View status button is visible for each bot
- [x] Bot status panel is shown when view status is clicked
- [x] Shows assigned strategies with count
- [x] Adds strategy to bot
- [x] Sets capital allocation for strategy

## tests/e2e/multi-strategy.spec.ts — Multi-Strategy System

- [x] Different signal generators for ORB and 52W strategies (skipped)
- [x] Shows ORB-specific scan items (skipped)
- [x] Shows 52W-specific scan items (skipped)
- [x] Separate watchlists per strategy type (skipped)
- [x] Positions with strategy attribution (skipped)
- [x] Filters positions by strategy tab (skipped)
- [x] Shows all positions in All tab (skipped)
- [x] ORB levels on chart for ORB positions (skipped)
- [x] 52W high line on chart for 52W positions (skipped)

## tests/e2e/multi-strategy-watchlist.spec.ts — Multi-Strategy Watchlist/Trade History

- [x] Shows strategy in trade history (skipped)
- [x] Filters history by strategy (skipped)
- [x] Shows P&L per strategy in tabs (skipped)
- [x] Strategy P&L in portfolio (skipped)

## tests/e2e/multi-strategy-signal-types.spec.ts — Multi-Strategy Signal Types

- [x] Displays ORB strategy type badge
- [x] Displays SR_BREAKOUT strategy type badge
- [x] Displays 52W_CHASER strategy type badge
- [x] Displays 52W_TARGET strategy type badge
- [x] Displays EMA_CROSS strategy type badge
- [x] Displays EMA_CROSS strategy name correctly
- [x] Shows strategy count including all types
- [x] Displays each strategy name with correct type badge
- [x] Creates bot with ORB strategy
- [x] Creates bot with SR_BREAKOUT strategy
- [x] Creates bot with 52W_CHASER strategy
- [x] Creates bot with 52W_TARGET strategy
- [x] Creates bot with EMA_CROSS strategy
- [x] Creates bot with mixed strategy types
- [x] Creates bot with all four strategy types
- [x] Validates total allocation does not exceed 100%
- [x] Adds a new strategy to existing bot
- [x] Adds EMA_CROSS strategy to existing bot (skipped)
- [x] Removes a strategy from bot
- [x] Changes strategy type via edit

## tests/e2e/screener.spec.ts — Screener

- [x] Displays stock data table with rows
- [x] Displays correct columns (Symbol, Score) in table header
- [x] Stock symbols are clickable links to /chart/
- [x] Displays approaching and touched sections
- [x] Displays last updated timestamp
- [x] Displays screener navigation tabs
- [x] Switches between screeners via tabs
- [x] Shows active screener highlighted
- [x] Auto-refresh input is visible
- [x] Disables auto-refresh when set to 0
- [x] Summary strip is displayed when data available
- [x] Summary strip shows market summary metrics
- [x] Trading list textarea is displayed
- [x] Copy trading list to clipboard (Copy button)
- [x] Error state when API fails (skipped)
- [x] Retry on error (skipped)
- [x] Config tab is visible
- [x] Switches to Config tab
- [x] Displays screener list in config view
- [x] Displays filter badges for screener with filters
- [x] Displays PREVIEW section
- [x] Shows active screener in config list
- [x] Create button is visible in config
- [x] Opens create modal when clicking Create
- [x] Shows form fields (name input, preview) in create modal
- [x] Create button is disabled when no name entered
- [x] Create is enabled when columns selected (skipped)
- [x] Live preview is displayed in create modal

## tests/e2e/screener-interactions.spec.ts — Screener Interactions

- [x] Copies all symbols to clipboard
- [x] Switches to heatmap view
- [x] Navigates to chart on symbol click
- [x] Displays side panel with screener info

## tests/e2e/screener-url-params.spec.ts — Screener URL Params

- [x] Restores screener from URL param on page load
- [x] Updates URL when screener nav is clicked
- [x] Updates URL param when switching screener
- [x] Preserves URL screener param across tab switches

## tests/e2e/screener-section-labels.spec.ts — Screener Section Labels

- [x] Shows dynamic section labels for non-52W screener
- [x] Shows "Approaching" for trending screener
- [x] Keeps nav active after API resolves
- [x] Shows "Touched" section when data has touched stocks

## tests/e2e/backtest.spec.ts — Backtest Navigation

- [x] Displays symbol multiselect
- [x] Adds symbol to list and runs backtest
- [x] Displays strategy config section
- [x] Displays days input
- [x] Displays include costs checkbox
- [x] Has reset option in run menu
- [x] Run backtest button is visible
- [x] Runs backtest and displays results
- [x] Displays chart tabs after backtest
- [x] Displays zoom select after backtest
- [x] Displays results summary after backtest

## tests/e2e/backtest-mantine.spec.ts — Backtest Mantine Features

- [x] Zoom dropdown has All, 30D, 7D, 1D options
- [x] Symbol tabs displayed when multiple symbols in results
- [x] Switches chart when clicking different symbol tab
- [x] Trade row highlighted when clicked
- [x] Trade row highlight removed after 3s timeout
- [x] Results table sorts when clicking column header
- [x] Sort direction toggles when clicking same column twice
- [x] Run backtest button works
- [x] Net PnL displayed in summary
- [x] Costs displayed in summary
- [x] Win Rate displayed in summary
- [x] Trades count displayed in summary
- [x] Empty state shown when no results
- [x] Error alert displayed when backtest fails
- [x] Chart legend displayed
- [x] Trade history sorts by time
- [x] Trade history sorts by P&L
- [x] Trade summary (P&L, WR, wins) in history panel
- [x] Trade history panel can be closed
- [x] Symbol displayed in results
- [x] P&L value displayed in results
- [x] Trades count displayed in results
- [x] Win rate displayed in results
- [x] Profit factor displayed in results
- [x] TP/SL exits displayed in results
- [x] Reset functionality clears results
- [x] Symbol chips displayed after adding symbols
- [x] Clear all symbols button visible when symbols selected
- [x] Clear all symbols removes chips and disables run
- [x] Individual symbol chip can be removed
- [x] Run dropdown menu shows Run Backtest, Run & Save, Reset Config
- [x] Strategy variation select is visible and interactive

## tests/e2e/backtest-url-params.spec.ts — Backtest URL Params

- [x] Loads strategy and symbols from URL params
- [x] Loads 52W target strategy from URL params
- [x] Loads variation by ID from URL params
- [x] Loads custom params from URL params
- [x] Updates URL when user changes strategy
- [x] Updates URL when user adds symbol
- [x] Preserves URL params on navigation away and back

## tests/e2e/strategies-v2.spec.ts — Strategies V2

- [x] Navigates via nav-strategies link
- [x] Navigates via URL /strategies
- [x] Strategies nav tabs visible with Strategy Tree default active
- [x] Switches to Performance tab
- [x] Switches back to Strategy Tree tab
- [x] Template tree panel visible with tree nodes
- [x] Empty state visible with empty mocks
- [x] Create from template modal opens
- [x] Modal has strategy name and type inputs
- [x] Modal has ORB, Risk, Runner tabs
- [x] Risk tab panel visible when clicked
- [x] Cancel button closes modal
- [x] Edit template modal visible on pencil icon click
- [x] Edit modal name input pre-filled, submit works
- [x] Error state visible with error mocks
- [x] Retry and dismiss buttons visible in error state

## tests/e2e/paper-trading.spec.ts — Paper Trading

- [x] Paper trading view with tabs (Live, Trade History, Settings) visible
- [x] Bot cards displayed
- [x] Portfolio summary visible with Value and Cash
- [x] Scan items from multi-strategy bot visible
- [x] Positions with strategy tabs displayed
- [x] Positions filtered by strategy tab
- [x] Bot status shows running/pid when bot is running
- [x] Empty state shown when no positions
- [x] Calls bots API on load
- [x] Calls portfolio API when bot is selected
- [x] Calls scan API when bot is selected
- [x] Start Bot button triggers start and updates UI
- [x] Start Bot button shown when bot is not running
- [x] Stop Bot button shown when bot is running
- [x] All positions shown in "All" tab
- [x] Watchlist scan card with accordion sections (Signals, Watching, Skipped)
- [x] Accordion component used (not flat table)
- [x] Signals accordion item present
- [x] Watching accordion item present
- [x] Skipped accordion item present
- [x] Signals section with signal items (LONG/SHORT)
- [x] Watching items displayed
- [x] Skipped items displayed in table
- [x] Skipped symbols deduplicated across strategies
- [x] "No scan data" shown when bot is stopped
- [x] Close button visible for each position
- [x] Close position button clickable without error
- [x] Close All button visible when positions exist
- [x] Close All clickable without error
- [x] Close All API endpoint is called
- [x] Updates ORB sl_pct and saves
- [x] Updates Risk risk_per_trade and saves
- [x] Resets settings to defaults
- [x] Shows validation error for invalid sl_pct
- [x] Portfolio card shows total value and cash
- [x] Portfolio card shows strategy summaries section
- [x] Portfolio card shows daily loss bar section
- [x] Portfolio card shows Day P&L
- [x] Chart controls: all switches visible (ALL trades, ORB, Pivot, 52W, EMA)
- [x] Chart controls: toggle EMA lines
- [x] Chart controls: toggle ORB lines
- [x] Chart controls: toggle 52W lines
- [x] Chart controls: toggle SL/TP markers
- [x] Chart controls: switch timeframe
- [x] Chart controls: chart header with symbol and date
- [x] Settings panel: all section headers (ORB, Risk, Runner, Costs)
- [x] TradingCostsSection: all fields visible
- [x] TradingCostsSection: all field labels visible
- [x] RiskManagementSection: all fields visible
- [x] RiskManagementSection: all field labels visible
- [x] OrbSettingsSection: all fields visible
- [x] OrbSettingsSection: all field labels visible
- [x] RunnerSettingsSection: all fields visible
- [x] RunnerSettingsSection: all field labels visible

## tests/e2e/navigation-v2.spec.ts — Navigation V2

- [x] Displays all 9 non-admin nav items
- [x] Does not display admin nav for non-admin user
- [x] Displays admin nav for admin user
- [x] Click nav-screener navigates to /
- [x] Click nav-news navigates to /news
- [x] Click nav-backtest navigates to /backtest
- [x] Click nav-paper navigates to /paper
- [x] Click nav-sector navigates to /sector
- [x] Click nav-strategies navigates to /strategies
- [x] Click nav-bots navigates to /bots
- [x] Click nav-options navigates to /options
- [x] Click nav-settings navigates to /settings
- [x] Default active state on screener
- [x] Active state updates after clicking nav-news
- [x] Active state updates after clicking nav-paper
- [x] Active state updates after clicking nav-bots
- [x] Active state updates after clicking nav-settings
- [x] Deep link to /paper loads paper trading view
- [x] Deep link to /strategies loads strategies view
- [x] Deep link to /options loads options view
- [x] Deep link to /settings loads settings page
- [x] Deep link to /news loads news page
- [x] Browser back from strategies returns to screener
- [x] Browser forward returns to options
- [x] Unknown route /unknown-page redirects to screener

## tests/e2e/controls.spec.ts — UI Controls

- [x] Refreshes data when refresh button clicked
- [x] Copies trading list to clipboard
- [x] Changes auto-refresh interval (skipped — flaky)
- [x] Shows error state when API fails (skipped)
- [x] Shows loading state during data fetch

## tests/e2e/correlation.spec.ts — Correlation

- [x] No console errors/warnings during correlation tests
- [x] Correlation tab visible on screener page
- [x] Switches to correlation tab and shows controls
- [x] Calculate button disabled with fewer than 2 symbols
- [x] Timeframe and period controls visible
- [x] Switches between daily and intraday timeframe
- [x] Switches between period options
- [x] Shows correlation data after calculate (skipped)
- [x] Shows meta stats (Date Range, Symbols, Data Points) after calculation (skipped)

## tests/e2e/sector.spec.ts — Sector Dashboard

- [x] Navigates to sector dashboard view
- [x] Displays "Sector Dashboard" title
- [x] Displays subtitle about real-time performance
- [x] Displays India and US market toggle buttons
- [x] Displays Live Dashboard and Historical Cycles tabs
- [x] Displays Refresh button
- [x] Live Dashboard tab is active by default
- [x] Sector performance table with headers (Sector, Change, A/D Ratio, Strength)
- [x] Top sector summary card with green styling
- [x] Market breadth card with UP/DOWN badges
- [x] Weakest sector summary card
- [x] Real-time alerts section
- [x] Interval movers section
- [x] Switches to Historical Cycles tab and shows iframe
- [x] Switches back to Live Dashboard tab
- [x] Iframe src points to dashboard-modular.html
- [x] Hides dashboard content when on Historical Cycles tab
- [x] India button visible in header
- [x] US button visible in header
- [x] Toggles between India and US markets
- [x] Refresh button visible and clickable
- [x] Responsive: desktop viewport (1280x720)
- [x] Responsive: tablet viewport (768x1024)
- [x] Responsive: mobile viewport (375x667)
- [x] Updates navigation active state when navigating to sector
- [x] Navigates to sector from other views
- [x] Navigates away from sector to other views

## tests/e2e/sector-correlation.spec.ts — Sector Correlation

- [x] Displays Sector Correlation tab
- [x] Navigates to correlation tab and displays heatmap with canvas
- [x] Displays beta bar chart with Beta and Benchmark labels
- [x] Relative strength table with columns (Rank, Sector, 5D RS, 1M RS, 3M RS, Beta, 1M Change)
- [x] Table shows NIFTY 50 and NIFTY BANK data
- [x] Rotation timeline section is visible
- [x] Switches between India and US markets in correlation tab
- [x] Changes lookback period (1M) and refreshes data
- [x] Shows last updated timestamp

## tests/e2e/notifications.spec.ts — Notification Panel

- [x] Opens notification panel when button clicked (skipped)
- [x] Shows notification filter tabs All/Primary/Secondary (skipped)
- [x] Clears notifications when clear button clicked
- [x] Filters notifications by type

## tests/e2e/options.spec.ts — Options View

- [x] Navigates to options view via side menu
- [x] Loads options view directly from URL
- [x] Displays option chain panel by default
- [x] Displays underlying and expiry selectors
- [x] Displays chain summary with PCR and Max Pain
- [x] Displays option chain table with strike prices
- [x] Opens user guide modal
- [x] Switches between table and analysis views
- [x] Filters by option type

## tests/e2e/buyer-interest.spec.ts — Buyer Interest+ Screener

- [x] Loads Buyer Interest+ data and shows columns
- [x] Displays bullish stocks with high wick percentage
- [x] Shows sentiment data in table with mock symbols

## tests/e2e/live-prices.spec.ts — Live Price Streaming

- [x] Live price updater component is mounted
- [x] Position current_price updates from live prices

## tests/e2e/trade-history.spec.ts — Trade History

- [x] Trade history tab visible
- [x] Trade history table visible
- [x] Trade details (symbol, price) shown in table
- [x] Empty state when no trades
- [x] Filters by date range
- [x] Filters by symbol
- [x] Filters by strategy
- [x] Clears filters
- [x] Shows entry and exit prices
- [x] Shows P&L for each trade
- [x] Shows strategy name for each trade
- [x] Shows trade timestamp
- [x] Export button is visible
- [x] Exports to CSV
- [x] Pagination controls shown for large datasets
- [x] Can navigate to next page
- [x] Bot filter dropdown is visible
- [x] Strategy filter dropdown is visible
- [x] Trade row expands on toggle to show stats
- [x] Trade stats values (reason, notes) shown when expanded
- [x] Trade notes editor (reason, notes fields, save btn) shown when expanded
- [x] Trade notes can be edited and saved
- [x] Delete trade button is visible
- [x] Delete trade button clickable without error

## tests/e2e/sorting.spec.ts — Table Sorting

- [x] Sorts by Score column (descending)
- [x] Toggles sort direction when clicking same column twice
- [x] Sorts by Symbol column
- [x] Clickable sort indicators on sortable columns

## tests/e2e/all-strategies-replay-chart.spec.ts — Replay Chart (All Strategies)

- [x] ORB replay runs and displays chart
- [x] ORB toggle control visible
- [x] Symbol badge for traded symbol visible
- [x] SR Breakout replay runs and displays chart
- [x] Pivot toggle control visible
- [x] EMA Cross replay runs and displays chart
- [x] EMA toggle control visible
- [x] 52W Chaser replay runs and displays chart
- [x] 52W toggle control visible
- [x] 52W Target replay runs and displays chart
- [x] All-trades toggle visible
- [x] Markers toggle visible
- [x] Replay config form displayed (date, strategy, symbols, run button)
- [x] Refresh cache switch visible
- [x] Trade log displayed after replay
- [x] Strategy filter in trade log
- [x] Symbol filter in trade log
- [x] Trade rows with strategy links
- [x] Replay stats visible
- [x] Replay summary visible
- [x] Replay positions panel visible when trades exist
- [x] Empty state when no replay data
- [x] Timeframe buttons present

## tests/e2e/all-strategies-paper-chart.spec.ts — Paper Chart (All Strategies)

- [x] ORB position chart displayed
- [x] ORB lines toggle visible
- [x] Chart with SL/TP data for live position
- [x] Chart shown when position is clicked
- [x] SR Breakout position chart displayed
- [x] Pivot lines toggle visible
- [x] 52W Chaser position chart with 52W levels
- [x] 52W lines toggle visible
- [x] EMA Cross position chart with EMA overlays
- [x] EMA lines toggle visible
- [x] Timeframe selector visible
- [x] All-trades switch visible
- [x] Chart renders for live position
- [x] Chart header with symbol
- [x] Chart legend visible
- [x] Placeholder when no position is selected
- [x] SELL (SHORT) position chart displayed

## tests/e2e/all-strategies-multi-signal-types.spec.ts — Multi-Strategy All 5 Types

- [x] Strategy tabs visible for all 5 strategy types
- [x] Positions shown for each strategy type row
- [x] Filters positions by strategy tab — ORB
- [x] Filters positions by strategy tab — SR Breakout
- [x] Filters positions by strategy tab — EMA Cross
- [x] Filters positions by strategy tab — 52W Chaser
- [x] Filters positions by strategy tab — 52W Target
- [x] All positions shown in All tab
- [x] Scan items with strategy attribution
- [x] Signal scan items visible
- [x] Watching scan items visible
- [x] Strategy column in positions table
- [x] Correct strategy name per position
- [x] Single ORB strategy works
- [x] Single 52W Chaser strategy works
- [x] Single EMA Cross strategy works
- [x] Empty positions state when no positions
- [x] No scan data when bot is stopped

## tests/e2e/all-strategies-backtest.spec.ts — Backtest (All Strategy Types)

- [x] ORB backtest runs and displays results
- [x] ORB chart displays with trade markers
- [x] ORB zones displayed as overlay data in chart
- [x] Trade in history panel with TP exit reason
- [x] SR Breakout backtest runs and displays results
- [x] SR Breakout chart displays with pivot overlays
- [x] SR level info in trade data
- [x] EMA Cross backtest runs and displays results
- [x] EMA Cross chart displays with EMA overlays
- [x] 52W Chaser backtest runs and displays results
- [x] 52W Chaser chart with 52W high line
- [x] Losing trade for 52W Chaser SL exit
- [x] 52W Target backtest runs and displays results
- [x] 52W Target chart with 52W high line
- [x] Timeframe switching (Native, 5m, 15m, 30m, 1H, 4H)
- [x] Zoom select with All, 30D, 7D, 1D options
- [x] dataZoom configured on chart
- [x] Chart zoom via mouse wheel
- [x] Trade row highlight on click
- [x] Multi-day chart renders without xAxis collapse
- [x] Error alert when backtest API fails
- [x] Empty chart when chart API returns empty candles

## tests/e2e/all-strategies-chart-preview.spec.ts — Chart Preview

- [x] Chart displays with ORB data
- [x] ORB high and low lines displayed
- [x] ORB lines have data (non-null values)
- [x] Pivot levels (PP, R1, S1) displayed
- [x] Chart with 52W levels data
- [x] Chart renders with 52W levels in response
- [x] Chart displays with trade data
- [x] Timeframe switching (1m, 5m, 15m, 30m, 60m)
- [x] Timeframe selector dropdown visible
- [x] Chart refreshes when timeframe changes
- [x] OR minutes setting changeable
- [x] Pivot toggle checkbox works (check/uncheck)
- [x] Combined ORB + Pivot + 52W overlays rendered simultaneously
- [x] Chart controls visible
- [x] Back button visible
- [x] Back button navigates away from chart
- [x] Symbol in title
- [x] Candle count in footer
- [x] Error shown when API fails
- [x] Error shown for 500 response
- [x] Handles empty candle data
- [x] Handles missing symbol parameter
- [x] Renders on mobile viewport (375x667)
- [x] Renders on tablet viewport (768x1024)
- [x] Renders on desktop viewport (1920x1080)
- [x] dataZoom configured
- [x] Zoom via mouse wheel
- [x] Pan via drag
- [x] Loading state shown while fetching

## tests/e2e/paper-chart-intraday.spec.ts — Paper Chart Intraday

- [x] Paper trading view with live tab
- [x] Live and history tabs visible

# Known Issues Cross-Reference (from AGENTS.md)

- [ ] **Replay system name→ID migration** — deferred, test IDs may reference strategy names instead of IDs (Phases 3)
- [ ] **ExitReasonBadge**: doesn't color-code rich exit reasons (MANUAL_CLOSE, PnL-formatted strings) — all E2E tests checking ExitReasonBadge color may fail for these reasons
- [ ] **ExitReasonBadge missing cases**: FORCE_CLOSE, TRAILING_STOP, MAX_HOLDING, NEW_52W_HIGH — all show as raw gray text
- [ ] **52W daily data caching** — fetches 400 days per chart request, no caching (performance impact on all chart E2E tests)
- [ ] **`_filter_to_date_or_recent` timezone bug** — known production issue affecting trade history date filtering
- [ ] **TradingAgents auth**: `get_current_user` dependency has compatibility issues — not covered by E2E auth tests for chat/analyze endpoints
- [ ] **Analysis speed**: Multi-agent analysis takes 60-120s — stream E2E tests may need longer timeouts
- [ ] **bots spec skipped tests**: `@smoke should display list of bots` and `@smoke should show bot status for each bot` skipped due to CI timeout
- [ ] **multi-strategy spec skipped tests**: All tests skipped (signal generators, scan items, watchlists, positions, chart levels)
- [ ] **Notification panel tests**: 2 of 4 tests skipped (notif-open-btn interactions)
- [ ] **market-ticker auto-refresh**: Skipped (30s poll interval)
