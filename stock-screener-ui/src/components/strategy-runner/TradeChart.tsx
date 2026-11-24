import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Box, Text, typeSize } from "@/ui";
import { loadEcharts } from "../../utils/loadEcharts";
import {
  CANDLESTICK_ITEM_STYLE,
} from "../../utils/chartUtils";
import {
  CHART_AVG_ENTRY,
  MARKER_TP,
  MARKER_SL,
  TRADING_GREEN,
  TRADING_RED,
} from "../../config/colors";
import { fetchChartPreview, previewDaysForDate, type PreviewCandle } from "../../api/chartPreview";

interface TradeChartProps {
  symbol: string;
  date: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  stopLoss?: number;
  takeProfit?: number;
  height?: number;
}

export function TradeChart(props: TradeChartProps) {
  let chartRef: HTMLDivElement | undefined;
  let instance: any = null;
  let disposed = false;
  const [status, setStatus] = createSignal<"loading" | "ready" | "empty">("loading");

  const height = () => props.height ?? 300;

  onMount(() => {
    const handleResize = () => instance?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));

    void (async () => {
      const echartsLib = await loadEcharts();
      if (disposed || !echartsLib) return;

      const data = await fetchChartPreview(props.symbol, 1, previewDaysForDate(props.date), 45);
      if (disposed) return;

      const candles: PreviewCandle[] = data?.candles?.length ? data.candles : [];
      if (!candles.length || !chartRef) {
        setStatus("empty");
        return;
      }

      instance = echartsLib.init(chartRef);
      if (disposed || !instance) return;

      const times = candles.map((c) => c.time?.slice(11, 16) || "");
      const ohlc = candles.map((c) => [c.open, c.close, c.low, c.high]);

      const entryIdx = candles.findIndex((c) => c.time >= props.entryTime);
      const exitIdx = candles.findIndex((c) => c.time >= props.exitTime);

      const option = {
        tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
        grid: { left: 50, right: 20, top: 40, bottom: 30 },
        xAxis: { data: times, axisLabel: { rotate: 45, fontSize: typeSize("micro") }, show: entryIdx >= 0 },
        yAxis: {
          scale: true,
          min: (value: any) => Math.min(value.min * 0.995, props.entryPrice * 0.99),
          max: (value: any) => Math.max(value.max * 1.005, props.exitPrice * 1.01),
        },
        series: [{
          type: "candlestick",
          data: ohlc,
          itemStyle: CANDLESTICK_ITEM_STYLE,
          markLine: {
            silent: true,
            data: [
              { yAxis: props.entryPrice, label: { formatter: "Entry " + props.entryPrice, position: "insideEndTop" }, lineStyle: { color: CHART_AVG_ENTRY, type: "dashed" } },
              { yAxis: props.exitPrice, label: { formatter: "Exit " + props.exitPrice, position: "insideEndBottom" }, lineStyle: { color: props.entryPrice <= props.exitPrice ? TRADING_GREEN : TRADING_RED, type: "solid" } },
              ...(props.stopLoss != null && props.stopLoss > 0 ? [{ yAxis: props.stopLoss, label: { formatter: "SL " + props.stopLoss, position: "insideEndTop" }, lineStyle: { color: MARKER_SL, type: "dotted" } }] : []),
              ...(props.takeProfit != null && props.takeProfit > 0 ? [{ yAxis: props.takeProfit, label: { formatter: "TP " + props.takeProfit, position: "insideEndBottom" }, lineStyle: { color: MARKER_TP, type: "dotted" } }] : []),
            ],
          },
        }],
      };

      instance.setOption(option, true);
      instance.dispatchAction({ type: "dataZoom", startValue: Math.max(0, (entryIdx || 0) - 30), endValue: Math.min(times.length - 1, (exitIdx || times.length - 1) + 30) });
      setStatus("ready");
    })().catch(() => {
      if (!disposed) setStatus("empty");
    });
  });

  onCleanup(() => {
    disposed = true;
    instance?.dispose();
    instance = null;
  });

  return (
    <Box
      style={{ width: "100%", height: `${height()}px`, "min-height": `${height()}px` }}
      data-testid="trade-chart"
    >
      <Show
        when={status() !== "empty"}
        fallback={
          <Text size="xs" c="dimmed" ta="center" data-testid="trade-chart-empty">
            No chart data for {props.symbol} on {props.date}
          </Text>
        }
      >
        <div ref={(el) => (chartRef = el)} style={{ width: "100%", height: "100%" }} />
      </Show>
    </Box>
  );
}
