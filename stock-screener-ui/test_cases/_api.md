# api

## index.ts (Screener API)
- [x] fetchData builds URL with provider, mode, screener params
- [x] fetchData sets loading true then false on success
- [x] fetchData clears error before fetching
- [x] fetchData sets error on non-ok response (HTTP {status})
- [x] fetchData sets error with message on thrown Error
- [x] fetchData sets generic "Failed to fetch" on non-Error thrown
- [x] fetchData does not set error when request is aborted
- [x] fetchData does not reset loading when request is aborted
- [x] fetchData calls renderCallback
- [x] fetchData applies default_sort from profile_meta when present
- [x] fetchData does not call sort setters when no default_sort
- [x] fetchData uses param screener value for activeScreener
- [x] fetchData clears data only on manual screener switch
- [x] fetchData appends profile filter params to URL
- [x] resetLoadingState sets loading to false and calls renderCallback
- [x] detectAutoRefreshChanges does nothing when no symbols added
- [x] detectAutoRefreshChanges detects primary and secondary added symbols
- [x] detectAutoRefreshChanges calls markNewSymbols and pushNotification
- [x] setRenderCallback stores render callback
- [x] loadScreeners fetches screener options and meta
- [x] loadScreeners resets active screener when resetActive=true
- [x] loadScreeners falls back to DEFAULT_SCREENER_OPTIONS on error
- [x] setupAutoRefresh clears existing interval
- [x] setupAutoRefresh does not set interval when autoRefreshSeconds <=0
- [x] setupAutoRefresh skips auto-refresh on backtest view
- [ ] setupAutoRefresh skips auto-refresh on config/correlation tabs
- [x] setupAutoRefresh calls fetchData with "auto" source

## paperTrading.ts
- [x] normalizeBotPortfolio normalizes full portfolio object
- [x] normalizeBotPortfolio handles null with defaults
- [x] normalizeBotPortfolio uses positions.length as fallback
- [x] normalizeBotPortfolio uses capital_used fallback for margin_used
- [x] normalizeBotPortfolio uses total_trades fallback for trades
- [x] normalizeBotPortfolio computes daily_pnl_pct from initial_capital
- [x] normalizeBotPortfolio returns 0 daily_pnl_pct when capital is 0
- [x] normalizeBotPortfolio converts string values to numbers
- [x] fetchPositions extracts positions array from response
- [x] fetchPositions returns empty array when no positions key
- [x] fetchPositions returns empty array on error
- [x] fetchTrades builds URL with limit, bot_id, from_date, to_date, days_back
- [x] fetchTrades omits optional params when not provided
- [x] fetchTrades returns trades array from response
- [x] fetchTrades returns empty array when no trades key
- [x] fetchTrades returns empty array on error
- [x] fetchSymbolPerformance converts object values to array
- [x] fetchSymbolPerformance returns empty array for empty object
- [x] fetchSymbolPerformance returns empty array on error
- [x] fetchDailyReport includes date param when provided
- [x] fetchDailyReport omits date param when not provided
- [x] fetchDailyReport returns null on error
- [x] healthCheck returns true when status is healthy
- [x] healthCheck returns false when status is not healthy
- [x] healthCheck returns false on network error
- [x] closePaperPosition sends POST with correct body and uppercased symbol
- [x] closePaperPosition uses default reason MANUAL when not provided
- [x] closePaperPosition throws on non-ok response
- [x] closeAllPositions sends POST to /api/bots/{botId}/close-all
- [x] updateTradeNotes sends PATCH with notes and reason
- [x] fetchPaperChart builds URL with symbol and optional params
- [x] fetchPaperChart handles data.error gracefully
- [x] fetchPaperChart returns null on error
- [x] fetchPaperBotSnapshot fetches bot snapshot
- [x] fetchPortfolio fetches portfolio data
- [x] refreshLiveData fetches portfolio, positions, bot status in parallel
- [x] refreshHistoryData fetches trades and performance summary in parallel
- [x] fetchStrategyConfig fetches config with optional strategy_id
- [x] updateStrategyConfig sends PUT with config body
- [x] resetStrategyConfig sends POST to /api/paper/config/reset

## trading_agents.ts
- [x] getTradingAgentsConfig fetches config successfully
- [x] getTradingAgentsConfig throws error on failure
- [x] checkTradingAgentsHealth returns health status
- [x] checkTradingAgentsHealth returns unavailable when service down
- [x] analyzeStock sends POST with ticker and optional params
- [x] analyzeStock returns decision, reports, stats
- [x] analyzeStock throws on non-ok response
- [x] streamStockAnalysis handles complete events
- [x] streamStockAnalysis handles error events
- [x] streamStockAnalysis throws on non-ok response
- [x] streamStockAnalysis throws when response has no body
- [x] listConversations fetches conversation list
- [x] createConversation creates with optional title
- [x] getMessages fetches messages for conversation
- [x] addMessage adds message with role, content, optional ticker
- [x] deleteConversation sends DELETE request
- [x] fetchWithSSE reads SSE stream and calls onEvent callback

## chartPreview.ts
- [x] fetchChartPreview returns null for empty symbol
- [x] fetchChartPreview uses cache within TTL
- [x] fetchChartPreview returns null on fetch error
- [x] fetchChartPreview returns data with error field
- [x] clearPreviewCache clears all entries when no symbol
- [x] clearPreviewCache clears symbol-specific entries

## bots.ts
- [x] listBots fetches all bots
- [x] getBot fetches single bot by ID
- [x] createBot sends POST with data
- [x] updateBot sends PUT with data
- [x] deleteBot sends DELETE
- [x] startBot sends POST with optional test_mode
- [x] stopBot sends POST to stop endpoint
- [x] getBotStatus returns normalized status
- [x] getBotStatus handles status_unknown flag
- [x] getBotLogs fetches with lines param
- [x] getBotPortfolio fetches portfolio data
- [x] getBotPositions fetches with optional strategy_id
- [x] getBotPerformance fetches with days param
- [x] compareStrategyPerformance fetches comparison data
- [x] listAvailableStrategies fetches available strategies
- [x] getBotTradeCount fetches trade count
- [x] getBotTrades fetches with limit and optional strategy_id

## strategies.ts
- [x] listStrategies fetches with include_templates and strategy_type filters
- [x] listTemplates fetches templates
- [x] getStrategy fetches single strategy with variations
- [x] createStrategy sends POST
- [x] updateStrategy sends PUT
- [x] syncVariations sends POST to sync endpoint
- [x] deleteStrategy sends DELETE
- [x] getStrategyPerformance fetches performance
- [x] getStrategyTrades fetches with limit
- [x] getStrategyVariations fetches parent and variations
- [x] listBots fetches bots assigned to strategies
- [x] getBot fetches single bot from strategies endpoint

## backtest.ts
- [x] calculateTotals computes from results array
- [x] calculateTotals returns zero when no results
- [x] fetchStrategies fetches available strategies
- [x] fetchStrategies returns empty on error
- [x] fetchVariations fetches strategy variations
- [x] fetchCosts fetches cost breakdown
- [x] runBacktest sends POST with strategy/params/days
- [x] runBacktest shows error notification on failure
- [x] runBacktest sets results and totals on success
- [x] runBacktest processes chart_data from response
- [x] fetchChartData fetches chart for symbol with optional tf
- [x] fetchChartData handles missing candles
- [x] fetchProgress fetches progress for long-running backtests
- [x] fetchResults fetches cached results
- [x] fetchBacktestHistory fetches history list
- [x] fetchBacktestDetails fetches single history item
- [x] deleteBacktest sends DELETE and returns success

## correlation.ts
- [x] fetchCorrelation sends POST with symbols, timeframe, period
- [x] fetchCorrelation throws on non-ok response
- [x] fetchCorrelation returns matrix, symbols, normalized, meta

## screeners.ts
- [x] createScreener sends POST with payload
- [x] createScreener throws on non-ok response
- [x] updateScreener sends PUT with partial payload
- [x] deleteScreener sends DELETE

## replay.ts
- [x] fetchReplaySymbols fetches symbol list
- [x] runReplay creates SSE connection
- [x] runReplay parses SSE events and calls onEvent
- [x] runReplay calls onComplete when done
- [x] runReplay calls onError on failure
- [x] runReplay returns cancel function
- [x] cancel function aborts controller and stops loop

## sector.ts
- [x] fetchSectorPerformance fetches with market param
- [x] fetchSectorPerformance throws on non-ok response
- [x] fetchSectorPerformance accepts AbortSignal

## sectorCorrelation.ts
- [x] fetchSectorCorrelation fetches with market and lookback_days
- [x] fetchSectorCorrelation throws on non-ok response

## config.ts
- [x] API_BASE uses VITE_API_BASE_URL or defaults
- [x] WS_BASE uses VITE_WS_BASE_URL or defaults
- [x] API_ENDPOINTS has correct URL paths for all endpoints

## utils/request.ts
- [x] apiGet sends GET with auth headers
- [x] apiPost sends POST with JSON body
- [x] apiPut sends PUT with JSON body
- [x] apiDelete sends DELETE
- [x] apiPostAction sends POST to action endpoint
- [x] request utilities handle non-ok responses

## news.ts
- [x] fetches news articles
- [x] handles error responses

## brokers.ts
- [x] fetches broker connections
- [x] handles OAuth token operations

## holidays_api.ts
- [x] fetchHolidays fetches holiday list
- [x] fetchHolidayCheck fetches single date check

## symbols.ts
- [x] searches symbols by query
- [x] returns symbol metadata

## chartPreview.ts
- [x] fetchChartPreview fetches preview data
- [x] clearPreviewCache clears cache
- [x] cache has 1 minute TTL

## chartBuilder.ts
- [x] buildChartData constructs chart data from candles/trades
- [x] buildChartData handles empty trades

## upstoxOptions.ts
- [x] getOptionChain fetches option chain
- [x] getUnderlyings fetches underlying list
- [x] getExpiries fetches expiry dates
- [x] getSpotPrice fetches spot price
- [x] getPositions fetches positions

## botControlApi.ts
- [x] startPaperBot sends start command
- [x] stopPaperBot sends stop command
- [x] fetchPaperBotStatus fetches status
- [x] initLiveAutoRefresh starts polling
- [x] stopLiveAutoRefresh stops polling
- [x] refreshBotLiveData refreshes all live data
- [x] normalizeBotPortfolio normalizes portfolio response
