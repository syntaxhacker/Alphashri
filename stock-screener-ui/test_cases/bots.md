# BotsPage

- [x] Renders `data-testid="bots-view"` container
- [x] Renders "Bots" title and description
- [x] Renders "New Bot" create button
- [x] Renders Bot list tab and Status tab
- [x] Status tab is disabled when no bot is selected
- [x] Shows empty state with "No bots configured" when bots array is empty
- [x] Loading state shows `InlineLoader`
- [x] Error state shows `ErrorAlert` with dismiss button
- [x] Switches to Status view when "View Status" button is clicked
- [x] Calls `stopAutoRefresh` when switching views
- [x] Calls `startAutoRefresh` when viewing status of a running bot
- [x] Calls `startBotAction` on Start
- [x] Calls `stopBotAction` on Stop
- [x] Deletes bot with confirmation dialog
- [x] Initializes bots state on mount via `initBotsState()`
- [x] Cleans up auto-refresh on unmount

# BotStatusPanel

- [x] Renders bot name
- [x] Shows StatusBadge (running/stopped)
- [x] Shows Start Bot button when bot is not running
- [x] Shows Stop Bot button when bot is running
- [x] Refresh button reloads status and trades
- [x] Start handler calls `startBotAction`, reloads status/trades, starts auto-refresh
- [x] Stop handler calls `stopBotAction`, stops auto-refresh, reloads status
- [x] PortfolioSummaryCard is shown when `status.portfolio` exists
- [x] Placeholder card shown when no portfolio data
- [x] Strategy status cards rendered when `status.strategies` exists
- [x] Positions table rendered when positions exist
- [x] Trades table always rendered (empty or populated)
- [x] Shows "Last update" timestamp when available

# BotConfigModal

- [x] Modal title is "Create New Bot" when bot is null
- [x] Modal title is "Edit Bot" when bot is provided
- [x] Form pre-fills bot data when editing
- [x] Bot name input is required
- [x] Active checkbox is shown
- [x] Max Total Positions number input (1-20)
- [x] Max Total Capital % number input (10-100)
- [x] Max Daily Loss % number input (1-20)
- [x] Strategy allocation rows are editable
- [x] Strategy select dropdown shows available strategies
- [x] Allocation % input per strategy (5-100)
- [x] Max Positions input per strategy (1-10)
- [x] Add Strategy button adds a new row
- [x] Remove strategy button removes a row
- [x] Total allocation % is calculated and displayed
- [x] "Over 100%" alert shown when allocation exceeds 100%
- [x] Cancel button closes the modal
- [x] Submit calls `createBotAction` for new bot
- [x] Submit calls `updateBotAction` for existing bot
- [x] StrategyParams displays ORB-specific parameters
- [x] StrategyParams displays SR_BREAKOUT-specific parameters
- [x] StrategyParams displays 52W-specific parameters
- [x] StrategyParams displays EMA_CROSS-specific parameters
- [x] Form submission prevents over-allocation

# BotHelpers

- [x] `PortfolioSummaryCard` displays initial capital, cash, positions count, total P&L
- [x] `StrategyStatusCard` displays strategy name, status, positions count, capital used, P&L, trades count
- [x] `StrategyStatusCard` shows capital usage progress bar
- [x] `PositionsTable` renders column headers (Strategy, Symbol, Side, Qty, Entry, Current, P&L, SL/TP)
- [x] `PositionsTable` returns null when positions array is empty
- [x] `TradesTable` renders column headers (Strategy, Symbol, Side, Qty, Entry, Exit, P&L, Net P&L, Exit Reason)
- [x] `TradesTable` shows "No trades yet" empty state
- [x] `BotActionButtons` shows View, Start/Stop, Edit, Delete buttons
- [x] Start button is disabled when bot is not active
- [x] Delete button is disabled when bot is running
- [x] `BotSummaryCell` shows strategy count and type badges
- [x] `BotRow` shows green indicator for running, gray for stopped
- [x] `BotRow` shows "Inactive" badge when bot is not active
- [x] `getBotRowStyle` applies selection background
- [x] `getBotIndicatorColor` returns correct colors

# config.ts (logic tests)

- [x] `calculateTotalAllocation` sums percentages (decimal * 100)
- [x] Returns 0 for empty strategies array
- [x] `isAllocationOverLimit` returns true for totals > 100
- [x] Returns false for exactly 100
- [x] Returns false for below 100
- [x] `formatAllocationPct` converts decimal to display percentage
- [x] `parseAllocationInput` converts percentage to decimal
- [x] `formatMaxCapitalPct` converts decimal to display percentage
- [x] `parseMaxCapitalInput` converts percentage to decimal
- [x] Handles fractional percentage values
- [x] Handles max positions range 1-10

# status.ts (formatExitReason)

- [x] Maps "target" → "Target"
- [x] Maps "stop_loss" → "Stop Loss"
- [x] Maps "signal" → "Signal"
- [x] Maps "manual" → "Manual"
- [x] Maps "timeout" → "Timeout"
- [x] Returns original string for unknown reasons
- [x] Does not match partial substrings

# formatNumber (status.test.ts)

- [x] Formats numbers < 1000 without suffix
- [x] Formats thousands with K suffix
- [x] Formats lakhs with L suffix
- [x] Handles negative numbers with K suffix
- [x] Handles negative numbers with L suffix
- [x] Handles zero
- [x] Boundary at exactly 1000
- [x] Boundary at exactly 100000
- [x] Numbers just below thresholds (999, 99999)

# index.test.ts (legacy rendering)

- [x] `renderBotsView` renders bots-view container
- [x] Renders list tab as active when view is "list"
- [x] Renders empty state when no bots
- [x] Renders bot list with bot data
- [x] Renders "Running (PID ...)" for running bot
- [x] Renders "Inactive" badge for inactive bot
- [x] Renders error when error state is present
- [x] Renders create modal when showCreateModal is true
- [x] Disables status tab when no bot is selected
- [x] Renders strategy allocations with percentages
- [x] Shows "Over 100%" warning when allocation exceeds 100%
- [x] `initBotsHandlers` attaches handlers to window
- [x] `cleanupBots` calls stopAutoRefresh

# Bot Architecture (from AGENTS.md)

- [ ] Bot runs as separate subprocess via `runner_cli.py`
- [ ] API and bot communicate via DB (positions/trades/runtime state)
- [ ] Redis heartbeat/status/PID
- [ ] `persist_state()` writes to `BotRuntimeState` + `StrategyRuntimeState` DB tables
- [ ] SharedPortfolioManager is source of truth for open positions
- [ ] Close All Positions API closes positions directly from DB
- [ ] Scan items persisted to `bot_runtime_states.scan_items`
- [ ] Position restore on restart: `_load_positions_from_db()`
- [ ] Force close of previous-day positions on restart
- [ ] `low_price` resets to `entry_price` on restore
- [ ] Orphan bot stop: PID read from Redis key with 24h TTL, sends SIGTERM
- [ ] Bot stdout goes to log file (not PIPE) to avoid deadlock
- [ ] Crash notification sends Telegram alert on exception
- [ ] `_TimestampedConsole` prepends `[HH:MM:SS]` to bot log lines

# E2E — Bots Navigation

- [x] Navigates to bots view via sidebar
- [x] Loads bots view from URL directly

# E2E — Bots List

- [ ] Displays list of bots
- [ ] Shows bot status for each bot
- [x] Shows strategies count for each bot
- [x] Shows PID for running bots

# E2E — Bots Create

- [x] Create bot button is visible
- [x] Opens create bot modal on click
- [x] Creates new bot via save

# E2E — Bots Edit

- [x] Edit button is visible for each bot
- [x] Opens edit modal with current values pre-filled
- [x] Saves edited bot

# E2E — Bots Delete

- [x] Delete button is visible for each bot
- [x] Confirms before deleting
- [x] Removes bot from list after delete

# E2E — Bots Controls

- [x] Shows Start Bot button when bot is not running
- [x] Shows Stop Bot button when bot is running

# E2E — Bots Status

- [x] View status button is visible for each bot
- [x] Bot status panel is shown when view status is clicked

# E2E — Bots Strategy Assignments

- [x] Shows assigned strategies with count
- [x] Adds strategy to bot
- [x] Sets capital allocation for strategy

# E2E — Multi-Strategy Signal Types

- [x] Displays ORB strategy type badge
- [x] Displays SR_BREAKOUT strategy type badge
- [x] Displays 52W_CHASER strategy type badge
- [x] Displays 52W_TARGET strategy type badge
- [x] Displays EMA_CROSS strategy type badge
- [x] Shows strategy count including all types
- [x] Displays each strategy name with correct type badge

# E2E — Multi-Strategy Create with Different Types

- [x] Creates bot with ORB strategy
- [x] Creates bot with SR_BREAKOUT strategy
- [x] Creates bot with 52W_CHASER strategy
- [x] Creates bot with 52W_TARGET strategy
- [x] Creates bot with EMA_CROSS strategy
- [x] Creates bot with mixed strategy types
- [x] Creates bot with all four strategy types
- [x] Validates total allocation does not exceed 100%

# E2E — Multi-Strategy Edit Strategy Types

- [x] Adds a new strategy to existing bot
- [x] Removes a strategy from bot
- [x] Changes strategy type via edit

# E2E — Multi-Strategy System (Signal Generators)

- [ ] Shows different signal generators for ORB and 52W strategies
- [ ] Shows ORB-specific scan items
- [ ] Shows 52W-specific scan items
- [ ] Separate watchlists per strategy type
- [ ] Shows positions with strategy attribution
- [ ] Filters positions by strategy tab
- [ ] Shows all positions in All tab
- [ ] Shows ORB levels on chart for ORB positions
- [ ] Shows 52W high line on chart for 52W positions

# E2E — Multi-Strategy Trade History

- [ ] Shows strategy in trade history
- [ ] Filters history by strategy

# E2E — Multi-Strategy P&L

- [ ] Shows P&L per strategy in tabs
- [ ] Shows strategy P&L in portfolio
