import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
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
import { IconArrowsMaximize } from "@tabler/icons-react";
import { fetchChartPreview, type ChartPreviewData } from "../../api/chartPreview";
import { buildChartOption } from "../chart/chartRenderer";
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
  showPreviewChart: (event: React.MouseEvent, symbol: string) => void;
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

export function PreviewChartProvider({ children }: { children: ReactNode }) {
  const notify = useNotification();
  const navigate = useNavigate();

  const [hoverState, setHoverState] = useState<{
    visible: boolean;
    symbol: string | null;
    x: number;
    y: number;
    data: ChartPreviewData | null;
    loading: boolean;
  }>({ visible: false, symbol: null, x: 0, y: 0, data: null, loading: false });

  const [expandedState, setExpandedState] = useState<{
    visible: boolean;
    symbol: string | null;
    data: ChartPreviewData | null;
    loading: boolean;
    timeframe: number;
    orMinutes: number;
  }>({ visible: false, symbol: null, data: null, loading: false, timeframe: 15, orMinutes: 45 });

  const hoverTimerRef = useRef<number | null>(null);
  const hoverChartRef = useRef<EChartsInstance | null>(null);
  const expandedChartRef = useRef<EChartsInstance | null>(null);

  const showPreviewChart = useCallback((event: React.MouseEvent, symbol: string) => {
    // Immediately clear any pending show to prevent stale previews
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    hoverTimerRef.current = window.setTimeout(async () => {
      // Set visible state with symbol
      setHoverState((prev) => ({
        ...prev,
        visible: true,
        symbol,
        x: event.clientX + 15,
        y: event.clientY + 15,
        loading: true,
        data: null,
      }));
      try {
        const data = await fetchChartPreview(symbol, 15, 1, 45);
        setHoverState((prev) => {
          if (prev.symbol !== symbol) {
            return prev;
          }
          return { ...prev, data: data ?? null, loading: false };
        });
      } catch {
        setHoverState((prev) => ({ ...prev, loading: false }));
      }
    }, 300);
  }, []);

  const hidePreviewChart = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (hoverChartRef.current) {
      hoverChartRef.current.dispose();
      hoverChartRef.current = null;
    }
    setHoverState({ visible: false, symbol: null, x: 0, y: 0, data: null, loading: false });
  }, []);

  const fetchExpandedData = useCallback(
    async (symbol: string, tf: number, orMinutes: number) => {
      setExpandedState((prev) => ({ ...prev, loading: true, data: null }));
      try {
        const data = await fetchChartPreview(symbol, tf, 5, orMinutes);
        if (data?.error) {
          notifyErrorOnce(notify, data.error);
          setExpandedState((prev) => ({ ...prev, loading: false }));
          return;
        }
        setExpandedState((prev) => ({ ...prev, data: data ?? null, loading: false }));
      } catch {
        setExpandedState((prev) => ({ ...prev, loading: false }));
      }
    },
    [notify],
  );

  const toggleExpandedChart = useCallback(
    (symbol: string) => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      hidePreviewChart();
      setExpandedState((prev) => {
        if (prev.visible && prev.symbol === symbol) {
          if (expandedChartRef.current) {
            expandedChartRef.current.dispose();
            expandedChartRef.current = null;
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
    },
    [hidePreviewChart],
  );

  const collapseChart = useCallback(() => {
    if (expandedChartRef.current) {
      expandedChartRef.current.dispose();
      expandedChartRef.current = null;
    }
    setExpandedState((prev) => ({
      ...prev,
      visible: false,
      symbol: null,
      data: null,
      loading: false,
    }));
  }, []);

  const setTimeframe = useCallback(
    (tf: string | null) => {
      const val = parseInt(tf ?? "15");
      setExpandedState((prev) => ({ ...prev, timeframe: val }));
      const symbol = expandedState.symbol;
      if (symbol) {
        fetchExpandedData(symbol, val, expandedState.orMinutes);
      }
    },
    [expandedState.symbol, expandedState.orMinutes, fetchExpandedData],
  );

  const setOrMinutes = useCallback(
    (or: string | null) => {
      const val = parseInt(or ?? "45");
      setExpandedState((prev) => ({ ...prev, orMinutes: val }));
      const symbol = expandedState.symbol;
      if (symbol) {
        fetchExpandedData(symbol, expandedState.timeframe, val);
      }
    },
    [expandedState.symbol, expandedState.timeframe, fetchExpandedData],
  );

  const openFullChart = useCallback(
    (symbol: string) => {
      collapseChart();
      navigate(`/chart/${symbol}`);
    },
    [collapseChart, navigate],
  );

  const ctxValue: PreviewChartContextValue = {
    showPreviewChart,
    hidePreviewChart,
    toggleExpandedChart,
    collapseChart,
  };

  return (
    <PreviewChartContext.Provider value={ctxValue}>
      {children}

      {hoverState.visible && hoverState.symbol && (
        <Portal>
          <HoverPreview
            symbol={hoverState.symbol}
            x={hoverState.x}
            y={hoverState.y}
            data={hoverState.data}
            loading={hoverState.loading}
            chartRef={hoverChartRef}
          />
        </Portal>
      )}

      {expandedState.visible && expandedState.symbol && (
        <Portal>
          <ExpandedPanel
            symbol={expandedState.symbol}
            data={expandedState.data}
            loading={expandedState.loading}
            timeframe={expandedState.timeframe}
            orMinutes={expandedState.orMinutes}
            chartRef={expandedChartRef}
            onTimeframeChange={setTimeframe}
            onOrMinutesChange={setOrMinutes}
            onClose={collapseChart}
            onOpenFull={openFullChart}
          />
        </Portal>
      )}
    </PreviewChartContext.Provider>
  );
}

interface HoverPreviewProps {
  symbol: string;
  x: number;
  y: number;
  data: ChartPreviewData | null;
  loading: boolean;
  chartRef: React.MutableRefObject<EChartsInstance | null>;
}

function HoverPreview({ symbol, x, y, data, loading, chartRef }: HoverPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const adjustedX = Math.min(x, window.innerWidth - 340);
  const adjustedY = Math.min(y, window.innerHeight - 220);

  useEffect(() => {
    if (!data || !containerRef.current) return;
    if (!window.echarts) return;

    if (chartRef.current) {
      chartRef.current.dispose();
    }

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

    const chartDiv = containerRef.current.querySelector(".echarts-container") as HTMLElement;
    if (!chartDiv) return;

    chartRef.current = window.echarts.init(chartDiv);
    chartRef.current.setOption(chartOption);
    chartRef.current.resize();

    return () => {
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, [data, chartRef]);

  return (
    <Paper
      ref={containerRef}
      shadow="xl"
      p={0}
      pos="fixed"
      left={adjustedX}
      top={adjustedY}
      w={320}
      h={200}
      style={{ zIndex: 9999, pointerEvents: "none", overflow: "hidden" }}
      data-testid="preview-chart-hover"
    >
      <Group
        gap={6}
        px="xs"
        py={4}
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Text size="xs" fw={600} c="blue">
          {symbol}
        </Text>
        <Text size="xs" c="dimmed">
          15m
        </Text>
      </Group>
      <Box h={160} pos="relative">
        {loading && (
          <Box
            pos="absolute"
            inset={0}
            style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Loader size="sm" />
          </Box>
        )}
        {!loading && !data?.candles.length && (
          <Box
            pos="absolute"
            inset={0}
            style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Text size="xs" c="dimmed">
              No data
            </Text>
          </Box>
        )}
        {!loading && (data?.candles.length ?? 0) > 0 && (
          <div className="echarts-container" style={{ width: 320, height: 160, minHeight: 160 }} />
        )}
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
  chartRef: React.MutableRefObject<EChartsInstance | null>;
  onTimeframeChange: (val: string | null) => void;
  onOrMinutesChange: (val: string | null) => void;
  onClose: () => void;
  onOpenFull: (symbol: string) => void;
}

function ExpandedPanel({
  symbol,
  data,
  loading,
  timeframe,
  orMinutes,
  chartRef,
  onTimeframeChange,
  onOrMinutesChange,
  onClose,
  onOpenFull,
}: ExpandedPanelProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data || !chartContainerRef.current) return;
    if (!window.echarts) return;

    if (chartRef.current) {
      chartRef.current.dispose();
    }

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

    const chartDiv = chartContainerRef.current.querySelector(".echarts-container") as HTMLElement;
    if (!chartDiv) return;

    chartRef.current = window.echarts.init(chartDiv);
    chartRef.current.setOption(chartOption);
    chartRef.current.resize();

    const handleResize = () => chartRef.current?.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, [data, chartRef]);

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
        zIndex: 10000,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
      }}
      data-testid="preview-chart-expanded"
    >
      <Group
        gap="md"
        px="md"
        py="xs"
        sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}
      >
        <Text size="lg" fw={600} c="blue">
          {symbol}
          {data?.candles.length ? ` (${data.candles.length} candles)` : ""}
        </Text>
        <Select
          size="xs"
          w={70}
          data={TIMEFRAMES.map((t) => ({ value: String(t.value), label: t.label }))}
          value={String(timeframe)}
          onChange={onTimeframeChange}
          data-testid="preview-tf-select"
        />
        <Select
          size="xs"
          w={90}
          data={OR_MINUTES_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          value={String(orMinutes)}
          onChange={onOrMinutesChange}
          data-testid="preview-or-select"
        />
        <CloseButton ml="auto" size="md" onClick={onClose} data-testid="preview-close-btn" />
      </Group>

      <Box
        ref={chartContainerRef}
        style={{ flex: 1, padding: 8, minHeight: 0, position: "relative" }}
      >
        {loading && (
          <Box
            pos="absolute"
            inset={0}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Loader />
          </Box>
        )}
        {!loading && (data?.candles.length ?? 0) === 0 && (
          <Box
            pos="absolute"
            inset={0}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text c="dimmed">No data available</Text>
          </Box>
        )}
        {!loading && (data?.candles.length ?? 0) > 0 && (
          <div
            className="echarts-container"
            style={{ width: "100%", height: "100%", minHeight: 0 }}
          />
        )}
      </Box>

      <Group
        justify="flex-end"
        px="md"
        py="xs"
        sx={{ borderTop: 1, borderColor: "divider", flexShrink: 0 }}
      >
        <ActionIcon
          variant="subtle"
          color="blue"
          onClick={() => onOpenFull(symbol)}
          data-testid="preview-open-full-btn"
        >
          <IconArrowsMaximize size={16} />
        </ActionIcon>
        <Text
          size="xs"
          c="blue"
          style={{ cursor: "pointer" }}
          onClick={() => onOpenFull(symbol)}
          data-testid="preview-open-full-link"
        >
          Open Full Chart
        </Text>
      </Group>
    </Paper>
  );
}
