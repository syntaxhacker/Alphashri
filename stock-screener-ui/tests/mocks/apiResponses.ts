// Mock API responses for E2E tests

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

// Helper to setup API mocks in Playwright tests
// IMPORTANT: This must be called BEFORE page.goto()
export async function setupApiMocks(page: import("@playwright/test").Page) {
  // Mock auth endpoints
  await page.route("**/api/auth/me", async (route) => {
    // Return unauthenticated by default - tests should use login helper if needed
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Not authenticated" }),
    });
  });

  await page.route("**/api/auth/login", async (route) => {
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

  // Mock screeners list - use full URL pattern
  await page.route("**/api/screeners", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockScreenersList),
    });
  });

  // Mock screener data endpoint with query parameters
  await page.route("**/api/screener*", async (route) => {
    const url = route.request().url();

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
}

// Test user credentials
export const testUser = {
  id: 1,
  email: "test@alphashri.dev",
  display_name: "TestUser",
  initial_capital: 1000000,
  created_at: "2026-01-01T00:00:00",
};

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

// Mutable config for tests
let currentConfig = { ...mockStrategyConfig };

// Helper to login as test user (sets localStorage tokens)
export async function loginAsTestUser(page: import("@playwright/test").Page) {
  // Mock auth/me to return authenticated user
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(testUser),
    });
  });

  // Set localStorage tokens before navigating
  await page.addInitScript(() => {
    localStorage.setItem("alphashri_token", "test_access_token_12345");
    localStorage.setItem("alphashri_refresh_token", "test_refresh_token_12345");
    localStorage.setItem(
      "alphashri_user",
      JSON.stringify({
        id: 1,
        email: "test@alphashri.dev",
        display_name: "TestUser",
        initial_capital: 1000000,
        created_at: "2026-01-01T00:00:00",
      }),
    );
  });
}

// Helper to setup paper trading API mocks
export async function setupPaperTradingMocks(page: import("@playwright/test").Page) {
  // Reset config to defaults
  currentConfig = { ...mockStrategyConfig };

  // Mock portfolio endpoint
  await page.route("**/api/paper/portfolio", async (route) => {
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
  await page.route("**/api/paper/positions", async (route) => {
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
  await page.route("**/api/paper/bot/status", async (route) => {
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
  await page.route("**/api/paper/bot/snapshot", async (route) => {
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

  // Mock GET config endpoint
  await page.route("**/api/paper/config**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          config: currentConfig,
        }),
      });
    } else if (route.request().method() === "PUT") {
      // Handle PUT - update config
      const body = route.request().postDataJSON();
      currentConfig = { ...currentConfig, ...body };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Config updated",
          config: currentConfig,
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock POST config/reset endpoint
  await page.route("**/api/paper/config/reset", async (route) => {
    currentConfig = { ...mockStrategyConfig };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Config reset to defaults",
        config: currentConfig,
      }),
    });
  });
}

// Helper to get current config (for test assertions)
export function getCurrentConfig() {
  return { ...currentConfig };
}

// Multi-strategy bot mocks
export async function setupMultiStrategyBotMocks(page: import("@playwright/test").Page) {
  const BOT_UUID_1 = "550e8400-e29b-41d4-a716-446655440000";
  const BOT_UUID_2 = "81b1e4e1-de04-4989-8357-96daade0bd86";
  const STRATEGY_UUID_1 = "d827feff-0581-4bbb-8fe8-34629ad59369";
  const STRATEGY_UUID_2 = "9a14755a-db30-4267-bd43-cba3e50c0e3a";

  // Mock bots list endpoint - only match /api/bots exactly (not /api/bots/123)
  // The API returns an array of bots directly, not wrapped in { bots: [...] }
  await page.route("**/api/bots", async (route) => {
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
          name: "Multi-ORB Test Bot",
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

  // Mock bot start
  await page.route(/\/api\/bots\/[a-f0-9-]+\/start/, async (route) => {
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
  await page.route(/\/api\/bots\/[a-f0-9-]+\/stop/, async (route) => {
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
  await page.route(/\/api\/bots\/[a-f0-9-]+\/status/, async (route) => {
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
  await page.route(/\/api\/bots\/[a-f0-9-]+\/portfolio/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cash: 100000,
        equity: 105000,
        pnl: 5000,
        margin_used: 50000,
        daily_pnl: 1000,
        positions: [
          {
            id: 1,
            symbol: "TCS",
            side: "BUY",
            qty: 10,
            entry_price: 3750,
            current_price: 3800,
            pnl: 500,
            pnl_pct: 1.33,
            strategy_name: "ORB Conservative",
          },
          {
            id: 2,
            symbol: "INFY",
            side: "BUY",
            qty: 20,
            entry_price: 1480,
            current_price: 1500,
            pnl: 400,
            pnl_pct: 1.35,
            strategy_name: "ORB Aggressive",
          },
        ],
      }),
    });
  });

  // Mock bot positions - use regex to match any bot ID
  await page.route(/\/api\/bots\/[a-f0-9-]+\/positions/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        positions: [
          {
            id: 1,
            symbol: "TCS",
            side: "BUY",
            qty: 10,
            entry_price: 3750,
            current_price: 3800,
            pnl: 500,
            pnl_pct: 1.33,
            strategy_name: "ORB Conservative",
          },
          {
            id: 2,
            symbol: "INFY",
            side: "BUY",
            qty: 20,
            entry_price: 1480,
            current_price: 1500,
            pnl: 400,
            pnl_pct: 1.35,
            strategy_name: "ORB Aggressive",
          },
        ],
        count: 2,
      }),
    });
  });

  // Mock bot scan items - use regex to match any bot ID
  await page.route(/\/api\/bots\/[a-f0-9-]+\/scan/, async (route) => {
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
