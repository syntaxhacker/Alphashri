import { Show, createContext, onCleanup, type JSX, useContext } from "solid-js";
import { createStore } from "solid-js/store";
import { useNavigate } from "@solidjs/router";
import { Portal } from "@/ui";
import { fetchChartPreview } from "../../api/chartPreview";
import { loadEcharts } from "../../utils/loadEcharts";
import { useNotification } from "../../hooks/useNotification";
import { HoverPreview } from "./preview/HoverPreview";
import { ExpandedPanel } from "./preview/ExpandedPanel";
import {
  classifyPreviewResponse,
  notifyErrorOnce,
  RETRY_MESSAGE,
  StaleRequestGuard,
} from "./preview/request";
import {
  createExpandedState,
  createHoverState,
  type ChartInstanceBox,
  type ExpandedState,
  type HoverState,
} from "./preview/types";

export type { ChartInstanceBox } from "./preview/types";

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

export function PreviewChartProvider(props: { children?: JSX.Element }) {
  const notify = useNotification();
  const navigate = useNavigate();

  const [hoverState, setHoverState] = createStore<HoverState>(createHoverState());
  const [expandedState, setExpandedState] = createStore<ExpandedState>(createExpandedState());

  let hoverTimer: number | null = null;
  const hoverGuard = new StaleRequestGuard();
  const hoverChartBox: ChartInstanceBox = { current: null };
  const expandedChartBox: ChartInstanceBox = { current: null };
  const expandedGuard = new StaleRequestGuard();
  let echartsPrefetched = false;

  const prefetchEcharts = () => {
    if (echartsPrefetched) return;
    echartsPrefetched = true;
    void loadEcharts();
  };

  const cancelHoverRequest = () => hoverGuard.cancel();
  const cancelExpandedRequest = () => expandedGuard.cancel();

  onCleanup(() => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    cancelHoverRequest();
    cancelExpandedRequest();
    if (hoverChartBox.current) {
      hoverChartBox.current.dispose();
      hoverChartBox.current = null;
    }
    if (expandedChartBox.current) {
      expandedChartBox.current.dispose();
      expandedChartBox.current = null;
    }
  });

  const loadHoverData = async (symbol: string) => {
    const request = hoverGuard.begin();
    try {
      const data = await fetchChartPreview(symbol, 15, 1, 45);
      if (!hoverGuard.isCurrent(request) || hoverState.symbol !== symbol) return;
      const result = classifyPreviewResponse(data);
      if (result.status === "transport") {
        setHoverState({ data: null, loading: false, error: RETRY_MESSAGE });
        return;
      }
      if (result.status === "server-error") {
        setHoverState({ data: null, loading: false, error: result.message });
        return;
      }
      setHoverState({ data: result.data, loading: false, error: null });
    } catch {
      if (!hoverGuard.isCurrent(request) || hoverState.symbol !== symbol) return;
      setHoverState({ data: null, loading: false, error: RETRY_MESSAGE });
    }
  };

  const showPreviewChart = (event: MouseEvent, symbol: string) => {
    // Prefetch once; repeating the dynamic import on every pointer move is wasted work.
    prefetchEcharts();
    // Immediately clear any pending show to prevent stale previews
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    const x = event.clientX + 15;
    const y = event.clientY + 15;
    hoverTimer = window.setTimeout(() => {
      hoverTimer = null;
      if (hoverState.visible && hoverState.symbol === symbol) {
        // Pausing over the same row must not reset data or refetch: that would
        // dispose and recreate the ECharts instance on every pointer stop.
        if (hoverState.x !== x || hoverState.y !== y) setHoverState({ x, y });
        return;
      }
      setHoverState({
        visible: true,
        symbol,
        x,
        y,
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
    if (!hoverState.visible && !hoverGuard.active) return;
    cancelHoverRequest();
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
    const request = expandedGuard.begin();
    setExpandedState({ loading: true, data: null, error: null });
    try {
      const data = await fetchChartPreview(symbol, tf, 5, orMinutes);
      if (!expandedGuard.isCurrent(request)) return;
      const result = classifyPreviewResponse(data);
      if (result.status === "transport") {
        setExpandedState({ loading: false, error: RETRY_MESSAGE });
        return;
      }
      if (result.status === "server-error") {
        notifyErrorOnce(notify, result.message);
        setExpandedState({ loading: false, error: result.message });
        return;
      }
      setExpandedState({ data: result.data, loading: false, error: null });
    } catch {
      if (!expandedGuard.isCurrent(request)) return;
      setExpandedState({ loading: false, error: RETRY_MESSAGE });
    }
  };

  const retryExpanded = () => {
    const symbol = expandedState.symbol;
    if (symbol) void fetchExpandedData(symbol, expandedState.timeframe, expandedState.orMinutes);
  };

  const toggleExpandedChart = (symbol: string) => {
    prefetchEcharts();
    hidePreviewChart();
    const wasOpenForSymbol = expandedState.visible && expandedState.symbol === symbol;
    if (wasOpenForSymbol) {
      if (expandedChartBox.current) {
        expandedChartBox.current.dispose();
        expandedChartBox.current = null;
      }
      cancelExpandedRequest();
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
    cancelExpandedRequest();
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

  // Only stable callbacks live in context. Putting preview state here would hand
  // every consumer a new value on each pointer move and remount the whole subtree.
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
