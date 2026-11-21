# App Architecture & Feature Map

A browsable map of what is actually in the repo today. Every linked path was checked against
disk. This document **complements** [`MAP.md`](./MAP.md) (task → file) and
[`architecture.md`](./architecture.md) (Mermaid system/deployment diagrams); it does not repeat
them. Where the three disagree, this document follows the source — see [Doc drift](#10-doc-drift-notes)
at the end.

---

## 1. System overview

Three layers, one process boundary. The FastAPI app is the only writer of the DB; the bot runs as
a **separate subprocess** (`trading/runner_cli.py`) that also talks to the DB and Redis.

| Layer | Entry file | Responsibility |
| --- | --- | --- |
| Solid 1.9 / Vite 8 / Tailwind 4 frontend | [`src/main.tsx`](../src/main.tsx) → [`src/App.tsx`](../src/App.tsx) | Routing, stores, `@/ui` design system, ECharts panels |
| FastAPI / Uvicorn backend (:8765) | [`api_server_fastapi.py`](../api_server_fastapi.py) | 292 operations in [`openapi.yaml`](../openapi.yaml), auth, screener, reports, bots, SSE/WebSocket |
| Storage | [`db/database.py`](../db/database.py), `db/alphashri.db` (dev SQLite), Redis (cache, bot heartbeat/PID), PostgreSQL (prod) | SQLAlchemy models in [`db/models/`](../db/models/__init__.py); Alembic migrations in `db/migrations/` |

**How the layers talk**

| Transport | Frontend owner | Backend owner | Used by |
| --- | --- | --- | --- |
| REST (JSON) | `fetchWithAuth` in [`src/state/auth.ts`](../src/state/auth.ts); base URL from [`src/api/config.ts`](../src/api/config.ts); one typed module per feature in [`src/api/`](../src/api/index.ts) | Routers mounted in [`api_server_fastapi.py`](../api_server_fastapi.py) (`_include_api()` at line 1123, includes at 1569–1732); contract in [`openapi.yaml`](../openapi.yaml) | All features |
| SSE | [`src/api/sse.ts`](../src/api/sse.ts) `readSseStream` + frame parser | [`api/paper/live_stream.py`](../api/paper/live_stream.py) (`/api/paper/live/stream`), chart-pattern scan and TradingAgents stream in [`api/trading_agents.py`](../api/trading_agents.py) | Live prices → [`LivePriceUpdater.tsx`](../src/components/paper-trading/LivePriceUpdater.tsx); pattern scan progress; TradingAgents (no UI consumer) |
| WebSocket | [`src/state/newsWebSocket.tsx`](../src/state/newsWebSocket.tsx), [`src/pages/report/niftyStreamSolid.ts`](../src/pages/report/niftyStreamSolid.ts), [`src/hooks/useFyersTickStream.ts`](../src/hooks/useFyersTickStream.ts) | [`api/news/news_ws.py`](../api/news/news_ws.py) (`/ws/news`), [`api/reports_api/nifty_ws.py`](../api/reports_api/nifty_ws.py) (`/ws/nifty/*`), [`api/reports_api/fyers_ws.py`](../api/reports_api/fyers_ws.py), [`api/orderflow_stream.py`](../api/orderflow_stream.py) (`/ws/orderflow`) | News feed, Index Report live tape/bursts, order flow |

Auth gate: [`AuthProvider`](../src/components/auth/AuthProvider.tsx) wraps everything; `AppContent`
renders the login/register screen until `auth.isAuthenticated`, then mounts `<Router root={Shell}>`.
`Shell` adds [`AppLayout`](../src/components/layout/AppLayout.tsx), `PreviewChartProvider`,
`SymbolDockProvider`, `Suspense`/`ErrorBoundary` and the toast host. Vite proxies `/api` to
:8765 in dev; production frontend points at the Render backend via `API_BASE`.

---

## 2. Frontend layout

```
src/main.tsx → src/App.tsx → <Route> → src/pages/<feature>/… → src/components/<feature>/…
                                  │                              └─ shared: src/components/common/
                                  └─ state via src/state/ + src/hooks/useStoreSubscription.ts
```

`App.tsx` registers **31 route elements** (30 explicit paths + one `*` catch-all redirect to
`/screener`). All are `lazy()`-loaded from `./pages/`. The `Shell` wrapper is shared.

| Folder | What belongs here |
| --- | --- |
| [`src/api/`](../src/api/index.ts) | One typed request module per feature over `fetchWithAuth`; transport + normalization, no state. |
| [`src/components/`](../src/components/common/compact.tsx) | Feature UI organised by domain. `common/` holds shared widgets (TanStackTable, tableCells, compact panels, state views). |
| [`src/config/`](../src/config/constants.ts) | Constants, theme, backtest defaults, currency/units ([`currency.ts`](../src/config/currency.ts)), market-universe descriptors ([`marketUniverses.ts`](../src/config/marketUniverses.ts)), wire caps. |
| [`src/hooks/`](../src/hooks/useFetch.ts) | Reusable Solid hooks: `useFetch`, `usePolling`, `useStoreSubscription`, `useScreenerState`, `useOptionsState`, `useStrategiesState`, tick-stream hooks. |
| [`src/pages/`](../src/pages/home/HomePage.tsx) | Route entry points (21 real pages + 7 thin `index.tsx` re-exports; see [§9](#9-where-things-are-not)). |
| [`src/state/`](../src/state/index.ts) | `createSubscriber` stores, one module per feature; `state/store/` holds two legacy Solid `createStore` slices. |
| [`src/types/`](../src/types/index.ts) | Shared TypeScript contracts (no runtime code). |
| [`src/ui/`](../src/ui/index.ts) | Local design system: semantic-HTML primitives + inputs + `palette.ts`. No Mantine. |
| [`src/utils/`](../src/utils/ui-helpers.ts) | Pure helpers (chart math, colour/contrast, market clock, report parsers, UI formatters). |
| `src/assets/`, `src/test/`, `src/test-utils/` | Static assets; shared guard specs; test render helpers. |

---

## 3. Feature map

Every route in `App.tsx` is represented below, plus the tabs inside `/screener` and the
unauthenticated login screen. "Store" names a module under `src/state/`; "API" a module under
`src/api/`; "Backend" the router (or a directly-declared endpoint in the app module).

### 3.1 Platform / navigation

#### Redirects (`/`, `*`)
**What:** Folds legacy `?tab=` URLs into `/screener/<tab>` and sends unknown paths to the screener.
**Entry:** `RootRedirect` and catch-all in [`src/App.tsx`](../src/App.tsx). No store/API/backend.

#### Authentication (no route)
**What:** Login/register screen shown in `App` while `auth.isAuthenticated` is false.
**Components:** [`AuthProvider.tsx`](../src/components/auth/AuthProvider.tsx), [`LoginForm.tsx`](../src/components/auth/LoginForm.tsx).
**Store:** [`state/auth.ts`](../src/state/auth.ts) · **API:** [`src/api/config.ts`](../src/api/config.ts) (`API_ENDPOINTS.AUTH`) · **Backend:** [`api/auth.py`](../api/auth.py) (`/api/auth/login|me|logout`, JWT + refresh).

#### Home / Monitor — `/home`
**What:** Dockable workspace canvas plus a date-scoped catalyst radar and session pulse bar.
**Components:** [`HomePage.tsx`](../src/pages/home/HomePage.tsx), [`HomeMonitorView.tsx`](../src/components/home/HomeMonitorView.tsx), [`WindowManager.tsx`](../src/components/window/WindowManager.tsx), [`panelRegistry.ts`](../src/components/window/panelRegistry.ts), [`CatalystRadarPanel.tsx`](../src/components/catalyst/CatalystRadarPanel.tsx).
**Store:** [`catalystStore.ts`](../src/state/catalystStore.ts) (one 30 s poll for the whole app) · **API:** [`catalysts.ts`](../src/api/catalysts.ts) · **Backend:** [`api/catalyst_radar/router.py`](../api/catalyst_radar/router.py) (`/api/catalysts/today`).

### 3.2 Screening & market data

#### Screener — `/screener/:tab?`
**What:** The main workspace; five tabs, with the old Dashboard and Deep Value folded into Market's `movers` and `value` views.
**Entry:** [`ScreenerContainer.tsx`](../src/pages/screener/ScreenerContainer.tsx) → [`ScreenerPage.tsx`](../src/components/screener/ScreenerPage.tsx).
**Store:** [`state/index.ts`](../src/state/index.ts) via [`useScreenerState.ts`](../src/hooks/useScreenerState.ts) · **API:** [`screeners.ts`](../src/api/screeners.ts), [`screenerDashboard.ts`](../src/api/screenerDashboard.ts) · **Backend:** `GET /api/screener` + `/api/screeners` declared directly in [`api_server_fastapi.py`](../api_server_fastapi.py); scan logic in [`api/screener_api/screener_scan.py`](../api/screener_api/screener_scan.py).

| Tab (`/screener/<tab>`) | Component | Store / API | Backend |
| --- | --- | --- | --- |
| `screener` (default content) | [`ScreenerContent.tsx`](../src/components/screener/ScreenerContent.tsx) + [`ScreenerTable.tsx`](../src/components/screener/ScreenerTable.tsx) | `state/index.ts` · [`screeners.ts`](../src/api/screeners.ts) | [`api_server_fastapi.py`](../api_server_fastapi.py) `/api/screener` |
| `market?view=value` (was `deepvalue`) | [`ValuePanel.tsx`](../src/components/value/ValuePanel.tsx) embedded by [`MarketScreenerPanel.tsx`](../src/components/market/MarketScreenerPanel.tsx); the Value filter band + one-click preset are in [`MarketFilterRail.tsx`](../src/components/market/MarketFilterRail.tsx) | local Solid signals · [`valueScan.ts`](../src/api/valueScan.ts), presets in [`valuePresets.generated.ts`](../src/api/valuePresets.generated.ts) | [`api/value_scan/router.py`](../api/value_scan/router.py) `/api/value/scan` |
| `fno` | [`FnoScreenerTab.tsx`](../src/components/screener/FnoScreenerTab.tsx) | local signals · [`fnoScreener.ts`](../src/api/fnoScreener.ts) | [`api/options_screener.py`](../api/options_screener.py) `/api/options/screener` |
| `market` (bare `/screener`) | [`MarketScreenerPage.tsx`](../src/pages/market/MarketScreenerPage.tsx) → [`MarketMapView.tsx`](../src/components/market/MarketMapView.tsx) | local signals · [`marketScreener.ts`](../src/api/marketScreener.ts) | [`api/market_screen/router.py`](../api/market_screen/router.py) `/api/market`, `/api/market/snapshot` |
| `correlation` | [`CorrelationTab.tsx`](../src/components/screener/CorrelationTab.tsx), [`CorrelationMatrix.tsx`](../src/components/screener/CorrelationMatrix.tsx) | [`correlation.ts`](../src/state/correlation.ts) · [`correlation.ts`](../src/api/correlation.ts) | [`api/correlation.py`](../api/correlation.py) `/api/correlation/` |
| `config` | [`ScreenerConfigView.tsx`](../src/components/screener/ScreenerConfigView.tsx) | `state/index.ts` · [`screeners.ts`](../src/api/screeners.ts) | `/api/screeners` CRUD in [`api_server_fastapi.py`](../api_server_fastapi.py) |
| `dashboard` (legacy) | Redirected to `market?view=movers` | — | — |
| `deepvalue` (legacy) | Redirected to `market?view=value` | — | — |

#### Sector — `/sector`
**What:** Sector rotation matrix, RRG, heatmap, movers and sector correlation.
**Components:** [`SectorPage.tsx`](../src/components/sector/SectorPage.tsx) via [`pages/sector/index.tsx`](../src/pages/sector/index.tsx); [`RotationBoard.tsx`](../src/components/sector/RotationBoard.tsx), [`SectorHeatmapView.tsx`](../src/components/sector/SectorHeatmapView.tsx).
**Stores:** [`sector.ts`](../src/state/sector.ts), [`sectorCorrelation.ts`](../src/state/sectorCorrelation.ts) · **API:** [`sector.ts`](../src/api/sector.ts), [`rotation.ts`](../src/api/rotation.ts), [`sectorCorrelation.ts`](../src/api/sectorCorrelation.ts) · **Backend:** [`api/sector.py`](../api/sector.py), [`api/rotation.py`](../api/rotation.py).

#### Chart — `/chart/:symbol?`
**What:** Standalone candlestick/pattern chart with levels overlays.
**Entry:** [`ChartView.tsx`](../src/pages/chart/ChartView.tsx) · **API:** [`chartPreview.ts`](../src/api/chartPreview.ts), [`chartBuilder.ts`](../src/api/chartBuilder.ts) · **Backend:** [`api/chart.py`](../api/chart.py) (`/api/chart/preview`). No dedicated store.

#### Heatmap
**What:** No standalone route (removed 2026-11-14). Treemap is shared by Market, Sector, Agri and the Home dock panel.
**Components:** [`MarketMapView.tsx`](../src/components/market/MarketMapView.tsx) (renders the treemap), maths in [`marketTreemap.ts`](../src/components/market/marketTreemap.ts), shared scale helpers in [`heatmapUtils.ts`](../src/components/heatmap/heatmapUtils.ts) · **API:** [`heatmap.ts`](../src/api/heatmap.ts) · **Backend:** [`api/heatmap.py`](../api/heatmap.py). See [`DELETION_LOG.md`](./DELETION_LOG.md).

### 3.3 Trading, backtesting & automation

#### Backtest — `/backtest`
**Components:** [`BacktestPage.tsx`](../src/components/backtest/BacktestPage.tsx) via [`pages/backtest/index.tsx`](../src/pages/backtest/index.tsx); `BacktestConfig/ResultsTable/ChartTabs`.
**Store:** [`backtest.ts`](../src/state/backtest.ts) (read reactively with `useStoreSnapshot`) · **API:** [`backtest.ts`](../src/api/backtest.ts) · **Backend:** [`api/backtest_routes.py`](../api/backtest_routes.py), engine [`backtest/engine.py`](../backtest/engine.py), costs [`backtest/costs.py`](../backtest/costs.py).

#### Paper Trading — `/paper`
**What:** Simulated portfolio, positions/trades, bot selector, live P&L and settings.
**Components:** [`PaperTradingView.tsx`](../src/components/paper-trading/PaperTradingView.tsx) via [`pages/paper/index.tsx`](../src/pages/paper/index.tsx); [`PaperChart.tsx`](../src/components/paper-trading/PaperChart.tsx), [`LivePriceUpdater.tsx`](../src/components/paper-trading/LivePriceUpdater.tsx).
**Store:** [`paperTrading.ts`](../src/state/paperTrading.ts) · **API:** [`paperTrading.ts`](../src/api/paperTrading.ts) (+ SSE via [`sse.ts`](../src/api/sse.ts)) · **Backend:** [`api/paper_trading.py`](../api/paper_trading.py), [`api/paper/live_stream.py`](../api/paper/live_stream.py).

#### Replay — `/replay`
**Components:** [`ReplayPage.tsx`](../src/components/replay/ReplayPage.tsx) via [`pages/replay/index.tsx`](../src/pages/replay/index.tsx); `ReplayConfig/Chart/TradeLog/Stats`.
**Store:** [`replay.ts`](../src/state/replay.ts) · **API:** [`replay.ts`](../src/api/replay.ts) · **Backend:** [`api/replay_api.py`](../api/replay_api.py) (SSE).

#### Strategies — `/strategies`
**Components:** [`StrategiesPage.tsx`](../src/components/strategies/StrategiesPage.tsx) via [`StrategiesContainer.tsx`](../src/pages/strategies/StrategiesContainer.tsx); `OrbParamsPanel`, `SrBreakoutParamsPanel`, `SwingParamsPanel`.
**Store:** [`strategies.ts`](../src/state/strategies.ts) · **API:** [`strategies.ts`](../src/api/strategies.ts) · **Backend:** [`api/strategies.py`](../api/strategies.py).

#### Strategy Runner — `/strategy-runner`
**Components:** [`StrategyRunnerPage.tsx`](../src/components/strategy-runner/StrategyRunnerPage.tsx) via [`pages/strategy-runner/index.tsx`](../src/pages/strategy-runner/index.tsx).
**Store:** `strategies` · **API:** [`strategyRunner.ts`](../src/api/strategyRunner.ts) · **Backend:** [`api/strategy_runner_api.py`](../api/strategy_runner_api.py) → subprocess [`trading/runner_cli.py`](../trading/runner_cli.py).

#### Bots — `/bots`
**Components:** [`BotsPage.tsx`](../src/components/bots/BotsPage.tsx) via [`pages/bots/index.tsx`](../src/pages/bots/index.tsx); `BotStatusPanel`, `BotConfigModal`.
**Store:** [`bots.ts`](../src/state/bots.ts) · **API:** [`bots.ts`](../src/api/bots.ts), [`botControlApi.ts`](../src/api/botControlApi.ts) · **Backend:** [`api/bots_api/bots_router.py`](../api/bots_api/bots_router.py) (`/api/bots`).

#### Experiments — `/experiments`
**Components:** [`ExperimentsPage.tsx`](../src/components/experiments/ExperimentsPage.tsx) via [`pages/experiments/index.tsx`](../src/pages/experiments/index.tsx).
**Store:** [`experiments.ts`](../src/state/experiments.ts) · **API:** [`experiments.ts`](../src/api/experiments.ts) · **Backend:** [`api/experiment_routes.py`](../api/experiment_routes.py) (`/api/experiments`), [`trading/autoresearch_engine.py`](../trading/autoresearch_engine.py).

### 3.4 Options

#### Options — `/options`
**What:** Underlying chain, positions, positioning, premium tracker and simulator.
**Components:** [`OptionsContainer.tsx`](../src/pages/options/OptionsContainer.tsx) → [`OptionsPage.tsx`](../src/components/options/OptionsPage.tsx), [`OptionsDockPanel.tsx`](../src/components/options-dock/OptionsDockPanel.tsx).
**Stores:** [`optionsDock.ts`](../src/state/optionsDock.ts), [`optionsDashboard.ts`](../src/state/optionsDashboard.ts), [`optionsStore.ts`](../src/state/optionsStore.ts) · **API:** [`optionsDock.ts`](../src/api/optionsDock.ts), [`upstoxOptions.ts`](../src/api/upstoxOptions.ts), [`premiumTracker.ts`](../src/api/premiumTracker.ts) · **Backend:** [`api/options.py`](../api/options.py), [`api/options_underlying.py`](../api/options_underlying.py), [`api/options_positioning.py`](../api/options_positioning.py), [`api/premium_tracker.py`](../api/premium_tracker.py).

#### Options Analytics — `/options/analytics/:symbol`
**What:** Payoff / smile / term / surface / probability panels.
**Entry:** [`OptionsAnalyticsPage.tsx`](../src/pages/options/OptionsAnalyticsPage.tsx) · **Components:** [`src/components/options-dock/analytics/`](../src/components/options-dock/analytics/AnalyticsTabStrip.tsx).
**Store:** [`optionsAnalytics.ts`](../src/state/optionsAnalytics.ts) · **API:** [`optionsAnalytics.ts`](../src/api/optionsAnalytics.ts) · **Backend:** [`api/options_analytics.py`](../api/options_analytics.py); constants in [`api/options_conventions.py`](../api/options_conventions.py).

### 3.5 Reports & research

#### Index Report — `/report/index` (`/report/nifty` redirects here)
**What:** Live options desk for an index/underlying — spot tape, 10 s chain, OI walls, flow windows, replay.
**Entry:** [`NiftyReportShell.tsx`](../src/pages/report/NiftyReportShell.tsx) → [`ReportWorkspace.tsx`](../src/pages/report/ReportWorkspace.tsx), [`NiftyChartPanel.tsx`](../src/pages/report/NiftyChartPanel.tsx), [`NiftyTapeTable.tsx`](../src/pages/report/NiftyTapeTable.tsx), [`NiftyWallsCard.tsx`](../src/pages/report/NiftyWallsCard.tsx).
**Store:** [`niftyReportStore.ts`](../src/pages/report/niftyReportStore.ts) + [`ReportContext.tsx`](../src/pages/report/ReportContext.tsx); live WS in [`niftyStreamSolid.ts`](../src/pages/report/niftyStreamSolid.ts).
**API:** [`reportNifty.ts`](../src/api/reportNifty.ts) · **Backend:** [`api/reports_api/nifty.py`](../api/reports_api/nifty.py), [`api/reports_api/options_report.py`](../api/reports_api/options_report.py), [`api/reports_api/options_walls.py`](../api/reports_api/options_walls.py), [`api/reports_api/nifty_ws.py`](../api/reports_api/nifty_ws.py).

#### Daily Report — `/report`
**What:** Daily breadth, breakouts, follow-through and delivery events.
**Entry:** [`ReportContainer.tsx`](../src/pages/report/ReportContainer.tsx) → [`DailyReportPage.tsx`](../src/pages/report/DailyReportPage.tsx).
**API:** [`report.ts`](../src/api/report.ts) (+ [`eventWatch.ts`](../src/api/eventWatch.ts) for the embedded `EventWatch.tsx`) · **Backend:** [`api/reports_api/breakouts.py`](../api/reports_api/breakouts.py), [`delivery.py`](../api/reports_api/delivery.py), [`followthrough.py`](../api/reports_api/followthrough.py), [`market.py`](../api/reports_api/market.py), [`events_feed.py`](../api/reports_api/events_feed.py).

#### Profitability — `/report/profit`
**Entry:** [`Profitability.tsx`](../src/pages/report/Profitability.tsx) · **API:** [`profitability.ts`](../src/api/profitability.ts) · **Backend:** [`api/reports_api/profitability.py`](../api/reports_api/profitability.py).

#### Chart Patterns — `/patterns`
**What:** Detected chart patterns across timeframes, grid/list/fullscreen views.
**Components:** [`PatternsContainer.tsx`](../src/pages/patterns/PatternsContainer.tsx) → [`PatternsPage.tsx`](../src/pages/patterns/PatternsPage.tsx); feature UI in [`src/components/patterns/`](../src/components/patterns/PatternGrid.tsx).
**Store:** [`chartPatterns.ts`](../src/state/chartPatterns.ts) · **API:** [`chartPatterns.ts`](../src/api/chartPatterns.ts) · **Backend:** [`api/chart_patterns.py`](../api/chart_patterns.py), detector engine [`chart_patterns/engine.py`](../chart_patterns/engine.py), cache [`chart_patterns/candles.py`](../chart_patterns/candles.py).

### 3.6 Platform & tooling

#### News — `/news`
**Components:** [`NewsPage.tsx`](../src/pages/NewsPage.tsx) → [`NewsPanel.tsx`](../src/components/news/NewsPanel.tsx).
**API:** [`news.ts`](../src/api/news.ts) + WS via [`newsWebSocket.tsx`](../src/state/newsWebSocket.tsx) · **Backend:** [`api/news_routes.py`](../api/news_routes.py), [`api/news/news_ws.py`](../api/news/news_ws.py), [`api/news/news_fetch.py`](../api/news/news_fetch.py). No dedicated feature store (panel-local signals).

#### Admin — `/admin`
**Components:** [`AdminPage.tsx`](../src/pages/AdminPage.tsx) + panels in [`src/pages/admin/`](../src/pages/admin/Admin52wRangePanel.tsx).
**API:** [`adminPatternTimeframes.ts`](../src/api/adminPatternTimeframes.ts), [`orderflowJournal.ts`](../src/api/orderflowJournal.ts) · **Backend:** [`api/admin.py`](../api/admin.py), [`api/admin_routes.py`](../api/admin_routes.py), [`api/debug_api.py`](../api/debug_api.py).

#### Settings — `/settings`
**What:** Broker OAuth connection plus persisted per-user UI config.
**Entry:** [`SettingsPage.tsx`](../src/pages/settings/SettingsPage.tsx) · **Component:** [`BrokerConnectionCard.tsx`](../src/components/settings/BrokerConnectionCard.tsx) · **API:** [`brokers.ts`](../src/api/brokers.ts), [`userConfigs.ts`](../src/api/userConfigs.ts) · **Backend:** [`api/brokers.py`](../api/brokers.py), [`api/user_configs.py`](../api/user_configs.py).

#### Agri — `/agri`
**Components:** [`AgriContainer.tsx`](../src/pages/agri/AgriContainer.tsx) → [`AgriPage.tsx`](../src/pages/agri/AgriPage.tsx) · **API:** [`agri.ts`](../src/api/agri.ts) · **Backend:** [`api/agri/router.py`](../api/agri/router.py).

#### Order Flow — `/orderflow`
**Components:** [`OrderFlowPage.tsx`](../src/pages/orderflow/OrderFlowPage.tsx) · **API:** [`orderflowJournal.ts`](../src/api/orderflowJournal.ts) + WS via [`useFyersTickStream.ts`](../src/hooks/useFyersTickStream.ts) · **Backend:** [`api/orderflow_stream.py`](../api/orderflow_stream.py), [`api/orderflow_journal.py`](../api/orderflow_journal.py).

#### POC routes — `/poc/*`
**What:** Research/proof-of-concept screens, not production surfaces.

| Route | Entry file |
| --- | --- |
| `/poc/kit` | [`KitPoc.tsx`](../src/pages/poc/KitPoc.tsx) |
| `/poc/smc` | [`SmcPoc.tsx`](../src/pages/poc/SmcPoc.tsx) |
| `/poc/smc-trades` | [`SmcTrades.tsx`](../src/pages/poc/SmcTrades.tsx) |
| `/poc/tick-replay` | [`TickReplay.tsx`](../src/pages/poc/TickReplay.tsx) |
| `/poc/replay` | [`ReplayIndexPage.tsx`](../src/pages/poc/ReplayIndexPage.tsx) |
| `/poc/replay/:strategyId` | [`ReplayStrategyPage.tsx`](../src/pages/poc/ReplayStrategyPage.tsx) |

**Backend:** [`api/poc_nq.py`](../api/poc_nq.py) (`/api/poc/nq`), [`api/reports_api/sim.py`](../api/reports_api/sim.py).

---

## 4. Backend layout

**Registration.** [`api_server_fastapi.py`](../api_server_fastapi.py) creates the `FastAPI` app at
line 1109 with `OPENAPI_TAGS` (lines ~1046–1092) and a lifespan that starts background jobs
(prewarm, 52W range batch, event-radar poller, DB backup). Most routers mount through
`_include_api("module", "router", label)`; the rest use explicit `app.include_router(...)` blocks
at 1575–1701. Router registration is **not** discoverable by walking `app.routes` in this
FastAPI version — use the checked-in [`openapi.yaml`](../openapi.yaml), regenerated by
[`scripts/export_openapi.py`](../scripts/export_openapi.py).

**Routers by domain**

| Domain | Modules |
| --- | --- |
| Auth / user | [`api/auth.py`](../api/auth.py), [`api/user_configs.py`](../api/user_configs.py), [`api/brokers.py`](../api/brokers.py) |
| Screening | [`api/screener.py`](../api/screener.py), [`api/screener_api/`](../api/screener_api/screener_scan.py), [`api/market_screen/router.py`](../api/market_screen/router.py), [`api/value_scan/router.py`](../api/value_scan/router.py), [`api/options_screener.py`](../api/options_screener.py), [`api/correlation.py`](../api/correlation.py) |
| Options | [`api/options.py`](../api/options.py), [`api/options_analytics.py`](../api/options_analytics.py), [`api/options_conventions.py`](../api/options_conventions.py), [`api/options_math.py`](../api/options_math.py), [`api/options_iv.py`](../api/options_iv.py) |
| Trading / bots | [`api/paper_trading.py`](../api/paper_trading.py), [`api/paper/live_stream.py`](../api/paper/live_stream.py), [`api/bots_api/`](../api/bots_api/bots_router.py), [`api/strategy_runner_api.py`](../api/strategy_runner_api.py), [`api/strategies.py`](../api/strategies.py), [`api/replay_api.py`](../api/replay_api.py) |
| Reports | [`api/reports_api/`](../api/reports_api/nifty.py) (NIFTY + generic `/api/reports/options/{symbol}`), [`api/event_radar/router.py`](../api/event_radar/router.py) (`/api/events`), [`api/catalyst_radar/router.py`](../api/catalyst_radar/router.py) (`/api/catalysts`) |
| Market data / research | [`api/chart.py`](../api/chart.py), [`api/chart_patterns.py`](../api/chart_patterns.py), [`api/heatmap.py`](../api/heatmap.py), [`api/sector.py`](../api/sector.py), [`api/rotation.py`](../api/rotation.py), [`api/news_routes.py`](../api/news_routes.py), [`api/trading_agents.py`](../api/trading_agents.py) |
| Ops | [`api/admin.py`](../api/admin.py), [`api/debug_api.py`](../api/debug_api.py), [`api/notifications_api.py`](../api/notifications_api.py), [`api/orderflow_stream.py`](../api/orderflow_stream.py), [`api/agri/router.py`](../api/agri/router.py), [`api/poc_nq.py`](../api/poc_nq.py) |

**Domain services**

- `db/`: [`database.py`](../db/database.py) (engine, Alembic upgrade at startup), models by domain in [`db/models/`](../db/models/__init__.py) (`user.py`, `trade.py`, `bot.py`, `broker.py`, `event.py`, `chat.py`, …). Never edit `db/alphashri.db` directly.
- `trading/`: signal-generator hierarchy rooted at [`base_signals.py`](../trading/base_signals.py) → [`orb_signals.py`](../trading/orb_signals.py), [`sr_breakout_signals.py`](../trading/sr_breakout_signals.py), [`ema_cross_signals.py`](../trading/ema_cross_signals.py), and [`week52_utils.py`](../trading/week52_utils.py) → chaser/target/blind. Orchestration: [`runner_cli.py`](../trading/runner_cli.py) → [`runner_core.py`](../trading/runner_core.py) → [`strategy_runner.py`](../trading/strategy_runner.py); positions in [`shared_portfolio.py`](../trading/shared_portfolio.py); risk in [`global_risk_manager.py`](../trading/global_risk_manager.py). Bots persist to DB + Redis, not JSON snapshots.
- `chart_patterns/`: [`engine.py`](../chart_patterns/engine.py), [`scan.py`](../chart_patterns/scan.py), [`candles.py`](../chart_patterns/candles.py), detectors in `detectors/`.
- `backtest/`: [`engine.py`](../backtest/engine.py), [`costs.py`](../backtest/costs.py) (single source of truth for trading costs), strategies in `strategies/`.

---

## 5. State management

No Redux, no `useState` for store-owned data. The pattern:

1. [`createSubscriber.ts`](../src/state/createSubscriber.ts) returns `{ subscribe, notify }` over a `Set` of callbacks — 14 lines, no framework dependency.
2. A feature module (e.g. [`bots.ts`](../src/state/bots.ts), [`chartPatterns.ts`](../src/state/chartPatterns.ts)) holds module-level `let` state and calls `notify()` after every mutation; setters and `getState()` are plain exported functions.
3. [`useStoreSubscription.ts`](../src/hooks/useStoreSubscription.ts) bridges that to Solid: `useStoreSubscription(subscribe)` returns a version accessor (you must read it); `useStoreSnapshot(subscribe, getState)` returns a reactive memo of a snapshot.
4. Components read `state()` in JSX/memos — 20 non-test modules use this hook; `useStoreSnapshot` is concentrated in Backtest, Paper Trading, Screener and Replay.
5. [`state/store/`](../src/state/store/index.ts) is the legacy exception: two Solid `createStore` slices (`appSlice.ts`, `notificationsSlice.ts`) used by Settings and notifications.

| Feature | Store module |
| --- | --- |
| Screener (all tabs) | [`state/index.ts`](../src/state/index.ts) via [`useScreenerState.ts`](../src/hooks/useScreenerState.ts) |
| Backtest | [`backtest.ts`](../src/state/backtest.ts) |
| Paper Trading | [`paperTrading.ts`](../src/state/paperTrading.ts) |
| Bots / Strategies / Replay | [`bots.ts`](../src/state/bots.ts), [`strategies.ts`](../src/state/strategies.ts), [`replay.ts`](../src/state/replay.ts) |
| Chart Patterns | [`chartPatterns.ts`](../src/state/chartPatterns.ts) |
| Sector / Correlation | [`sector.ts`](../src/state/sector.ts), [`sectorCorrelation.ts`](../src/state/sectorCorrelation.ts), [`correlation.ts`](../src/state/correlation.ts) |
| Options dock / analytics / dashboard | [`optionsDock.ts`](../src/state/optionsDock.ts), [`optionsAnalytics.ts`](../src/state/optionsAnalytics.ts), [`optionsDashboard.ts`](../src/state/optionsDashboard.ts), [`optionsStore.ts`](../src/state/optionsStore.ts) |
| Experiments / saved config / holidays / catalysts | [`experiments.ts`](../src/state/experiments.ts), [`savedConfig.ts`](../src/state/savedConfig.ts), [`holidays.ts`](../src/state/holidays.ts), [`catalystStore.ts`](../src/state/catalystStore.ts) |
| Auth / News WS / Index Report | [`auth.ts`](../src/state/auth.ts), [`newsWebSocket.tsx`](../src/state/newsWebSocket.tsx), [`pages/report/niftyReportStore.ts`](../src/pages/report/niftyReportStore.ts) |

---

## 6. Design system

[`src/ui/index.ts`](../src/ui/index.ts) is the barrel. Primitives are grouped by folder:
`layout/` (`Box`, `Flex`, `Stack`, `Group`, `Paper`, `Card`, `ScrollArea`, `ToolbarRow`),
`inputs/` (`Button`, `Select`, `TextInput`, `NumberInput`, `SegmentedControl`, …), `feedback/`
(`Badge`, `Alert`, `Loader`, `Progress`), `data-display/` (`Tabs`, `Accordion`, `Menu`, `Tree`),
`overlay/` (`Modal`, `Tooltip`, `Popover`), `typography/`, `navigation/`, `misc/`. They render
semantic HTML + Tailwind; Mantine-only `styles={{…}}` props were dropped. Shared widgets live one
level up in [`components/common/`](../src/components/common/TanStackTable.tsx): `TanStackTable`,
`tableCells.tsx`, [`compact.tsx`](../src/components/common/compact.tsx) (`CompactPanel`,
`CompactStat`), `states.tsx`, `Icons.tsx`.

[`palette.ts`](../src/ui/palette.ts) is the single colour source (no hardcoded hex elsewhere);
[`src/tailwind.css`](../src/tailwind.css) mirrors it under `@theme`. Semantic tokens: `POSITIVE`,
`NEGATIVE`, `WARNING`, `INFO`, and a surface ramp `BG #000000 → SURFACE #13161C → SURFACE_ALT
#1F242D → BORDER #2C313B`. Derive tints with `alpha()` rather than restating rgba strings; use
[`utils/contrast.ts`](../src/utils/contrast.ts) (`pickTextColor`) for every filled cell/badge.

Scale: radius small 4 / control 6 / large 10 px; control heights `xs 24 · sm 30 · md 34 · lg 38`;
type floor 9 px (body 13, table 11). Enforced by guards:
[`theme-single-source.test.ts`](../src/test/theme-single-source.test.ts),
[`design-scale.test.ts`](../src/test/design-scale.test.ts),
[`contrast.test.ts`](../src/test/contrast.test.ts),
[`ui-guard.test.ts`](../src/test/ui-guard.test.ts),
[`inputs.w-h.test.tsx`](../src/ui/inputs/inputs.w-h.test.tsx),
plus [`style-keys.test.ts`](../src/test/style-keys.test.ts) and
[`numeric-typography.test.ts`](../src/test/numeric-typography.test.ts).
Toast stylesheet import in [`main.tsx`](../src/main.tsx) is also guarded
([`toast-stylesheet.test.ts`](../src/test/toast-stylesheet.test.ts)).

---

## 7. Data flow examples

**A. Open Index Report (`/report/index`)**
`App.tsx` lazy route → [`NiftyReportShell.tsx`](../src/pages/report/NiftyReportShell.tsx) mounts
`ReportProvider` → [`ReportContext.tsx`](../src/pages/report/ReportContext.tsx) reads
[`niftyReportStore.ts`](../src/pages/report/niftyReportStore.ts) → that store calls
[`api/reportNifty.ts`](../src/api/reportNifty.ts) → `fetchWithAuth` → FastAPI routers
[`api/reports_api/nifty.py`](../api/reports_api/nifty.py) and
[`api/reports_api/options_report.py`](../api/reports_api/options_report.py), with live spot/tape
arriving over `niftyStreamSolid.ts` → `/ws/nifty/report`.

**B. Open Deep Value (`/screener?view=value`)**
`ScreenerPage.tsx` forwards `?view=value` to the Market tab →
[`MarketScreenerPanel.tsx`](../src/components/market/MarketScreenerPanel.tsx) mounts the lazy
[`ValuePanel.tsx`](../src/components/value/ValuePanel.tsx) in `embedded` mode →
[`hooks/useValueScanSolid.ts`](../src/components/value/useValueScanSolid.ts) →
[`api/valueScan.ts`](../src/api/valueScan.ts) `GET /api/value/scan?market=…` →
[`api/value_scan/router.py`](../api/value_scan/router.py) → TradingView scanner via
`tv_source.py`, scored by `scoring.py`, cached per-market in Redis (`cache.py`). The Value
band in [`MarketFilterRail.tsx`](../src/components/market/MarketFilterRail.tsx) supplies the
bounds and one-click preset; legacy `?tab=deepvalue` / `/screener/deepvalue` URLs redirect here.

**C. Live P&L on `/paper`**
[`PaperTradingView.tsx`](../src/components/paper-trading/PaperTradingView.tsx) mounts
[`LivePriceUpdater.tsx`](../src/components/paper-trading/LivePriceUpdater.tsx) → `readSseStream`
from [`api/sse.ts`](../src/api/sse.ts) against `/api/paper/live/stream` →
[`api/paper/live_stream.py`](../api/paper/live_stream.py) bridges the Upstox
`MarketDataStreamerV3` WebSocket into an SSE `price` event → updater calls `setPositions()` in
[`state/paperTrading.ts`](../src/state/paperTrading.ts), which recomputes P&L and notifies
subscribers. Falls back to polling when the stream drops.

---

## 8. Where things are NOT

- **Routes** are not in a config file — all 31 are inline `<Route>` elements in [`src/App.tsx`](../src/App.tsx). Guard: [`src/test/routes.test.ts`](../src/test/routes.test.ts).
- **Seven page folders are stubs.** The actual components live under `src/components/`; the `pages/<name>/index.tsx` files only re-export: [`sector`](../src/pages/sector/index.tsx), [`backtest`](../src/pages/backtest/index.tsx), [`bots`](../src/pages/bots/index.tsx), [`experiments`](../src/pages/experiments/index.tsx), [`paper`](../src/pages/paper/index.tsx), [`replay`](../src/pages/replay/index.tsx), [`strategy-runner`](../src/pages/strategy-runner/index.tsx).
- **Screener tab panels are not co-located with the tab strip.** Market lives in [`pages/market/`](../src/pages/market/MarketScreenerPage.tsx), while Correlation/Config/F&O live in `components/screener/`. Deep Value is no longer a tab — its panel in [`components/value/`](../src/components/value/ValuePanel.tsx) is mounted by the Market `value` view.
- **Some screens are docked panels, not pages.** The catalyst radar is registered in [`panelRegistry.ts`](../src/components/window/panelRegistry.ts) and mounted by Home's `WindowManager`, not by a route.
- **There is no standalone `/heatmap` route** and no `src/pages/heatmap/` directory (removed 2026-11-14); the treemap is shared, rendered by [`MarketMapView.tsx`](../src/components/market/MarketMapView.tsx) over [`marketTreemap.ts`](../src/components/market/marketTreemap.ts).
- **No `src/patterns/` directory** (old GoF demos deleted). Chart-pattern UI is [`components/patterns/`](../src/components/patterns/PatternGrid.tsx); route code is [`pages/patterns/`](../src/pages/patterns/PatternsPage.tsx); Tabler SVG icons used by `@/ui` are [`ui/icons.tsx`](../src/ui/icons.tsx), while generic app icons are [`components/common/Icons.tsx`](../src/components/common/Icons.tsx).
- **No `*.columns.ts` files** — column builders are factories in [`components/table/columns/`](../src/components/table/columns/index.tsx) or inline arrays beside the consumer.
- **One layering inversion remains** (a component importing a page): the lazy Market tab import in [`components/screener/ScreenerPage.tsx`](../src/components/screener/ScreenerPage.tsx). The other one (`components/dock/reportChartDock.tsx`) was deleted on 2026-11-21. Do not add more.
- **Endpoints are not discovered by reading routers one by one** — start at [`openapi.yaml`](../openapi.yaml). WebSocket routes (`/ws/orderflow`, `/ws/nifty/*`, `/ws/news`) never appear in it.
- **TradingAgents has no UI consumer.** Chat/analyze/stream endpoints exist in [`api/trading_agents.py`](../api/trading_agents.py); the old `ChatPopup` was removed on 2026-11-21.

---

## 9. Doc drift notes

Verified against source; **these docs were not edited** (outside this task's file scope):

- `MAP.md:18` says "all 27 pages" and `AGENTS.md:179` says "21 of 28 routes; 7 live under `components/`". [`src/App.tsx`](../src/App.tsx) actually has **31 `<Route>` elements** (30 paths + `*`).
- `AGENTS.md`'s Event Radar section describes a Screener `?tab=events` and `src/components/events/`. Neither exists: there is no Events tab in [`ScreenerPage.tsx`](../src/components/screener/ScreenerPage.tsx) and no `components/events/` directory. The backend [`api/event_radar/router.py`](../api/event_radar/router.py) does exist; the visible UI surfaces are the Home dock's [`CatalystRadarPanel.tsx`](../src/components/catalyst/CatalystRadarPanel.tsx) and the Daily Report's [`EventWatch.tsx`](../src/pages/report/EventWatch.tsx), backed by different endpoints (`/api/catalysts/today`, `/api/reports/events/*`).
- `AGENTS.md` names `src/hooks/useLivePrices.ts` and `PaperTradingView2.tsx`; the current implementation is [`components/paper-trading/LivePriceUpdater.tsx`](../src/components/paper-trading/LivePriceUpdater.tsx) + [`api/sse.ts`](../src/api/sse.ts), mounted by `PaperTradingView.tsx` (the `*2` suffix was removed).
- `MAP.md`'s layering-inversion examples (`StrategyRunnerTabs.tsx`, `PatternListView.tsx`, `SymbolDockProvider.tsx`, `MarketMapView.tsx`) no longer import pages. The current offenders are listed in [§8](#8-where-things-are-not).
- `architecture.md` lists an "/api/screener — TradingView Screener" service; today the TradingView-backed screening lives in `api/market_screen/` (`/api/market`) and `api/value_scan/` (`/api/value`), while `/api/screener` is the NSE/Upstox scan declared in the app module. Its "Render / Cloudflare Pages" deployment split is consistent with [`API_BASE`](../src/api/config.ts) and [`PRODUCTION.md`](../PRODUCTION.md).
- `AGENTS.md` states radius `4/6/10`, control heights `24/30/34/38` and a 9 px floor are guarded by [`design-scale.test.ts`](../src/test/design-scale.test.ts); that guard scans broader allowlists, so the stricter claim is documentary rather than literally enforced.
- The Changelog/Reports-Index rules in `AGENTS.md` apply to tasks that add reports; this documentation-only change adds no report artifact, so no `reports/index.html` regeneration was needed.
