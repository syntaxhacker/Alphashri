# stock-screener-ui — Agent Rules

## ⚠️ Golden Rules
- **NEVER delete or directly modify `db/alphashri.db`** — it contains user accounts, bot state, and trade history. Tests use in-memory SQLite via `test_engine` fixture. If a migration is stuck, use `SKIP_ALEMBIC=1` or ask the user.
- **NEVER commit secrets, API keys, or tokens** to the repo.

## Stack
React 19 + Vite 8 + Mantine 8 + TypeScript. Backend: FastAPI (Python).

## Commands
- `./start.sh` — starts both API (uvicorn) and UI (vite) together, auto-activates `.venv`. During market hours the 52W range batch now runs a prompt initial job quickly after startup (see the 52W section). Logs to `logs/alphashri.log`.
- `bun run dev` — dev server only (proxy /api → localhost:8765)
- `bun run build` — production build
- `bun run lint` — oxlint (0 warnings/errors required before commit)
- `bun run test` — vitest --run (use `npx vitest run <file>` for targeted tests, NOT `bun test` which lacks vi.mock support)
- `source .venv/bin/activate && python -m pytest tests/` — backend tests

## Python Environment
- **Version**: pinned via `.python-version` (3.12.13) — pyenv reads this automatically
- **Virtual env**: `.venv/` (created with `uv venv --python 3.12.13`)
- **Package manager**: `uv` (faster than pip) — install deps with `uv pip install -r <requirements.txt>`
- **Dependencies**: `../requirements.txt` (root) + `api/requirements.txt` (API-specific)
- **Note**: `nautilus-trader` in `api/requirements.txt` requires Rust toolchain — install separately if needed
- **`start.sh`**: auto-activates `.venv` before starting uvicorn; always use `./start.sh` to run both services. Logs saved to `logs/alphashri.log`.
- **Start with DeepSeek**: pass env vars inline to use DeepSeek for TradingAgents analysis:
  ```bash
  DEEPSEEK_API_KEY=sk-xxx OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://api.deepseek.com ./start.sh
  ```
  Or add keys to `.env` or `.env.dev` — `config.py` auto-loads them via `load_dotenv()`.
- **Test login**: email `qa@test.com` / password `qa123`
- **Get token for curl**:
  ```bash
  TOKEN=$(curl -s -X POST http://localhost:8765/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"qa@test.com","password":"qa123"}' | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
  )
  curl -H "Authorization: Bearer $TOKEN" http://localhost:8765/api/trading-agents/health
  ```

## TradingAgents Chat Bot
- **Chat endpoint** (`/api/trading-agents/chat`): Conversational AI using DeepSeek via LiteLLM. Uses function calling to detect stock analysis requests. Returns `should_analyze` field when a stock ticker is detected.
- **Analyze endpoint** (`/api/trading-agents/analyze`): Runs full multi-agent analysis (market, news, fundamentals analysts) via TradingAgents framework. Takes 60-120s. First call slow, subsequent calls served from file cache.
- **Stream endpoint** (`/api/trading-agents/stream/{ticker}`): SSE streaming with progress, tool_call, report, and complete events. Uses `json.dumps()` for data serialization (critical: sse_starlette 3.4.1 does NOT auto-serialize dicts to JSON — must call `json.dumps()` manually).
- **File cache**: Results stored at `experiments/data/analysis_cache/{TICKER}_{DATE}.json` with 24h TTL. Checked by both analyze and stream endpoints before running analysis.
- **Providers**: Chat uses OpenRouter free model (`openai/gpt-oss-20b:free`) if DeepSeek key not available. Analysis uses DeepSeek via LiteLLM (`deepseek/deepseek-chat`).
- **No auth required** on chat, analyze, and stream endpoints (get_current_user had compatibility issues with this router). Conversation history endpoints use hardcoded user_id=3.
- **Chat history**: Conversations and messages stored in `chat_conversations`/`chat_messages` tables. CRUD endpoints at `/api/trading-agents/conversations`.
- **Chat Popup** (`src/components/common/ChatPopup.tsx`): Floating action button, expandable to full screen, history sidebar, markdown rendering via `react-markdown`.

## Mantine v8 Rules
- Reference `mantine_llm.txt` for component docs — never guess APIs
- Use Mantine components (`Flex`, `Stack`, `ScrollArea`, `Group`, `Grid`, `Text`) instead of raw `<div>` + inline styles
- Use `CompactPanel`, `CompactStat`, `CompactStatGrid` from `components/common/compact.tsx` for small stat displays
- Never hardcode dark colors (`#0a0a0a`, `#1a1a1a`) — use Mantine CSS vars (`var(--mantine-color-body)`) or theme object
- Use `styles` prop on Mantine components for overrides, not global CSS classes
- Default sizes: `size="sm"` for inputs/buttons, `size="xs"` for dense tables/badges

## State Management
- All stores in `src/state/` — custom `createSubscriber` pattern + `useStoreSubscription` hook
- Redux slices in `src/state/store/` (appSlice, notificationsSlice) — legacy, minimal usage
- Never call `useState` for data that lives in a store

## Component Patterns
- Barrel files (`mantine.ts`) point to current components — edit `*2.tsx` files, update barrel, never edit old files
- Page-level routing components in `src/pages/<feature>/` (e.g., `pages/chart/ChartView.tsx`, `pages/sector/SectorPage.tsx`)
- Shared components: `SortableHeader`, `BadgeComponents`, `PnlText`, `DataTable`, `compact.tsx`, `states.tsx` in `src/components/common/`
- Shared utilities: `formatNumber`, `formatSignedPnl`, `formatPercentage`, `formatCurrencyCompact`, `formatTimeOnly`, `formatElapsed`, `getPnLTextColor`, `getNextSortDirection`, `sortByField` in `src/utils/ui-helpers.ts`
- Config/constants/theme consolidated in `src/config/` (constants.ts, theme.ts, backtestDefaults.ts)
- ECharts: never wrap chart container in `ScrollArea` — ECharts needs explicit dimensions via `flex: 1` on a flex parent
- **React keys**: never use `symbol` alone as key — always composite (`${strategy_id}-${symbol}`) or unique ID. Positions can have same symbol across strategies.

## Folder Structure
```
src/
  api/          # API layer (fetchWithAuth, endpoint functions)
  assets/       # static assets (svg, images)
  components/   # UI components organized by feature
  config/       # constants.ts, theme.ts, backtestDefaults.ts
  hooks/        # generic shared hooks (useAsyncData, useECharts, useStoreSubscription, useTableSort)
  pages/        # page-level routing targets (chart, sector, settings, options, screener, strategies)
  state/        # all state management (subscriber stores + redux in state/store/)
  types/        # TypeScript type definitions
  utils/        # shared utilities (ui-helpers, chartUtils, notifications, runtime_utils)
```

## Replay Trading
- Components: `src/components/replay/` — page-level feature, uses SSE from `api/replay_api.py`
- Cache: `experiments/data/replay_cache/{date}/{symbol}.pkl` (gitignored)

## Live Price Streaming (SSE)
- **Backend**: `api/paper/live_stream.py` — `GET /api/paper/live/stream`
  - Reads open positions from DB → resolves instrument keys via `instruments` table (fallback to JSON file)
  - Connects to Upstox `MarketDataStreamerV3` WebSocket (`wss://api.upstox.com/v3/feed/market-data-feed`)
  - Mode: `ltpc` (LTP + close price only, max 5000 instrument keys per connection)
  - Streams `event: price` with `{symbol, ltp, ltq, instrument_key, ts}` via SSE
  - Uses `threading.Queue` bridge between WS thread and async SSE generator
  - 30s heartbeat if no data; auto-cleanup on client disconnect
- **Frontend**: `src/hooks/useLivePrices.ts` — `fetch` + `ReadableStream` (supports auth headers, unlike `EventSource`)
  - `<LivePriceUpdater />` component in `PaperTradingView2.tsx` subscribes to live prices
  - On each tick, updates `current_price` + recalculates P&L for matching positions via `setPositions()`
  - Falls back to 20s polling on disconnect/error
- **Price vs Polling**: WebSocket delivers first tick in ~30ms vs REST ~174ms. Live ticks stream at ~4/sec during market hours.

## CSS
- Legacy hardcoded CSS in `style.css` is being migrated to Mantine — prefer `var(--mantine-color-*)` vars
- Remove dead CSS classes when removing old components (verify with grep before deleting)
- No CSS modules — global CSS with Mantine class overrides

## Backend (Python)
- Single source of truth for IST timezone: `config.IST` (root `config.py`, re-exported in `stock-screener-ui/config.py`)
- Use `datetime.now(config.IST)` everywhere, never `datetime.now()` without tz
- Pandas date filtering: use `pd.Timestamp(date_str, tz=config.IST)` not raw strings — Timestamp vs string comparison raises TypeError
- `fetch_intraday_data_v3` for today, `fetch_historical_data_v3` for past dates
- API routes in `stock-screener-ui/api/`, DB models in `db/models.py`
- **Trades endpoint** (`/api/paper/trades`): queries PostgreSQL first, falls back to journal files. The `get_trades` and `_get_trades_from_db` functions handle this.
- **Chart endpoint** (`/api/paper/chart/{symbol}`): has a known timezone mismatch bug on production — `fetch_historical_data_v3` returns data with UTC index but filtering uses `config.IST` (UTC+5:30), causing 0 rows after date filter. Works locally because `railway run` may use different config. Investigate: compare `df_1m_full.index.tz` vs `config.IST` in the Docker container.
- **Local dev data**: prod DB can be dumped to local SQLite via `python scripts/dump_prod_to_local.py`. Note: trades have `user_id=1` in prod, local user may be different — update `user_id` after dump.
- **Trading costs**: `backtest/costs.py:calculate_trading_costs()` is the single source of truth. Both `runner_signals.py` and `paper_portfolio.py` use it — never use flat `trade_value * 0.0006`.
- **Background screener tasks** (prewarm + 52W range batch) are started in the lifespan and gated to market hours. The 52W batch now does a prompt initial run shortly after `start.sh` (during market hours) rather than waiting the full interval — see the dedicated 52W section for agent behavior around this.

## Signal Generator Architecture

```
BaseSignalGenerator (base_signals.py)
  ├── SRBreakoutSignalGenerator (sr_breakout_signals.py)
  ├── EMACrossSignalGenerator (ema_cross_signals.py)
  └── Base52WSignalGenerator (week52_utils.py)  ← swing base, is_eod_exit_time() → False
        ├── Week52ChaserSignalGenerator (week52_chaser_signals.py)
        ├── Week52TargetSignalGenerator (week52_target_signals.py)
        └── Blind52WSignalGenerator (blind_52w_signals.py)

ORBSignalGenerator (orb_signals.py)  ← extends BaseSignalGenerator (no longer standalone)
```

### Shared helpers on BaseSignalGenerator
- `_calc_sl_tp(side, entry_price, sl_pct=None, tp_pct=None)` → `(sl, tp)` tuple — handles LONG/SHORT formulae
- `_safe_float(market_data, key, default=0.0)` — safely extracts float from dict (handles None)
- `_format_exit_note(reason, pnl_pct)` → `"reason (PnL: +x.xx%)"` — standardizes exit note formatting
- `_calc_pnl_pct(side, entry, current)` — handles LONG/SHORT sign, div-by-zero guard

### 52W swing strategies (Base52WSignalGenerator)
- `is_eod_exit_time()` always returns `False` (swing = multi-day holds, no EOD exit)
- `_extract_exit_kwargs(kwargs, current_price)` — extracts `days_in_position`, `max_holding_days`, `highest_price_since_entry`, `entry_52w_high`, `trailing_stop_pct` with instance-aware defaults

### DRY rules for signal generators
- Always use `_calc_sl_tp()` for SL/TP arithmetic, never inline
- Always use `_safe_float()` for market_data extraction, never `get(..., 0) or 0`
- Always use `_format_exit_note()` for exit signal notes
- Always use `_calc_pnl_pct()` for PnL calculations, never inline formula

## Strategy Config Pipeline
- **DB Model** (`db/models/bot.py:StrategyConfig`) → **Dataclass** (`trading/config_loader.py:StrategyConfigData`) → **Dict** (`runner.config`) → **SignalGenerator** / **RiskManager**
- All strategy params flow through this pipeline. Adding a new param requires touching all 4 layers + API models + CRUD + migration.
- `base_signals.py` is the abstract base for ALL signal generators — owns `sl_pct`, `tp_pct`, `eod_exit_hour/minute`, `is_eod_exit_time()`, `_calc_sl_tp()`, `_safe_float()`, `_format_exit_note()`, and `_calc_pnl_pct()`. Each subclass overrides before `super().__init__()`.
- **ORB** now extends `BaseSignalGenerator`. SL/TP passed as constructor args from `StrategyRunner`.
- Each strategy has its own per-generator SL/TP defaults. Config comes from DB (seed_qa_data.py), not hardcoded here.
- **StrategyRunner.ORB** passes individual params (not config dict): `self.config['sl_pct']`. All other strategies pass the full dict.
- **DB model defaults** (`sl_pct=1.0, tp_pct=1.5`) apply when creating a new StrategyConfig row via API without explicit values.
- **`CompletedTrade`** now carries `sl_price`/`tp_price` from the position (fix: `portfolio_core.py:close_position()` sets them). Previously always stored 0.0.
- **Risk params**: `risk_per_trade_pct`, `max_capital_per_trade_pct` flow from `runner.config` → `global_risk_manager.validate_trade()`.
- **ORB Best strategy**: optimized via autoresearch (PF=1.61 on 5-min benchmark). Key params: `sl_pct=1.0`, `tp_pct=1.5`, `breakout_buffer_pct=0.3`, `cooldown_minutes=75`, `eod_exit=(15,0)`, `enable_shorts=False`, `min_or_range_pct=0.8`. Validated on 13 days with replay engine (PF=1.19). TP rarely hit — real edge is SL1.0 + 75min cooldown + 15:00 EOD exit.
- **Hardcoded values audit** (all strategy-specific values are now configurable):
  - `runner_core.py:FORCE_EXIT=(15,30)` — global market close, NOT strategy-specific. Safe to keep.
  - `runner_signals.py:178` — `day_change_pct > 2.0` ORB skip filter. Generic safety, could be config in future.
  - `week52_chaser_signals.py:128-132` — ADX<25, RSI 50-70 filters. 52W-specific, could be config.
  - `runner_signals.py:581` — `0.8` daily loss alert multiplier. Could be global risk param.
  - Fibonacci pivot constants in `sr_breakout_signals.py` — mathematical constants, never change.

## Telegram Notifications
- Module: `trading/telegram_notifier.py` — all calls are non-blocking via `ThreadPoolExecutor`
- The separate `upstox_trader/screeners/tv_alerts.py` Telegram system is **unrelated** — that's for TradingView screener webhooks

## Bot Architecture
- Bot runs as **separate subprocess** via `runner_cli.py` — NOT in the API process
- API and bot communicate via: **DB** (positions/trades/runtime state), **Redis** (heartbeat/status/PID)
- State persistence: `persist_state()` in `runner_core.py` writes to `BotRuntimeState` + `StrategyRuntimeState` DB tables. No JSON snapshot files.
- API reads bot state via `api/bot_state.py:get_bot_state()` — queries DB + Redis, returns same shape as old snapshot
- Bot's in-memory `SharedPortfolioManager` is the source of truth for open positions — the API reads from DB
- **Close All Positions**: API closes positions directly from DB (no command file). If bot is running, it detects the closed positions next cycle.
- **Scan items**: persisted to `bot_runtime_states.scan_items` DB column. `/api/bots/{bot_id}/scan` reads from DB first, Redis as fallback.
- **Position restore on restart**: `_load_positions_from_db()` in `runner_core.py` — force-closes positions from previous day with `FORCE_CLOSE` reason. `low_price` resets to `entry_price`.
- **Force exit**: `runner_core.py:FORCE_EXIT=(15,30)` is global market close time
- **Orphan bot stop**: `get_bot_pid()` reads PID from Redis key `bot:{user_id}:{bot_id}:pid` (24h TTL), sends SIGTERM
- **Pipe deadlock fix**: bot stdout goes directly to log file (not PIPE) — prevents buffer fill on uvicorn reload
- **Crash notification**: bot's `run()` wraps main loop in try/except, sends Telegram alert with open positions count + P&L on crash
- **`_TimestampedConsole`**: prepends `[HH:MM:SS]` to all bot log lines

## Market Data Auth
- **Market data endpoints** (`/api/chart/preview`, `/api/paper/chart`, `/api/backtest/run`) use `UpstoxAPI` with `UPSTOX_API_KEY`/`UPSTOX_API_SECRET` — **no OAuth broker token needed**
- **Options + broker endpoints** (`/api/options/*`, `/api/brokers/*`) require OAuth access token via `get_shared_broker_token('upstox')` — user must connect broker in Settings
- **Live price streaming** (`/api/paper/live/stream`) also requires OAuth access token (uses `MarketDataStreamerV3` SDK)
- Never gate market data behind broker OAuth check

## Upstox Token Storage (DB-first)
- **Primary**: `broker_connections` table via `get_shared_broker_token('upstox')` (post-OAuth)  
- **Fallback 1**: `.upstox_token.json` file in project root 
- **Fallback 2**: `UPSTOX_ACCESS_TOKEN` env var
- `upstox_auth.py`'s `UpstoxAuthHandler.load_token()` checks DB → file. `save_token()` still writes to file for backward compat.
- `UPSTOX_CONFIG` dict in root `config.py` only has `api_key`/`api_secret` (removed `access_token`)
- Stale file-only patterns fixed: `sector_data.py` uses `UpstoxAuthHandler`, `upstox_auth_refresh.py` checks DB first

## Upstox Data Debugging
- `scripts/test_upstox_data.py` — quick V3 API health check: tests LTP + intraday for 5 symbols, detects Cloudflare 1015 blocks and token expiry
- Run with: `python scripts/test_upstox_data.py` (no venv needed, uses only `requests`)
- Common errors:
  - **HTTP 429 / Cloudflare 1015** — IP/network blocked by Cloudflare WAF. Wait or use VPN.
  - **HTTP 401** — expired token. Re-authenticate via OAuth login.
  - **HTTP 404** — check instrument key format or market hours
- Token file: `.upstox_token.json` in project root

## Benchmark
- `scripts/benchmark_upstox_data.py` — benchmarks REST LTP V3 vs WebSocket V3 MarketDataStreamerV3
- Usage: `source .venv/bin/activate && python scripts/benchmark_upstox_data.py`
- Token resolution: DB → file → env var (loads dotenv from `.env`)
- Loads 15 liquid NSE_EQ symbols from 56MB instruments JSON
- REST: tests 1-symbol and 15-symbol batch (5 iterations each, reports avg/min/max)
- WS: connects `MarketDataStreamerV3` in `ltpc` mode, collects 15s of ticks, reports first-tick latency + tick cadence

## Chart Cache
- `api/paper/chart_cache.py` — pickle-based disk cache at `experiments/data/chart_cache/{date}/{symbol}.pkl`
- Returns `(df, is_cached)` tuple — chart response includes `"cached": true/false`
- Cache is checked **before** any fetch (intraday or historical)
- **Today's data**: 60-second TTL via `.meta` file — prevents stale pre-market data poisoning
- **Historical dates**: no TTL — data never changes
- Today's intraday fetch that returns empty (pre-market) does NOT fall through to historical — returns empty to avoid caching wrong day's data
- Pre-market cache poisoning fix: when `date == today` and `fetch_intraday_data_v3` returns None/empty, early return (no fallback to historical)

## 52W Range Screener Background Job
- The 52W range batch job (`compute_52w_ranges_task`) and screener prewarm task are started from the FastAPI lifespan.
- Both are gated to market hours via `_is_market_hours()` (delegates to the canonical `trading.utils.is_market_open()` for precise 9:15-15:30 IST trading days + holidays; always use `config.IST`; has a simple hour fallback).
- **Key `start.sh` behavior**: The range batch now performs a *prompt initial run* shortly after startup (during market hours) instead of sleeping the full interval first. This ensures that running `start.sh` when ranges are stale triggers an observable batch quickly (previous behavior waited up to 1 hour). After the initial run, it follows the normal `SCREENER_52W_INTERVAL_SEC` (default 3600, overrideable).
- Scheduled runs are incremental only (`--skip-existing`). After the initial bootstrap, they usually process only a handful of symbols and finish in ~1-2 seconds.
- The admin 52W panel shows the last job result from Redis (status usually stays "completed"). The live progress bar is only shown while the job status is actively "running" — because normal runs are so fast, it is rarely visible on the panel's 5s poll. Use "Clear cache + DB" followed by a manual "Run batch" (or full refresh) if you need to observe the progress UI.
- "Latest DB update" (max row `updated_at`) only moves forward when the script actually inserts or changes range data for a symbol (not on every job execution).
- Prewarm keeps the 52w_high screener (and others) responsive during market hours.
- Logs for the jobs appear in `logs/alphashri.log`.

## Trade Entry Reason Pipeline
- Signal generators set `signal.notes` with detailed calculations (ORB: range%, SL%, ATR, ADX, RSI; SR Breakout: pivot type, buffer%; EMA Cross: gap, SL%; 52W Chaser: ADX, RSI; 52W Target: SL%, trail%)
- `runner_signals.py:453` stores `signal.notes` in `position.metadata['entry_reason']`
- On trade close, `position.metadata['entry_reason']` → `CompletedTrade.reason` → `_persist_trade_to_db` → `Trade.reason` column
- Exit notes include PnL% and price level: "Stop loss hit ₹1340.00 (PnL: -0.40%)"
- `CompletedTrade` has `reason`, `peak_price`, `low_price`, `sl_price`, `tp_price` fields — propagated from `SharedPosition` in `portfolio_core.py:close_position()`
- `signal.notes` can be `None` — always use `signal.notes or ''` when assigning to scan items

## Paper Trading UI Defaults
- **Trade history**: defaults to "Today" filter (`filterFromDate`/`filterToDate` = today) instead of all-time
- **Field naming**: `PaperPosition` and `PaperTrade` both use `stop_loss`/`take_profit` — never `sl_price`/`tp_price`
- **Close All button**: in positions header, calls `POST /api/bots/{bot_id}/close-all` with current prices, shows loading state + error alert
- **Expandable trade rows**: click to expand with TradeStats (SL, TP, Peak, Low, Costs, Gross/Net P&L) and TradeNotesEditor (editable Reason + Notes with Save)
- **PATCH endpoint**: `PATCH /api/paper/trades/{trade_id}` — update notes/reason, max 500 chars

## Deployment & Production

See [PRODUCTION.md](./PRODUCTION.md) for infrastructure, deployment, Railway CLI, logs, Redis, and post-push verification.

## Testing
- Frontend: vitest, files co-located as `*.test.ts` / `*.test.tsx`
- Backend: pytest, files in `stock-screener-ui/tests/`
- Run both before committing
- **Read `TEST_RULES.md`** before writing or modifying any test — covers assertion conventions, mock patterns, accordion interaction, data-testid naming, and coverage requirements

### Running Targeted Tests (Fast)
Use glob patterns to run only the changed feature's tests during development:
```bash
bun test -- --run src/components/screener/Correlation  # component tests only
bun test -- --run src/state/correlation.test.ts         # state tests only
bun test -- --run src/components/screener/CorrelationMatrix.test.tsx  # single file
source .venv/bin/activate && python -m pytest tests/test_correlation.py -v  # backend
```
Always run the full suite (`bun run test`) before committing.

**Note**: Use `npx vitest run <file>` for tests using `vi.mock` — `bun test` does not support `vi.mock`.
```bash
npx vitest run src/components/common/ChatPopup.test.tsx  # use vitest for vi.mock tests
```

### Backend Test Gotchas
- **`@patch` decorator ordering**: When using `@patch` as a decorator on test methods, mock arguments are injected **before** pytest fixtures. Order is bottom-to-top for decorators, left-to-right for args:
  ```python
  @patch('module.b')  # mock_b — second arg
  @patch('module.a')  # mock_a — first arg
  def test_foo(self, mock_a, mock_b, client, db):  # mocks first, then fixtures
      ...
  ```
  Getting this wrong causes `fixture 'mock_X' not found` errors.

## Mutation Testing
- See [MUTATION_TESTING.md](./MUTATION_TESTING.md) for advanced testing guide

## Committing
- Never commit unless asked
- Lint + build must pass: `bun run lint && bun run build`

## DB Migrations (Alembic)
- Location: `db/migrations/versions/`
- Chain: `e5f6a7b8c9d0` → `f6a7b8c9d0e1` (add notes) → `g7b8c9d0e1f2` (add peak/low price) → `2026_04_16_add_reason_to_trades` → `2026_04_20_snapshot_to_db` (BotRuntimeState, StrategyRuntimeState, Position new columns)
- **Validation**: `python scripts/validate_migrations.py` — CI runs this automatically on PRs touching `db/migrations/**`
- **Rule**: `down_revision` must be the actual revision ID (e.g., `'h8b9c0d1e2f3'`), never the filename
- **How to find parent revision**: Look at the parent migration file's `revision = '...'` variable, not its filename
- Trade model columns: `notes` (String 500), `reason` (String 500), `peak_price` (Float), `low_price` (Float), `bot_id` (Integer FK)
- `Trade.to_dict()` includes all columns including `bot_id`, `peak_price`, `low_price`
- Position model has NO `peak_price`/`low_price` — restore defaults to `entry_price`. Position HAS `strategy_type`, `peak_price`, `low_price`, `metadata_json` columns (added in snapshot-to-DB migration).

## Known Issues / Deferred
- **Replay system name→ID migration** (Phase 3) — deferred, known limitation
- **ExitReasonBadge**: doesn't color-code rich exit reasons (MANUAL_CLOSE, PnL-formatted strings like "Stop loss hit ₹1340.00") — falls to gray default
- **ExitReasonBadge missing cases**: `FORCE_CLOSE`, `TRAILING_STOP`, `MAX_HOLDING`, `NEW_52W_HIGH` — all show as raw gray text
- **Portfolio summary compact redesign** — mentioned but not started
- **52W daily data caching** — fetches 400 days per chart request with no caching
- **52W range batch progress in admin UI**: normal post-bootstrap runs are very fast (tiny candidate set after skip-existing), so the "running" state + progress bar is rarely caught by the panel's polling. The UI mostly shows the last completed result. Force a long run (clear DB first + full refresh) if you need to observe live progress.
- **`_filter_to_date_or_recent` timezone bug** — see [PRODUCTION.md](./PRODUCTION.md) (known production issue)
- **TradingAgents auth**: `get_current_user` dependency has compatibility issues with this router (langgraph_sdk/chaining chainlit interference). All trading_agents endpoints use no auth or hardcoded user_id=3 for now.
- **Analysis speed**: Multi-agent analysis takes 60-120s (15+ DeepSeek LLM calls). First analysis on any ticker is slow, subsequent requests are instant from file cache.
