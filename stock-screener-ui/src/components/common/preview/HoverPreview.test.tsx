// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { loadEcharts } from "@/utils/loadEcharts";
import type { ChartPreviewData } from "../../../api/chartPreview";
import type { ChartInstanceBox } from "./types";
import { HoverPreview } from "./HoverPreview";

const h = vi.hoisted(() => {
  const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { init: vi.fn(() => instance), instance };
});

vi.mock("@/utils/loadEcharts", () => ({ loadEcharts: vi.fn(async () => h) }));

const candle = {
  time: "2025-10-24T09:15",
  date: "2025-10-24",
  time_str: "09:15",
  open: 100,
  high: 105,
  low: 98,
  close: 103,
  volume: 1000,
};

const data: ChartPreviewData = {
  symbol: "RELIANCE",
  candles: [candle],
  orb_zones: [],
  pivot_levels: [],
  timeframe: 15,
  total_candles: 1,
};

type Props = Parameters<typeof HoverPreview>[0];

const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
const originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    symbol: "RELIANCE",
    x: 100,
    y: 80,
    data,
    loading: false,
    error: null,
    chartBox: { current: null } as ChartInstanceBox,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadEcharts).mockReset().mockResolvedValue(h);
  setViewport(1024, 768);
});

afterEach(() => {
  vi.useRealTimers();
  for (const [key, descriptor] of [
    ["innerWidth", originalWidth],
    ["innerHeight", originalHeight],
  ] as const) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
    else delete (window as unknown as Record<string, unknown>)[key];
  }
});

describe("HoverPreview", () => {
  test("keeps the card inside the viewport while preserving an in-bounds pointer position", () => {
    setViewport(800, 600);
    renderWithProviders(() => <HoverPreview {...props({ x: 1200, y: 900 })} />);

    const card = screen.getByTestId("preview-chart-hover");
    expect(card.style.position).toBe("fixed");
    expect(card.style.left).toBe("460px"); // 800 - 340
    expect(card.style.top).toBe("380px"); // 600 - 220
    expect(card.style.pointerEvents).toBe("none");
    expect(card).toHaveTextContent("RELIANCE");
    expect(card).toHaveTextContent("15m");
  });

  test("leaves a pointer near the origin untouched", () => {
    renderWithProviders(() => <HoverPreview {...props({ x: 40, y: 60 })} />);
    const card = screen.getByTestId("preview-chart-hover");
    expect(card.style.left).toBe("40px");
    expect(card.style.top).toBe("60px");
  });

  test("distinguishes loading, transport error and genuine empty data", () => {
    const loading = renderWithProviders(() => <HoverPreview {...props({ loading: true })} />);
    expect(screen.getByTestId("preview-chart-hover")).toBeInTheDocument();
    expect(h.init).not.toHaveBeenCalled();
    loading.unmount();

    const failed = renderWithProviders(() => <HoverPreview {...props({ error: "Upstream down" })} />);
    const errorBox = screen.getByTestId("preview-chart-hover-error");
    expect(errorBox).toHaveTextContent("Couldn't load chart");
    expect(errorBox).toHaveTextContent("Hover away and back to retry");
    expect(screen.queryByTestId("preview-chart-hover-empty")).not.toBeInTheDocument();
    expect(h.init).not.toHaveBeenCalled();
    failed.unmount();

    renderWithProviders(() => <HoverPreview {...props({ data: null })} />);
    expect(screen.getByTestId("preview-chart-hover-empty")).toHaveTextContent("No data");
    expect(screen.queryByTestId("preview-chart-hover-error")).not.toBeInTheDocument();
    expect(h.init).not.toHaveBeenCalled();
  });

  test("mounts the chart into the hover card and disposes it when the host unmounts the card", async () => {
    const chartBox = { current: null } as ChartInstanceBox;
    const view = renderWithProviders(() => <HoverPreview {...props({ chartBox })} />);

    await vi.waitFor(() => expect(h.init).toHaveBeenCalledTimes(1));
    const container = document.querySelector(
      '[data-testid="preview-chart-hover"] .echarts-container',
    ) as HTMLElement;
    expect(container).not.toBeNull();
    expect(h.init).toHaveBeenCalledWith(container);
    expect(h.instance.setOption).toHaveBeenCalledTimes(1);
    expect(chartBox.current).toBe(h.instance);

    view.unmount();
    expect(h.instance.dispose).toHaveBeenCalledTimes(1);
    expect(chartBox.current).toBeNull();
  });

  test("a late ECharts load after the card is gone cannot create an orphan chart", async () => {
    let resolveLoad: ((value: unknown) => void) | undefined;
    vi.mocked(loadEcharts).mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; }),
    );

    const view = renderWithProviders(() => <HoverPreview {...props()} />);
    view.unmount();
    resolveLoad?.(h);
    await Promise.resolve();
    await Promise.resolve();

    expect(h.init).not.toHaveBeenCalled();
    expect(h.instance.dispose).not.toHaveBeenCalled();
  });

  test("host-driven show, data arrival and hide settle deterministically under fake timers", async () => {
    vi.useFakeTimers();

    function Host() {
      const [showing, setShowing] = createSignal(false);
      const [loading, setLoading] = createSignal(false);
      const [previewData, setPreviewData] = createSignal<ChartPreviewData | null>(null);
      const chartBox = { current: null } as ChartInstanceBox;

      onMount(() => {
        const show = window.setTimeout(() => { setShowing(true); setLoading(true); }, 100);
        const ready = window.setTimeout(() => { setLoading(false); setPreviewData(data); }, 350);
        const hide = window.setTimeout(() => setShowing(false), 500);
        onCleanup(() => {
          clearTimeout(show);
          clearTimeout(ready);
          clearTimeout(hide);
        });
      });

      return (
        <Show when={showing()}>
          <HoverPreview
            symbol="RELIANCE"
            x={10}
            y={10}
            data={previewData()}
            loading={loading()}
            error={null}
            chartBox={chartBox}
          />
        </Show>
      );
    }

    renderWithProviders(() => <Host />);
    expect(screen.queryByTestId("preview-chart-hover")).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getByTestId("preview-chart-hover")).toBeInTheDocument();
    expect(h.init).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('[data-testid="preview-chart-hover"] .echarts-container')).not.toBeNull();
    expect(h.init).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(150);
    expect(screen.queryByTestId("preview-chart-hover")).not.toBeInTheDocument();
    expect(h.instance.dispose).toHaveBeenCalledTimes(1);
  });
});
