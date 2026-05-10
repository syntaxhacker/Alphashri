# state

## createSubscriber
- [x] createSubscriber returns { subscribe, notify }
- [x] subscribe returns unsubscribe function
- [x] unsubscribe removes callback from future notifications
- [x] notify calls all subscribers
- [x] notify calls subscribers multiple times
- [x] handles many subscribers (10+)
- [x] subscribe can be called multiple times
- [x] unsubscribe is idempotent

## index.ts (Screener State)
- [x] DEFAULT_SCREENER_DATA has correct structure
- [x] subscribe returns unsubscribe function
- [x] subscribe calls callback on notifySubscribers
- [x] unsubscribe removes callback from subscribers
- [x] multiple subscribers all get notified
- [x] callbacks can unsubscribe individually
- [x] setData updates data and notifies
- [x] setIsLoading updates isLoading and notifies
- [x] setError updates error and notifies
- [x] setError clears error when passed null
- [x] setAutoRefreshInterval stores interval reference
- [x] setAutoRefreshSeconds updates interval and notifies
- [x] setSortColumn updates column and notifies
- [x] setSortDirection updates direction and notifies
- [x] setScreenerOptions updates options and notifies
- [x] setActiveScreener updates active screener and notifies
- [x] setProfileMetaById updates profile meta
- [x] setProfileFilters updates filters and notifies
- [x] setActiveProvider updates provider and notifies
- [x] setActiveMode updates mode and notifies
- [x] addNotification adds to array without notify
- [x] setNotifications replaces all notifications
- [x] clearNotifications resets array and seq
- [x] incrementNotifSeq increments sequence
- [x] setNotifPanelOpen updates panel state
- [x] setNotifFilter updates filter
- [x] setRecentAddedSymbols updates tracking object
- [x] toggleSymbolSelection adds/removes symbol
- [x] setSelectedSymbols replaces all selected
- [x] clearSelectedSymbols empties selection

## paperTrading
- [x] initialPaperTradingState has correct all fields
- [x] getPaperTradingState returns current state
- [x] subscribe returns unsubscribe function
- [x] unsubscribe removes callback from future notifications
- [x] setPaperTradingView updates currentView
- [x] setPositions updates positions
- [x] setPositions accepts empty array
- [x] setPortfolio updates portfolio
- [x] setPortfolio accepts null
- [x] setTrades updates trades
- [x] setDailySummary updates dailySummary
- [x] setDailySummary accepts null
- [x] setPerformanceSummary updates performanceSummary
- [x] setPerformanceSummary accepts null
- [x] setSymbolPerformance updates symbolPerformance
- [x] setFilterDate updates filterDate
- [x] setFilterDate accepts null
- [x] setFilterFromDate updates filterFromDate
- [x] setFilterToDate updates filterToDate
- [x] setFilterSymbol updates filterSymbol
- [x] setFilterSymbol accepts null
- [x] setFilterStrategy updates filterStrategy
- [x] setFilterBot updates filterBot
- [x] setFilterBot accepts null
- [x] setSelectedSymbol updates selectedSymbol
- [x] setSelectedSymbol accepts null
- [x] setSelectedStrategyTab updates selectedStrategyTab
- [x] setChartData updates chartData and sets chartLoading=false
- [x] setChartData accepts null
- [x] setChartLoading updates chartLoading
- [x] setChartTimeframe updates chartTimeframe
- [x] setLoading updates isLoading
- [x] setError updates error and sets isLoading=false
- [x] setError accepts null
- [x] setAutoRefresh disables and clears timer
- [x] setAutoRefresh enables refresh
- [x] setBotStatus updates bot fields
- [x] setBotStatus accepts null values
- [x] setBotSnapshot updates botSnapshot
- [x] setStrategyConfig updates config and resets error/dirty
- [x] setStrategyConfig accepts null
- [x] setConfigLoading updates configLoading
- [x] setConfigError updates configError and sets configLoading=false
- [x] setConfigDirty updates configDirty
- [x] updateConfigValue updates a specific config key and sets dirty
- [x] updateConfigValue does nothing when no config is set
- [x] setAvailableBots updates availableBots
- [x] setAvailableBots accepts empty array
- [x] resetPaperTradingState resets all to initial
- [x] triggerPaperTradingRerender notifies without changing state
- [x] deleteTradeAction removes trade from state on success
- [x] deleteTradeAction sets error on failure
- [x] deleteTradeAction handles non-Error rejection
- [x] updateTradeNotesAction updates trade with new notes/reason
- [x] updateTradeNotesAction handles error gracefully
- [x] updateTradeNotesAction handles trade not found locally
- [x] updateTradeNotesAction merges backend response fields

## correlation
- [x] setSymbols sets symbols and calls notify
- [x] addSymbol adds new symbol and calls notify
- [x] addSymbol does not add duplicates
- [x] addSymbol does not call notify for duplicates
- [x] removeSymbol removes symbol and calls notify
- [x] removeSymbol calls notify even for non-existent
- [x] setTimeframe sets to intraday/daily and calls notify
- [x] setPeriod sets period and calls notify
- [x] setPeriodUnit sets to minutes/days and calls notify
- [x] setCorrelationData sets matrix/normalized/meta and calls notify
- [x] setIsLoading sets loading state
- [x] setError sets error state
- [x] fetchCorrelationData calls API with current params
- [x] fetchCorrelationData sets data on success
- [x] fetchCorrelationData sets error on failure
- [x] fetchCorrelationData sets loading state during fetch

## auth
- [x] initial authState has isAuthenticated=false, loading=true
- [x] getAccessToken reads from localStorage
- [x] getRefreshToken reads from localStorage
- [x] setTokens writes to localStorage
- [x] clearTokens removes from localStorage
- [x] getStoredUser parses JSON from localStorage
- [x] setStoredUser writes JSON to localStorage
- [x] login calls /api/auth/login and sets tokens
- [x] login updates authState on success
- [x] login updates error on failure
- [x] register calls /api/auth/register
- [x] logout clears tokens and resets state
- [x] checkAuth verifies token with /api/auth/me
- [x] checkAuth falls back to stored user
- [x] checkAuth tries token refresh on 401
- [x] initAuth calls checkAuth on load
- [x] fetchWithAuth adds Bearer token to requests

## backtest
- [x] initialBacktestState has correct defaults
- [x] getState returns current backtest state
- [x] subscribe returns unsubscribe function
- [x] setCurrentView updates view
- [x] setStrategies updates strategies and clears loading
- [x] setStrategiesLoading updates loading flag
- [x] setSelectedVariation returns to default when null
- [x] setParamsKeepVariation merges params
- [x] setChartData sets single chart data
- [x] setChartLoading updates chart loading
- [x] setChartOptions updates chart options

## bots
- [x] getBotsState returns current state
- [x] getCurrentView returns view
- [x] setCurrentView updates view
- [x] subscribe returns unsubscribe function
- [x] triggerRerender notifies subscribers
- [x] loadBots fetches and sets bots
- [x] loadBots sets error on failure
- [x] loadBot fetches single bot and sets selectedBot
- [x] loadBotStatus fetches status
- [x] loadBotTrades fetches trades
- [x] loadAvailableStrategies fetches strategies
- [x] createBotAction creates bot and reloads list
- [x] createBotAction sets error on failure
- [x] updateBotAction updates bot and reloads list
- [x] deleteBotAction checks trade count before deleting
- [x] deleteBotAction prevents deletion when trades exist
- [x] startBotAction starts bot
- [x] stopBotAction stops bot
- [x] openCreateModal loads strategies and shows modal
- [x] closeCreateModal hides modal
- [x] openEditModal loads strategies and shows edit modal
- [x] closeEditModal hides edit modal
- [x] clearError clears error
- [x] selectBot sets selected bot and loads status if running
- [x] startAutoRefresh polls bot status
- [x] stopAutoRefresh clears interval
- [x] initBotsState loads bots once

## strategies
- [x] getStrategiesState returns current state
- [x] getCurrentView returns view
- [x] setCurrentView updates view
- [x] subscribe returns unsubscribe function
- [x] triggerRerender notifies subscribers
- [x] setLoading updates loading flag
- [x] setError sets error
- [x] loadStrategies fetches and sets strategies
- [x] loadTemplates fetches templates
- [x] loadInitialData fetches templates and strategies together
- [x] loadStrategy fetches single strategy with variations
- [x] createStrategy creates and reloads
- [x] updateStrategy updates and reloads
- [x] deleteStrategyAction deletes and reloads
- [x] syncVariations syncs template params
- [x] loadAllPerformance fetches and aggregates trade performance
- [x] loadBots fetches assigned bots
- [x] selectStrategy sets selected strategy
- [x] initStrategiesState loads initial data once
- [x] openCreateModal shows create modal with optional template
- [x] closeCreateModal hides create modal
- [x] openEditModal shows edit modal
- [x] closeEditModal hides edit modal
- [x] clearError clears error

## holidays
- [x] getHolidayState returns current state
- [x] subscribeToHolidays subscribes to changes
- [x] loadHolidays fetches and indexes holidays
- [x] loadHolidays skips if already loading
- [x] isTradingHoliday checks trading date set
- [x] isClearingHoliday checks clearing date set
- [x] checkDate returns holiday info from local data
- [x] checkDate falls back to API on unknown date
- [x] resetHolidays resets to initial state

## optionsStore
- [x] getOptionsState returns current state
- [x] subscribe returns unsubscribe function
- [x] setUnderlying updates underlying and fetches expiries/spot
- [x] setExpiry updates selected expiry
- [x] setFilters updates partial filters
- [x] resetFilters resets to defaults
- [x] fetchChain fetches option chain from API
- [x] fetchChain validates underlying/expiry selected
- [x] fetchPositions fetches positions
- [x] initOptionsState loads underlyings and selects first
- [x] getAvailableUnderlyingSymbols returns symbol list
- [x] getUnderlyingInfo finds by symbol

## replay
- [x] getReplayState returns current state
- [x] subscribeToReplay subscribes to changes
- [x] setConfig updates partial config
- [x] startRunning resets data and sets isRunning=true
- [x] stopRunning sets isRunning=false
- [x] addTrade appends trade with auto-increment id
- [x] addOpenPosition appends position with auto-increment id
- [x] closeOpenPosition removes position by symbol+strategy
- [x] setProgress updates progress
- [x] setSummary updates summary
- [x] addCandles appends candles for symbol
- [x] addORLevels appends OR levels
- [x] addPivotLevels appends pivot levels
- [x] add52WLevel appends 52W levels
- [x] setEMAData sets EMA data by symbol
- [x] setSelectedSymbol updates selected symbol
- [x] setStrategyFilter updates strategy filter
- [x] setChartOptions merges partial chart options
- [x] setHighlightedTrade finds trade and auto-toggles overlays
- [x] setHighlightedTrade does nothing for non-existent tradeId
- [x] autoToggleOverlays sets show_all_trades=false
- [x] setError sets error and isRunning=false
- [x] setTotals sets total symbols and candles
- [x] reset resets to initial state

## newsWebSocket
- [x] NewsWebSocketProvider creates context
- [x] useNewsWebSocket returns context value
- [x] connects to WebSocket on mount
- [x] receives and parses news events
- [x] disconnects on unmount

## sectorCorrelation
- [x] setMarket updates market and calls notify
- [x] setLookbackDays updates lookback days and calls notify
- [x] setIsLoading updates loading state
- [x] setError updates error state
- [x] setCorrelationData updates data and calls notify
- [x] fetchCorrelationData calls API and sets data on success
- [x] fetchCorrelationData sets error on failure
- [x] fetchCorrelationData sets loading state during fetch

## store/ (Redux Slices)
- [x] appSlice sets currentView
- [x] appSlice sets selectedTab
- [x] notificationsSlice adds notification
- [x] notificationsSlice dismisses notification
- [x] notificationsSlice clears all
- [x] hooks.ts provides typed useAppSelector, useAppDispatch
- [x] index.ts configures store with both slices
