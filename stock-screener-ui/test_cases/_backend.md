# backend

## ORB Strategy (test_orb_signals.py, test_backtest_strategy_orb.py)
- [x] generates breakout signal when price crosses above range high
- [x] generates breakout signal when price crosses below range low (shorts)
- [x] does not generate signal inside opening range
- [x] respects cooldown period between signals
- [x] enforces minimum OR range percentage filter
- [x] enforces maximum OR range percentage filter
- [x] respects EOD exit time
- [x] calculates stop loss and take profit correctly
- [x] skip filter: day_change_pct > 2.0 prevents trading
- [x] handles missing opening range data

## SR Breakout Strategy (test_backtest_strategy_sr_breakout.py, test_pivot_utils.py)
- [x] detects pivot high and low levels
- [x] generates breakout signal above resistance
- [x] generates breakout signal below support
- [x] calculates Pivot Point (PP), R1, S1, R2, S2
- [x] uses breakout_buffer_pct for confirmation
- [x] respects cooldown between signals
- [x] handles daily pivot level calculations
- [x] validates Fibonacci-based pivot constants

## 52W Chaser Strategy (test_week52_chaser.py, test_week52_chaser_integration.py)
- [x] generates signal when price is near 52-week high
- [x] ADX < 25 filter prevents trading in low volatility
- [x] RSI 50-70 filter prevents overbought/oversold entries
- [ ] respects cooldown between signals
- [x] sets correct stop loss and take profit
- [x] handles symbols without 52-week data

## 52W Target Strategy (test_week52_target.py, test_week52_target_integration.py)
- [x] generates signal for 52-week high breakout entries
- [x] uses trailing stop loss activation
- [x] respects max holding period
- [x] calculates trailing stop based on trailing_activation_pct
- [x] sets initial stop loss correctly

## EMA Cross Strategy (test_backtest_strategy_ema.py, test_ema_cross_signals.py)
- [x] generates signal when fast EMA crosses above slow EMA
- [x] generates signal when fast EMA crosses below slow EMA
- [x] calculates EMA gap percentage
- [x] sets stop loss based on sl_pct
- [x] respects cooldown between signals

## Signal Generators (test_signal_generators.py, test_signal_notes.py)
- [x] base SignalGenerator sets sl_pct, tp_pct, eod_exit params
- [x] is_eod_exit_time returns true after configured time
- [x] each signal generator sets appropriate notes with calculation details
- [x] ORB notes include range%, SL%, ATR, ADX, RSI
- [x] SR Breakout notes include pivot type and buffer%
- [x] EMA Cross notes include gap and SL%
- [x] 52W Chaser notes include ADX and RSI
- [x] 52W Target notes include SL% and trail%
- [x] signal.notes can be None, handled with fallback to empty string

## Risk Manager (test_risk_manager.py, test_global_risk_manager.py, test_risk_manager_edges.py, test_risk_utils.py, test_runner_risk.py)
- [x] validates trade against risk_per_trade_pct
- [x] validates trade against max_capital_per_trade_pct
- [x] enforces max_daily_loss_pct
- [x] enforces max_total_exposure_pct
- [x] enforces max_positions limit
- [x] enforces max_trade_value and min_trade_value
- [x] validates cooldown_minutes between trades on same symbol
- [x] respects max_holding_days
- [x] respects cooldown_days between trades
- [x] edge cases: zero values, negative values, extreme values
- [x] cooldown logic respects different symbol and strategy combinations

## Portfolio (test_shared_portfolio.py, test_shared_portfolio_metadata.py, test_portfolio_state.py)
- [x] opens new position with correct metadata
- [x] closes position and creates CompletedTrade
- [x] close_position sets sl_price and tp_price on CompletedTrade
- [x] stores entry_reason in position.metadata
- [x] propagates entry_reason to CompletedTrade.reason on close
- [x] exit notes include PnL% and price level
- [x] calculates unrealized P&L correctly
- [x] updates current_price for open positions
- [x] handles partial position updates
- [x] validates side (BUY/SELL) constraints
- [x] position restore on restart force-closes previous day positions
- [x] low_price resets to entry_price on restore

## Backtest Engine (test_backtest_engine.py, test_multi_strategy.py, test_multi_strategy_qa.py)
- [x] runs backtest for single strategy
- [x] runs backtest for multiple symbols
- [x] returns correct result structure (trades, wins, gross_pnl, etc.)
- [x] calculates profit factor correctly
- [x] calculates win rate correctly
- [x] includes trading costs when flag enabled
- [x] handles empty symbol list
- [x] handles missing market data
- [x] multi-strategy backtest compares performance across strategies
- [x] QA validation of combined strategy results

## Trading Costs (test_backtest_costs.py)
- [x] calculate_trading_costs is single source of truth
- [x] calculates brokerage correctly
- [x] calculates STT correctly
- [x] calculates exchange charges correctly
- [x] calculates SEBI charges correctly
- [x] calculates stamp duty correctly
- [x] calculates GST on brokerage correctly
- [x] handles min_brokerage floor
- [x] returns correct total costs breakdown

## Database Models (test_db_models.py, test_db_database.py)
- [x] StrategyConfig model has all required fields
- [x] Trade model has notes, reason, peak_price, low_price, bot_id columns
- [x] Trade.to_dict() includes all columns
- [x] BotRuntimeState persists bot state to DB
- [x] StrategyRuntimeState persists strategy state
- [x] Position model has strategy_type, peak_price, low_price, metadata_json
- [x] Position model does NOT have peak_price/low_price (restore defaults to entry_price)
- [x] broker_connections table stores tokens

## Config Loader (test_config_loader.py)
- [x] StrategyConfigData dataclass loads from DB model
- [x] all strategy params flow through DB → dataclass → dict pipeline
- [x] default values applied when creating new config via API
- [x] handles missing optional fields

## Chart Cache (test_chart_cache.py, test_chart_cache_extended.py)
- [x] caches chart data to disk as pickle
- [x] checks cache before fetching from upstream
- [x] today's data has 60-second TTL via .meta file
- [x] historical dates have no TTL
- [x] empty today result does not fall through to historical
- [x] pre-market cache poisoning prevention
- [x] returns (df, is_cached) tuple

## Upstox Market Data (test_market_data.py)
- [x] fetch_intraday_data_v3 fetches today's data
- [x] fetch_historical_data_v3 fetches past dates
- [x] handles Cloudflare 1015 block (HTTP 429)
- [x] handles token expiry (HTTP 401)
- [x] handles missing instrument key (HTTP 404)
- [x] verifies LTP endpoint works
- [x] intraday vs historical routing logic

## Bots (test_bots_api.py, test_bot_db_state.py)
- [x] CRUD endpoints create/read/update/delete bot config
- [x] start bot creates subprocess with correct PID
- [x] stop bot sends SIGTERM to process
- [x] bot status reflects running/stopped state
- [x] bot state persists to DB (BotRuntimeState, StrategyRuntimeState)
- [x] API reads bot state from DB + Redis
- [x] scan items persisted to bot_runtime_states.scan_items column
- [x] close-all positions endpoint works
- [x] orphan bot detection and cleanup

## Paper Trader (test_paper_trader.py)
- [x] opens positions via paper trading
- [x] closes positions via paper trading
- [x] calculates P&L correctly
- [x] stores trade history
- [x] updates current_price for positions
- [x] _load_positions_from_db restores previous day positions
- [x] force close positions from previous day

## Replay Engine (test_replay_phase2.py)
- [x] replays historical data for a date
- [x] processes candle-by-candle
- [x] generates signals during replay
- [x] tracks open positions during replay
- [x] records completed trades
- [x] generates summary at end
- [x] uses cache for replay data

## Strategy Runner (test_strategy_runner.py)
- [x] main loop processes signals for all strategies
- [x] respects EOD market close (FORCE_EXIT at 15:30)
- [x] handles multiple strategies in sequence
- [x] detects and handles crashes with Telegram alert
- [x] _TimestampedConsole prepends timestamps to logs
- [ ] pipe deadlock fix: stdout goes to log file

## Telegram Notifier (test_telegram_notifier.py)
- [x] sends notification asynchronously via ThreadPoolExecutor
- [x] sends crash notification with open positions count + P&L
- [x] non-blocking, does not block main loop

## Journal (test_journal.py)
- [x] writes daily journal entries
- [x] reads journal entries by date
- [x] handles missing journal files

## Monitor Positions (test_monitor_positions.py)
- [x] monitors open positions for SL/TP hits
- [x] triggers exit when stop loss hit
- [x] triggers exit when take profit hit
- [x] triggers trailing stop on activation

## Security (test_security.py)
- [x] auth required on protected endpoints
- [x] no auth on trading_agents chat/analyze/stream
- [x] token validation works

## SL/TP Pipeline (test_sl_tp_pipeline.py)
- [x] sl_pct/tp_pct from DB model defaults (1.0/1.5)
- [x] each strategy has per-generator SL/TP defaults
- [x] config flows correctly through pipeline

## ORB Conservative (test_orb_conservative.py, test_orb_conservative_integration.py)
- [x] conservative ORB variant uses wider range filter
- [x] respects ORB specific params: sl_pct, tp_pct, breakout_buffer_pct, cooldown_minutes

## News (test_news_persistence.py, test_news_instrument_mapper.py)
- [x] news articles persisted to database
- [x] instrument mapper resolves symbols from news content
- [x] handles missing instrument mapping

## Correlation (test_correlation.py)
- [x] computes correlation matrix from price data
- [x] supports intraday and daily timeframes
- [x] validates matrix dimensions match symbol count

## API Profiles (test_api_profiles_unittest.py)
- [x] profile endpoints return correct data
- [x] handles missing profile data

## Backtest API Integration (test_backtest_api.py, test_backtest_chart_data.py)
- [x] POST /api/backtest/run starts backtest
- [x] returns results for valid params
- [x] returns error for invalid strategy
- [x] chart data endpoint returns candles/trades
- [x] handles missing chart data

## Trades Endpoint
- [x] queries PostgreSQL first for trades
- [x] falls back to journal files
- [x] get_trades and _get_trades_from_db handle both sources

## Redis Cache (test_redis_cache.py)
- [x] stores and retrieves bot heartbeat
- [x] stores and retrieves bot PID
- [ ] 24h TTL on PID key
- [x] handles Redis unavailability

## Trade Position Models (test_trade_position_models.py)
- [x] SharedPosition model has correct fields
- [x] CompletedTrade has reason, peak_price, low_price, sl_price, tp_price
- [x] Position metadata correctly serialized

## Week52 Utils (test_week52_utils.py)
- [x] fetches 52-week high data
- [x] handles missing 52-week data
- [x] data caching for 52W levels

## API Contract Tests (contract/)
- [x] endpoint responses match expected schema
- [x] status codes are correct

## E2E Tests (e2e/)
- [x] full workflow: login → view screener → run backtest
- [x] paper trading workflow: open → monitor → close

## Config Tests (test_config_loader.py)
- [x] config loads from environment variables
- [x] config falls back to defaults
- [x] dotenv .env/.env.dev files loaded

## Scenario Tests (scenarios/API_TEST_SCENARIOS.md, TEST_SCENARIOS.md)
- [ ] integration scenarios for combined features
- [ ] error handling scenarios

## Gap Areas
- [x] Live price streaming SSE backend not covered in existing tests
- [x] Sector data endpoints no dedicated backend tests
- [x] Alembic migration validation tests
