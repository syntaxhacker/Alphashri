import { Show, createContext, createEffect, onCleanup, onMount, type JSX, useContext } from "solid-js";
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
  Button,
  Portal,
  alpha,
} from "@/ui";
import * as palette from "@/ui/palette";
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
  /** Transport failure message — distinct from a successful response with zero candles. */
  error: string | null;
}

interface ExpandedState {
  visible: boolean;
  symbol: string | null;
  data: ChartPreviewData | null;
  loading: boolean;
  /** Transport failure message — distinct from a successful response with zero candles. */
  error: string | null;
  timeframe: number;
  orMinutes: number;
}

const RETRY_MESSAGE = "Couldn't load chart";

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
    error: null,
  });

  const [expandedState, setExpandedState] = createStore<ExpandedState>({
    visible: false,
    symbol: null,
    data: null,
    loading: false,
    error: null,
    timeframe: 15,
    orMinutes: 45,
  });

  let hoverTimer: number | null = null;
  const hoverChartBox: ChartInstanceBox = { current: null };
  const expandedChartBox: ChartInstanceBox = { current: null };
  // Monotonic token so a slow timeframe/orMinutes response cannot overwrite a newer one.
  let expandedRequestId = 0;

  const loadHoverData = async (symbol: string) => {
    try {
      const data = await fetchChartPreview(symbol, 15, 1, 45);
      if (hoverState.symbol !== symbol) return;
      if (!data) {
        setHoverState({ data: null, loading: false, error: RETRY_MESSAGE });
        return;
      }
      if (data.error) {
        setHoverState({ data: null, loading: false, error: data.error });
        return;
      }
      setHoverState({ data, loading: false, error: null });
    } catch {
      if (hoverState.symbol !== symbol) return;
      setHoverState({ data: null, loading: false, error: RETRY_MESSAGE });
    }
  };

  const showPreviewChart = (event: MouseEvent, symbol: string) => {
    // Prefetch the ECharts engine on hover so it's ready when the preview
    // actually renders (no-op once cached on `window`).
    void loadEcharts();
    // Immediately clear any pending show to prevent stale previews
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hoverTimer = window.setTimeout(() => {
      setHoverState({
        visible: true,
        symbol,
        x: event.clientX + 15,
        y: event.clientY + 15,
        loading: true,
        data: null,
        error: null,
      });
      void loadHoverData(symbol);
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
    setHoverState({
      visible: false,
      symbol: null,
      x: 0,
      y: 0,
      data: null,
      loading: false,
      error: null,
    });
  };

  const fetchExpandedData = async (symbol: string, tf: number, orMinutes: number) => {
    const requestId = ++expandedRequestId;
    setExpandedState({ loading: true, data: null, error: null });
    try {
      const data = await fetchChartPreview(symbol, tf, 5, orMinutes);
      if (requestId !== expandedRequestId) return;
      if (!data) {
        setExpandedState({ loading: false, error: RETRY_MESSAGE });
        return;
      }
      if (data.error) {
        notifyErrorOnce(notify, data.error);
        setExpandedState({ loading: false, error: data.error });
        return;
      }
      setExpandedState({ data, loading: false, error: null });
    } catch {
      if (requestId !== expandedRequestId) return;
      setExpandedState({ loading: false, error: RETRY_MESSAGE });
    }
  };

  const retryExpanded = () => {
    const symbol = expandedState.symbol;
    if (symbol) void fetchExpandedData(symbol, expandedState.timeframe, expandedState.orMinutes);
  };

  const toggleExpandedChart = (symbol: string) => {
    void loadEcharts();
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hidePreviewChart();
    const wasOpenForSymbol = expandedState.visible && expandedState.symbol === symbol;
    if (wasOpenForSymbol) {
      if (expandedChartBox.current) {
        expandedChartBox.current.dispose();
        expandedChartBox.current = null;
      }
      expandedRequestId += 1;
      setExpandedState({
        visible: false,
        symbol: null,
        data: null,
        loading: false,
        error: null,
      });
      return;
    }
    const timeframe = 15;
    const orMinutes = 45;
    setExpandedState({
      visible: true,
      symbol,
      data: null,
      loading: true,
      error: null,
      timeframe,
      orMinutes,
    });
    void fetchExpandedData(symbol, timeframe, orMinutes);
  };

  const collapseChart = () => {
    expandedRequestId += 1;
    if (expandedChartBox.current) {
      expandedChartBox.current.dispose();
      expandedChartBox.current = null;
    }
    setExpandedState({ visible: false, symbol: null, data: null, loading: false, error: null });
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
            error={hoverState.error}
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
            error={expandedState.error}
            timeframe={expandedState.timeframe}
            orMinutes={expandedState.orMinutes}
            chartBox={expandedChartBox}
            onTimeframeChange={setTimeframe}
            onOrMinutesChange={setOrMinutes}
            onClose={collapseChart}
            onOpenFull={openFullChart}
            onRetry={retryExpanded}
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
  error: string | null;
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

interface ExpandedPanelProps {
  symbol: string;
  data: ChartPreviewData | null;
  loading: boolean;
  error: string | null;
  timeframe: number;
  orMinutes: number;
  chartBox: ChartInstanceBox;
  onTimeframeChange: (val: string | null) => void;
  onOrMinutesChange: (val: string | null) => void;
  onClose: () => void;
  onOpenFull: (symbol: string) => void;
  onRetry: () => void;
}

function ExpandedPanel(props: ExpandedPanelProps) {
  let containerRef: HTMLDivElement | undefined;
  let panelRef: HTMLElement | undefined;

  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => panelRef?.focus());
    // Capture phase with a popup check, mirroring Modal: an open timeframe
    // select owns Escape first, or one keypress would close both.
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute("role") === "combobox" && active.getAttribute("aria-expanded") === "true") return;
      if (active?.closest('[role="listbox"],[role="menu"]')) return;
      if (panelRef?.querySelector('[role="combobox"][aria-expanded="true"]')) return;
      props.onClose();
    };
    document.addEventListener("keydown", onDocKey, true);
    // aria-modal promises the page behind is inert; without this the user can
    // scroll the underlying list while the dialog is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    onCleanup(() => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onDocKey, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    });
  });

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
    <>
      <div
        data-testid="preview-chart-backdrop"
        className="fixed inset-0"
        style={{ "z-index": 9999, "background-color": alpha(palette.BG, 0.55) }}
        onClick={props.onClose}
      />
      <Paper
        ref={(el: HTMLElement) => (panelRef = el)}
        shadow="xl"
        p={0}
        pos="fixed"
        top="50%"
        left="50%"
        w={650}
        h={480}
        role="dialog"
        aria-modal="true"
        aria-label={`${props.symbol} preview chart`}
        tabIndex={-1}
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
          <Show when={!props.loading && props.error}>
            <Box
              pos="absolute"
              inset={0}
              style={{
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                "justify-content": "center",
                gap: "8px",
              }}
              data-testid="preview-chart-expanded-error"
            >
              <Text c="error" fw={600}>
                {RETRY_MESSAGE}
              </Text>
              <Show when={props.error !== RETRY_MESSAGE}>
                <Text size="xs" c="dimmed">
                  {props.error}
                </Text>
              </Show>
              <Button variant="outline" size="xs" onClick={props.onRetry} data-testid="preview-chart-retry">
                Retry
              </Button>
            </Box>
          </Show>
          <Show when={!props.loading && !props.error && (props.data?.candles.length ?? 0) === 0}>
            <Box
              pos="absolute"
              inset={0}
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
              }}
              data-testid="preview-chart-expanded-empty"
            >
              <Text c="dimmed">No data available</Text>
            </Box>
          </Show>
          <Show when={!props.loading && !props.error && (props.data?.candles.length ?? 0) > 0}>
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
    </>
  );
}
