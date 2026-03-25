/**
 * Chart Data Builder
 *
 * Converts raw backtest data to ECharts format.
 *
 * DATA FORMATS FROM API:
 * - Candles: index is IST without timezone "2025-10-24T09:15:00"
 * - Trades: entry_time/exit_time are IST without timezone "2025-10-27T11:25:00"
 *
 * All times are in IST, no conversion needed.
 */

import type {
  SymbolChartData,
  CandleData,
  ChartTrade,
  ORBZone,
  PivotLevels,
  Trade,
  Week52Levels,
} from "../types/backtest";

interface RawCandle {
  index: string[]; // IST strings like "2025-10-24T09:15:00"
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

interface RawTrade {
  entry_price: number;
  exit_price: number;
  entry_time: string; // IST without timezone like "2025-10-27T11:25:00"
  exit_time: string;
  quantity: number;
  gross_pnl: number;
  gross_pnl_pct: number;
  trading_costs: number;
  net_pnl: number;
  net_pnl_pct: number;
  exit_reason: "TP" | "SL" | "EOD";
  hold_duration_minutes: number;
  date: string; // YYYY-MM-DD
  // ORB strategy fields
  or_high?: number;
  or_low?: number;
  // S/R Breakout strategy fields
  pp?: number; // Pivot Point
  r1?: number; // Resistance 1
  s1?: number; // Support 1
  r2?: number; // Resistance 2
  s2?: number; // Support 2
  // 52W Chaser strategy fields
  "52w_high"?: number;
  // 52W Target strategy fields
  "52w_high_entry"?: number;
  trailing_active?: boolean;
}

export function buildChartData(
  symbol: string,
  rawCandles: RawCandle,
  rawTrades: RawTrade[],
  orMinutes: number = 45,
): SymbolChartData {
  const candles = formatCandleData(rawCandles);

  // Get unique trade dates to filter ORB zones
  const tradeDates = new Set(rawTrades.map((t) => t.date));

  // Only calculate ORB zones for days with trades
  const orbZones = formatORBZones(candles, orMinutes).filter((z) => tradeDates.has(z.date_raw));

  // Extract pivot levels from trades (for S/R Breakout strategy)
  const pivotLevels = extractPivotLevels(rawTrades);

  // Extract 52W high levels from trades (for 52W Chaser strategy)
  const week52Levels = extractWeek52Levels(rawTrades);

  const trades = formatTradeMarkers(rawTrades, candles);

  const startDates = candles.map((c) => c.date_raw).filter((d) => d);
  const startDate = startDates[0] || null;
  const endDate = startDates[startDates.length - 1] || null;

  console.log(
    `buildChartData: ${candles.length} candles, ${orbZones.length} ORB zones, ${pivotLevels.length} pivot levels, ${week52Levels.length} 52W levels, ${trades.length} trade markers`,
  );

  return {
    symbol,
    candles,
    orb_zones: orbZones,
    pivot_levels: pivotLevels,
    week52_levels: week52Levels,
    trades,
    date_range: {
      start: startDate,
      end: endDate,
    },
    total_candles: candles.length,
    total_trades: rawTrades.length,
  };
}

/**
 * Parse candle time (already in IST) and extract parts
 * Input: "2025-10-24T09:15:00" (IST, no timezone)
 * Output: IST time parts
 */
function formatCandleData(raw: RawCandle): CandleData[] {
  const candles: CandleData[] = [];
  const indices = raw.index || [];
  const opens = raw.open || [];
  const highs = raw.high || [];
  const lows = raw.low || [];
  const closes = raw.close || [];
  const volumes = raw.volume || [];

  console.log(`formatCandleData: ${indices.length} raw candles`);

  for (let i = 0; i < indices.length; i++) {
    try {
      const timeStr = indices[i];
      const cleanTime = timeStr.replace(/\+00:00$|Z$/, "");
      const [datePart, timePart] = cleanTime.split("T");

      if (!datePart || !timePart) {
        console.error("Error parsing candle:", indices[i], "missing date or time part");
        continue;
      }

      const [hours, minutes] = timePart.split(":");

      const dateRaw = datePart; // YYYY-MM-DD for matching
      const timeDisplay = `${hours}:${minutes}`; // HH:MM for display
      const comparableTime = `${dateRaw}T${timeDisplay}`; // For matching with trades

      candles.push({
        time: comparableTime,
        date: dateRaw,
        time_str: timeDisplay,
        open: opens[i] || 0,
        high: highs[i] || 0,
        low: lows[i] || 0,
        close: closes[i] || 0,
        volume: volumes[i] || 0,
      });
    } catch (e) {
      console.error("Error parsing candle:", indices[i], e);
    }
  }

  if (candles.length > 0) {
    console.log(`Candles: ${candles[0].time} to ${candles[candles.length - 1].time}`);
  }

  return candles;
}

/**
 * Helper to create an ORB zone from candles
 */
function createORBZone(date: string, orCandles: CandleData[], orEndMinutes: number): ORBZone {
  const orHigh = Math.max(...orCandles.map((c) => c.high));
  const orLow = Math.min(...orCandles.map((c) => c.low));
  return {
    date,
    date_raw: date,
    or_high: Math.round(orHigh * 100) / 100,
    or_low: Math.round(orLow * 100) / 100,
    or_end_time: `${String(Math.floor(orEndMinutes / 60)).padStart(2, "0")}:${String(orEndMinutes % 60).padStart(2, "0")}`,
  };
}

function formatORBZones(candles: CandleData[], orMinutes: number): ORBZone[] {
  const zones: ORBZone[] = [];
  let currentDate: string | null = null;
  let orCandles: CandleData[] = [];

  const marketOpenMinutes = 9 * 60 + 15; // 9:15 AM
  const orEndMinutes = marketOpenMinutes + orMinutes;

  for (const candle of candles) {
    const timeParts = candle.time_str.split(":");
    const candleMinutes = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);

    // New day
    if (candle.date !== currentDate) {
      // Process previous day's OR
      if (orCandles.length > 0 && currentDate) {
        zones.push(createORBZone(currentDate, orCandles, orEndMinutes));
      }

      currentDate = candle.date;
      orCandles = [];
    }

    // Collect OR candles (before 10:00 for 45-min OR)
    if (candleMinutes < orEndMinutes) {
      orCandles.push(candle);
    }
  }

  // Process last day
  if (orCandles.length > 0 && currentDate) {
    zones.push(createORBZone(currentDate, orCandles, orEndMinutes));
  }

  return zones;
}

/**
 * Extract pivot levels from trades (for S/R Breakout strategy).
 * Pivot levels are the same for all trades on the same day.
 */
function extractPivotLevels(trades: RawTrade[]): PivotLevels[] {
  const levelsByDate = new Map<string, PivotLevels>();

  for (const trade of trades) {
    if (trade.pp && trade.r1 && trade.s1) {
      // Only add if not already added for this date
      if (!levelsByDate.has(trade.date)) {
        levelsByDate.set(trade.date, {
          date: trade.date,
          date_raw: trade.date,
          pp: trade.pp,
          r1: trade.r1,
          s1: trade.s1,
          r2: trade.r2,
          s2: trade.s2,
        });
      }
    }
  }

  return Array.from(levelsByDate.values());
}

/**
 * Extract 52W high levels from trades (for 52W Chaser strategy).
 * 52W high is the same for all trades on the same day.
 */
function extractWeek52Levels(trades: RawTrade[]): Week52Levels[] {
  const levelsByDate = new Map<string, Week52Levels>();

  for (const trade of trades) {
    // Support both 52w_chaser (52w_high) and 52w_target (52w_high_entry)
    const week52High = trade["52w_high_entry"] ?? trade["52w_high"];
    if (week52High !== undefined && week52High !== null) {
      if (!levelsByDate.has(trade.date)) {
        levelsByDate.set(trade.date, {
          date: trade.date,
          date_raw: trade.date,
          "52w_high": week52High,
          trailing_active: trade.trailing_active,
        });
      }
    }
  }

  return Array.from(levelsByDate.values());
}

/**
 * Format trade markers. Match trade times to candle times.
 * Trade times are IST without timezone: "2025-10-27T11:25:00"
 * Candle times are already converted to IST comparable format
 */
function formatTradeMarkers(trades: RawTrade[], candles: CandleData[]): ChartTrade[] {
  const markers: ChartTrade[] = [];

  // Build lookup map for candle times
  const candleTimeMap = new Map<string, number>();
  candles.forEach((c, i) => candleTimeMap.set(c.time, i));

  console.log(
    `Sample candle times for matching:`,
    candles.slice(0, 3).map((c) => c.time),
  );

  trades.forEach((trade, idx) => {
    // Trade time format: "2025-10-27T11:25:00" or "2025-10-27T11:25:00+00:00"
    // Normalize to "YYYY-MM-DDTHH:MM"
    const entryNormalized = normalizeTradeTime(trade.entry_time);
    const exitNormalized = normalizeTradeTime(trade.exit_time);
    // Use date-only format for matching with daily candles
    const entryDateOnly = normalizeTradeTimeToDate(trade.entry_time);
    const exitDateOnly = normalizeTradeTimeToDate(trade.exit_time);

    if (idx < 3) {
      console.log(
        `Trade ${idx + 1}: ${trade.entry_time} -> ${entryNormalized} -> date: ${entryDateOnly}`,
      );
    }

    // Find candle index using date-only matching for daily candles
    const entryCandleIdx = candleTimeMap.get(entryDateOnly);
    const exitCandleIdx = candleTimeMap.get(exitDateOnly);

    if (entryCandleIdx === undefined) {
      console.warn(`Entry time not found: ${entryNormalized}`);
    }
    if (exitCandleIdx === undefined) {
      console.warn(`Exit time not found: ${exitNormalized}`);
    }

    // Shared trade data for both entry and exit markers
    const tradeData = {
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      quantity: trade.quantity,
      gross_pnl: trade.gross_pnl,
      trading_costs: trade.trading_costs,
      net_pnl: trade.net_pnl,
      net_pnl_pct: trade.net_pnl_pct,
      exit_reason: trade.exit_reason,
      hold_duration_minutes: trade.hold_duration_minutes,
      or_high: trade.or_high,
      or_low: trade.or_low,
      pp: trade.pp,
      r1: trade.r1,
      s1: trade.s1,
      r2: trade.r2,
      s2: trade.s2,
    };

    // Entry marker
    markers.push({
      trade_id: idx + 1,
      type: "entry",
      time: entryNormalized,
      candle_idx: entryCandleIdx,
      date: trade.date,
      price: trade.entry_price,
      marker: {
        symbol: "triangle",
        color: "#00BFFF",
        size: 16,
      },
      trade: tradeData,
    });

    // Exit marker
    const exitColors: Record<string, string> = {
      TP: "#00E676",
      SL: "#FF1744",
      EOD: "#FFEA00",
    };

    markers.push({
      trade_id: idx + 1,
      type: "exit",
      time: exitNormalized,
      candle_idx: exitCandleIdx,
      date: trade.date,
      price: trade.exit_price,
      marker: {
        symbol: "circle",
        color: exitColors[trade.exit_reason] || "#FFEA00",
        size: 14,
      },
      trade: tradeData,
    });
  });

  return markers;
}

/**
 * Normalize trade time to comparable format
 * Input: "2025-10-27T11:25:00" or "2025-10-27T11:25:00+00:00"
 * Output: "2025-10-27T11:25"
 */
function normalizeTradeTime(time: string): string {
  if (!time) return "";
  // Remove timezone suffix and seconds if present
  return time
    .replace(/\+00:00$/, "")
    .replace(/\+05:30$/, "")
    .replace(/Z$/, "")
    .substring(0, 16); // "YYYY-MM-DDTHH:MM"
}

/**
 * Normalize trade time to date-only format for matching with daily candles
 * Input: "2025-10-27T11:25:00" or "2025-10-27"
 * Output: "2025-10-27T00:00"
 */
function normalizeTradeTimeToDate(time: string): string {
  if (!time) return "";
  // Extract just the date part and append 00:00 for daily candle matching
  const datePart = time.split("T")[0];
  return `${datePart}T00:00`;
}

// Helper to convert chart trades to Trade[] for modal
export function chartTradesToTrades(chartTrades: ChartTrade[]): Trade[] {
  const trades: Trade[] = [];

  chartTrades
    .filter((ct) => ct.type === "entry")
    .forEach((ct) => {
      trades.push({
        entry_price: ct.trade.entry_price,
        exit_price: ct.trade.exit_price,
        entry_time: ct.trade.entry_time,
        exit_time: ct.trade.exit_time,
        quantity: ct.trade.quantity,
        gross_pnl: ct.trade.gross_pnl,
        gross_pnl_pct: ct.trade.gross_pnl_pct || 0,
        trading_costs: ct.trade.trading_costs,
        net_pnl: ct.trade.net_pnl,
        net_pnl_pct: ct.trade.net_pnl_pct,
        exit_reason: ct.trade.exit_reason,
        hold_duration_minutes: ct.trade.hold_duration_minutes,
        date: ct.date,
        or_high: ct.trade.or_high,
        or_low: ct.trade.or_low,
        pp: ct.trade.pp,
        r1: ct.trade.r1,
        s1: ct.trade.s1,
        r2: ct.trade.r2,
        s2: ct.trade.s2,
        // 52W Chaser fields
        "52w_high": ct.trade["52w_high"],
        trailing_active: ct.trade.trailing_active,
      });
    });

  return trades;
}
