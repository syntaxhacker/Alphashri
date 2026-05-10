# Strategies

## StrategiesContainer
- [x] Mounts and reads initial strategies state
- [x] Calls initStrategiesState on mount

## StrategiesPage
- [x] Renders with data-testid strategies-view
- [x] Nav container rendered
- [x] Content area rendered
- [x] Error state shows error panel with Retry and Dismiss buttons
- [x] Retry button calls onRefresh
- [x] Dismiss button calls onClearError
- [x] Active view "tree" renders TemplateTreeView
- [x] Active view "performance" renders PerformanceView
- [x] StrategyForm create modal rendered
- [x] StrategyForm edit modal rendered

## StrategiesNav
- [x] Nav renders with data-testid
- [x] Title "Strategies" displayed
- [x] Description displayed
- [x] Segmented control with "Strategy Tree" and "Performance" tabs
- [x] Tab change calls onChange

## TemplateTreeView
- [x] Loading state shown when isLoading and no templates
- [x] Empty state shown when no templates
- [x] Tree panel rendered with data-testid
- [x] Column headers: Name, Type, SL%, TP%, MaxPos, Actions
- [x] Tree nodes rendered for each template with children
- [x] Template nodes have bold font weight
- [x] Variation nodes have normal font weight
- [x] Template nodes show strategy type badge
- [x] Template expand/collapse chevron toggles children
- [x] Template actions: Edit, Sync Variations, Create Variation
- [x] Variation actions: Edit, Delete
- [x] Edit template button calls onEditTemplate
- [x] Sync Variations button confirms then calls onSyncVariations
- [x] Create Variation button calls onCreateFromTemplate
- [x] Edit strategy button calls onEditStrategy
- [x] Delete strategy button calls onDeleteStrategy
- [x] EditableNumberCell for SL% renders with correct value
- [x] EditableNumberCell for TP% renders with correct value
- [x] EditableNumberCell for MaxPos renders with correct value

## EditableNumberCell
- [x] Renders with initial value
- [x] Calls onUpdate on blur when value changes
- [x] Does not call onUpdate on blur when value unchanged
- [x] Does not call onUpdate on blur when value invalid
- [x] Reverts value on update failure
- [x] Calls onUpdate on Enter key
- [x] Reverts value on Escape key without saving
- [x] Stops propagation on key events
- [x] Handles integer fields (max_positions)
- [x] Syncs with external value changes
- [x] Does not sync external value while user is editing dirty value

## PerformanceView
- [x] Shows loading state with Loader when isLoading
- [x] Shows empty state when performance array empty
- [x] Summary stats displayed: Total Trades, Win Rate, Total P&L, Active Strategies
- [x] Win Rate progress bar shown
- [x] Color of win rate positive/negative based on threshold
- [x] Performance table with Strategy, Total Trades, W/L, Win Rate, Net P&L columns
- [x] Performance rows clickable, calls onSelectStrategy
- [x] Row data: strategy name, total trades, winners/losers split, win rate badge, net P&L
- [x] Win rate badge color: teal >= 50%, red < 50%
- [x] Net P&L color: teal positive, red negative

## StrategyForm
- [x] Modal rendered with data-testid
- [x] Title shows "Create Strategy" or "Edit Strategy"
- [x] Form has data-testid strategy-form
- [x] Edit mode with bot running shows restart warning
- [x] Template info alert shown in create mode
- [x] Strategy Name input rendered
- [x] Strategy Type select rendered (disabled in edit mode)
- [x] Description input rendered
- [x] Screener Profiles MultiSelect rendered
- [x] Tabs rendered based on strategy type
- [x] ORB tab visible for ORB type
- [x] S/R Breakout tab visible for SR_BREAKOUT type (TODO: add test with SR type)
- [x] EMA Params tab visible for EMA_CROSS type (TODO: add test with EMA type)
- [x] 52W Params tab visible for swing types (TODO: add test with 52W type)
- [x] Sizing tab always visible
- [x] Execution tab always visible
- [x] Cancel and Submit buttons rendered
- [x] Submit button text "Create" or "Save"
- [x] ORB params panel includes OR Duration, Min Range, SL/TP, Max Range
- [x] EMA params panel includes Fast/Slow period (TODO: add test with EMA type)
- [x] Swing params panel includes entry threshold, trailing stop, holding days, cooldown days (TODO: add test with 52W type)
- [x] Risk panel includes Risk Per Trade %, Max Position Size %, Min/Max Trade Value, Cooldown
- [x] Intraday type shows cooldown_minutes
- [x] Swing type shows cooldown_days
- [x] Runner panel includes Max Distance from OR (for ORB), Enable Shorts, EOD Exit Hour/Minute
- [x] SL/TP inputs respect isSwing boundary (max SL 30%, TP 20%)
- [x] EMA validation: fast period must be less than slow period (TODO: add test)
- [x] Changing strategy type updates active tab (TODO: add test)
- [x] Cancel closes modal
- [x] Submit calls onSubmit with form data (TODO: add form submit test)

## OrbParamsPanel
- [x] Panel renders with data-testid
- [x] OR Duration input with suffix " min"
- [x] Min Range input with suffix "% of price"
- [x] SlTpRow renders SL% and TP% inputs
- [x] Max Range input with suffix "% of price"

## RiskManagementPanel
- [x] Panel renders with data-testid
- [x] Risk Per Trade % input with suffix and description
- [x] Max Position Size % input with suffix and description
- [x] Min Trade Value input with ₹ prefix
- [x] Max Trade Value input with ₹ prefix
- [x] Cooldown Minutes input for intraday types
- [x] Cooldown Days input for swing types
- [x] Description text about strategy capital allocation

## RunnerPanel
- [x] Panel renders with data-testid
- [x] Max Distance from OR input for ORB types
- [x] Enable Shorts switch rendered
- [x] EOD Exit Hour input rendered
- [x] EOD Exit Minute input rendered

## Backend: config_loader.py
- [ ] StrategyConfigData dataclass created from StrategyConfig DB model
- [ ] All strategy params flow through DB -> dataclass -> runner config dict
- [ ] Default param values applied when missing
- [ ] Per-generator SL/TP defaults respected

## Backend: base_signals.py
- [ ] Abstract base class for signal generators
- [ ] Owns sl_pct, tp_pct, eod_exit_hour/minute
- [ ] is_eod_exit_time() returns correct boolean
- [ ] Each subclass overrides before super().__init__()

## Backend: Signal Generators
- [ ] ORB signal generator creates buy when price breaks above OR high
- [ ] ORB signal generator creates sell when price breaks below OR low
- [ ] ORB respects cooldown_minutes between signals
- [ ] ORB respects min/max OR range filters
- [ ] SR Breakout signal generator detects pivot breakout
- [ ] SR Breakout uses configured pivot_type and breakout_buffer_pct
- [ ] 52W Chaser generates signals near 52-week high
- [ ] 52W Chaser respects ADX > 25 filter
- [ ] 52W Chaser respects RSI 50-70 filter
- [ ] 52W Target generates signals with trailing stop configuration
- [ ] EMA Cross generates signals on fast/slow EMA crossover
- [ ] All generators set signal.notes with detailed calculations
- [ ] Signal notes include entry reason metadata

## Backend: Strategy Runner
- [ ] Runner loads positions from DB on restart
- [ ] Runner force-closes previous-day positions
- [ ] Runner respects risk_per_trade_pct
- [ ] Runner respects max_capital_per_trade_pct
- [ ] Runner respects max_positions limit
- [ ] Runner closes positions at EOD (FORCE_EXIT time)
- [ ] Persists state to BotRuntimeState + StrategyRuntimeState DB tables
- [ ] Signals written to scan_items in DB
- [ ] Completed trades persisted to Trade DB table
- [ ] Exit notes include PnL% and price level

## Strategies E2E
- [x] Navigate via nav to strategies view
- [x] Navigate via URL /strategies
- [x] Strategies nav tabs visible, Strategy Tree default
- [x] Switch to Performance tab -> performance view visible
- [x] Switch back to Strategy Tree -> tree panel visible
- [x] Template tree panel visible with tree nodes
- [x] Empty state shown when no templates
- [x] Create from template (plus icon) -> modal visible
- [x] Strategy form modal has name and type inputs
- [x] Strategy form tabs: ORB params, Sizing, Execution
- [x] Click Sizing tab -> risk panel visible
- [x] Click Execution tab -> runner panel visible
