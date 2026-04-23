import type { HolidayMap } from "../chartUtils";
import { formatVolume, getCandleChange, getCandleFromParams } from "../chartUtils";
import type { UnifiedTrade } from "./types";

export function buildTooltip(
  candles: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    date?: string;
    time_str?: string;
    time: string;
  }[],
  holidays?: { date: string; type: string; description: string }[],
  extendedTimeData?: string[],
  hasGaps?: boolean,
  holidayMap?: HolidayMap,
): (params: any) => string {
  return function (params: any) {
    if (!params || !params.length) return "";

    for (const p of params) {
      if (p.data?.isLive && p.data?.trade) {
        const pos = p.data.trade;
        const pnl = pos.pnl ?? 0;
        const pnlPct = pos.pnl_pct ?? 0;
        const pnlColor = pnl >= 0 ? "#00E676" : "#FF1744";
        return `<div style="padding:6px 8px;font-family:monospace;font-size:12px;line-height:1.4"><div style="color:#00BFFF;font-weight:bold;margin-bottom:4px">LIVE POSITION | ${pos.side}</div><div style="display:flex;gap:12px;margin-bottom:2px"><span>Entry: <b>₹${pos.entry_price.toFixed(2)}</b></span><span>Current: <b>₹${(pos.current_price ?? 0).toFixed(2)}</b></span><span>Qty: ${pos.quantity ?? 1}</span></div><div style="display:flex;gap:12px"><span style="color:#FF00FF">SL: ₹${(pos.stop_loss ?? 0).toFixed(2)}</span><span style="color:#FFFF00">TP: ₹${(pos.take_profit ?? 0).toFixed(2)}</span></div><div style="margin-top:4px"><span style="color:${pnlColor};font-weight:bold">P&L: ₹${pnl.toFixed(0)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)</span></div></div>`;
      }

      if (p.data?.trade) {
        const t: UnifiedTrade = p.data.trade;
        const pnlColor = (t.pnl ?? 0) >= 0 ? "#00E676" : "#FF1744";
        const pnl = t.pnl ?? 0;
        const costs = t.costs ?? 0;
        const side = t.side ? ` | ${t.side}` : "";
        const reason = t.exit_reason || "Open";
        return `<div style="padding:6px 8px;font-family:monospace;font-size:12px;line-height:1.4"><div style="color:#00BFFF;font-weight:bold;margin-bottom:4px">Trade #${t.id}${side} | ${reason}</div><div style="display:flex;gap:12px;margin-bottom:2px"><span>Entry: <b>₹${t.entry_price.toFixed(2)}</b></span><span>Exit: <b>₹${(t.exit_price ?? 0).toFixed(2)}</b></span><span>Qty: ${t.quantity}</span></div><div style="display:flex;gap:12px"><span style="color:${pnlColor};font-weight:bold">P&L: ${pnl >= 0 ? "+" : ""}₹${pnl.toFixed(0)}</span><span style="color:#888">Cost: ₹${costs.toFixed(0)}</span></div></div>`;
      }
    }

    if (hasGaps && extendedTimeData) {
      const candle = params.find((p: any) => p.seriesType === "candlestick");
      if (candle) {
        const idx = candle.dataIndex;
        const label = extendedTimeData[idx];
        if (label?.includes("[")) {
          const parts = label.match(/(\S+)\s+\[(\w+)\]/);
          const hDate = parts ? parts[1] : label;
          const hType = parts ? parts[2] : "?";
          const desc = holidayMap?.descriptions.get(hDate)?.desc ?? "";
          const typeLabel =
            hType === "H" ? "Trading Holiday" : hType === "C" ? "Clearing Holiday" : "Weekend";
          return `<div style="padding:6px 8px;font-size:12px"><div style="font-weight:bold;color:${hType === "H" ? "#FF5252" : "#FFB74D"}">${hDate} — ${typeLabel}</div>${desc ? `<div style="color:#888">${desc}</div>` : ""}</div>`;
        }
      }
    }

    const result = getCandleFromParams(params, candles);
    if (!result) return "";
    const c = result.candle;
    const { change, changeColor } = result.change;
    const timeLabel =
      c.time_str || c.date
        ? `${c.date || ""} ${c.time_str || ""}`.trim()
        : c.time.split(/[T ]/).pop()?.substring(0, 5) || c.time;
    return `<div style="padding:6px 8px;font-family:monospace;font-size:12px;line-height:1.4"><div style="font-weight:bold;margin-bottom:4px">${timeLabel}</div><div style="display:flex;gap:12px"><span>O: ₹${c.open.toFixed(2)}</span><span>H: ₹${c.high.toFixed(2)}</span><span>L: ₹${c.low.toFixed(2)}</span><span>C: ₹${c.close.toFixed(2)}</span></div><div style="display:flex;gap:12px;color:#888"><span style="color:${changeColor};font-weight:bold">${c.close >= c.open ? "+" : ""}${change}%</span><span>Vol: ${formatVolume(c.volume)}</span></div></div>`;
  };
}
