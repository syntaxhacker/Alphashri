// Mock API responses for E2E tests

export const mockScreenersList = {
  screeners: [
    { id: 'trending', label: 'Trending', description: '52-week high scanner' },
    { id: 'buyer_interest_enhanced', label: 'Buyer Interest+', description: 'Enhanced buyer interest with sentiment' }
  ],
  default: 'trending',
  meta_by_id: {
    buyer_interest_enhanced: {
      section_labels: { primary: 'Buyer Interest+', secondary: '' },
      filters: [
        { key: 'direction', label: 'Direction', type: 'select', options: ['both', 'bullish', 'bearish'], default: 'both' },
        { key: 'min_score', label: 'Min Score', type: 'number', min: 0, max: 200, default: 0 },
        { key: 'min_vol_surge', label: 'Min Vol Surge', type: 'number', min: 0, max: 10, step: 0.1, default: 0 }
      ]
    }
  }
};

// Mock trending screener response
export const mockTrendingResponse = {
  approaching: [
    {
      symbol: 'MOCK1',
      score: 105,
      tv_price: 100.50,
      upstox_price: 100.45,
      broker_diff: -0.05,
      to_52w_high: 2.73,
      recent_return_5d: -1.6,
      perf_w: 4.8,
      sector: 'Finance',
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
      reversal_signal: '',
      is_bullish: true,
      sentiment: 'bullish',
      rationale: 'Score 105 | 52W gap +2.73% | 5D -1.6% | PerfW +4.8%',
      time_to_52w: { days: 1, confidence: 'MED' }
    },
    {
      symbol: 'MOCK2',
      score: 90,
      tv_price: 200.00,
      upstox_price: 200.05,
      broker_diff: 0.02,
      to_52w_high: 0.4,
      recent_return_5d: 0.3,
      perf_w: 6.5,
      sector: 'Technology',
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
      market_cap_b: 5000.00,
      volume_m: 5.42,
      reversal_signal: '',
      is_bullish: false,
      sentiment: 'bearish',
      rationale: 'Score 90 | 52W gap +0.40% | 5D +0.3% | PerfW +6.5%',
      time_to_52w: { days: 0, confidence: 'HIGH' }
    }
  ],
  touched: [
    {
      symbol: 'MOCK3',
      score: 115,
      tv_price: 150.00,
      upstox_price: 150.10,
      broker_diff: 0.07,
      to_52w_high: 0,
      recent_return_5d: 2.5,
      perf_w: 8.0,
      sector: 'Healthcare',
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
      market_cap_b: 3000.00,
      volume_m: 2.5,
      reversal_signal: '',
      is_bullish: true,
      sentiment: 'bullish',
      rationale: 'Score 115 | Touched 52W | 5D +2.5% | PerfW +8.0%',
      time_to_52w: { days: 0, confidence: 'HIGH' }
    }
  ],
  last_updated: new Date().toISOString(),
  provider: 'upstox',
  mode: 'intraday',
  screener: 'trending'
};

// All buyer interest stocks (unfiltered)
const allBuyerInterestStocks = [
  {
    symbol: 'BULL1',
    score: 99,
    tv_price: 500.00,
    upstox_price: 500.50,
    broker_diff: 0.10,
    to_52w_high: 0,
    recent_return_5d: 2.5,
    perf_w: 5.0,
    sector: 'Industrial Services',
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
    reversal_signal: '',
    is_bullish: true,
    sentiment: 'bullish',
    rationale: 'Wick 87.2% | VolSurge 1.66x | RSI 70.0'
  },
  {
    symbol: 'BULL2',
    score: 95,
    tv_price: 300.00,
    upstox_price: 300.25,
    broker_diff: 0.08,
    to_52w_high: 0,
    recent_return_5d: 1.8,
    perf_w: 4.0,
    sector: 'Technology',
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
    reversal_signal: '',
    is_bullish: true,
    sentiment: 'bullish',
    rationale: 'Wick 75.0% | VolSurge 2.00x | RSI 65.0'
  },
  {
    symbol: 'BEAR1',
    score: 85,
    tv_price: 200.00,
    upstox_price: 199.50,
    broker_diff: -0.25,
    to_52w_high: 0,
    recent_return_5d: -1.5,
    perf_w: -2.0,
    sector: 'Energy',
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
    reversal_signal: '',
    is_bullish: false,
    sentiment: 'bearish',
    rationale: 'Wick 25.0% | VolSurge 1.50x | RSI 35.0'
  },
  {
    symbol: 'BEAR2',
    score: 80,
    tv_price: 150.00,
    upstox_price: 149.80,
    broker_diff: -0.13,
    to_52w_high: 0,
    recent_return_5d: -2.0,
    perf_w: -3.0,
    sector: 'Materials',
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
    reversal_signal: '',
    is_bullish: false,
    sentiment: 'bearish',
    rationale: 'Wick 15.0% | VolSurge 1.20x | RSI 30.0'
  },
  {
    symbol: 'NEUTRAL1',
    score: 75,
    tv_price: 100.00,
    upstox_price: 100.05,
    broker_diff: 0.05,
    to_52w_high: 0,
    recent_return_5d: 0.5,
    perf_w: 1.0,
    sector: 'Consumer',
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
    reversal_signal: '',
    is_bullish: true,
    sentiment: 'neutral',
    rationale: 'Wick 50.0% | VolSurge 1.00x | RSI 50.0'
  }
];

// Helper to create buyer interest response
function createBuyerInterestResponse(direction: string) {
  let stocks = allBuyerInterestStocks;
  if (direction === 'bullish') {
    stocks = stocks.filter(s => s.wick_close_pct >= 60);
  } else if (direction === 'bearish') {
    stocks = stocks.filter(s => s.wick_close_pct <= 40);
  }
  return {
    approaching: stocks,
    touched: [],
    last_updated: new Date().toISOString(),
    provider: 'upstox',
    mode: 'intraday',
    screener: 'buyer_interest_enhanced',
    profile_meta: {
      section_labels: { primary: 'Buyer Interest+', secondary: '' },
      filters: [
        { key: 'direction', label: 'Direction', type: 'select', options: ['both', 'bullish', 'bearish'], default: 'both' },
        { key: 'min_score', label: 'Min Score', type: 'number', min: 0, max: 200, default: 0 },
        { key: 'min_vol_surge', label: 'Min Vol Surge', type: 'number', min: 0, max: 10, step: 0.1, default: 0 }
      ]
    }
  };
}

// Export the counts for assertions
export const mockBuyerInterestCounts = {
  total: allBuyerInterestStocks.length,
  bullish: allBuyerInterestStocks.filter(s => s.wick_close_pct >= 60).length,
  bearish: allBuyerInterestStocks.filter(s => s.wick_close_pct <= 40).length
};

// Helper to setup API mocks in Playwright tests
// IMPORTANT: This must be called BEFORE page.goto()
export async function setupApiMocks(page: import('@playwright/test').Page) {
  // Mock screeners list - use full URL pattern
  await page.route('http://localhost:8765/api/screeners', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockScreenersList)
    });
  });

  // Mock screener data endpoint with query parameters
  await page.route('http://localhost:8765/api/screener**', async route => {
    const url = route.request().url();

    // Check if it's buyer_interest_enhanced
    if (url.includes('screener=buyer_interest_enhanced')) {
      const directionMatch = url.match(/pf_direction=([^&]+)/);
      const direction = directionMatch ? directionMatch[1] : 'both';
      const response = createBuyerInterestResponse(direction);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      });
      return;
    }

    // Default to trending response
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockTrendingResponse)
    });
  });
}
