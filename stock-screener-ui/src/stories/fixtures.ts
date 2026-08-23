/**
 * Realistic domain fixtures for Storybook — single source for NSE mocks.
 * Every story that needs data imports from here; no ad-hoc mock objects in stories.
 * Prices are NSE-realistic (RELIANCE ~1400, TCS ~3200, NIFTY ~23500) with
 * IST timestamps and ₹ formatting, so UI truncation/overflow issues surface.
 */

import type { OptionChainResponse } from "@/api/upstoxOptions";

// ── NIFTY / RELIANCE spot ──
export const MOCK_SPOT_NIFTY = 23500;
export const MOCK_SPOT_RELIANCE = 1415;

// ── Option chain: NIFTY 23500, 7 strikes around spot ──
function makeContract(
  strike: number,
  type: "CE" | "PE",
  spot: number,
  expiry: string,
  underlying: string,
): import("@/api/upstoxOptions").OptionContract {
  const distance = Math.abs(strike - spot);
  const isATM = distance < 100;
  const isITM = type === "CE" ? strike < spot : strike > spot;
  const ltp = isATM ? 85 + Math.random() * 20 : isITM ? 120 + Math.random() * 40 : 12 + Math.random() * 18;
  const volume = Math.floor(50000 + Math.random() * 200000);
  const oi = Math.floor(800000 + Math.random() * 1500000);
  const iv = 14 + Math.random() * 18;
  return {
    instrument_key: `NSE_FO|${strike}${type}`,
    trading_symbol: `${underlying}${expiry.replace(/-/g, "")}${strike}${type}`,
    strike_price: strike,
    expiry,
    instrument_type: `OPT_${type}`,
    lot_size: 50,
    market_data: {
      ltp: +ltp.toFixed(2),
      volume,
      oi,
      prev_oi: oi - Math.floor(Math.random() * 60000),
      bid_price: +(ltp - 0.5).toFixed(2),
      ask_price: +(ltp + 0.5).toFixed(2),
    },
    option_greeks: {
      delta: type === "CE" ? +(0.3 + Math.random() * 0.4).toFixed(3) : +(-0.3 - Math.random() * 0.4).toFixed(3),
      gamma: +(0.002 + Math.random() * 0.008).toFixed(5),
      vega: +(2 + Math.random() * 4).toFixed(2),
      theta: +(-8 - Math.random() * 6).toFixed(2),
      iv: +iv.toFixed(2),
    },
    sentiment: isATM ? { type: "Neutral", color: "gray", label: "Neutral" } : isITM ? { type: "Bullish", color: "green", label: "Bullish" } : { type: "Bearish", color: "red", label: "Bearish" },
  };
}

export const MOCK_EXPIRY = "2026-04-30";
export const MOCK_OPTION_CHAIN: OptionChainResponse = {
  status: "success",
  underlying: "NIFTY",
  expiry: MOCK_EXPIRY,
  spot: MOCK_SPOT_NIFTY,
  timestamp: new Date().toISOString(),
  chain: [23300, 23400, 23500, 23600, 23700, 23800, 23900].map(strike => ({
    strike,
    ce: makeContract(strike, "CE", MOCK_SPOT_NIFTY, MOCK_EXPIRY, "NIFTY"),
    pe: makeContract(strike, "PE", MOCK_SPOT_NIFTY, MOCK_EXPIRY, "NIFTY"),
  })),
  summary: {
    pcr: 1.18,
    max_pain: 23500,
    expected_move: { upper: 23850, lower: 23150, range: 700 },
    total_ce_oi: 4200000,
    total_pe_oi: 4950000,
    dte: 8,
  },
};

// ── Candles: 50x 15m RELIANCE candles around 1415 ──
export function makeMockCandles(n = 50, base = 1415) {
  let p = base;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const h = o + Math.random() * 6;
    const l = o - Math.random() * 6;
    const c = l + Math.random() * (h - l);
    p = c;
    const hh = String(9 + Math.floor(i / 4)).padStart(2, "0");
    const mm = String((i % 4) * 15).padStart(2, "0");
    return {
      time: `2026-03-20T${hh}:${mm}:00`,
      date: "2026-03-20",
      time_str: `${hh}:${mm}`,
      open: +o.toFixed(2),
      high: +h.toFixed(2),
      low: +l.toFixed(2),
      close: +c.toFixed(2),
      volume: Math.floor(80000 + Math.random() * 120000),
    };
  });
}

export const MOCK_CANDLES = makeMockCandles(50, MOCK_SPOT_RELIANCE);

export const MOCK_CHART_DATA: import("@/api/chartPreview").ChartPreviewData = {
  symbol: "RELIANCE",
  candles: MOCK_CANDLES as any,
  orb_zones: [{ date: "2026-03-20", date_raw: "2026-03-20", or_high: 1422, or_low: 1410, or_end_time: "10:00" }],
  pivot_levels: [{ date: "2026-03-20", date_raw: "2026-03-20", pp: 1415, r1: 1425, s1: 1405, r2: 1435, s2: 1395 }],
  high_52w: 1605.5,
  timeframe: 15,
  or_minutes: 45,
  total_candles: 50,
};

// — Decoupled per-strategy variants (one overlay only, for Chromatic isolation) —
function cloneChart(overrides: Partial<import("@/api/chartPreview").ChartPreviewData>) {
  return { ...MOCK_CHART_DATA, ...overrides } as import("@/api/chartPreview").ChartPreviewData;
}
export const MOCK_ORB_CHART = cloneChart({
  orb_zones: [{ date: "2026-03-20", date_raw: "2026-03-20", or_high: 1422, or_low: 1410, or_end_time: "10:00" }],
  pivot_levels: [],
  high_52w: null as any,
});
export const MOCK_PIVOT_CHART = cloneChart({
  orb_zones: [],
  pivot_levels: [{ date: "2026-03-20", date_raw: "2026-03-20", pp: 1415, r1: 1425, s1: 1405, r2: 1435, s2: 1395 }],
  high_52w: null as any,
});
export const MOCK_52W_CHART = cloneChart({
  orb_zones: [],
  pivot_levels: [],
  high_52w: 1605.5,
});
export const MOCK_EMA_CHART: import("@/api/chartPreview").ChartPreviewData = {
  ...MOCK_CHART_DATA,
  orb_zones: [],
  pivot_levels: [],
  high_52w: null as any,
  // ema_series is not in ChartPreviewData but used via PaperChartData.embeds for TradingChart — keep shape compatible
  // Paper/backtest variants below carry the real EMA payload
} as any;
export const MOCK_BARE_CHART = cloneChart({ orb_zones: [], pivot_levels: [], high_52w: null as any });

// Paper-variant fixtures (correct shapes for normalizePaper)
function makeEmaSeries(len: number) {
  const fast: (number | null)[] = Array(len).fill(null);
  const slow: (number | null)[] = Array(len).fill(null);
  for (let i = 8; i < len; i++) fast[i] = 1410 + Math.sin(i / 3) * 8 + i * 0.15;
  for (let i = 20; i < len; i++) slow[i] = 1410 + Math.cos(i / 4) * 6 + i * 0.12;
  return {
    ema_fast: { label: "EMA 9", color: "#22c55e", data: fast },
    ema_slow: { label: "EMA 21", color: "#a855f7", data: slow },
  };
}
const EMA_50 = makeEmaSeries(50);
export const MOCK_PAPER_ORB: import("@/types/paperTrading").PaperChartData = {
  symbol: "RELIANCE", date: "2026-03-20", candles: MOCK_CANDLES as any, trades: [], orb_levels: { or_high: 1422, or_low: 1410, or_open: 1416, or_range: 12, or_range_pct: 0.85, or_minutes: 45, or_candle_count: 3 }, week52_levels: null, pivot_levels: null, current_position: null, ema_series: null,
} as any;
export const MOCK_PAPER_PIVOT: import("@/types/paperTrading").PaperChartData = {
  symbol: "RELIANCE", date: "2026-03-20", candles: MOCK_CANDLES as any, trades: [], orb_levels: null, week52_levels: null, pivot_levels: { pp: 1415, r1: 1425, s1: 1405, r2: 1435, s2: 1395 }, current_position: null, ema_series: null,
} as any;
export const MOCK_PAPER_52W: import("@/types/paperTrading").PaperChartData = {
  symbol: "RELIANCE", date: "2026-03-20", candles: MOCK_CANDLES as any, trades: [], orb_levels: null, week52_levels: { high_52w: 1605.5, low_52w: 1120, distance_to_high_pct: 11.8, distance_to_low_pct: 26.1, near_high: false }, pivot_levels: null, current_position: null, ema_series: null,
} as any;
export const MOCK_PAPER_EMA: import("@/types/paperTrading").PaperChartData = {
  symbol: "RELIANCE", date: "2026-03-20", candles: MOCK_CANDLES as any, trades: [], orb_levels: null, week52_levels: null, pivot_levels: null, current_position: null, ema_series: EMA_50 as any,
} as any;
export const MOCK_PAPER_BARE: import("@/types/paperTrading").PaperChartData = {
  symbol: "RELIANCE", date: "2026-03-20", candles: MOCK_CANDLES as any, trades: [{ trade_id: "t1", entry_price: 1410, exit_price: 1425, stop_loss: 1395, take_profit: 1430, exit_reason: "TP" } as any], orb_levels: null, week52_levels: null, pivot_levels: null, current_position: { entry_price: 1410, entry_time: "2026-03-20T09:30:00", side: "BUY", stop_loss: 1395, take_profit: 1430 } as any, ema_series: null,
} as any;

// ── Paper trading ──
export const MOCK_PAPER_POSITIONS: import("@/types/paperTrading").PaperPosition[] = [
  {
    symbol: "RELIANCE", side: "BUY", quantity: 10, entry_price: 1410, current_price: 1428, entry_time: "2026-03-20T09:30:00Z",
    stop_loss: 1390, take_profit: 1450, pnl: 180, pnl_pct: 1.27, margin_used: 14100, order_id: "1", strategy_id: 1, strategy_name: "ORB Best",
  },
  {
    symbol: "TCS", side: "BUY", quantity: 5, entry_price: 3200, current_price: 3225, entry_time: "2026-03-20T10:15:00Z",
    stop_loss: 3150, take_profit: 3300, pnl: 125, pnl_pct: 0.78, margin_used: 16000, order_id: "2", strategy_id: 2, strategy_name: "EMA Cross",
  },
] as any;

export const MOCK_PAPER_PORTFOLIO: import("@/types/paperTrading").PortfolioStatus = {
  initial_capital: 100000, cash: 42000, margin_used: 30100, position_value: 32000,
  unrealized_pnl: 305, realized_pnl: 1200, total_value: 102340, total_pnl: 2340, total_pnl_pct: 2.34,
  positions: 2, trades: 12, daily_pnl: 420, daily_pnl_pct: 0.42, daily_trades: 2, open_positions: 2,
};

export const MOCK_PAPER_TRADES: import("@/types/paperTrading").PaperTrade[] = [
  {
    trade_id: "t1", symbol: "RELIANCE", side: "BUY", quantity: 10, entry_price: 1400, exit_price: 1420, entry_time: "2026-03-19T09:30:00Z", exit_time: "2026-03-19T15:15:00Z",
    pnl: 200, pnl_pct: 1.42, exit_reason: "TP", costs: 12, net_pnl: 188, stop_loss: 1380, take_profit: 1420, peak_price: 1425, low_price: 1395, hold_duration_minutes: 345, notes: "", reason: "ORB breakout", strategy_id: 1, strategy_name: "ORB Best", bot_id: "bot-1", bot_name: "ORB Best — Paper",
  },
  {
    trade_id: "t2", symbol: "INFY", side: "BUY", quantity: 8, entry_price: 1480, exit_price: 1465, entry_time: "2026-03-19T10:00:00Z", exit_time: "2026-03-19T14:30:00Z",
    pnl: -120, pnl_pct: -1.01, exit_reason: "SL", costs: 10, net_pnl: -130, stop_loss: 1465, take_profit: 1510, peak_price: 1490, low_price: 1460, hold_duration_minutes: 270, notes: "", reason: "EMA cross", strategy_id: 2, strategy_name: "EMA Cross", bot_id: "bot-1", bot_name: "ORB Best — Paper",
  },
] as any;

// ── Sector heatmap: 20 NSE stocks ──
export const MOCK_SECTOR_STOCKS = [
  "RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","LT","SBIN","BHARTIARTL","ITC","AXISBANK",
  "KOTAKBANK","BAJFINANCE","ASIANPAINT","MARUTI","TITAN","ULTRACEMCO","WIPRO","HCLTECH","SUNPHARMA","NTPC",
].map(s => ({ symbol: s, change_pct: +(Math.random()*6-3).toFixed(2), sector: ["Energy","IT","Bank","FMCG","Pharma"][Math.floor(Math.random()*5)] }));

// ── Heatmap: 100 NSE stocks with full HeatmapStock shape ──
const HEATMAP_SECTORS = ["Financial Services","IT","Energy","FMCG","Pharma","Auto","Metals","Power"];
const HEATMAP_NAMES: Record<string,string> = {
  RELIANCE: "Reliance Industries", TCS: "Tata Consultancy", INFY: "Infosys", HDFCBANK: "HDFC Bank", ICICIBANK: "ICICI Bank",
  LT: "Larsen & Toubro", SBIN: "State Bank of India", BHARTIARTL: "Bharti Airtel", ITC: "ITC", AXISBANK: "Axis Bank",
};
function makeHeatmapStock(symbol: string, i: number): import("@/api/heatmap").HeatmapStock {
  const sector = HEATMAP_SECTORS[i % HEATMAP_SECTORS.length];
  const price = 800 + Math.random() * 2800;
  const pe = 12 + Math.random() * 38;
  return {
    symbol,
    name: HEATMAP_NAMES[symbol] || symbol,
    sector,
    market_cap: Math.floor(50000 + Math.random() * 950000),
    pe_ratio: +pe.toFixed(1),
    pb_ratio: +(1.5 + Math.random() * 4).toFixed(1),
    dividend_yield: +(0.5 + Math.random() * 2.5).toFixed(2),
    perf_1y: +(Math.random()*60 - 15).toFixed(1),
    roe: +(8 + Math.random()*18).toFixed(1),
    high_52w: +(price * 1.18).toFixed(0),
    low_52w: +(price * 0.72).toFixed(0),
    price: +price.toFixed(2),
    change_pct: +(Math.random()*6 - 2.5).toFixed(2),
  };
}
const HEATMAP_SYMBOLS = [
  "RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","LT","SBIN","BHARTIARTL","ITC","AXISBANK",
  "KOTAKBANK","BAJFINANCE","ASIANPAINT","MARUTI","TITAN","ULTRACEMCO","WIPRO","HCLTECH","SUNPHARMA","NTPC",
  "ONGC","TATAMOTORS","JSWSTEEL","HINDALCO","COALINDIA","GRASIM","TECHM","CIPLA","DRREDDY","DIVISLAB",
  "EICHERMOT","BRITANNIA","NESTLEIND","HEROMOTOCO","BAJAJ-AUTO","ADANIENT","ADANIPORTS","INDUSINDBK","SHREECEM","BPCL",
  "HINDUNILVR","UPL","TATASTEEL","VEDL","SBILIFE","HDFCLIFE","ICICIPRULI","APOLLOHOSP","BAJAJFINSV","POWERGRID",
];
export const MOCK_HEATMAP_STOCKS: import("@/api/heatmap").HeatmapStock[] = HEATMAP_SYMBOLS.map(makeHeatmapStock);
export const MOCK_HEATMAP_RESPONSE: import("@/api/heatmap").HeatmapResponse = {
  stocks: MOCK_HEATMAP_STOCKS,
  count: MOCK_HEATMAP_STOCKS.length,
  cached: false,
};
export const MOCK_SECTORS_RESPONSE: import("@/api/heatmap").SectorsResponse = {
  sectors: HEATMAP_SECTORS.map(name => ({ name, count: Math.floor(6 + Math.random()*8), avg_pe: +(18 + Math.random()*10).toFixed(1) } as any)),
};

// ── Backtest results ──
export const MOCK_BACKTEST_RESULTS: import("@/types/backtest").BacktestResult[] = [
  { symbol: "RELIANCE", trades: 12, wins: 7, losses: 5, win_rate: 58, gross_pnl: 3200, total_costs: 420, net_pnl: 2780, pf: 1.6, tp_exits: 5, sl_exits: 4, eod_exits: 3 },
  { symbol: "TCS", trades: 9, wins: 5, losses: 4, win_rate: 55, gross_pnl: 1800, total_costs: 310, net_pnl: 1490, pf: 1.3, tp_exits: 3, sl_exits: 3, eod_exits: 3 },
] as any;
