import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type LineWidth,
} from "lightweight-charts";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type { ReplayCandle, ReplayTrade } from "@/types/replay";
import type { MarkLineData, UnifiedLivePosition } from "@/utils/chart/types";

export interface TradingViewChartProps {
  candles: ReplayCandle[];
  trades?: ReplayTrade[];
  highlightedTradeId?: number | null;
  onTradeClick?: (id: number) => void;
  height?: number;
  /** Horizontal levels (ORB high/low, pivots, 52W high/low, highlighted SL/TP) */
  markLines?: MarkLineData[];
  /** EMA overlays, each aligned index-wise to `candles` */
  emaData?: { label: string; color: string; data: (number | null)[] }[];
  /** Active position entry / SL / TP levels */
  livePosition?: UnifiedLivePosition;
}

const toTime = (t: string): Time => (new Date(t.replace(" ", "T")).getTime() / 1000) as Time;

function toLineStyle(type: string): LineStyle {
  switch (type) {
    case "dashed":
      return LineStyle.Dashed;
    case "dotted":
      return LineStyle.Dotted;
    case "largeDashed":
      return LineStyle.LargeDashed;
    case "sparseDotted":
      return LineStyle.SparseDotted;
    default:
      return LineStyle.Solid;
  }
}

function clampWidth(w?: number): LineWidth {
  const n = Math.round(w ?? 1);
  return (n < 1 ? 1 : n > 4 ? 4 : n) as LineWidth;
}

export function TradingViewChart({
  candles,
  trades = [],
  highlightedTradeId,
  height,
  markLines,
  emaData,
  livePosition,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const emaSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const heightRef = useRef(height);

  // create chart once — not on height/candles.
  // With an explicit height -> fixed size (page-level charts). Without -> autoSize
  // so the chart fills its flex container (paper Trade History panel).
  useEffect(() => {
    if (!containerRef.current) return;
    const fixedHeight = heightRef.current;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: palette.BG }, textColor: palette.TEXT },
      grid: { vertLines: { color: palette.BORDER }, horzLines: { color: palette.BORDER } },
      ...(fixedHeight != null
        ? { width: containerRef.current.clientWidth, height: fixedHeight }
        : { autoSize: true }),
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

    let ro: ResizeObserver | null = null;
    if (fixedHeight != null) {
      ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      ro.observe(containerRef.current);
    }

    return () => {
      ro?.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
      emaSeriesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // height updates without recreate (fixed-height mode only)
  useEffect(() => {
    heightRef.current = height;
    if (height != null) chartRef.current?.applyOptions({ height });
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
        time: toTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    candleSeriesRef.current.setData(candleData);

    const volData: HistogramData[] = candles
      .map((c) => ({
        time: toTime(c.time),
        value: c.volume,
        color: c.close >= c.open ? withAlpha(palette.POSITIVE, 0.9) : withAlpha(palette.NEGATIVE, 0.9),
      }))
      .sort((a: any, b: any) => (a.time as number) - (b.time as number));
    volumeSeriesRef.current.setData(volData as any);
  }, [candles]);

  // horizontal overlay levels: ORB / pivots / 52W / highlighted SL-TP / position
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    priceLinesRef.current.forEach((l) => {
      try {
        series.removePriceLine(l);
      } catch {
        /* noop */
      }
    });
    priceLinesRef.current = [];

    const add = (price: number | undefined, color: string, width: number | undefined, style: LineStyle, title: string) => {
      if (price == null || !isFinite(price) || price <= 0) return;
      const line = series.createPriceLine({
        price,
        color,
        lineWidth: clampWidth(width),
        lineStyle: style,
        axisLabelVisible: true,
        title,
      });
      priceLinesRef.current.push(line);
    };

    (markLines || []).forEach((ml) => {
      add(ml.yAxis, ml.lineStyle.color, ml.lineStyle.width, toLineStyle(ml.lineStyle.type), ml.label.formatter);
    });

    if (livePosition) {
      add(livePosition.entry_price, palette.PRIMARY, 1, LineStyle.Solid, `Entry ${livePosition.entry_price}`);
      if (livePosition.stop_loss && livePosition.stop_loss > 0) {
        add(livePosition.stop_loss, palette.NEGATIVE, 1, LineStyle.Dashed, `SL ${livePosition.stop_loss}`);
      }
      if (livePosition.take_profit && livePosition.take_profit > 0) {
        add(livePosition.take_profit, palette.POSITIVE, 1, LineStyle.Dashed, `TP ${livePosition.take_profit}`);
      }
    }
  }, [markLines, livePosition]);

  // EMA overlays (line series aligned to candles)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    emaSeriesRef.current.forEach((s) => {
      try {
        chart.removeSeries(s);
      } catch {
        /* noop */
      }
    });
    emaSeriesRef.current = [];

    if (!emaData || emaData.length === 0 || candles.length === 0) return;

    emaData.forEach((ema) => {
      const series = chart.addSeries(LineSeries, {
        color: ema.color,
        lineWidth: 1 as LineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const data: LineData[] = ema.data
        .map((v, i) =>
          v == null || !isFinite(v) || !candles[i] ? null : { time: toTime(candles[i].time), value: v },
        )
        .filter((d): d is LineData => d !== null)
        .sort((a, b) => (a.time as number) - (b.time as number));
      series.setData(data);
      emaSeriesRef.current.push(series);
    });
  }, [emaData, candles]);

  // markers — lightweight-charts v5 uses createSeriesMarkers plugin, not series.setMarkers
  useEffect(() => {
    if (!markersRef.current) return;
    const markers = trades
      .filter((t) => t.entry_time)
      .map((t) => {
        const isBuy = t.side === "BUY";
        const isHighlighted = highlightedTradeId === (t as any).id;
        return {
          time: toTime(t.entry_time),
          position: isBuy ? ("belowBar" as const) : ("aboveBar" as const),
          color: isBuy ? palette.POSITIVE : palette.NEGATIVE,
          shape: isBuy ? ("arrowUp" as const) : ("arrowDown" as const),
          text: isHighlighted ? `★ ${t.side} ${t.entry_price}` : `${t.side}`,
          size: isHighlighted ? 2 : 1,
        };
      });
    const exitMarkers = trades
      .filter((t) => t.exit_time)
      .map((t) => {
        const isHighlighted = highlightedTradeId === (t as any).id;
        return {
          time: toTime(t.exit_time),
          position: "aboveBar" as const,
          color: t.exit_reason === "TP" ? palette.POSITIVE : t.exit_reason === "SL" ? palette.NEGATIVE : palette.MARKER_EOD,
          shape: "circle" as const,
          text: isHighlighted ? `✕ ${t.exit_reason} ${t.exit_price}` : `${t.exit_reason}`,
        };
      });
    const allMarkers = [...markers, ...exitMarkers].sort((a, b) => (a.time as number) - (b.time as number));
    try {
      markersRef.current.setMarkers(allMarkers as any);
    } catch {
      /* noop */
    }
  }, [trades, highlightedTradeId]);

  // fit once on mount / symbol change
  useEffect(() => {
    if (candles.length) chartRef.current?.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length === 0 ? 0 : candles[0]?.time]);

  return (
    <Box sx={{ width: "100%", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box ref={containerRef} sx={{ width: "100%", flex: 1, minHeight: 0, position: "relative", ...(height != null ? { height } : {}) }} data-testid="tradingview-chart" />
    </Box>
  );
}
