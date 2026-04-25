import type { UnifiedCandle, UnifiedTrade } from "../chart/types";

interface RawCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawTrade {
  entry_price: number;
  exit_price: number;
  entry_time: string;
  exit_time: string;
  exit_reason: string;
  quantity: number;
  side: string;
  net_pnl: number;
  costs: number;
}

export function mapCandles(candles: RawCandle[]): UnifiedCandle[] {
  return candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

export function mapTrades(
  trades: RawTrade[],
  getId: (t: RawTrade, idx: number) => number,
): UnifiedTrade[] {
  return trades.map((t, idx) => ({
    id: getId(t, idx),
    entry_price: t.entry_price,
    exit_price: t.exit_price,
    entry_time: t.entry_time,
    exit_time: t.exit_time,
    exit_reason: t.exit_reason,
    quantity: t.quantity,
    side: t.side as "BUY" | "SELL",
    pnl: t.net_pnl,
    costs: t.costs,
  }));
}
