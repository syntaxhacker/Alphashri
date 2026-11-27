import { Show, createEffect, onCleanup } from "solid-js";
import { Paper, Group, Text, Box, Loader } from "@/ui";
import type { ChartPreviewData } from "../../../api/chartPreview";
import { buildChartOption } from "../../chart/chartRenderer";
import { loadEcharts } from "../../../utils/loadEcharts";
import { RETRY_MESSAGE } from "./request";
import type { ChartInstanceBox } from "./types";

interface HoverPreviewProps {
  symbol: string;
  x: number;
  y: number;
  data: ChartPreviewData | null;
  loading: boolean;
  error: string | null;
  chartBox: ChartInstanceBox;
}

export function HoverPreview(props: HoverPreviewProps) {
  let paperRef: HTMLDivElement | undefined;

  const adjustedX = () => Math.min(props.x, window.innerWidth - 340);
  const adjustedY = () => Math.min(props.y, window.innerHeight - 220);

  createEffect(() => {
    const data = props.data;
    const container = paperRef;
    if (!data || !container) return;

    const chartOption = buildChartOption({
      symbol: data.symbol,
      candles: data.candles,
      orb_zones: data.orb_zones,
      pivot_levels: data.pivot_levels,
      high_52w: data.high_52w,
      size: "preview",
      showPivots: false,
      show52wHigh: false,
    });

    if (!chartOption) return;

    let cancelled = false;
    // ECharts is loaded lazily (dynamic import, cached on `window`), so the
    // preview chart renders as soon as the engine is available instead of
    // requiring it in the initial shell.
    void loadEcharts().then((echartsLib) => {
      if (cancelled || !echartsLib) return;

      const chartDiv = container.querySelector(".echarts-container") as HTMLElement | null;
      if (!chartDiv) return;

      if (props.chartBox.current) {
        props.chartBox.current.dispose();
        props.chartBox.current = null;
      }

      const instance = echartsLib.init(chartDiv);
      props.chartBox.current = instance;
      instance.setOption(chartOption);
      instance.resize();
    });

    onCleanup(() => {
      cancelled = true;
      if (props.chartBox.current) {
        props.chartBox.current.dispose();
        props.chartBox.current = null;
      }
    });
  });

  return (
    <Paper
      ref={(el: HTMLDivElement) => (paperRef = el)}
      shadow="xl"
      p={0}
      pos="fixed"
      left={adjustedX()}
      top={adjustedY()}
      w={320}
      h={200}
      style={{ "z-index": 9999, "pointer-events": "none", overflow: "hidden" }}
      data-testid="preview-chart-hover"
    >
      <Group gap={6} px="xs" py={4}>
        <Text size="xs" fw={600} c="primary">
          {props.symbol}
        </Text>
        <Text size="xs" c="dimmed">
          15m
        </Text>
      </Group>
      <Box h={160} pos="relative">
        <Show when={props.loading}>
          <Box
            pos="absolute"
            inset={0}
            style={{ display: "flex", "align-items": "center", "justify-content": "center" }}
          >
            <Loader size="sm" />
          </Box>
        </Show>
        {/* The hover card is pointer-events:none, so an inline retry would be unclickable;
            leaving the symbol and hovering again is the retry path. */}
        <Show when={!props.loading && props.error}>
          <Box
            pos="absolute"
            inset={0}
            style={{
              display: "flex",
              "flex-direction": "column",
              "align-items": "center",
              "justify-content": "center",
              gap: "4px",
            }}
            data-testid="preview-chart-hover-error"
          >
            <Text size="xs" c="error">
              {RETRY_MESSAGE}
            </Text>
            <Text size="xs" c="dimmed">
              Hover away and back to retry
            </Text>
          </Box>
        </Show>
        <Show when={!props.loading && !props.error && (props.data?.candles.length ?? 0) === 0}>
          <Box
            pos="absolute"
            inset={0}
            style={{ display: "flex", "align-items": "center", "justify-content": "center" }}
            data-testid="preview-chart-hover-empty"
          >
            <Text size="xs" c="dimmed">
              No data
            </Text>
          </Box>
        </Show>
        <Show when={!props.loading && !props.error && (props.data?.candles.length ?? 0) > 0}>
          <div className="echarts-container" style={{ width: "320px", height: "160px", "min-height": "160px" }} />
        </Show>
      </Box>
    </Paper>
  );
}
