// Mock API responses for E2E tests

import { apiRoute } from "./routeHelper";

export const mockScreenersList = {
  screeners: [
    { id: "trending", label: "Trending", description: "52-week high scanner" },
    {
      id: "buyer_interest_enhanced",
      label: "Buyer Interest+",
      description: "Enhanced buyer interest with sentiment",
    },
  ],
  default: "trending",
  meta_by_id: {
    buyer_interest_enhanced: {
      section_labels: { primary: "Buyer Interest+", secondary: "" },
      filters: [
        {
          key: "direction",
          label: "Direction",
          type: "select",
          options: ["both", "bullish", "bearish"],
          default: "both",
        },
        { key: "min_score", label: "Min Score", type: "number", min: 0, max: 200, default: 0 },
        {
          key: "min_vol_surge",
          label: "Min Vol Surge",
          type: "number",
          min: 0,
          max: 10,
          step: 0.1,
          default: 0,
        },
      ],
    },
  },
};

// Mock trending screener response
export const mockTrendingResponse = {
  approaching: [
    {
      symbol: "MOCK1",
      score: 105,
      tv_price: 100.5,
      upstox_price: 100.45,
      broker_diff: -0.05,
      high_52w: 103.25,
      to_52w_high: 2.73,
      recent_return_5d: -1.6,
      perf_w: 4.8,
      sector: "Finance",
      touched_52w: false,
      day_change: 0.26,
      rsi: 63.0,
      stoch_k: 0,
      wick_close_pct: 78.7,
      volume_surge: 2.53,
      volatility_d: 3.35,
      adx: 33.2,
      interest_score: 105.0,
      gap_pct: 0,
      premarket_change: 0,
      impact_score: 0,
      market_cap_b: 1222.98,
      volume_m: 1.34,
      reversal_signal: "",
      is_bullish: true,
      sentiment: "bullish",
      rationale: "Score 105 | 52W gap +2.73% | 5D -1.6% | PerfW +4.8%",
    },
    {
      symbol: "MOCK2",
      score: 90,
      tv_price: 200.0,
      upstox_price: 200.05,
      broker_diff: 0.02,
      high_52w: 200.8,
      to_52w_high: 0.4,
      recent_return_5d: 0.3,
      perf_w: 6.5,
      sector: "Technology",
      touched_52w: false,
      day_change: 0.45,
      rsi: 80.1,
      stoch_k: 0,
      wick_close_pct: 25.0,
      volume_surge: 0.6,
      volatility_d: 0.88,
      adx: 42.6,
      interest_score: 90.0,
      gap_pct: 0,
      premarket_change: 0,
      impact_score: 0,
      market_cap_b: 5000.0,
      volume_m: 5.42,
      reversal_signal: "",
      is_bullish: false,
      sentiment: "bearish",
      rationale: "Score 90 | 52W gap +0.40% | 5D +0.3% | PerfW +6.5%",
    },
  ],
  touched: [
    {
      symbol: "MOCK3",
      score: 115,
      tv_price: 150.0,
      upstox_price: 150.1,
      broker_diff: 0.07,
      high_52w: 150.0,
      to_52w_high: 0,
      recent_return_5d: 2.5,
      perf_w: 8.0,
      sector: "Healthcare",
      touched_52w: true,
      day_change: 1.5,
      rsi: 75.0,
      stoch_k: 0,
      wick_close_pct: 85.0,
      volume_surge: 3.0,
      volatility_d: 4.0,
      adx: 45.0,
      interest_score: 115.0,
      gap_pct: 0,
      premarket_change: 0,
      impact_score: 0,
      market_cap_b: 3000.0,
      volume_m: 2.5,
      reversal_signal: "",
      is_bullish: true,
      sentiment: "bullish",
      rationale: "Score 115 | Touched 52W | 5D +2.5% | PerfW +8.0%",
    },
  ],
  last_updated: new Date().toISOString(),
  provider: "upstox",
  mode: "intraday",
  screener: "trending",
};

// All buyer interest stocks (unfiltered)
const allBuyerInterestStocks = [
  {
    symbol: "BULL1",
    score: 99,
    tv_price: 500.0,
    upstox_price: 500.5,
    broker_diff: 0.1,
    to_52w_high: 0,
    recent_return_5d: 2.5,
    perf_w: 5.0,
    sector: "Industrial Services",
    touched_52w: false,
    day_change: 2.5,
    rsi: 70.0,
    stoch_k: 0,
    wick_close_pct: 87.2,
    volume_surge: 1.66,
    volatility_d: 3.0,
    adx: 35.0,
    interest_score: 99.0,
    gap_pct: 0,
    premarket_change: 0,
    impact_score: 0,
    market_cap_b: 1000.0,
    volume_m: 1.0,
    reversal_signal: "",
    is_bullish: true,
    sentiment: "bullish",
    rationale: "Wick 87.2% | VolSurge 1.66x | RSI 70.0",
  },
  {
    symbol: "BULL2",
    score: 95,
    tv_price: 300.0,
    upstox_price: 300.25,
    broker_diff: 0.08,
    to_52w_high: 0,
    recent_return_5d: 1.8,
    perf_w: 4.0,
    sector: "Technology",
    touched_52w: false,
    day_change: 1.8,
    rsi: 65.0,
    stoch_k: 0,
    wick_close_pct: 75.0,
    volume_surge: 2.0,
    volatility_d: 2.5,
    adx: 30.0,
    interest_score: 95.0,
    gap_pct: 0,
    premarket_change: 0,
    impact_score: 0,
    market_cap_b: 800.0,
    volume_m: 0.8,
    reversal_signal: "",
    is_bullish: true,
    sentiment: "bullish",
    rationale: "Wick 75.0% | VolSurge 2.00x | RSI 65.0",
  },
  {
    symbol: "BEAR1",
    score: 85,
    tv_price: 200.0,
    upstox_price: 199.5,
    broker_diff: -0.25,
    to_52w_high: 0,
    recent_return_5d: -1.5,
    perf_w: -2.0,
    sector: "Energy",
    touched_52w: false,
    day_change: -1.5,
    rsi: 35.0,
    stoch_k: 0,
    wick_close_pct: 25.0,
    volume_surge: 1.5,
    volatility_d: 2.0,
    adx: 25.0,
    interest_score: 85.0,
    gap_pct: 0,
    premarket_change: 0,
    impact_score: 0,
    market_cap_b: 500.0,
    volume_m: 0.5,
    reversal_signal: "",
    is_bullish: false,
    sentiment: "bearish",
    rationale: "Wick 25.0% | VolSurge 1.50x | RSI 35.0",
  },
  {
    symbol: "BEAR2",
    score: 80,
    tv_price: 150.0,
    upstox_price: 149.8,
    broker_diff: -0.13,
    to_52w_high: 0,
    recent_return_5d: -2.0,
    perf_w: -3.0,
    sector: "Materials",
    touched_52w: false,
    day_change: -2.0,
    rsi: 30.0,
    stoch_k: 0,
    wick_close_pct: 15.0,
    volume_surge: 1.2,
    volatility_d: 1.5,
    adx: 20.0,
    interest_score: 80.0,
    gap_pct: 0,
    premarket_change: 0,
    impact_score: 0,
    market_cap_b: 300.0,
    volume_m: 0.3,
    reversal_signal: "",
    is_bullish: false,
    sentiment: "bearish",
    rationale: "Wick 15.0% | VolSurge 1.20x | RSI 30.0",
  },
  {
    symbol: "NEUTRAL1",
    score: 75,
    tv_price: 100.0,
    upstox_price: 100.05,
    broker_diff: 0.05,
    to_52w_high: 0,
    recent_return_5d: 0.5,
    perf_w: 1.0,
    sector: "Consumer",
    touched_52w: false,
    day_change: 0.5,
    rsi: 50.0,
    stoch_k: 0,
    wick_close_pct: 50.0,
    volume_surge: 1.0,
    volatility_d: 1.0,
    adx: 15.0,
    interest_score: 75.0,
    gap_pct: 0,
    premarket_change: 0,
    impact_score: 0,
    market_cap_b: 200.0,
    volume_m: 0.2,
    reversal_signal: "",
    is_bullish: true,
    sentiment: "neutral",
    rationale: "Wick 50.0% | VolSurge 1.00x | RSI 50.0",
  },
];

// Helper to create buyer interest response
function createBuyerInterestResponse(direction: string) {
  let stocks = allBuyerInterestStocks;
  if (direction === "bullish") {
    stocks = stocks.filter((s) => s.wick_close_pct >= 60);
  } else if (direction === "bearish") {
    stocks = stocks.filter((s) => s.wick_close_pct <= 40);
  }
  return {
    approaching: stocks,
    touched: [],
    last_updated: new Date().toISOString(),
    provider: "upstox",
    mode: "intraday",
    screener: "buyer_interest_enhanced",
    profile_meta: {
      section_labels: { primary: "Buyer Interest+", secondary: "" },
      filters: [
        {
          key: "direction",
          label: "Direction",
          type: "select",
          options: ["both", "bullish", "bearish"],
          default: "both",
        },
        { key: "min_score", label: "Min Score", type: "number", min: 0, max: 200, default: 0 },
        {
          key: "min_vol_surge",
          label: "Min Vol Surge",
          type: "number",
          min: 0,
          max: 10,
          step: 0.1,
          default: 0,
        },
      ],
    },
  };
}

// Export the counts for assertions
export const mockBuyerInterestCounts = {
  total: allBuyerInterestStocks.length,
  bullish: allBuyerInterestStocks.filter((s) => s.wick_close_pct >= 60).length,
  bearish: allBuyerInterestStocks.filter((s) => s.wick_close_pct <= 40).length,
};

export const mockSectorResponse = {
  sectors: [
    {
      sector: "Technology",
      avg_change: 2.45,
      stock_count: 45,
      advances: 35,
      declines: 10,
      avg_rsi: 62.5,
      avg_adx: 28.3,
      top_movers: "TCS(+3.2%) INFY(+2.8%) WIPRO(+1.9%)",
    },
    {
      sector: "Finance",
      avg_change: 1.2,
      stock_count: 38,
      advances: 25,
      declines: 13,
      avg_rsi: 58.0,
      avg_adx: 22.1,
      top_movers: "HDFC(+2.1%) ICICI(+1.5%) SBI(+0.8%)",
    },
    {
      sector: "Energy",
      avg_change: -0.85,
      stock_count: 22,
      advances: 8,
      declines: 14,
      avg_rsi: 45.2,
      avg_adx: 18.5,
      top_movers: "RELIANCE(+0.5%) ONGC(-1.2%) BPCL(-2.0%)",
    },
  ],
  top_stock_movers: [
    { symbol: "TCS", change: 3.2 },
    { symbol: "INFY", change: 2.8 },
    { symbol: "HDFC", change: 2.1 },
    { symbol: "WIPRO", change: 1.9 },
    { symbol: "ICICI", change: 1.5 },
  ],
  last_updated: new Date().toISOString(),
  market: "india",
};

// Mock sector correlation response (India)
export const mockSectorCorrelationResponse = {
  sectors: [
    {
      name: "NIFTY 50",
      beta_vs_index: 1.0,
      relative_strength_5d: 0.5,
      relative_strength_1m: 1.0,
      relative_strength_3m: 2.0,
      rank_current: 1,
      rank_change_1m: 0,
    },
    {
      name: "NIFTY BANK",
      beta_vs_index: 1.3,
      relative_strength_5d: 1.2,
      relative_strength_1m: 2.5,
      relative_strength_3m: 4.0,
      rank_current: 2,
      rank_change_1m: 1,
    },
    {
      name: "NIFTY IT",
      beta_vs_index: 0.9,
      relative_strength_5d: -0.3,
      relative_strength_1m: 0.5,
      relative_strength_3m: 1.0,
      rank_current: 3,
      rank_change_1m: -1,
    },
    {
      name: "NIFTY FMCG",
      beta_vs_index: 0.7,
      relative_strength_5d: 0.2,
      relative_strength_1m: 0.8,
      relative_strength_3m: 1.5,
      rank_current: 4,
      rank_change_1m: 0,
    },
  ],
  correlation_matrix: [
    [1.0, 0.85, 0.65, 0.45],
    [0.85, 1.0, 0.55, 0.4],
    [0.65, 0.55, 1.0, 0.6],
    [0.45, 0.4, 0.6, 1.0],
  ],
  sector_names: ["NIFTY 50", "NIFTY BANK", "NIFTY IT", "NIFTY FMCG"],
  last_updated: new Date().toISOString(),
};

// Mock sector correlation response (US)
export const mockSectorCorrelationResponseUS = {
  sectors: [
    {
      name: "SPY",
      beta_vs_index: 1.0,
      relative_strength_5d: 0.5,
      relative_strength_1m: 1.0,
      relative_strength_3m: 2.0,
      rank_current: 1,
      rank_change_1m: 0,
    },
    {
      name: "XLK",
      beta_vs_index: 1.2,
      relative_strength_5d: 1.5,
      relative_strength_1m: 3.0,
      relative_strength_3m: 5.0,
      rank_current: 2,
      rank_change_1m: 1,
    },
    {
      name: "XLF",
      beta_vs_index: 1.1,
      relative_strength_5d: 0.8,
      relative_strength_1m: 2.0,
      relative_strength_3m: 3.0,
      rank_current: 3,
      rank_change_1m: -1,
    },
    {
      name: "XLE",
      beta_vs_index: 0.9,
      relative_strength_5d: -0.2,
      relative_strength_1m: 0.5,
      relative_strength_3m: 1.5,
      rank_current: 4,
      rank_change_1m: 0,
    },
  ],
  correlation_matrix: [
    [1.0, 0.82, 0.75, 0.6],
    [0.82, 1.0, 0.7, 0.55],
    [0.75, 0.7, 1.0, 0.65],
    [0.6, 0.55, 0.65, 1.0],
  ],
  sector_names: ["SPY", "XLK", "XLF", "XLE"],
  last_updated: new Date().toISOString(),
};

export async function setupSectorMocks(page: import("@playwright/test").Page) {
  // Mock /api/sector endpoint
  await page.route(apiRoute("sector"), async (route) => {
    const url = route.request().url();
    const marketMatch = url.match(/market=([^&]+)/);
    const market = marketMatch ? marketMatch[1] : "india";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...mockSectorResponse,
        market,
      }),
    });
  });

  // Mock /api/sector/correlation endpoint
  await page.route(apiRoute("sector/correlation"), async (route) => {
    const url = route.request().url();
    const marketMatch = url.match(/market=([^&]+)/);
    const market = marketMatch ? marketMatch[1] : "india";

    const response =
      market === "america" ? mockSectorCorrelationResponseUS : mockSectorCorrelationResponse;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...response,
      }),
    });
  });
}

// Track auth state per page object using WeakMap
const authStateByPage = new WeakMap<import("@playwright/test").Page, boolean>();

// Test user credentials - defined before setupApiMocks
export const testUser = {
  id: 1,
  email: "test@alphashri.dev",
  display_name: "TestUser",
  initial_capital: 1000000,
  created_at: "2026-01-01T00:00:00",
};

// Helper to setup API mocks in Playwright tests
// IMPORTANT: This must be called BEFORE page.goto()
export async function setupApiMocks(page: import("@playwright/test").Page) {
  // Reset auth state for this page
  authStateByPage.set(page, false);

  // Mock auth endpoints
  await page.route(apiRoute("auth/me"), async (route) => {
    const isAuthenticated = authStateByPage.get(page) ?? false;
    if (isAuthenticated) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(testUser),
      });
    } else {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Not authenticated" }),
      });
    }
  });

  await page.route(apiRoute("auth/login"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "test_access_token_12345",
        refresh_token: "test_refresh_token_12345",
        token_type: "bearer",
        expires_in: 86400,
      }),
    });
  });

  // Mock screener data endpoint with query parameters
  await page.route(apiRoute("screener"), async (route) => {
    const url = route.request().url();

    if (url.endsWith("/api/screeners")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockScreenersList),
      });
      return;
    }

    // Check if it's buyer_interest_enhanced
    if (url.includes("screener=buyer_interest_enhanced")) {
      const directionMatch = url.match(/pf_direction=([^&]+)/);
      const direction = directionMatch ? directionMatch[1] : "both";
      const response = createBuyerInterestResponse(direction);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
      return;
    }

    // Default to trending response
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockTrendingResponse),
    });
  });

  // Mock market ticker endpoint
  await page.route(apiRoute("market-ticker"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tickers: {
          "NIFTY 50": { price: 22450.3, change: 125.5, change_percent: 0.56 },
          "NIFTY BANK": { price: 47890.15, change: -45.2, change_percent: -0.09 },
          SENSEX: { price: 73890.5, change: 210.3, change_percent: 0.29 },
        },
        last_updated: new Date().toISOString(),
      }),
    });
  });
}

// Mock strategy config
export const mockStrategyConfig = {
  id: 1,
  name: "orb_default",
  strategy_type: "ORB",
  is_active: true,
  is_default: true,
  or_minutes: 45,
  sl_pct: 0.4,
  tp_pct: 1.2,
  min_or_range_pct: 0.5,
  max_or_range_pct: 3.0,
  max_positions: 5,
  max_capital_per_trade_pct: 0.1,
  max_daily_loss_pct: 0.02,
  max_total_exposure_pct: 0.5,
  risk_per_trade_pct: 0.01,
  min_trade_value: 5000,
  max_trade_value: 100000,
  cooldown_minutes: 30,
  max_distance_from_or_pct: 1.5,
  brokerage_pct: 0.0003,
  min_brokerage: 20,
  stt_pct: 0.00025,
  exchange_pct: 0.0000297,
  sebi_pct: 0.000001,
  stamp_pct: 0.00003,
  gst_pct: 0.18,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
};

// Track config state per page object using WeakMap (for parallel test safety)
const configByPage = new WeakMap<import("@playwright/test").Page, typeof mockStrategyConfig>();

// Helper to get or create config for a page
function getConfigForPage(page: import("@playwright/test").Page): typeof mockStrategyConfig {
  if (!configByPage.has(page)) {
    configByPage.set(page, { ...mockStrategyConfig });
  }
  return configByPage.get(page)!;
}

// Helper to login as test user
// Note: With globalSetup, auth is handled once per worker via storageState.
// This function now just sets up route mocking without addInitScript.
export async function loginAsTestUser(page: import("@playwright/test").Page) {
  authStateByPage.set(page, true);

  // Set localStorage tokens before page loads to simulate authenticated session
  await page.addInitScript((user) => {
    localStorage.setItem("alphashri_token", "test_access_token_12345");
    localStorage.setItem("alphashri_refresh_token", "test_refresh_token_12345");
    localStorage.setItem("alphashri_user", JSON.stringify(user));
    localStorage.setItem("alphashri_show_market_ticker", "true");
  }, testUser);

  await page.route(apiRoute("auth/me"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(testUser),
    });
  });
}

// Helper to setup paper trading API mocks
export async function setupPaperTradingMocks(page: import("@playwright/test").Page) {
  // Initialize config for this page
  configByPage.set(page, { ...mockStrategyConfig });

  // Mock portfolio endpoint
  await page.route(apiRoute("paper/portfolio"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        initial_capital: 1000000,
        cash: 950000,
        margin_used: 50000,
        position_value: 50000,
        unrealized_pnl: 1000,
        realized_pnl: 5000,
        total_value: 1006000,
        total_pnl: 6000,
        total_pnl_pct: 0.6,
        positions: 1,
        trades: 5,
        daily_pnl: 1000,
        daily_pnl_pct: 0.1,
        daily_trades: 2,
        open_positions: 1,
      }),
    });
  });

  // Mock positions endpoint
  await page.route(apiRoute("paper/positions"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        count: 0,
        positions: [],
      }),
    });
  });

  // Mock bot status endpoint
  await page.route(apiRoute("paper/bot/status"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        running: false,
        pid: null,
        log_file: null,
      }),
    });
  });

  // Mock bot snapshot endpoint
  await page.route(apiRoute("paper/bot/snapshot"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        watchlist: [],
        open_positions: [],
        scan_items: [],
        signals: [],
      }),
    });
  });

  // Mock live price SSE stream
  await page.route(apiRoute("paper/live/stream"), async (route) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
        controller.enqueue(
          encoder.encode(
            'event: price\ndata: {"type":"price","instrument_key":"NSE_EQ|INE002A01018","symbol":"RELIANCE","ltp":1417.4,"ltq":"1"}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'event: price\ndata: {"type":"price","instrument_key":"NSE_EQ|INE467B01029","symbol":"TCS","ltp":2485.1,"ltq":"1"}\n\n',
          ),
        );
      },
    });

    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      body: stream as any,
    });
  });

  // Mock GET config endpoint
  await page.route(apiRoute("paper/config"), async (route) => {
    const config = getConfigForPage(page);
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          config: config,
        }),
      });
    } else if (route.request().method() === "PUT") {
      // Handle PUT - update config
      const body = route.request().postDataJSON();
      const updatedConfig = { ...config, ...body };
      configByPage.set(page, updatedConfig);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Config updated",
          config: updatedConfig,
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock POST config/reset endpoint
  await page.route(apiRoute("paper/config/reset"), async (route) => {
    const resetConfig = { ...mockStrategyConfig };
    configByPage.set(page, resetConfig);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Config reset to defaults",
        config: resetConfig,
      }),
    });
  });

  await page.route(apiRoute("paper/journal"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

// Helper to get current config for a specific page (for test assertions)
export function getCurrentConfig(page: import("@playwright/test").Page) {
  return { ...getConfigForPage(page) };
}

// Multi-strategy bot mocks
export async function setupMultiStrategyBotMocks(page: import("@playwright/test").Page) {
  const BOT_UUID_1 = "550e8400-e29b-41d4-a716-446655440000";
  const BOT_UUID_2 = "81b1e4e1-de04-4989-8357-96daade0bd86";
  const STRATEGY_UUID_1 = "d827feff-0581-4bbb-8fe8-34629ad59369";
  const STRATEGY_UUID_2 = "9a14755a-db30-4267-bd43-cba3e50c0e3a";

  // Mock bots list endpoint - only match /api/bots exactly (not /api/bots/123)
  // The API returns an array of bots directly, not wrapped in { bots: [...] }
  await page.route(apiRoute("bots"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: BOT_UUID_1,
          name: "Multi-Strategy Bot",
          strategies: [
            { id: STRATEGY_UUID_1, name: "ORB Conservative", allocation: 0.5 },
            { id: STRATEGY_UUID_2, name: "ORB Aggressive", allocation: 0.5 },
          ],
          is_active: true,
          is_running: false,
        },
        {
          id: BOT_UUID_2,
          name: "Multi-Strategy Bot",
          strategies: [
            { id: STRATEGY_UUID_1, name: "ORB Conservative", allocation: 0.5 },
            { id: STRATEGY_UUID_2, name: "ORB Aggressive", allocation: 0.5 },
          ],
          is_active: true,
          is_running: true,
          pid: 12345,
        },
      ]),
    });
  });

  // Mock bot summaries endpoint (used by BotCardStrip)
  await page.route(apiRoute("bots/summary"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: BOT_UUID_1,
          name: "Multi-Strategy Bot",
          is_active: true,
          running: false,
          pid: null,
          status: "stopped",
          position_count: 0,
          strategies: [
            { id: STRATEGY_UUID_1, name: "ORB Conservative", strategy_type: "ORB" },
            { id: STRATEGY_UUID_2, name: "ORB Aggressive", strategy_type: "ORB" },
          ],
        },
        {
          id: BOT_UUID_2,
          name: "Multi-Strategy Bot",
          is_active: true,
          running: true,
          pid: 12345,
          status: "running",
          position_count: 2,
          strategies: [
            { id: STRATEGY_UUID_1, name: "ORB Conservative", strategy_type: "ORB" },
            { id: STRATEGY_UUID_2, name: "ORB Aggressive", strategy_type: "ORB" },
          ],
        },
      ]),
    });
  });

  // Mock bot start
  await page.route(apiRoute("bots/[a-f0-9-]+/start"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Bot started",
        pid: 12345,
      }),
    });
  });

  // Mock bot stop
  await page.route(apiRoute("bots/[a-f0-9-]+/stop"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Bot stopped",
      }),
    });
  });

  // Mock bot status - use regex to match any bot ID
  await page.route(apiRoute("bots/[a-f0-9-]+/status"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        is_running: true,
        pid: 12345,
        portfolio: {
          cash: 100000,
          equity: 105000,
          pnl: 5000,
        },
        positions: [],
        strategies: [
          { id: STRATEGY_UUID_1, name: "ORB Conservative", pnl: 2500 },
          { id: STRATEGY_UUID_2, name: "ORB Aggressive", pnl: 2500 },
        ],
      }),
    });
  });

  // Mock bot portfolio - use regex to match any bot ID
  await page.route(apiRoute("bots/[a-f0-9-]+/portfolio"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        portfolio: {
          cash: 100000,
          total_value: 105000,
          margin_used: 50000,
          day_pnl: 1000,
          positions_count: 2,
          total_positions: 2,
          unrealized_pnl: 900,
        },
        positions: [
          {
            id: 1,
            symbol: "TCS",
            side: "BUY",
            quantity: 10,
            entry_price: 3750,
            current_price: 3800,
            pnl: 500,
            pnl_pct: 1.33,
            strategy_name: "ORB Conservative",
            strategy_id: 1,
          },
          {
            id: 2,
            symbol: "INFY",
            side: "BUY",
            quantity: 20,
            entry_price: 1480,
            current_price: 1500,
            pnl: 400,
            pnl_pct: 1.35,
            strategy_name: "ORB Aggressive",
            strategy_id: 2,
          },
        ],
      }),
    });
  });

  // Mock bot positions - use regex to match any bot ID
  await page.route(apiRoute("bots/[a-f0-9-]+/positions"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        positions: [
          {
            id: 1,
            symbol: "TCS",
            side: "BUY",
            quantity: 10,
            entry_price: 3750,
            current_price: 3800,
            pnl: 500,
            pnl_pct: 1.33,
            strategy_name: "ORB Conservative",
            strategy_id: 1,
          },
          {
            id: 2,
            symbol: "INFY",
            side: "BUY",
            quantity: 20,
            entry_price: 1480,
            current_price: 1500,
            pnl: 400,
            pnl_pct: 1.35,
            strategy_name: "ORB Aggressive",
            strategy_id: 2,
          },
        ],
        count: 2,
      }),
    });
  });

  // Mock bot scan items - use regex to match any bot ID
  await page.route(apiRoute("bots/[a-f0-9-]+/scan"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bot_id: BOT_UUID_2,
        scan_items: [
          {
            id: 1,
            symbol: "TCS",
            price: 3750,
            or_high: 3760,
            or_low: 3745,
            status: "signal",
            strategy_name: "ORB Conservative",
          },
          {
            id: 2,
            symbol: "INFY",
            price: 1480,
            or_high: 1490,
            or_low: 1470,
            status: "watching",
            strategy_name: "ORB Aggressive",
          },
        ],
        count: 2,
      }),
    });
  });
}

// Correlation API mocks
export const mockCorrelationResponse = {
  matrix: [
    [1.0, 0.85, 0.32],
    [0.85, 1.0, 0.12],
    [0.32, 0.12, 1.0],
  ],
  symbols: ["TCS", "INFY", "RELIANCE"],
  normalized: {
    TCS: [
      { timestamp: "2026-04-01T00:00:00", value: 0 },
      { timestamp: "2026-04-02T00:00:00", value: 1.2 },
      { timestamp: "2026-04-03T00:00:00", value: -0.5 },
    ],
    INFY: [
      { timestamp: "2026-04-01T00:00:00", value: 0 },
      { timestamp: "2026-04-02T00:00:00", value: 0.9 },
      { timestamp: "2026-04-03T00:00:00", value: -0.3 },
    ],
    RELIANCE: [
      { timestamp: "2026-04-01T00:00:00", value: 0 },
      { timestamp: "2026-04-02T00:00:00", value: -0.2 },
      { timestamp: "2026-04-03T00:00:00", value: 0.5 },
    ],
  },
  meta: {
    start_date: "2026-04-01T00:00:00",
    end_date: "2026-04-03T00:00:00",
    data_points: 3,
  },
  cached: false,
};

export async function setupCorrelationMocks(page: import("@playwright/test").Page) {
  await page.route(apiRoute("correlation"), async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockCorrelationResponse),
      });
    } else {
      await route.continue();
    }
  });

  await page.route(apiRoute("symbols/search"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          { symbol: "TCS", name: "Tata Consultancy Services" },
          { symbol: "INFY", name: "Infosys" },
          { symbol: "RELIANCE", name: "Reliance Industries" },
        ],
        query: "t",
        total: 3,
      }),
    });
  });
}

// Options API mocks
export async function setupOptionsMocks(page: import("@playwright/test").Page) {
  // Mock underlyings
  await page.route(apiRoute("options/underlyings"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        underlyings: [
          {
            symbol: "NIFTY",
            name: "Nifty 50",
            instrument_key: "NSE_INDEX|Nifty 50",
            lot_size: 50,
            tick_size: 0.05,
          },
          {
            symbol: "BANKNIFTY",
            name: "Nifty Bank",
            instrument_key: "NSE_INDEX|Nifty Bank",
            lot_size: 15,
            tick_size: 0.05,
          },
        ],
      }),
    });
  });

  // Mock expiries
  await page.route(apiRoute("options/expiries"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        underlying: "NIFTY",
        expiries: [
          { date: "2026-03-12", weekly: true, days_to_expiry: 2 },
          { date: "2026-03-19", weekly: true, days_to_expiry: 9 },
        ],
      }),
    });
  });

  // Mock option chain
  await page.route(apiRoute("options/chain"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        underlying: "NIFTY",
        expiry: "2026-03-12",
        spot: 24000.5,
        timestamp: new Date().toISOString(),
        summary: {
          pcr: 0.95,
          max_pain: 24000,
          expected_move: { upper: 24200, lower: 23800, range: 200 },
          total_ce_oi: 1000000,
          total_pe_oi: 950000,
          dte: 2,
        },
        chain: [
          {
            strike: 23900,
            ce: {
              trading_symbol: "NIFTY26MAR23900CE",
              strike_price: 23900,
              instrument_type: "CE",
              market_data: {
                ltp: 150,
                volume: 10000,
                oi: 50000,
                prev_oi: 45000,
                bid_price: 148,
                ask_price: 152,
              },
              option_greeks: { delta: 0.6, iv: 18, theta: -5, gamma: 0.001, vega: 10 },
              sentiment: { type: "Long Buildup", color: "green", label: "LB" },
            },
            pe: {
              trading_symbol: "NIFTY26MAR23900PE",
              strike_price: 23900,
              instrument_type: "PE",
              market_data: {
                ltp: 40,
                volume: 5000,
                oi: 20000,
                prev_oi: 22000,
                bid_price: 38,
                ask_price: 42,
              },
              option_greeks: { delta: -0.4, iv: 20, theta: -4, gamma: 0.001, vega: 8 },
              sentiment: { type: "Long Unwinding", color: "orange", label: "LU" },
            },
          },
          {
            strike: 24000,
            ce: {
              trading_symbol: "NIFTY26MAR24000CE",
              strike_price: 24000,
              instrument_type: "CE",
              market_data: {
                ltp: 80,
                volume: 20000,
                oi: 100000,
                prev_oi: 80000,
                bid_price: 78,
                ask_price: 82,
              },
              option_greeks: { delta: 0.5, iv: 17, theta: -6, gamma: 0.002, vega: 12 },
              sentiment: { type: "Long Buildup", color: "green", label: "LB" },
            },
            pe: {
              trading_symbol: "NIFTY26MAR24000PE",
              strike_price: 24000,
              instrument_type: "PE",
              market_data: {
                ltp: 80,
                volume: 15000,
                oi: 80000,
                prev_oi: 75000,
                bid_price: 78,
                ask_price: 82,
              },
              option_greeks: { delta: -0.5, iv: 19, theta: -5, gamma: 0.002, vega: 11 },
              sentiment: { type: "Short Buildup", color: "red", label: "SB" },
            },
          },
        ],
      }),
    });
  });

  // Mock positions
  await page.route(apiRoute("options/positions"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        positions: [],
      }),
    });
  });

  // Mock spot price
  await page.route(apiRoute("options/spot"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        underlying: "NIFTY",
        spot: 24000.5,
      }),
    });
  });

  // Mock spot history
  await page.route(apiRoute("options/spot-history"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        underlying: "NIFTY",
        history: [
          { time: "2026-03-10T09:15:00", price: 23950 },
          { time: "2026-03-10T09:20:00", price: 24000.5 },
        ],
      }),
    });
  });
}

// Strategy mock data

const mockStrategyTemplates = [
  {
    id: "tmpl-550e8400-e29b-41d4-a716-446655440000",
    internal_id: 1,
    name: "ORB Default",
    strategy_type: "ORB",
    parent_id: null,
    is_template: true,
    is_active: true,
    is_default: true,
    description: "Opening Range Breakout - default configuration",
    or_minutes: 45,
    sl_pct: 0.4,
    tp_pct: 1.2,
    min_or_range_pct: 0.5,
    max_or_range_pct: 3.0,
    max_positions: 5,
    max_capital_per_trade_pct: 0.1,
    max_daily_loss_pct: 0.02,
    max_total_exposure_pct: 0.5,
    risk_per_trade_pct: 0.01,
    min_trade_value: 5000,
    max_trade_value: 100000,
    cooldown_minutes: 30,
    max_distance_from_or_pct: 1.5,
    brokerage_pct: 0.0003,
    min_brokerage: 20,
    stt_pct: 0.00025,
    exchange_pct: 0.0000297,
    sebi_pct: 0.000001,
    stamp_pct: 0.00003,
    gst_pct: 0.18,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
  },
  {
    id: "tmpl-81b1e4e1-de04-4989-8357-96daade0bd86",
    internal_id: 2,
    name: "52W Chaser",
    strategy_type: "52W_CHASER",
    parent_id: null,
    is_template: true,
    is_active: true,
    is_default: false,
    description: "52-Week High chaser strategy",
    or_minutes: 15,
    sl_pct: 0.6,
    tp_pct: 2.0,
    min_or_range_pct: 0.3,
    max_or_range_pct: 4.0,
    max_positions: 3,
    max_capital_per_trade_pct: 0.08,
    max_daily_loss_pct: 0.03,
    max_total_exposure_pct: 0.4,
    risk_per_trade_pct: 0.015,
    min_trade_value: 10000,
    max_trade_value: 150000,
    cooldown_minutes: 60,
    max_distance_from_or_pct: 2.0,
    brokerage_pct: 0.0003,
    min_brokerage: 20,
    stt_pct: 0.00025,
    exchange_pct: 0.0000297,
    sebi_pct: 0.000001,
    stamp_pct: 0.00003,
    gst_pct: 0.18,
    created_at: "2026-01-15T00:00:00",
    updated_at: "2026-01-15T00:00:00",
  },
  {
    id: "tmpl-9a14755a-db30-4267-bd43-cba3e50c0e3a",
    internal_id: 3,
    name: "Momentum",
    strategy_type: "MOMENTUM",
    parent_id: null,
    is_template: true,
    is_active: true,
    is_default: false,
    description: "Momentum breakout strategy with volume confirmation",
    or_minutes: 30,
    sl_pct: 0.5,
    tp_pct: 1.5,
    min_or_range_pct: 0.4,
    max_or_range_pct: 2.5,
    max_positions: 4,
    max_capital_per_trade_pct: 0.12,
    max_daily_loss_pct: 0.025,
    max_total_exposure_pct: 0.45,
    risk_per_trade_pct: 0.012,
    min_trade_value: 7500,
    max_trade_value: 120000,
    cooldown_minutes: 45,
    max_distance_from_or_pct: 1.8,
    brokerage_pct: 0.0003,
    min_brokerage: 20,
    stt_pct: 0.00025,
    exchange_pct: 0.0000297,
    sebi_pct: 0.000001,
    stamp_pct: 0.00003,
    gst_pct: 0.18,
    created_at: "2026-02-01T00:00:00",
    updated_at: "2026-02-01T00:00:00",
  },
];

const mockActiveStrategies = [
  {
    id: "strat-d827feff-0581-4bbb-8fe8-34629ad59369",
    internal_id: 10,
    name: "ORB Conservative",
    strategy_type: "ORB",
    parent_id: 1,
    is_template: false,
    is_active: true,
    is_default: false,
    description: "Conservative ORB variation with tight SL",
    or_minutes: 30,
    sl_pct: 0.3,
    tp_pct: 0.8,
    min_or_range_pct: 0.4,
    max_or_range_pct: 2.0,
    max_positions: 3,
    max_capital_per_trade_pct: 0.08,
    max_daily_loss_pct: 0.015,
    max_total_exposure_pct: 0.4,
    risk_per_trade_pct: 0.008,
    min_trade_value: 5000,
    max_trade_value: 80000,
    cooldown_minutes: 30,
    max_distance_from_or_pct: 1.2,
    brokerage_pct: 0.0003,
    min_brokerage: 20,
    stt_pct: 0.00025,
    exchange_pct: 0.0000297,
    sebi_pct: 0.000001,
    stamp_pct: 0.00003,
    gst_pct: 0.18,
    created_at: "2026-02-10T00:00:00",
    updated_at: "2026-03-01T00:00:00",
  },
  {
    id: "strat-f3a1b2c3-d4e5-4f6a-b7c8-9d0e1f2a3b4c",
    internal_id: 11,
    name: "ORB Aggressive",
    strategy_type: "ORB",
    parent_id: 1,
    is_template: false,
    is_active: true,
    is_default: false,
    description: "Aggressive ORB variation with wider targets",
    or_minutes: 60,
    sl_pct: 0.6,
    tp_pct: 2.0,
    min_or_range_pct: 0.6,
    max_or_range_pct: 4.0,
    max_positions: 6,
    max_capital_per_trade_pct: 0.15,
    max_daily_loss_pct: 0.03,
    max_total_exposure_pct: 0.6,
    risk_per_trade_pct: 0.02,
    min_trade_value: 10000,
    max_trade_value: 150000,
    cooldown_minutes: 20,
    max_distance_from_or_pct: 2.0,
    brokerage_pct: 0.0003,
    min_brokerage: 20,
    stt_pct: 0.00025,
    exchange_pct: 0.0000297,
    sebi_pct: 0.000001,
    stamp_pct: 0.00003,
    gst_pct: 0.18,
    created_at: "2026-02-15T00:00:00",
    updated_at: "2026-03-05T00:00:00",
  },
];

const mockPerformanceData = [
  {
    strategy_id: 10,
    strategy_name: "ORB Conservative",
    total_trades: 45,
    winners: 30,
    losers: 15,
    win_rate: 66.67,
    total_pnl: 12500,
    net_pnl: 9800,
  },
  {
    strategy_id: 11,
    strategy_name: "ORB Aggressive",
    total_trades: 32,
    winners: 18,
    losers: 14,
    win_rate: 56.25,
    total_pnl: 18200,
    net_pnl: 14500,
  },
];

const mockEmptyPerformanceData: {
  strategy_id: number;
  strategy_name: string;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  total_pnl: number;
  net_pnl: number;
}[] = [];

// Full strategy mocks for strategies page
export async function setupStrategiesMocks(page: import("@playwright/test").Page) {
  await page.route(apiRoute("strategies"), async (route) => {
    const method = route.request().method();
    if (method === "PUT") {
      const body = route.request().postDataJSON();
      const updatedStrategy = {
        ...mockActiveStrategies[0],
        ...body,
        updated_at: new Date().toISOString(),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Strategy updated",
          strategy: updatedStrategy,
        }),
      });
    } else if (method === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Strategy deleted",
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route(apiRoute("strategies/templates"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        templates: mockStrategyTemplates,
        count: mockStrategyTemplates.length,
      }),
    });
  });

  await page.route(apiRoute("strategies"), async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          strategies: mockActiveStrategies,
          count: mockActiveStrategies.length,
        }),
      });
    } else if (method === "POST") {
      const body = route.request().postDataJSON();
      const createdStrategy = {
        id: "strat-" + crypto.randomUUID(),
        internal_id: 100,
        name: body?.name ?? "New Strategy",
        strategy_type: body?.strategy_type ?? "ORB",
        parent_id: body?.parent_id ?? null,
        is_template: false,
        is_active: true,
        is_default: false,
        description: body?.description ?? null,
        or_minutes: body?.or_minutes ?? 45,
        sl_pct: body?.sl_pct ?? 0.4,
        tp_pct: body?.tp_pct ?? 1.2,
        min_or_range_pct: body?.min_or_range_pct ?? 0.5,
        max_or_range_pct: body?.max_or_range_pct ?? 3.0,
        max_positions: body?.max_positions ?? 5,
        max_capital_per_trade_pct: body?.max_capital_per_trade_pct ?? 0.1,
        max_daily_loss_pct: body?.max_daily_loss_pct ?? 0.02,
        max_total_exposure_pct: body?.max_total_exposure_pct ?? 0.5,
        risk_per_trade_pct: body?.risk_per_trade_pct ?? 0.01,
        min_trade_value: body?.min_trade_value ?? 5000,
        max_trade_value: body?.max_trade_value ?? 100000,
        cooldown_minutes: body?.cooldown_minutes ?? 30,
        max_distance_from_or_pct: body?.max_distance_from_or_pct ?? 1.5,
        brokerage_pct: 0.0003,
        min_brokerage: 20,
        stt_pct: 0.00025,
        exchange_pct: 0.0000297,
        sebi_pct: 0.000001,
        stamp_pct: 0.00003,
        gst_pct: 0.18,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Strategy created",
          strategy: createdStrategy,
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route(apiRoute("strategies/performance"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPerformanceData),
    });
  });

  await page.route(apiRoute("strategies/[0-9]+/performance"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategy_id: 10,
        strategy_name: "ORB Conservative",
        total_trades: 45,
        winners: 30,
        losers: 15,
        win_rate: 66.67,
        total_pnl: 12500,
        net_pnl: 9800,
      }),
    });
  });

  await page.route(apiRoute("strategies/[a-f0-9-]+/activate"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Strategy activated",
      }),
    });
  });
}

// Empty state mocks
export async function setupStrategiesEmptyMocks(page: import("@playwright/test").Page) {
  await page.route(apiRoute("strategies/templates"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        templates: [],
        count: 0,
      }),
    });
  });

  await page.route(apiRoute("strategies"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [],
        count: 0,
      }),
    });
  });

  await page.route(apiRoute("strategies/performance"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockEmptyPerformanceData),
    });
  });
}

// Error state mocks
export async function setupStrategiesErrorMocks(page: import("@playwright/test").Page) {
  await page.route(apiRoute("strategies/templates"), async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Internal server error" }),
    });
  });

  await page.route(apiRoute("strategies"), async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Internal server error" }),
    });
  });
}

// Delayed response mocks (5 second delay)
export async function setupStrategiesLoadingMocks(page: import("@playwright/test").Page) {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  await page.route(apiRoute("strategies"), async (route) => {
    await delay(5000);
    const method = route.request().method();
    if (method === "PUT") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Strategy updated",
          strategy: mockActiveStrategies[0],
        }),
      });
    } else if (method === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Strategy deleted",
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          strategy: mockActiveStrategies[0],
          variations: [],
        }),
      });
    }
  });

  await page.route(apiRoute("strategies/templates"), async (route) => {
    await delay(5000);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        templates: mockStrategyTemplates,
        count: mockStrategyTemplates.length,
      }),
    });
  });

  await page.route(apiRoute("strategies"), async (route) => {
    await delay(5000);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: mockActiveStrategies,
        count: mockActiveStrategies.length,
      }),
    });
  });

  await page.route(apiRoute("strategies/performance"), async (route) => {
    await delay(5000);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPerformanceData),
    });
  });
}
