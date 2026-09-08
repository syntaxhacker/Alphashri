// overlays.ts — pure canvas draw functions for tick-replay (no lightweight-charts import).
// All take (ctx, coord) from <OverlayCanvas>. Unit-tested in overlays.test.ts.
import * as palette from "@/ui/palette";
import type { OverlayCoord } from "./OverlayCanvas";
import type { ReplayTrade, ReplayTrend, ReplayZone } from "./types";

export const ZONE_STYLE: Record<ReplayZone["kind"], { fill: string; stroke: string }> = {
  supply: { fill: "rgba(168,85,247,0.18)", stroke: "#A78BFA" },
  demand: { fill: "rgba(168,85,247,0.18)", stroke: "#A78BFA" },
  "fvg-bull": { fill: palette.NT_FVG_BULL_FILL, stroke: palette.NT_FVG_BULL_STROKE },
  "fvg-bear": { fill: palette.NT_FVG_BEAR_FILL, stroke: palette.NT_FVG_BEAR_STROKE },
  ifvg: { fill: palette.NT_IFVG_FILL, stroke: palette.NT_IFVG_STROKE },
  lrl: { fill: "rgba(0,0,0,0)", stroke: palette.NT_TREND },
};

export function drawZoneBox(
  ctx: CanvasRenderingContext2D, coord: OverlayCoord,
  t1: number, t2: number, top: number, bottom: number,
  fill: string, stroke: string, label?: string,
): boolean {
  const x1 = coord.timeToX(t1);
  const x2 = coord.timeToX(t2);
  const y1 = coord.priceToY(top);
  const y2 = coord.priceToY(bottom);
  if (x1 == null || x2 == null || y1 == null || y2 == null) return false;
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(Math.abs(x2 - x1), 3);
  const h = Math.abs(y2 - y1);
  if (h < 2) return false;
  ctx.save();
  if (fill !== "rgba(0,0,0,0)") {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(w - 1, 1), Math.max(h - 1, 1));
  if (label) {
    ctx.fillStyle = stroke;
    ctx.font = "bold 10px monospace";
    ctx.fillText(label, x + 4, y + 13);
  }
  ctx.restore();
  return true;
}

/** Draw supply/demand/FVG/iFVG zones + LRL trendlines. Returns count drawn. */
export function drawZones(
  ctx: CanvasRenderingContext2D, coord: OverlayCoord,
  zones: ReplayZone[], trends: ReplayTrend[] = [],
): number {
  let drawn = 0;
  for (const z of zones) {
    const st = ZONE_STYLE[z.kind];
    if (drawZoneBox(ctx, coord, z.t1, z.t2, z.top, z.bottom, st.fill, st.stroke, z.label)) drawn++;
  }
  for (const tr of trends) {
    const x1 = coord.timeToX(tr.t1);
    const x2 = coord.timeToX(tr.t2);
    const y1 = coord.priceToY(tr.p1);
    const y2 = coord.priceToY(tr.p2);
    if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
    ctx.save();
    ctx.strokeStyle = palette.NT_TREND;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = palette.NT_TREND;
    for (const [x, y] of [[x1, y1], [x2, y2]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (tr.label) {
      ctx.font = "bold 10px monospace";
      ctx.fillText(tr.label, Math.min(x1, x2) + 6, Math.min(y1, y2) - 6);
    }
    ctx.restore();
    drawn++;
  }
  return drawn;
}

export interface RRGeometry {
  left: number;
  width: number;
  yEntry: number;
  ySl: number;
  yTp: number | null;
}

/** TV-style risk/reward geometry. TP null (trail) => reward zone omitted. BE (sl==entry) => zero-height risk. */
export function rrGeometry(
  coord: OverlayCoord, trade: Pick<ReplayTrade, "time" | "exit_time" | "entry" | "sl" | "tp">,
): RRGeometry | null {
  const x1 = coord.timeToX(trade.time);
  const x2 = coord.timeToX(trade.exit_time);
  const yE = coord.priceToY(trade.entry);
  const yS = coord.priceToY(trade.sl);
  if (x1 == null || x2 == null || yE == null || yS == null) return null;
  const yT = trade.tp != null ? coord.priceToY(trade.tp) : null;
  if (trade.tp != null && yT == null) return null;
  return {
    left: Math.min(x1, x2),
    width: Math.max(Math.abs(x2 - x1), 3),
    yEntry: yE, ySl: yS, yTp: yT,
  };
}

function withAlpha(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Paint the RR box. Returns false when nothing visible. Handles BE + trail. */
export function drawRiskReward(
  ctx: CanvasRenderingContext2D, coord: OverlayCoord, trade: ReplayTrade,
): boolean {
  const g = rrGeometry(coord, trade);
  if (!g) return false;
  const band = (yA: number, yB: number, fill: string, edge: string) => {
    const top = Math.min(yA, yB);
    const h = Math.abs(yB - yA);
    if (h < 2) return;
    ctx.fillStyle = fill;
    ctx.fillRect(g.left, top, g.width, h);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.left + 0.5, top + 0.5, Math.max(g.width - 1, 1), Math.max(h - 1, 1));
  };
  band(g.yEntry, g.ySl, withAlpha(palette.NEGATIVE, 0.13), withAlpha(palette.NEGATIVE, 0.55));
  if (g.yTp != null && trade.tp != null) {
    band(g.yEntry, g.yTp, withAlpha(palette.POSITIVE, 0.13), withAlpha(palette.POSITIVE, 0.55));
  }
  ctx.save();
  ctx.strokeStyle = palette.MARKER_ENTRY;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(g.left, g.yEntry);
  ctx.lineTo(g.left + g.width, g.yEntry);
  ctx.stroke();
  ctx.restore();
  ctx.font = "600 10px monospace";
  const risk = Math.abs(trade.entry - trade.sl).toFixed(1);
  const lx = g.left + g.width + 4;
  ctx.fillStyle = palette.NEGATIVE;
  ctx.fillText(`-${risk}`, lx, Math.min(g.yEntry, g.ySl) + 12);
  if (g.yTp != null && trade.tp != null) {
    const rwd = Math.abs(trade.tp - trade.entry).toFixed(1);
    ctx.fillStyle = palette.POSITIVE;
    ctx.fillText(`+${rwd} (${trade.rr >= 0 ? "+" : ""}${trade.rr.toFixed(1)}R)`, lx, Math.min(g.yEntry, g.yTp) + 12);
  }
  return true;
}

export type MarkerKind = "entry-long" | "entry-short" | "exit-tp" | "exit-sl" | "exit-be" | "exit-trail";

/** Marker spec for a trade (rendered via lightweight-charts createSeriesMarkers by the caller). */
export function tradeMarkers(trade: ReplayTrade): { time: number; kind: MarkerKind; text: string }[] {
  const isLong = trade.side === "LONG";
  const exitKind: MarkerKind =
    trade.result === "TP" ? "exit-tp"
    : trade.sl === trade.entry ? "exit-be"
    : trade.result === "TRAIL" ? "exit-trail" : "exit-sl";
  const exitEmoji = trade.result === "TP" ? "🎯" : trade.result === "TRAIL" ? "🏁" : trade.sl === trade.entry ? "➖" : "🛑";
  return [
    { time: trade.time, kind: isLong ? "entry-long" : "entry-short", text: `${trade.entry.toFixed(2)}` },
    { time: trade.exit_time, kind: exitKind, text: `${exitEmoji} ${trade.result} ${trade.exit.toFixed(2)}` },
  ];
}
