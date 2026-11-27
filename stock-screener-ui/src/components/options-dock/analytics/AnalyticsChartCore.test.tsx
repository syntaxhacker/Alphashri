// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { createSignal } from "solid-js";

const chartStub = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
};
// The chart core calls init(el, theme, opts); type the seam with those args so
// `.mock.calls[0][0]` is the container element, not an empty tuple.
const echartsInit = vi.fn((_el: HTMLElement, _theme?: unknown, _opts?: unknown) => chartStub);
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: echartsInit })),
}));

import { AnalyticsChartCore } from "./AnalyticsChartCore";

const option = (marker: string) => ({ title: { text: marker } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  chartStub.setOption.mockClear();
  chartStub.resize.mockClear();
  chartStub.dispose.mockClear();
  echartsInit.mockClear();
});

describe("AnalyticsChartCore lifecycle", () => {
  test("initialises once with the canvas renderer and paints the first option", async () => {
    render(() => (
      <UIProvider>
        <AnalyticsChartCore option={option("a")} optionKey="a" />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    expect(echartsInit).toHaveBeenCalledTimes(1);
    expect(echartsInit).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      undefined,
      { renderer: "canvas" },
    );
    expect(chartStub.setOption.mock.calls[0][1]).toEqual({ notMerge: false, lazyUpdate: true });
  });

  test("repaints when optionKey changes", async () => {
    const [key, setKey] = createSignal("a");
    render(() => (
      <UIProvider>
        <AnalyticsChartCore option={option(key())} optionKey={key()} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    setKey("b");
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(2));
    expect(chartStub.setOption.mock.calls.at(-1)?.[0]).toEqual(option("b"));
  });

  test("a fresh option object with the same key does not repaint", async () => {
    const [opt, setOpt] = createSignal(option("a"));
    render(() => (
      <UIProvider>
        <AnalyticsChartCore option={opt()} optionKey="stable" />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    setOpt(option("a different identity, same content key"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chartStub.setOption).toHaveBeenCalledTimes(1);
  });

  test("disposes the chart on unmount", async () => {
    const { unmount } = render(() => (
      <UIProvider>
        <AnalyticsChartCore option={option("a")} optionKey="a" />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    unmount();
    expect(chartStub.dispose).toHaveBeenCalledTimes(1);
  });

  test("the normal path reserves no fixed plot height", async () => {
    render(() => (
      <UIProvider>
        <AnalyticsChartCore option={option("a")} optionKey="a" />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    const host = screen.getByTestId("analytics-chart").parentElement as HTMLElement;
    // The dock band owns the height; a 96px floor here is what clipped the
    // smile footer at the normal dock size.
    expect(host.style.minHeight).toBe("");
    expect(host.className).toContain("flex-1");
    expect(host.className).toContain("min-h-0");
  });

  test("the empty state keeps a readable minimum height", async () => {
    render(() => (
      <UIProvider>
        <AnalyticsChartCore option={option("a")} optionKey="a" empty emptyText="No smile yet" />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    const host = screen.getByTestId("analytics-chart").parentElement as HTMLElement;
    expect(parseInt(host.style.minHeight, 10)).toBeGreaterThanOrEqual(48);
  });

  test("renders the empty state under the chart container", async () => {
    render(() => (
      <UIProvider>
        <AnalyticsChartCore
          option={option("a")}
          optionKey="a"
          empty
          emptyText="No smile yet"
          testId="smile-chart"
        />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("smile-chart")).toBeInTheDocument();
    expect(screen.getByTestId("smile-chart-empty")).toHaveTextContent("No smile yet");
  });
});

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

// happy-dom does not drive the frame clock, so the queue is flushed by hand.
function stubRaf() {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const cancel = vi.fn((id: number) => {
    pending.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return {
    pending,
    cancel,
    flush: () => {
      const queued = [...pending.values()];
      pending.clear();
      for (const cb of queued) cb(0);
    },
  };
}

function mountChart() {
  return render(() => (
    <UIProvider>
      <AnalyticsChartCore option={option("a")} optionKey="a" />
    </UIProvider>
  ));
}

describe("AnalyticsChartCore host resize", () => {
  test("a container width change resizes the chart without a window resize", async () => {
    const ro = stubResizeObserver();
    const raf = stubRaf();
    mountChart();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));
    expect(ro.observed).toEqual([echartsInit.mock.calls[0][0]]);

    // The 376 → 368 narrowing measured when the dock band swapped.
    ro.fire(368, 200);
    expect(chartStub.resize).not.toHaveBeenCalled();

    raf.flush();
    expect(chartStub.resize).toHaveBeenCalledTimes(1);
  });

  test("a burst of container resizes is coalesced into one resize per frame", async () => {
    const ro = stubResizeObserver();
    const raf = stubRaf();
    mountChart();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    ro.fire(376, 200);
    ro.fire(368, 200);
    ro.fire(360, 200);
    raf.flush();

    expect(chartStub.resize).toHaveBeenCalledTimes(1);
  });

  test("a zero-size entry schedules nothing", async () => {
    const ro = stubResizeObserver();
    const raf = stubRaf();
    mountChart();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    ro.fire(0, 0);
    expect(raf.pending.size).toBe(0);
    raf.flush();
    expect(chartStub.resize).not.toHaveBeenCalled();
  });

  test("unmount disconnects the observer and cancels the pending frame", async () => {
    const ro = stubResizeObserver();
    const raf = stubRaf();
    const view = mountChart();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    ro.fire(368, 200);
    const [frameId] = [...raf.pending.keys()];
    view.unmount();

    expect(ro.disconnect).toHaveBeenCalledTimes(1);
    expect(raf.cancel).toHaveBeenCalledWith(frameId);
    expect(raf.pending.size).toBe(0);

    // The cancelled frame cannot run; and a late observer entry must not touch
    // the disposed instance either.
    raf.flush();
    ro.fire(360, 200);
    raf.flush();
    expect(chartStub.resize).not.toHaveBeenCalled();
    expect(chartStub.dispose).toHaveBeenCalledTimes(1);
  });

  test("window resize still resizes once per frame", async () => {
    stubResizeObserver();
    const raf = stubRaf();
    mountChart();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    raf.flush();

    expect(chartStub.resize).toHaveBeenCalledTimes(1);
  });
});
