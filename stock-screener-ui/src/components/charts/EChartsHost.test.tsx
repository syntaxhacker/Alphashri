// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";

const mocks = vi.hoisted(() => {
  const setOption = vi.fn();
  const resize = vi.fn();
  const dispose = vi.fn();
  const on = vi.fn();
  const off = vi.fn();
  const instance = { setOption, resize, dispose, on, off };
  const init = vi.fn(() => instance);
  const load = vi.fn(async () => ({ init }));
  return { setOption, resize, dispose, on, off, instance, init, load };
});

vi.mock("../../utils/loadEcharts", () => ({ loadEcharts: mocks.load }));

import { EChartsHost } from "./EChartsHost";
import { EChartSolid } from "../paper-trading/EChartSolid";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  emit(width: number, height: number) {
    this.callback(
      [{ contentRect: { width, height } } as DOMRectReadOnly] as unknown as ResizeObserverEntry[],
      this as unknown as ResizeObserver,
    );
  }
}

let resolveLoad: (() => void) | undefined;

function deferredLoad() {
  resolveLoad = undefined;
  mocks.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLoad = () => resolve({ init: mocks.init } as never);
      }),
  );
}

beforeEach(() => {
  for (const spy of [mocks.setOption, mocks.resize, mocks.dispose, mocks.on, mocks.off, mocks.init, mocks.load]) {
    spy.mockClear();
  }
  mocks.load.mockImplementation(async () => ({ init: mocks.init }));
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EChartsHost lifecycle", () => {
  it("loads once, inits once, applies the accessor option and notifies onReady", async () => {
    deferredLoad();
    const option = { series: [{ type: "line", data: [1] }] };
    const onReady = vi.fn();
    render(() => (
      <EChartsHost option={() => option} onReady={onReady} data-testid="host-chart" />
    ));
    const el = screen.getByTestId("host-chart");

    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    // A size seen before the async load lands is used for the first paint.
    FakeResizeObserver.instances[0]!.emit(320, 200);
    resolveLoad?.();

    await waitFor(() => expect(mocks.setOption).toHaveBeenCalledTimes(1));
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.init.mock.calls[0][0]).toBe(el);
    expect(mocks.setOption).toHaveBeenCalledWith(option, true);
    expect(mocks.resize).toHaveBeenCalledWith({ width: 320, height: 200 });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(mocks.instance);
  });

  it("re-applies changed options without re-initializing and honors notMerge=false", async () => {
    const [option, setOption] = createSignal({ v: 0 });
    render(() => <EChartsHost option={option} notMerge={false} data-testid="host-chart" />);
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalledTimes(1));

    setOption({ v: 1 });
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalledTimes(2));

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.setOption).toHaveBeenLastCalledWith({ v: 1 }, false);
  });

  it("defers loading while the option is empty", async () => {
    const [option, setOption] = createSignal<unknown>(null);
    render(() => <EChartsHost option={option} data-testid="host-chart" />);
    await Promise.resolve();
    expect(mocks.load).not.toHaveBeenCalled();

    setOption({ v: 1 });
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalledWith({ v: 1 }, true));
  });

  it("binds, replaces and removes the click handler by identity", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const [handler, setHandler] = createSignal<(params: unknown) => void>(first);
    render(() => <EChartsHost option={() => ({ v: 0 })} onClick={handler()} data-testid="host-chart" />);
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalledTimes(1));

    expect(mocks.on).toHaveBeenCalledWith("click", first);

    setHandler(() => second);
    expect(mocks.off).toHaveBeenCalledWith("click", first);
    expect(mocks.on).toHaveBeenLastCalledWith("click", second);

    setHandler(() => undefined as unknown as (params: unknown) => void);
    expect(mocks.off).toHaveBeenCalledWith("click", second);
  });

  it("resizes from the observer and the window listener, then tears both down", async () => {
    const { unmount } = render(() => <EChartsHost option={() => ({ v: 0 })} data-testid="host-chart" />);
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalledTimes(1));
    expect(mocks.resize).toHaveBeenCalledWith();

    const observer = FakeResizeObserver.instances[0]!;
    observer.emit(400, 240);
    expect(mocks.resize).toHaveBeenLastCalledWith({ width: 400, height: 240 });

    window.dispatchEvent(new Event("resize"));
    expect(mocks.resize).toHaveBeenLastCalledWith({ width: 400, height: 240 });

    unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);

    mocks.resize.mockClear();
    observer.emit(500, 300);
    window.dispatchEvent(new Event("resize"));
    expect(mocks.resize).not.toHaveBeenCalled();
  });

  it("does not initialize or dispose when a load settles after unmount", async () => {
    deferredLoad();
    const { unmount } = render(() => <EChartsHost option={() => ({ v: 0 })} />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));

    unmount();
    resolveLoad?.();
    await Promise.resolve();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it("does not initialize when its element was removed from the DOM before load", async () => {
    deferredLoad();
    render(() => <EChartsHost option={() => ({ v: 0 })} data-testid="host-chart" />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));

    screen.getByTestId("host-chart").remove();
    resolveLoad?.();
    await Promise.resolve();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.setOption).not.toHaveBeenCalled();
  });

  it("initializes with the requested renderer (svg parity)", async () => {
    render(() => <EChartsHost option={() => ({ v: 0 })} renderer="svg" data-testid="host-chart" />);
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(mocks.init).toHaveBeenCalledWith(expect.anything(), undefined, { renderer: "svg" });
  });

  it("keeps the EChartSolid alias's accessor option and dispose behavior", async () => {
    const { unmount } = render(() => (
      <EChartSolid option={() => ({ v: 1 })} data-testid="solid-chart" />
    ));
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalledWith({ v: 1 }, true));
    expect(screen.getByTestId("solid-chart")).toHaveClass("w-full");

    unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("forwards class, style and data-testid to its single container", async () => {
    render(() => (
      <EChartsHost
        option={() => ({ v: 0 })}
        class="my-chart"
        style={{ height: "148px", width: "100%" }}
        data-testid="host-chart"
      />
    ));
    const el = screen.getByTestId("host-chart");
    expect(el).toHaveClass("my-chart");
    expect(el.style.height).toBe("148px");
    expect(el.style.width).toBe("100%");
  });
});
