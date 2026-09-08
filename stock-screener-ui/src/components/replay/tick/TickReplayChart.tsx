// TickReplayChart — composed single-trade replay: NtChart + markers + SL/TP lines +
// zones/trends + RR box. Replaces the inline SingleChart in SmcTrades and the
// chart half of SmcPoc. Any future strategy reuses this with its own zones/trade.
import { useEffect, useMemo, useRef } from "react";
import { createSeriesMarkers, type Time } from "lightweight-charts";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import NtChart, { type NtChartApi } from "./NtChart";
import OverlayCanvas, { type OverlayCoord } from "./OverlayCanvas";
import { drawRiskReward, drawZones, tradeMarkers } from "./overlays";
import type { Bar, ReplayTrade, ReplayTrend, ReplayZone } from "./types";

interface TickReplayChartProps {
  bars: Bar[];
  trade?: ReplayTrade | null;
  zones?: ReplayZone[];
  trends?: ReplayTrend[];
  height?: number;
  fitPaddingMin?: number; // minutes before entry / after exit in view
  id?: string;
}

const MARKER_COLOR: Record<string, string> = {
  "entry-long": palette.MARKER_ENTRY,
  "entry-short": palette.MARKER_SL,
  "exit-tp": palette.MARKER_TP,
  "exit-sl": palette.MARKER_SL,
  "exit-be": palette.TEXT_MUTED,
  "exit-trail": palette.MARKER_EOD,
};

export default function TickReplayChart({
  bars, trade = null, zones = [], trends = [], height = 300, fitPaddingMin = 120, id = "tick-replay-chart",
}: TickReplayChartProps) {
  const apiRef = useRef<NtChartApi>(null);

  // markers + price lines per trade
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !trade) return;
    const chart = api.getChart();
    const series = api.getSeries();
    if (!chart || !series) return;
    const isLong = trade.side === "LONG";
    createSeriesMarkers(series as any, [
      {
        time: trade.time as Time,
        position: (isLong ? "belowBar" : "aboveBar") as any,
        color: isLong ? palette.MARKER_ENTRY : palette.MARKER_SL,
        shape: (isLong ? "arrowUp" : "arrowDown") as any,
        text: `${isLong ? "🟢" : "🔴"} ${trade.entry.toFixed(2)}`,
      },
      {
        time: trade.exit_time as Time,
        position: (isLong ? "aboveBar" : "belowBar") as any,
        color: MARKER_COLOR[tradeMarkers(trade)[1].kind],
        shape: "circle" as any,
        text: tradeMarkers(trade)[1].text,
      },
    ]);
    const lines = [
      series.createPriceLine({ price: trade.sl, color: palette.MARKER_SL, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" }),
    ];
    if (trade.tp != null) {
      lines.push(series.createPriceLine({ price: trade.tp, color: palette.MARKER_TP, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TP" }));
    }
    const from = trade.time - fitPaddingMin * 60;
    const to = trade.exit_time + 60 * 60;
    const first = bars[0]?.time ?? 0;
    const last = bars[bars.length - 1]?.time ?? 0;
    if (from >= first && to <= last) {
      chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
    } else {
      chart.timeScale().fitContent();
    }
    return () => {
      createSeriesMarkers(series as any, []);
      const removable = series as unknown as { removePriceLine?: (l: unknown) => void };
      if (typeof removable.removePriceLine === "function") {
        for (const l of lines) removable.removePriceLine(l);
      }
    };
  }, [bars, trade, fitPaddingMin]);

  const draw = useMemo(() => {
    return (ctx: CanvasRenderingContext2D, coord: OverlayCoord) => {
      if (zones.length || trends.length) drawZones(ctx, coord, zones, trends);
      if (trade) drawRiskReward(ctx, coord, trade);
    };
  }, [zones, trends, trade]);

  return (
    <Box sx={{ width: "100%", height, position: "relative" }} data-testid="tick-replay-chart" id={id}>
      <NtChart ref={apiRef} bars={bars} height={height} />
      <OverlayCanvas chartApi={apiRef} height={height} draw={draw} />
    </Box>
  );
}
