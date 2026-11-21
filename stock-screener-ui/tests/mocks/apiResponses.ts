// Mock API responses for E2E tests

import { apiRoute } from "./routeHelper";

export const mockScreenersList = {
  screeners: [
    {
      id: "trending",
      label: "Trending",
      description: "52-week high scanner",
      section_labels: { primary: "Approaching", secondary: "Touched" },
      section_descriptions: {
        primary: "Stocks nearing but have not yet touched the 52W high",
        secondary: "Stocks that have touched or broken out of the 52W high",
      },
      score_formula: "",
      default_sort: "score",
      filters: [],
    },
    {
      id: "buyer_interest_enhanced",
      label: "Buyer Interest+",
      description: "Enhanced buyer interest with sentiment",
      section_labels: { primary: "Buyer Interest+", secondary: "" },
      section_descriptions: { primary: "Enhanced buyer interest stocks approaching 52W high", secondary: "" },
      score_formula: "",
      default_sort: "score",
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
  // IMPORTANT: Playwright gives higher priority to handlers registered LATER.
  // Specific routes must be registered after broader ones to take priority.
  // See: https://playwright.dev/docs/api/class-page#page-route

  // Mock /api/sector endpoint (broad - register first so it gets lower priority)
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

  // Mock /api/sector/correlation endpoint (specific - register last for higher priority)
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
    authStateByPage.set(page, true);
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

  await page.route(apiRoute("auth/refresh"), async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Refresh token invalid" }),
    });
  });

  await page.route(apiRoute("auth/register"), async (route) => {
    authStateByPage.set(page, true);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "test_access_token_12345",
        refresh_token: "test_refresh_token_12345",
        token_type: "bearer",
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

  // Mock screener dashboard (registered after the broad /api/screener handler so it
  // takes priority for /api/screener/dashboard requests).
  await page.route(apiRoute("screener/dashboard"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockDashboardResponse),
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

  // Surge endpoints now require auth; the fake E2E token would otherwise
  // produce expected 401 console noise in every spec.
  await page.route(apiRoute("notifications/surge**"), async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ total: 0, today_count: 0, offset: 0, limit: 10, events: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", id: 1 }),
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
  // Register specific routes BEFORE broad ones to avoid substring regex collisions.
  // apiRoute("strategies") regex also matches /api/strategies/templates, so templates
  // must be registered first — otherwise the broad handler intercepts with route.continue()
  // and sends the request to the real backend.

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

  // General /api/strategies handler — registered AFTER specific sub-routes
  await page.route(apiRoute("strategies"), async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    // Skip requests that match sub-paths already handled above
    if (path !== "/api/strategies") {
      await route.fallback();
      return;
    }

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
    } else if (method === "GET") {
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

  // Mock paper/trades for Performance view (loadAllPerformance fetches trades directly)
  await page.route(apiRoute("paper/trades"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        trades: [
          { strategy_id: 10, strategy_name: "ORB Conservative", pnl: 500, net_pnl: 480 },
          { strategy_id: 10, strategy_name: "ORB Conservative", pnl: -200, net_pnl: -210 },
          { strategy_id: 10, strategy_name: "ORB Conservative", pnl: 300, net_pnl: 290 },
          { strategy_id: 11, strategy_name: "ORB Aggressive", pnl: 800, net_pnl: 770 },
          { strategy_id: 11, strategy_name: "ORB Aggressive", pnl: -100, net_pnl: -110 },
        ],
        count: 5,
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

  await page.route(apiRoute("strategies/performance"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockEmptyPerformanceData),
    });
  });

  await page.route(apiRoute("strategies"), async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    if (path !== "/api/strategies") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [],
        count: 0,
      }),
    });
  });

  // Mock paper/trades returning empty
  await page.route(apiRoute("paper/trades"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trades: [], count: 0 }),
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

// Nifty report API mocks
export const mockNiftyReport = {
  mode: "live",
  date: "2026-10-12",
  expiry: "2026-10-14",
  spot: 22363.35,
  ohlc: { open: 22300, high: 22410.5, low: 22280, close: 22363.35 },
  pcr_oi: 0.6,
  pcr_vol: 1.21,
  max_pain: 22400,
  walls: {
    calls: [
      { strike: 22500, oi: 5000 },
      { strike: 22400, oi: 4000 },
    ],
    puts: [
      { strike: 22200, oi: 6000 },
      { strike: 22300, oi: 4500 },
    ],
  },
  strikes: [22100, 22200, 22300, 22400, 22500].map((strike) => ({
    strike,
    ce: {
      ltp: 120,
      close: 110,
      oi: 2000,
      prev_oi: 1800,
      oi_change: 200,
      price_change: 9.09,
      sentiment: "Bullish",
    },
    pe: {
      ltp: 100,
      close: 105,
      oi: 2500,
      prev_oi: 2600,
      oi_change: -100,
      price_change: -4.76,
      sentiment: "Bearish",
    },
  })),
  timeline: [
    { time: "09:15", title: "Open", detail: "Nifty opened flat above 22300" },
    { time: "11:30", title: "Midday", detail: "PCR slipped as calls added" },
    { time: "15:20", title: "Close", detail: "Settled near max pain 22400" },
  ],
  candles: Array.from({ length: 10 }, (_, i) => ({
    time: `2026-10-12T${String(9 + Math.floor((15 + i * 5) / 60)).padStart(2, "0")}:${String((15 + i * 5) % 60).padStart(2, "0")}:00`,
    open: 22300 + i * 6,
    high: 22320 + i * 6,
    low: 22290 + i * 6,
    close: 22310 + i * 6,
    volume: 100000 + i * 1000,
  })),
  fetched_at: "2026-10-12T10:00:00",
};

export const mockNiftyEodReport = {
  ...mockNiftyReport,
  mode: "eod",
  date: "2026-10-10",
  timeline: [
    { time: "09:15", title: "EOD Open", detail: "Nifty opened gap-up on Friday" },
    { time: "11:30", title: "EOD Midday", detail: "Walls held into the afternoon" },
    { time: "15:30", title: "EOD Close", detail: "Closed above max pain" },
  ],
};

export const mockNiftyExpiries = {
  expiries: [
    { date: "2026-10-14", weekly: true, days_to_expiry: 2 },
    { date: "2026-10-21", weekly: true, days_to_expiry: 9 },
  ],
};

export async function setupNiftyReportMocks(page: import("@playwright/test").Page) {
  // IMPORTANT: Playwright gives higher priority to handlers registered LATER.
  // apiRoute("reports/nifty") also matches /live, /expiries and /snapshot,
  // so the broad EOD handler is registered FIRST (lower priority).
  await page.route(apiRoute("reports/nifty"), async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    // Only handle the EOD-by-date endpoint; let specific handlers take the rest
    if (path !== "/api/reports/nifty" || !url.includes("date=")) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockNiftyEodReport),
    });
  });

  await page.route(apiRoute("reports/nifty/live"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockNiftyReport),
    });
  });

  await page.route(apiRoute("reports/nifty/expiries"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockNiftyExpiries),
    });
  });

  await page.route(apiRoute("reports/nifty/snapshot"), async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockNiftyReport),
      });
    } else {
      await route.continue();
    }
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

// Nifty OI tape API mocks (intraday minute-rows).
// Shape mirrors GET /api/reports/nifty/tape: { date, interval_sec, rows }.
// Served in chronological order; the panel renders latest-first itself.
export const mockNiftyTape = {
  date: "2026-10-12",
  interval_sec: 60,
  rows: [
    { t: "09:16", spot: 22310, call_doi: 7000, put_doi: 12100, net: 5100, net_pct: 1.5, call_tick: 31, put_tick: 40, pcr_vol: 1.1, pcr_oi: 0.59, pcr_doi: 0.02, spot_flip: -40, max_pain: 22400, flip: 22350, walls: { call: 22500, put: 22200 } },
    { t: "09:17", spot: 22325, call_doi: 8100, put_doi: 14000, net: 5900, net_pct: 1.7, call_tick: 35, put_tick: 47, pcr_vol: 1.15, pcr_oi: 0.6, pcr_doi: 0.04, spot_flip: -25, max_pain: 22400, flip: 22350, walls: { call: 22500, put: 22200 } },
    { t: "09:18", spot: 22340, call_doi: 9500, put_doi: 16200, net: 6700, net_pct: 1.9, call_tick: 38, put_tick: 51, pcr_vol: 1.18, pcr_oi: 0.61, pcr_doi: 0.05, spot_flip: -10, max_pain: 22400, flip: 22350, walls: { call: 22500, put: 22200 } },
    { t: "09:19", spot: 22355, call_doi: 12000, put_doi: 18500, net: 6500, net_pct: 1.8, call_tick: 42, put_tick: 55, pcr_vol: 1.21, pcr_oi: 0.62, pcr_doi: 0.07, spot_flip: 5, max_pain: 22400, flip: 22350, walls: { call: 22500, put: 22200 } },
  ],
};

export async function setupNiftyTapeMocks(page: import("@playwright/test").Page) {
  // Reuse the existing report mocks, then register the tape handler LAST so it
  // takes priority. The `tape**` pattern only matches /api/reports/nifty/tape*
  // and cannot intercept /live, /expiries, /snapshot or the EOD endpoint, so
  // the existing nifty-report spec is unaffected.
  await setupNiftyReportMocks(page);

  await page.route(apiRoute("reports/nifty/tape"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockNiftyTape),
    });
  });
}

// ---------------------------------------------------------------------------
// Deep Value scan (GET /api/value/scan)
// ---------------------------------------------------------------------------

const mockValueRow = {
  symbol: "SBILIFE",
  name: "SBI Life Insurance",
  exchange: "NSE",
  currency: "INR",
  price: 940.1,
  change: 1.2,
  mcap_bn: 1420.5,
  rev_bn: 410.2,
  pe: 9.1,
  ps: 1.4,
  pb: 1.1,
  fcf_yield: 6.8,
  div_yield: 1.9,
  roe: 21.3,
  gross_margin: 55.0,
  op_margin: 18.0,
  rev_yoy: 12.0,
  eps_yoy: 14.2,
  debt_to_equity: 0.3,
  current_ratio: 1.4,
  rsi: 58.0,
  vs_200dma: 6.4,
  off_52w_high: -14.2,
  score: 87,
  subscores: { value: 24, quality: 23, growth: 19, health: 21 },
  peer: { bucket: "Banks", pe_median: 11.2, roe_median: 15.4, fcf_yield_median: 4.1 },
  flags: ["above-200dma", "paying-dividend"],
  derived: {
    fcf_yield: 6.8,
    earnings_yield: 11.0,
    vs_200dma: 6.4,
    off_52w_high: -14.2,
    distorted_pe: false,
  },
};

export const mockValueScanResponse = {
  market: "india",
  currency: "INR",
  as_of: "2026-10-21T15:35:00+05:30",
  scanned: 1486,
  matched: 2,
  fields_complete: true,
  filters_applied: { max_pe: 12, min_roe: 12 },
  warnings: [],
  rows: [
    mockValueRow,
    {
      ...mockValueRow,
      symbol: "TATACONSUM",
      name: "Tata Consumer Products",
      exchange: "NSE",
      price: 970.0,
      change: 0.4,
      mcap_bn: 956.0,
      pe: 31.2,
      ps: 4.1,
      pb: 8.4,
      fcf_yield: 2.9,
      roe: 35.5,
      rev_yoy: 7.2,
      eps_yoy: 9.1,
      score: 61,
      subscores: { value: 12, quality: 22, growth: 15, health: 12 },
      flags: ["above-200dma"],
    },
  ],
  sectors: [
    { name: "Banks", count: 1, avg_score: 87 },
    { name: "Consumer", count: 1, avg_score: 61 },
  ],
};

export async function setupValueScanMocks(page: import("@playwright/test").Page) {
  await page.route(apiRoute("value/scan"), async (route) => {
    const url = new URL(route.request().url());
    const market = url.searchParams.get("market") || "india";
    const body =
      market === "usa"
        ? { ...mockValueScanResponse, market: "usa", currency: "USD" }
        : mockValueScanResponse;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/* ------------------------------------------------------------------ *
 * Saved user configs (GET/PUT/DELETE /api/user-configs/{scope})
 *
 * Stateful per page: a GET returns the latest PUT, and a page that never
 * wrote gets the server defaults with `saved: false` — exactly the contract
 * in docs/SAVED_CONFIGS_PLAN.md §2.5.
 *
 * The wire body is FLAT — `{universe, sectors, capTiers, …, sort, view}` —
 * as shipped in `api/user_configs.py:MarketFiltersV1` and emitted by
 * `useMarketConfig.serializeMarketConfig`. The plan's `{universe, filters}`
 * nesting never shipped; a nested body is still accepted (and flattened) so a
 * seed written in the old shape cannot silently restore nothing.
 * ------------------------------------------------------------------ */

/** `market.filters` v1 defaults — flat, mirroring `MarketFiltersV1()`. */
export const DEFAULT_MARKET_FILTERS_CONFIG = {
  universe: "all_equity",
  sectors: [] as string[],
  capTiers: [] as string[],
  priceMin: null as number | null,
  priceMax: null as number | null,
  dayChangeMin: null as number | null,
  dayChangeMax: null as number | null,
  mcapMinCr: null as number | null,
  mcapMaxCr: null as number | null,
  rsiMin: null as number | null,
  rsiMax: null as number | null,
  relVolMin: null as number | null,
  relVolMax: null as number | null,
  aboveSma20: false,
  aboveSma50: false,
  aboveSma200: false,
  fnoOnly: false,
  etfOnly: false,
  sort: "mcap_desc",
  view: "table",
};

export type MarketFiltersPayload = typeof DEFAULT_MARKET_FILTERS_CONFIG;

/** Fields of a `market.filters` payload, flat. Seeds may pass a subset. */
export type MarketFiltersSeed = Partial<MarketFiltersPayload> & {
  /** Legacy plan §2.4 nesting; flattened on write. Prefer the flat fields. */
  filters?: Partial<MarketFiltersPayload>;
};

export interface UserConfigEnvelope {
  scope: string;
  version: number;
  saved: boolean;
  updated_at: string | null;
  config: Record<string, unknown>;
  warning?: string;
}

export interface UserConfigMockHandle {
  /** Latest persisted payload, flat, or null when nothing has been saved yet. */
  stored: () => Record<string, unknown> | null;
  /** Latest persisted payload for an arbitrary scope (e.g. `table.market.grid`). */
  storedScope: (scope: string) => Record<string, unknown> | null;
  /** Every PUT body seen, in order — proves a write happened without spying on the UI. */
  puts: () => Record<string, unknown>[];
  /** Flip to a non-2xx status to exercise the "Filters not saved" chip. */
  setPutStatus: (status: number | null) => void;
}

type UserConfigEntry = { config: Record<string, unknown>; updatedAt: string };

/** Scopes owned by the route handler, shared with `seedUserConfig` for pre-navigation seeds. */
const userConfigScopesByPage = new WeakMap<
  import("@playwright/test").Page,
  Map<string, UserConfigEntry>
>();

/** v1 table prefs — the wire shape every `table.*` scope defaults to. */
const DEFAULT_TABLE_CONFIG = {
  sorting: [] as { id: string; desc: boolean }[],
  order: [] as string[],
  hidden: [] as string[],
};

function isTableScope(scope: string): boolean {
  return scope.startsWith("table.");
}

/** `table.*` bodies are echoed with the three v1 fields defaulted, never reshaped. */
function mergeTableConfig(raw: unknown): Record<string, unknown> {
  const base = JSON.parse(JSON.stringify(DEFAULT_TABLE_CONFIG)) as Record<string, unknown>;
  return isPlainObject(raw) ? { ...base, ...raw } : base;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Flatten a `market.filters` body onto the defaults, keeping unknown keys.
 * A nested `filters` object is merged in first and a top-level `universe`
 * wins — the same rule the server (`flatten_market_config`) and the frontend
 * adapter (`parseMarketConfig`) apply, so a legacy seed behaves like a PUT.
 */
function mergeMarketFilters(raw: unknown): Record<string, unknown> {
  const base = JSON.parse(
    JSON.stringify(DEFAULT_MARKET_FILTERS_CONFIG),
  ) as Record<string, unknown>;
  if (!isPlainObject(raw)) return base;
  const { filters, ...top } = raw;
  return {
    ...base,
    ...(isPlainObject(filters) ? filters : {}),
    ...top,
  };
}

/**
 * Mock the per-scope saved-config endpoints.
 *
 * `initial` seeds a *saved* row (GET → `saved: true`). Omit it for a fresh
 * account so the first GET proves the `saved: false` defaults path.
 * Call after `setupApiMocks` and before `page.goto()`.
 */
export async function setupUserConfigMocks(
  page: import("@playwright/test").Page,
  initial?: MarketFiltersSeed,
): Promise<UserConfigMockHandle> {
  const scopes = new Map<string, UserConfigEntry>();
  userConfigScopesByPage.set(page, scopes);
  if (initial) {
    scopes.set("market.filters", {
      config: mergeMarketFilters(initial),
      updatedAt: new Date().toISOString(),
    });
  }

  let putStatus: number | null = null;
  const puts: Record<string, unknown>[] = [];
  let clock = 0;
  const nextUpdatedAt = () => new Date(Date.UTC(2026, 10, 15, 9, 0, clock++)).toISOString();

  await page.route(apiRoute("user-configs/[^/]+"), async (route) => {
    const request = route.request();
    const scope = new URL(request.url()).pathname.split("/").pop() ?? "";
    const method = request.method();

    if (scope !== "market.filters" && !isTableScope(scope)) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "unknown_scope" }),
      });
      return;
    }

    if (method === "PUT") {
      if (putStatus !== null && putStatus >= 400) {
        await route.fulfill({
          status: putStatus,
          contentType: "application/json",
          body: JSON.stringify({ detail: "user_config_write_failed" }),
        });
        return;
      }
      let body: Record<string, unknown> = {};
      try {
        body = (JSON.parse(request.postData() || "{}") as Record<string, unknown>) ?? {};
      } catch {
        body = {};
      }
      puts.push(body);
      const entry: UserConfigEntry = {
        config: isTableScope(scope)
          ? mergeTableConfig(body.config ?? body)
          : mergeMarketFilters(body.config),
        updatedAt: nextUpdatedAt(),
      };
      scopes.set(scope, entry);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scope,
          version: 1,
          saved: true,
          updated_at: entry.updatedAt,
          config: entry.config,
        } satisfies UserConfigEnvelope),
      });
      return;
    }

    if (method === "DELETE") {
      const deleted = scopes.delete(scope);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, scope, deleted }),
      });
      return;
    }

    const entry = scopes.get(scope) ?? null;
    const envelope: UserConfigEnvelope = entry
      ? {
          scope,
          version: 1,
          saved: true,
          updated_at: entry.updatedAt,
          config: entry.config,
        }
      : {
          scope,
          version: 1,
          saved: false,
          updated_at: null,
          config: isTableScope(scope) ? mergeTableConfig(null) : mergeMarketFilters(null),
        };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope),
    });
  });

  return {
    stored: () => scopes.get("market.filters")?.config ?? null,
    storedScope: (scope) => scopes.get(scope)?.config ?? null,
    puts: () => puts,
    setPutStatus: (status) => {
      putStatus = status;
    },
  };
}

/**
 * Saved desk layout (`/api/user-configs/window.home`). `setupUserConfigMocks`
 * only serves `market.filters` / `table.*` and 404s every other scope, which
 * disables persistence for the HOME desk. This helper keeps the scope's row in
 * a page-scoped closure so a `page.reload()` truly re-reads the last PUT.
 */
export interface HomeConfigMockHandle {
  /** Last persisted `window.home` payload (the PUT body's `config`), deep-cloned. */
  stored: () => Record<string, unknown> | null;
  /** Every payload the desk wrote, in order. */
  puts: () => Record<string, unknown>[];
  /** Exact URLs received by the mock (GET + PUT + DELETE). */
  requests: () => string[];
}

export async function setupHomeConfigMocks(
  page: import("@playwright/test").Page,
): Promise<HomeConfigMockHandle> {
  const scope = "window.home";
  let saved: Record<string, unknown> | null = null;
  let updatedAt: string | null = null;
  const puts: Record<string, unknown>[] = [];
  const requests: string[] = [];

  const envelope = (config: Record<string, unknown>, isSaved: boolean) => ({
    scope,
    version: 1,
    saved: isSaved,
    updated_at: updatedAt,
    config,
  });
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  await page.route(apiRoute("user-configs/window.home"), async (route) => {
    const request = route.request();
    requests.push(request.url());
    const method = request.method();

    if (method === "PUT") {
      let body: Record<string, unknown> = {};
      try {
        body = (JSON.parse(request.postData() ?? "{}") as Record<string, unknown>) ?? {};
      } catch {
        body = {};
      }
      const config = isPlainObject(body.config) ? (body.config as Record<string, unknown>) : body;
      puts.push(config);
      saved = config;
      updatedAt = new Date(Date.UTC(2026, 10, 19, 9, 0, puts.length)).toISOString();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(config, true)),
      });
      return;
    }

    if (method === "DELETE") {
      saved = null;
      updatedAt = null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, scope, deleted: true }),
      });
      return;
    }

    // `saved: false` makes the store use the page's own seeded defaults.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope(saved ?? { v: 1, active: "Main", layouts: [] }, saved !== null)),
    });
  });

  return {
    stored: () => (saved ? clone(saved) : null),
    puts: () => clone(puts),
    requests: () => [...requests],
  };
}

/**
 * Seed a saved row for a scope before navigation. Requires
 * `setupUserConfigMocks(page)` on the same page so the GET handler reads it.
 */
export async function seedUserConfig(
  page: import("@playwright/test").Page,
  scope: string,
  config: Record<string, unknown>,
): Promise<void> {
  const scopes = userConfigScopesByPage.get(page);
  if (!scopes) {
    throw new Error("seedUserConfig needs setupUserConfigMocks(page) first");
  }
  scopes.set(scope, {
    config: isTableScope(scope) ? mergeTableConfig(config) : mergeMarketFilters(config),
    updatedAt: new Date().toISOString(),
  });
}

// Mock screener dashboard response (GET /api/screener/dashboard)
// 2 sections x 1 panel x 3 rows, matching ScreenerDashboardResponse shape.
// Panel ids "gainers" / "volume_surge" pass through as lone cards (no merge pair).
export const mockDashboardResponse = {
  universe: "nifty500",
  as_of: "2026-10-21T15:30:00+05:30",
  total: 6,
  cached: false,
  age_sec: 0,
  sections: [
    {
      id: "movers",
      title: "Movers",
      total: 3,
      panels: [
        {
          id: "gainers",
          title: "Gainers",
          metric_label: "Change %",
          qualify: 3,
          rows: [
            {
              symbol: "INDIAGLYCO",
              name: "InterGlobe Aviation",
              close: 3120.5,
              change: 2.4,
              logo: null,
              sub_label: "Rel vol",
              sub_value: "1.8x",
              spark: [100, 102, 99, 101, 103, 102],
            },
            {
              symbol: "RELIANCE",
              name: "Reliance Industries",
              close: 2940.0,
              change: 1.2,
              logo: null,
              sub_label: "Rel vol",
              sub_value: "1.4x",
              spark: [98, 97, 99, 100, 101, 100],
            },
            {
              symbol: "INFY",
              name: "Infosys",
              close: 1850.0,
              change: 0.9,
              logo: null,
              sub_label: "Rel vol",
              sub_value: "1.2x",
              spark: [50, 51, 49, 50, 51, 50],
            },
          ],
        },
      ],
    },
    {
      id: "unusual",
      title: "Unusual",
      total: 3,
      panels: [
        {
          id: "volume_surge",
          title: "Volume Surge",
          metric_label: "Volume surge",
          qualify: 3,
          rows: [
            {
              symbol: "TCS",
              name: "Tata Consultancy Services",
              close: 4120.0,
              change: -0.5,
              logo: null,
              sub_label: "Vol surge",
              sub_value: "3.2x",
              spark: [200, 205, 202, 208, 206, 204],
            },
            {
              symbol: "HDFCBANK",
              name: "HDFC Bank",
              close: 1750.0,
              change: 1.1,
              logo: null,
              sub_label: "Vol surge",
              sub_value: "2.8x",
              spark: [150, 148, 152, 151, 153, 150],
            },
            {
              symbol: "ICICIBANK",
              name: "ICICI Bank",
              close: 1280.0,
              change: -1.3,
              logo: null,
              sub_label: "Vol surge",
              sub_value: "2.5x",
              spark: [80, 82, 79, 81, 83, 80],
            },
          ],
        },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ *
 * Options dock (P1) — E1 underlying metadata + E2 option chain
 *
 * The dock's budget is part of its contract, so the helper RETURNS counters:
 * a test can assert 2 requests on open, 1 on an expiry change and 0 on a leg
 * change without scraping the network log.
 *
 *   const dock = await setupOptionDockMocks(page);
 *   …open the dock…
 *   expect(dock.counts.underlying).toBe(1);
 *   expect(dock.counts.chain).toBe(1);
 *
 * `dock.setChainStatus(429)` makes the NEXT chain response a rate-limit, which
 * is how the "keep the last frame" state is exercised.
 * ------------------------------------------------------------------ */

export const mockOptionDockUnderlying = {
  symbol: "RELIANCE",
  exchange: "NSE",
  fno: true,
  instrument_key: "NSE_EQ|INE002A01018",
  spot: 1417.4,
  expiries: [
    { date: "2026-11-26", weekly: true, dte_days: 10, lot_size: 500, tick_size: 0.05 },
    { date: "2026-12-31", weekly: false, dte_days: 45, lot_size: 500, tick_size: 0.05 },
  ],
  default_expiry: "2026-11-26",
  market_state: "open",
};

function optionDockChainBody(expiry: string, withLevels = true) {
  const leg = (ltp: number, oi: number, iv: number | null, delta: number | null) => ({
    instrument_key: `NSE_FO|${oi}`,
    trading_symbol: `RELIANCE${expiry.replace(/-/g, "")}${oi}CE`,
    strike_price: oi,
    expiry,
    instrument_type: "CE",
    market_data: {
      ltp,
      oi,
      prev_oi: oi - 1000,
      volume: 25_000,
      bid_price: Math.max(0, ltp - 0.5),
      ask_price: ltp + 0.5,
      close_price: ltp,
    },
    option_greeks:
      iv == null
        ? null
        : { delta, gamma: 0.002, theta: -4, vega: 9, iv, pop: 0.4 },
  });

  const seeded = [
    { strike: 1340, ce: leg(79.0, 18_000, 24.2, 0.88), pe: leg(3.1, 9_000, 24.0, -0.12) },
    { strike: 1360, ce: leg(61.5, 24_000, 23.4, 0.79), pe: leg(5.4, 13_000, 23.2, -0.18) },
    { strike: 1380, ce: leg(46.0, 31_000, 22.6, 0.68), pe: leg(9.1, 22_000, 22.4, -0.26) },
    { strike: 1400, ce: leg(27.5, 52_000, 21.9, 0.42), pe: leg(14.2, 74_000, 21.6, -0.37) },
    { strike: 1420, ce: leg(15.4, 86_000, 21.4, 0.31), pe: leg(21.8, 41_000, 21.2, -0.48) },
    // An illiquid strike with no greeks: the UI must render "—", never 0.
    { strike: 1440, ce: leg(2.1, 0, null, null), pe: leg(61.0, 12_000, 22.4, -0.71) },
    { strike: 1460, ce: leg(6.3, 27_000, 22.8, 0.24), pe: leg(88.4, 8_000, 23.1, -0.79) },
    { strike: 1480, ce: leg(3.4, 19_000, 23.6, 0.16), pe: leg(112.0, 5_000, 23.8, -0.86) },
    { strike: 1500, ce: leg(1.9, 14_000, 24.4, 0.1), pe: leg(131.5, 3_000, 24.6, -0.91) },
  ];
  const byStrike = new Map(seeded.map((row) => [row.strike, row]));

  // 50 strikes at a 5-point step. ATM (1420) sits at index 15 so the initial
  // centre is a real scroll at both 1600×900 and 390×844 — a 9-row ladder fits
  // the scroller and can never exercise follow/recentre. The seeded rows keep
  // their exact values (1340 stays the first row, 1420 stays the max CE OI);
  // fillers stay well below that OI so existing sorting assertions are stable.
  const chain: Array<(typeof seeded)[number]> = [];
  for (let strike = 1340; strike <= 1590; strike += 5) {
    // 1415 is closer to spot 1417.4 than the seeded ATM strike 1420.
    if (strike === 1415) continue;
    const row = byStrike.get(strike);
    if (row) {
      chain.push(row);
      continue;
    }
    const off = Math.abs(strike - 1420);
    const ltp = Math.max(0.4, 14 + off * 0.07);
    chain.push({
      strike,
      ce: leg(ltp, 6_000 + (strike % 7) * 1_000, 22.5, 0.2),
      pe: leg(ltp + 0.5, 7_000 + (strike % 5) * 1_000, 22.5, -0.2),
    });
  }

  return {
    status: "ok",
    underlying: "RELIANCE",
    expiry,
    spot: 1417.4,
    timestamp: "2026-11-16T11:20:00+05:30",
    summary: { pcr: 1.08, max_pain: 1420, total_ce_oi: 210_000, total_pe_oi: 226_000, dte: 10, atm_iv: 21.4 },
    chain,
    // Five distinct strikes so every badge code renders once. `withLevels=false`
    // reproduces a legacy payload for the "no level → no badge" regression.
    levels: withLevels
      ? {
          spot: 1417.4,
          step: 5,
          thin: false,
          call_wall: { strike: 1470, side: "above", strength: 0.2, oi: 95_000 },
          put_wall: { strike: 1390, side: "below", strength: 0.25, oi: 88_000 },
          max_pain: { strike: 1420, side: "at", strength: 0.3, payout: 1_250 },
          gex: {
            support: { strike: 1400, side: "below", strength: 0.4, net_gex: 1.2 },
            resistance: { strike: 1450, side: "above", strength: 0.6, net_gex: -1.8 },
            fuel_up: null,
            fuel_down: null,
            flip: 1420,
            regime: "short",
            degraded: false,
          },
        }
      : undefined,
  };
}

export interface OptionDockMocks {
  counts: { underlying: number; chain: number };
  /** Override the next `/underlying/{symbol}` response status (404 → non-F&O). */
  setUnderlyingStatus: (status: number) => void;
  /** Override the next `/chain/…` response status (429 → paused, 401 → reconnect). */
  setChainStatus: (status: number) => void;
  reset: () => void;
}

export async function setupOptionDockMocks(
  page: import("@playwright/test").Page,
  options: {
    fno?: boolean;
    underlyingStatus?: number;
    chainStatus?: number;
    /** `closed` keeps the dock from polling, so request counts stay exact. */
    marketState?: "open" | "closed" | "pre_open";
    /** `false` omits the chain's `levels` block (legacy payload → no badges). */
    levels?: boolean;
  } = {},
): Promise<OptionDockMocks> {
  const counts = { underlying: 0, chain: 0 };
  let underlyingStatus = options.underlyingStatus ?? 200;
  let chainStatus = options.chainStatus ?? 200;
  const fno = options.fno ?? true;
  const marketState = options.marketState ?? "closed";
  const withLevels = options.levels ?? true;

  const reset = () => {
    counts.underlying = 0;
    counts.chain = 0;
  };

  await page.route(apiRoute("options/underlying/**"), async (route) => {
    counts.underlying += 1;
    if (underlyingStatus === 404) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: { code: "not_fno", detail: "Unknown underlying" } }),
      });
      return;
    }
    if (underlyingStatus === 401) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: { code: "upstox_auth_required" } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        fno
          ? { ...mockOptionDockUnderlying, market_state: marketState }
          : {
              ...mockOptionDockUnderlying,
              fno: false,
              expiries: [],
              default_expiry: null,
              market_state: marketState,
            },
      ),
    });
  });

  await page.route(apiRoute("options/chain/**"), async (route) => {
    counts.chain += 1;
    if (chainStatus === 429) {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "8" },
        body: JSON.stringify({ detail: { code: "rate_limited", detail: "retry shortly" } }),
      });
      return;
    }
    if (chainStatus === 401) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: { code: "upstox_auth_required" } }),
      });
      return;
    }
    const expiry = new URL(route.request().url()).searchParams.get("expiry") ?? "2026-11-26";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(optionDockChainBody(expiry, withLevels)),
    });
  });

  return {
    counts,
    setUnderlyingStatus: (status: number) => {
      underlyingStatus = status;
    },
    setChainStatus: (status: number) => {
      chainStatus = status;
    },
    reset,
  };
}

// ---------------------------------------------------------------------------
// F&O screener (GET /api/options/screener)
// ---------------------------------------------------------------------------

export const mockFnoScreenerResponse = {
  status: "ok",
  as_of: "2026-11-16T11:20:00+05:30",
  expiry: "2026-11-26",
  expiries: [
    { date: "2026-11-26", days_to_expiry: 10 },
    { date: "2026-12-31", days_to_expiry: 45 },
  ],
  preset: "cheap_momentum",
  scanned: 120,
  matched: 2,
  stale: false,
  warnings: [],
  errors: [],
  rows: [
    {
      symbol: "RELIANCE",
      spot: 1417.4,
      d1: 1.2,
      d5: 4.5,
      vol_ratio: 1.4,
      above20: 1,
      setup: "BREAKOUT",
      call: "RELIANCE26NOV1420CE",
      strike: 1420,
      otm_pct: 0.18,
      premium: 27.5,
      cost_lot: 13_750,
      breakeven: 1447.5,
      pop: 62,
      delta: 0.42,
      gamma: 0.002,
      theta: -4,
      vega: 9,
      iv: 21.9,
      oi: 52_000,
      volume: 85_000,
      spread_pct: 1.8,
      move_2pct_est: 0.45,
    },
    {
      symbol: "TCS",
      spot: 2485.1,
      d1: 0.6,
      d5: 2.1,
      vol_ratio: 1.1,
      above20: 1,
      setup: "NEAR HIGH",
      call: "TCS26NOV2500CE",
      strike: 2500,
      otm_pct: 0.6,
      premium: 61.5,
      cost_lot: 61_500,
      breakeven: 2561.5,
      pop: 58,
      delta: 0.79,
      gamma: 0.002,
      theta: -6,
      vega: 12,
      iv: 23.4,
      oi: 24_000,
      volume: 40_000,
      spread_pct: 2.2,
      move_2pct_est: 0.3,
    },
  ],
};

export async function setupFnoScreenerMocks(page: import("@playwright/test").Page) {
  await page.route(apiRoute("options/screener"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockFnoScreenerResponse),
    });
  });
}
