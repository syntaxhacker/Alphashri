import { Show, createContext, createEffect, onCleanup, type JSX, useContext } from "solid-js";
import { createStore } from "solid-js/store";
import { useNavigate } from "@solidjs/router";
import {
  Paper,
  Group,
  Text,
  Select,
  CloseButton,
  Loader,
  ActionIcon,
  Box,
  Portal,
} from "@/ui";
import { IconArrowsMaximize } from "./Icons";
import { fetchChartPreview, type ChartPreviewData } from "../../api/chartPreview";
import { buildChartOption } from "../chart/chartRenderer";
import { loadEcharts } from "../../utils/loadEcharts";
import { useNotification } from "../../hooks/useNotification";
import { TIMEFRAMES, OR_MINUTES_OPTIONS } from "../../config/constants";

let lastErrorNotified = "";
let lastErrorTime = 0;
const ERROR_DEDUP_MS = 5000;

function notifyErrorOnce(notify: { error: (t: string, m: string) => void }, message: string) {
  const now = Date.now();
  if (message === lastErrorNotified && now - lastErrorTime < ERROR_DEDUP_MS) return;
  lastErrorNotified = message;
  lastErrorTime = now;
  notify.error("Chart Error", message);
}

interface PreviewChartContextValue {
  showPreviewChart: (event: MouseEvent, symbol: string) => void;
  hidePreviewChart: () => void;
  toggleExpandedChart: (symbol: string) => void;
  collapseChart: () => void;
}

const PreviewChartContext = createContext<PreviewChartContextValue>({
  showPreviewChart: () => {},
  hidePreviewChart: () => {},
  toggleExpandedChart: () => {},
  collapseChart: () => {},
});

export function usePreviewChart() {
  return useContext(PreviewChartContext);
}

/** Box passed to the chart children so both sides can (re)create/dispose the ECharts instance. */
export type ChartInstanceBox = { current: EChartsInstance | null };

interface HoverState {
  visible: boolean;
  symbol: string | null;
  x: number;
  y: number;
  data: ChartPreviewData | null;
  loading: boolean;
}

interface ExpandedState {
  visible: boolean;
  symbol: string | null;
  data: ChartPreviewData | null;
  loading: boolean;
  timeframe: number;
  orMinutes: number;
}

export function PreviewChartProvider(props: { children?: JSX.Element }) {
  const notify = useNotification();
  const navigate = useNavigate();

  const [hoverState, setHoverState] = createStore<HoverState>({
    visible: false,
    symbol: null,
    x: 0,
    y: 0,
    data: null,
    loading: false,
  });

  const [expandedState, setExpandedState] = createStore<ExpandedState>({
    visible: false,
    symbol: null,
    data: null,
    loading: false,
    timeframe: 15,
    orMinutes: 45,
  });

  let hoverTimer: number | null = null;
  const hoverChartBox: ChartInstanceBox = { current: null };
  const expandedChartBox: ChartInstanceBox = { current: null };

  const showPreviewChart = (event: MouseEvent, symbol: string) => {
    // Prefetch the ECharts engine on hover so it's ready when the preview
    // actually renders (no-op once cached on `window`).
    void loadEcharts();
    // Immediately clear any pending show to prevent stale previews
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hoverTimer = window.setTimeout(async () => {
      // Set visible state with symbol
      setHoverState({
        visible: true,
        symbol,
        x: event.clientX + 15,
        y: event.clientY + 15,
        loading: true,
        data: null,
      });
      try {
        const data = await fetchChartPreview(symbol, 15, 1, 45);
        if (hoverState.symbol !== symbol) return;
        setHoverState({ data: data ?? null, loading: false });
      } catch {
        setHoverState({ loading: false });
      }
    }, 300);
  };

  const hidePreviewChart = () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (hoverChartBox.current) {
      hoverChartBox.current.dispose();
      hoverChartBox.current = null;
    }
    setHoverState({ visible: false, symbol: null, x: 0, y: 0, data: null, loading: false });
  };

  const fetchExpandedData = async (symbol: string, tf: number, orMinutes: number) => {
    setExpandedState({ loading: true, data: null });
    try {
      const data = await fetchChartPreview(symbol, tf, 5, orMinutes);
      if (data?.error) {
        notifyErrorOnce(notify, data.error);
        setExpandedState({ loading: false });
        return;
      }
      setExpandedState({ data: data ?? null, loading: false });
    } catch {
      setExpandedState({ loading: false });
    }
  };

  const toggleExpandedChart = (symbol: string) => {
    // Prefetch the ECharts engine when the expanded panel opens.
    void loadEcharts();
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hidePreviewChart();
    setExpandedState((prev) => {
      if (prev.visible && prev.symbol === symbol) {
        if (expandedChartBox.current) {
          expandedChartBox.current.dispose();
          expandedChartBox.current = null;
        }
        return {
          visible: false,
          symbol: null,
          data: null,
          loading: false,
          timeframe: prev.timeframe,
          orMinutes: prev.orMinutes,
        };
      }
      return { visible: true, symbol, data: null, loading: true, timeframe: 15, orMinutes: 45 };
    });
  };

  const collapseChart = () => {
    if (expandedChartBox.current) {
      expandedChartBox.current.dispose();
      expandedChartBox.current = null;
    }
    setExpandedState({ visible: false, symbol: null, data: null, loading: false });
  };

  const setTimeframe = (tf: string | null) => {
    const val = parseInt(tf ?? "15");
    setExpandedState({ timeframe: val });
    const symbol = expandedState.symbol;
    if (symbol) {
      void fetchExpandedData(symbol, val, expandedState.orMinutes);
    }
  };

  const setOrMinutes = (or: string | null) => {
    const val = parseInt(or ?? "45");
    setExpandedState({ orMinutes: val });
    const symbol = expandedState.symbol;
    if (symbol) {
      void fetchExpandedData(symbol, expandedState.timeframe, val);
    }
  };

  const openFullChart = (symbol: string) => {
    collapseChart();
    navigate(`/chart/${symbol}`);
  };

  const ctxValue: PreviewChartContextValue = {
    showPreviewChart,
    hidePreviewChart,
    toggleExpandedChart,
    collapseChart,
  };

  return (
    <PreviewChartContext.Provider value={ctxValue}>
      {props.children}

      <Show when={hoverState.visible && hoverState.symbol}>
        <Portal>
          <HoverPreview
            symbol={hoverState.symbol!}
            x={hoverState.x}
            y={hoverState.y}
            data={hoverState.data}
            loading={hoverState.loading}
            chartBox={hoverChartBox}
          />
        </Portal>
      </Show>

      <Show when={expandedState.visible && expandedState.symbol}>
        <Portal>
          <ExpandedPanel
            symbol={expandedState.symbol!}
            data={expandedState.data}
            loading={expandedState.loading}
            timeframe={expandedState.timeframe}
            orMinutes={expandedState.orMinutes}
            chartBox={expandedChartBox}
            onTimeframeChange={setTimeframe}
            onOrMinutesChange={setOrMinutes}
            onClose={collapseChart}
            onOpenFull={openFullChart}
          />
        </Portal>
      </Show>
    </PreviewChartContext.Provider>
  );
}

interface HoverPreviewProps {
  symbol: string;
  x: number;
  y: number;
  data: ChartPreviewData | null;
  loading: boolean;
  chartBox: ChartInstanceBox;
}

function HoverPreview(props: HoverPreviewProps) {
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
        <Show when={!props.loading && !props.data?.candles.length}>
          <Box
            pos="absolute"
            inset={0}
            style={{ display: "flex", "align-items": "center", "justify-content": "center" }}
          >
            <Text size="xs" c="dimmed">
              No data
            </Text>
          </Box>
        </Show>
        <Show when={!props.loading && (props.data?.candles.length ?? 0) > 0}>
          <div className="echarts-container" style={{ width: "320px", height: "160px", "min-height": "160px" }} />
        </Show>
      </Box>
    </Paper>
  );
}

interface ExpandedPanelProps {
  symbol: string;
  data: ChartPreviewData | null;
  loading: boolean;
  timeframe: number;
  orMinutes: number;
  chartBox: ChartInstanceBox;
  onTimeframeChange: (val: string | null) => void;
  onOrMinutesChange: (val: string | null) => void;
  onClose: () => void;
  onOpenFull: (symbol: string) => void;
}

function ExpandedPanel(props: ExpandedPanelProps) {
  let containerRef: HTMLDivElement | undefined;

  createEffect(() => {
    const data = props.data;
    const container = containerRef;
    if (!data || !container) return;

    const chartOption = buildChartOption({
      symbol: data.symbol,
      candles: data.candles,
      orb_zones: data.orb_zones,
      pivot_levels: data.pivot_levels,
      high_52w: data.high_52w,
      size: "expanded",
      showPivots: true,
      show52wHigh: true,
    });

    if (!chartOption) return;

    let cancelled = false;
    const handleResize = () => props.chartBox.current?.resize();

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

      window.addEventListener("resize", handleResize);
    });

    onCleanup(() => {
      cancelled = true;
      window.removeEventListener("resize", handleResize);
      if (props.chartBox.current) {
        props.chartBox.current.dispose();
        props.chartBox.current = null;
      }
    });
  });

  return (
    <Paper
      shadow="xl"
      p={0}
      pos="fixed"
      top="50%"
      left="50%"
      w={650}
      h={480}
      style={{
        "z-index": 10000,
        transform: "translate(-50%, -50%)",
        display: "flex",
        "flex-direction": "column",
      }}
      data-testid="preview-chart-expanded"
    >
      <Group gap="md" px="md" py="xs" className="flex-shrink-0">
        <Text size="lg" fw={600} c="primary">
          {props.symbol}
          {props.data?.candles.length ? ` (${props.data.candles.length} candles)` : ""}
        </Text>
        <Select
          size="xs"
          w={70}
          data={TIMEFRAMES.map((t) => ({ value: String(t.value), label: t.label }))}
          value={String(props.timeframe)}
          onChange={props.onTimeframeChange}
          data-testid="preview-tf-select"
        />
        <Select
          size="xs"
          w={90}
          data={OR_MINUTES_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          value={String(props.orMinutes)}
          onChange={props.onOrMinutesChange}
          data-testid="preview-or-select"
        />
        <CloseButton className="ml-auto" size="md" onClick={props.onClose} data-testid="preview-close-btn" />
      </Group>

      <Box
        ref={(el: HTMLDivElement) => (containerRef = el)}
        style={{ flex: 1, padding: "8px", "min-height": "0px", position: "relative" }}
      >
        <Show when={props.loading}>
          <Box
            pos="absolute"
            inset={0}
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
            }}
          >
            <Loader />
          </Box>
        </Show>
        <Show when={!props.loading && (props.data?.candles.length ?? 0) === 0}>
          <Box
            pos="absolute"
            inset={0}
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
            }}
          >
            <Text c="dimmed">No data available</Text>
          </Box>
        </Show>
        <Show when={!props.loading && (props.data?.candles.length ?? 0) > 0}>
          <div
            className="echarts-container"
            style={{ width: "100%", height: "100%", "min-height": "0px" }}
          />
        </Show>
      </Box>

      <Group justify="flex-end" px="md" py="xs" className="flex-shrink-0">
        <ActionIcon
          variant="subtle"
          color="primary"
          onClick={() => props.onOpenFull(props.symbol)}
          data-testid="preview-open-full-btn"
        >
          <IconArrowsMaximize size={16} />
        </ActionIcon>
        <Text
          size="xs"
          c="primary"
          style={{ cursor: "pointer" }}
          onClick={() => props.onOpenFull(props.symbol)}
          data-testid="preview-open-full-link"
        >
          Open Full Chart
        </Text>
      </Group>
    </Paper>
  );
}
