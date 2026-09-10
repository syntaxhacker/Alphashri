import { useEffect, useRef } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, createSeriesMarkers, type IChartApi, type ISeriesApi, type CandlestickData, type HistogramData, type Time } from "lightweight-charts";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type { ReplayCandle, ReplayTrade } from "@/types/replay";

export interface TradingViewChartProps {
  candles: ReplayCandle[];
  trades?: ReplayTrade[];
  highlightedTradeId?: number | null;
  onTradeClick?: (id: number) => void;
  height?: number;
}

export function TradingViewChart({ candles, trades = [], highlightedTradeId, height = 400 }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);

  // create chart once — not on height/candles
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: palette.BG }, textColor: palette.TEXT },
      grid: { vertLines: { color: palette.BORDER }, horzLines: { color: palette.BORDER } },
      width: containerRef.current.clientWidth,
      height,
      timeScale: { borderColor: palette.BORDER, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 5 },
      rightPriceScale: { borderColor: palette.BORDER },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: palette.MARKER_BORDER,
      downColor: palette.SCALE_BLUE[6],
      borderColor: palette.SCALE_BLUE[6],
      borderUpColor: palette.MARKER_BORDER,
      borderDownColor: palette.SCALE_BLUE[6],
      wickUpColor: palette.MARKER_BORDER,
      wickDownColor: palette.SCALE_BLUE[6],
      borderVisible: true,
      wickVisible: true,
    });
    candleSeriesRef.current = candleSeries as any;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: withAlpha(palette.TEXT_MUTED, 0.3),
      priceScaleId: "",
      priceFormat: { type: "volume" },
    });
    volumeSeriesRef.current = volumeSeries as any;
    (volumeSeries as any).priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const markers = createSeriesMarkers(candleSeries, []);
    markersRef.current = markers;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // height updates without recreate
  useEffect(() => {
    chartRef.current?.applyOptions({ height });
  }, [height]);

  // simple per docs: setData on candles change, fitContent once
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (candles.length === 0) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      return;
    }
    const candleData: CandlestickData[] = candles
      .map((c) => ({
        time: (new Date(c.time.replace(" ", "T")).getTime() / 1000) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    candleSeriesRef.current.setData(candleData);

    const volData: HistogramData[] = candles
      .map((c) => ({
        time: (new Date(c.time.replace(" ", "T")).getTime() / 1000) as Time,
        value: c.volume,
        color: c.close >= c.open ? withAlpha(palette.POSITIVE, 0.9) : withAlpha(palette.NEGATIVE, 0.9),
      }))
      .sort((a: any, b: any) => (a.time as number) - (b.time as number));
    volumeSeriesRef.current.setData(volData as any);
  }, [candles]);

  // markers — lightweight-charts v5 uses createSeriesMarkers plugin, not series.setMarkers
  useEffect(() => {
    if (!markersRef.current) return;
    const markers = trades
      .filter((t) => t.entry_time)
      .map((t) => {
        const time = (new Date(t.entry_time.replace(" ", "T")).getTime() / 1000) as Time;
        const isBuy = t.side === "BUY";
        const isHighlighted = highlightedTradeId === (t as any).id;
        return {
          time,
          position: isBuy ? "belowBar" as const : "aboveBar" as const,
          color: isBuy ? palette.POSITIVE : palette.NEGATIVE,
          shape: isBuy ? "arrowUp" as const : "arrowDown" as const,
          text: isHighlighted ? `★ ${t.side} ${t.entry_price}` : `${t.side}`,
          size: isHighlighted ? 2 : 1,
        };
      });
    const exitMarkers = trades
      .filter((t) => t.exit_time)
      .map((t) => {
        const time = (new Date(t.exit_time.replace(" ", "T")).getTime() / 1000) as Time;
        const isHighlighted = highlightedTradeId === (t as any).id;
        return {
          time,
          position: "aboveBar" as const,
          color: t.exit_reason === "TP" ? palette.POSITIVE : t.exit_reason === "SL" ? palette.NEGATIVE : palette.MARKER_EOD,
          shape: "circle" as const,
          text: isHighlighted ? `✕ ${t.exit_reason} ${t.exit_price}` : `${t.exit_reason}`,
        };
      });
    const allMarkers = [...markers, ...exitMarkers].sort((a, b) => (a.time as number) - (b.time as number));
    try {
      markersRef.current.setMarkers(allMarkers as any);
    } catch {}
  }, [trades, highlightedTradeId]);

  // fit once on mount / symbol change
  useEffect(() => {
    if (candles.length) chartRef.current?.timeScale().fitContent();
  }, [candles.length === 0 ? 0 : candles[0]?.time]);

  return (
    <Box sx={{ width: "100%", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box ref={containerRef} sx={{ width: "100%", height, flex: 1, minHeight: 0 }} data-testid="tradingview-chart" />
    </Box>
  );
}
