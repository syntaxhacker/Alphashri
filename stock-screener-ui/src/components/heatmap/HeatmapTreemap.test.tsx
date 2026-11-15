// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { HeatmapTreemap } from "./HeatmapTreemap";
import type { HeatmapStock } from "../../api/heatmap";

const mockOn = vi.fn();
const mockChartInstance = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: mockOn,
};
let initCalls: unknown[][] = [];

vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(() =>
    Promise.resolve({
      init: (...args: unknown[]) => {
        initCalls.push(args);
        return mockChartInstance;
      },
    }),
  ),
}));

type RoCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

function stubResizeObserver() {
  const callbacks: RoCallback[] = [];
  const observed: Element[] = [];
  const disconnect = vi.fn();
  class MockResizeObserver {
    constructor(cb: RoCallback) {
      callbacks.push(cb);
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect = disconnect;
  }
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  return {
    callbacks,
    observed,
    disconnect,
    fire: (width: number, height: number) => {
      for (const cb of callbacks) cb([{ contentRect: { width, height } }]);
    },
  };
}

function r(jsx: () => any) {
  return render(() => <UIProvider>{jsx()}</UIProvider>);
}

// requestAnimationFrame is not driven by the test clock in happy-dom.
function stubRaf() {
  const pending: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending.push(cb);
    return pending.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return {
    flush: () => {
      const queued = pending.splice(0);
      for (const cb of queued) cb(0);
    },
  };
}

const stock: HeatmapStock = {
  symbol: "RELIANCE",
  name: "Reliance Industries",
  sector: "Energy",
  market_cap: 15_000_000_000_000,
  pe_ratio: 22.5,
  pb_ratio: 2.5,
  dividend_yield: 0.8,
  perf_1y: 12.3,
  roe: 15.2,
  high_52w: 3000,
  low_52w: 2400,
  price: 2850,
  change_pct: 1.234,
};

describe("HeatmapTreemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initCalls = [];
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("clicking a tile calls onSymbolClick with the symbol", async () => {
    const onSymbolClick = vi.fn();
    r(() => (
      <HeatmapTreemap stocks={[stock]} metric="roe" onSymbolClick={onSymbolClick} />
    ));
    await vi.waitFor(() => expect(mockOn).toHaveBeenCalledWith("click", expect.any(Function)));
    const clickHandler = mockOn.mock.calls.find(([evt]) => evt === "click")?.[1];
    expect(clickHandler).toBeDefined();
    clickHandler({ name: "RELIANCE" });
    expect(onSymbolClick).toHaveBeenCalledWith("RELIANCE");
  });

  test("does not register a click handler when onSymbolClick is not provided", async () => {
    r(() => <HeatmapTreemap stocks={[stock]} metric="roe" />);
    await vi.waitFor(() => expect(mockChartInstance.setOption).toHaveBeenCalled());
    expect(mockOn).not.toHaveBeenCalledWith("click", expect.any(Function));
  });

  // Opening the chart dock narrows the content column without a window resize;
  // the canvas used to keep its old width and overflow the column.
  test("a host resize resizes the chart", async () => {
    const ro = stubResizeObserver();
    const raf = stubRaf();
    r(() => <HeatmapTreemap stocks={[stock]} metric="roe" />);
    await vi.waitFor(() => expect(ro.callbacks.length).toBe(1));

    ro.fire(900, 500);
    raf.flush();

    expect(mockChartInstance.resize).toHaveBeenCalledTimes(1);
  });

  test("observes the echarts host and disconnects on unmount", async () => {
    const ro = stubResizeObserver();
    const view = r(() => <HeatmapTreemap stocks={[stock]} metric="roe" />);
    await vi.waitFor(() => expect(ro.observed.length).toBe(1));

    expect(ro.observed[0]).toBe(initCalls[0][0]);

    view.unmount();
    expect(ro.disconnect).toHaveBeenCalledTimes(1);
  });

  test("a zero-size resize does not resize the chart", async () => {
    const ro = stubResizeObserver();
    const raf = stubRaf();
    r(() => <HeatmapTreemap stocks={[stock]} metric="roe" />);
    await vi.waitFor(() => expect(ro.callbacks.length).toBe(1));

    ro.fire(0, 0);
    raf.flush();
    expect(mockChartInstance.resize).not.toHaveBeenCalled();

    // ...and the observer is still live once the host has real dimensions.
    ro.fire(900, 500);
    raf.flush();
    expect(mockChartInstance.resize).toHaveBeenCalledTimes(1);
  });

  test("coalesces multiple host resizes into one resize per frame", async () => {
    const ro = stubResizeObserver();
    const raf = stubRaf();
    r(() => <HeatmapTreemap stocks={[stock]} metric="roe" />);
    await vi.waitFor(() => expect(ro.callbacks.length).toBe(1));

    ro.fire(900, 500);
    ro.fire(700, 500);
    raf.flush();

    expect(mockChartInstance.resize).toHaveBeenCalledTimes(1);
  });

  test("window resize still resizes the chart", async () => {
    stubResizeObserver();
    r(() => <HeatmapTreemap stocks={[stock]} metric="roe" />);
    await vi.waitFor(() => expect(mockChartInstance.setOption).toHaveBeenCalled());

    window.dispatchEvent(new Event("resize"));

    expect(mockChartInstance.resize).toHaveBeenCalledTimes(1);
  });
});
