// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";

const mockChart = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};
const mockInit = vi.fn(() => mockChart);
const mockLib = { init: mockInit };
const mockLoadSettled = vi.fn();
let mockAutoResolve = true;
let mockResolveLoad: (() => void) | undefined;

vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(() => {
    if (mockAutoResolve) return Promise.resolve(mockLib);
    return new Promise((resolve) => {
      mockResolveLoad = () => {
        resolve(mockLib);
        // Queue a marker after the component's `.then` microtask so tests can
        // prove that microtask actually ran (guarding a negative assertion).
        queueMicrotask(mockLoadSettled);
      };
    });
  }),
}));

import { loadEcharts } from "../../utils/loadEcharts";
import { EChart } from "./EChart";

type ROEntry = { contentRect: { width: number; height: number } };
let mockRoCallbacks: ResizeObserverCallback[] = [];
let mockRoCount = 0;
const mockRoDisconnect = vi.fn();

class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    mockRoCount += 1;
    mockRoCallbacks.push(callback);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = mockRoDisconnect;
}

function fireResize(width: number, height: number) {
  for (const cb of mockRoCallbacks) {
    cb([{ contentRect: { width, height } } as ROEntry] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
  }
}

let mockRafQueue = new Map<number, FrameRequestCallback>();
let mockRafId = 0;
const mockCancelRaf = vi.fn((id: number) => {
  mockRafQueue.delete(id);
});

function stubRaf() {
  mockRafQueue = new Map();
  mockRafId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = ++mockRafId;
    mockRafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", mockCancelRaf);
}

function flushRaf() {
  const pending = [...mockRafQueue.values()];
  mockRafQueue.clear();
  for (const cb of pending) cb(0);
}

beforeEach(() => {
  mockAutoResolve = true;
  mockResolveLoad = undefined;
  mockRoCallbacks = [];
  mockRoCount = 0;
  mockRoDisconnect.mockClear();
  mockInit.mockClear();
  mockLoadSettled.mockClear();
  mockCancelRaf.mockClear();
  mockChart.setOption.mockClear();
  mockChart.resize.mockClear();
  mockChart.dispose.mockClear();
  mockChart.on.mockClear();
  mockChart.off.mockClear();
  vi.mocked(loadEcharts).mockClear();
  stubRaf();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EChart lifecycle", () => {
  it("initializes one instance and applies the option with replace semantics", async () => {
    const option = { series: [{ type: "line", data: [1] }] };
    render(() => <EChart option={option} data-testid="chart" />);
    fireResize(320, 200);

    await waitFor(() => expect(mockInit).toHaveBeenCalledTimes(1));

    expect(loadEcharts).toHaveBeenCalledTimes(1);
    expect(mockChart.setOption).toHaveBeenCalledTimes(1);
    expect(mockChart.setOption).toHaveBeenCalledWith(option, {
      notMerge: true,
      lazyUpdate: true,
    });
    // The frame queued by the option effect was superseded by the init paint.
    expect(mockRafQueue.size).toBe(0);
  });

  it("coalesces rapid option changes into one paint with the latest option", async () => {
    const [option, setOption] = createSignal({ v: 0 });
    render(() => <EChart option={option()} />);
    fireResize(320, 200);
    await waitFor(() => expect(mockChart.setOption).toHaveBeenCalledTimes(1));

    setOption({ v: 1 });
    setOption({ v: 2 });
    setOption({ v: 3 });

    expect(mockChart.setOption).toHaveBeenCalledTimes(1);
    expect(mockRafQueue.size).toBe(1);

    flushRaf();

    expect(mockChart.setOption).toHaveBeenCalledTimes(2);
    expect(mockChart.setOption.mock.calls[1][0]).toEqual({ v: 3 });
    expect(mockChart.setOption.mock.calls[1][1]).toEqual({
      notMerge: true,
      lazyUpdate: true,
    });
  });

  it("disposes the instance, disconnects the observer and cancels frames on cleanup", async () => {
    const [option, setOption] = createSignal({ v: 0 });
    const { unmount } = render(() => <EChart option={option()} />);
    fireResize(320, 200);
    await waitFor(() => expect(mockChart.setOption).toHaveBeenCalledTimes(1));

    setOption({ v: 1 });
    expect(mockRafQueue.size).toBe(1);

    unmount();

    expect(mockChart.dispose).toHaveBeenCalledTimes(1);
    expect(mockRoDisconnect).toHaveBeenCalledTimes(1);
    expect(mockCancelRaf).toHaveBeenCalled();
    expect(mockRafQueue.size).toBe(0);
  });

  it("rebinds changed events and removes stale handlers when onEvents changes", async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const [events, setEvents] = createSignal<Record<string, (p: any) => void>>({
      click: h1,
      hover: h1,
    });
    render(() => <EChart option={{ v: 0 }} onEvents={events()} />);
    fireResize(320, 200);
    await waitFor(() => expect(mockChart.setOption).toHaveBeenCalledTimes(1));

    expect(mockChart.on).toHaveBeenCalledWith("click", h1);
    expect(mockChart.on).toHaveBeenCalledWith("hover", h1);
    expect(mockChart.on).toHaveBeenCalledTimes(2);

    setEvents({ click: h2 });

    expect(mockChart.off).toHaveBeenCalledWith("click", h1);
    expect(mockChart.off).toHaveBeenCalledWith("hover", h1);
    expect(mockChart.on).toHaveBeenCalledWith("click", h2);
    expect(mockChart.on).toHaveBeenCalledTimes(3);
  });

  it("does not initialize when unmounted before the async loader resolves", async () => {
    mockAutoResolve = false;
    const { unmount } = render(() => <EChart option={{ v: 0 }} />);
    await waitFor(() => expect(loadEcharts).toHaveBeenCalledTimes(1));
    expect(mockResolveLoad).toBeDefined();

    unmount();
    // A late observation from the disconnected observer must not resurrect it.
    fireResize(320, 200);
    mockResolveLoad?.();
    await waitFor(() => expect(mockLoadSettled).toHaveBeenCalledTimes(1));

    expect(mockInit).not.toHaveBeenCalled();
    expect(mockChart.setOption).not.toHaveBeenCalled();
    expect(mockChart.dispose).not.toHaveBeenCalled();
  });
});

describe("EChart container sizing (windowed desk)", () => {
  it("does not create a zero-dimension instance for a hidden/lazy container", async () => {
    render(() => <EChart option={{ v: 0 }} />);
    await waitFor(() => expect(loadEcharts).toHaveBeenCalledTimes(1));
    // Let the loader `.then` run: no positive observation has happened yet, so
    // no chart may be created inside the still-empty window.
    await Promise.resolve();
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockChart.resize).not.toHaveBeenCalled();

    fireResize(320, 200);
    await waitFor(() => expect(mockInit).toHaveBeenCalledTimes(1));
  });

  it("creates one observer, resizes to the first observed size at init and to every later size", async () => {
    const { unmount } = render(() => <EChart option={{ v: 0 }} />);
    fireResize(320, 200);
    await waitFor(() => expect(mockInit).toHaveBeenCalledTimes(1));

    expect(mockRoCount).toBe(1);
    expect(mockChart.resize).toHaveBeenCalledTimes(1);
    expect(mockChart.resize).toHaveBeenCalledWith({ width: 320, height: 200 });

    // Rapid size changes coalesce into one rAF and use the latest measurement.
    fireResize(400, 240);
    fireResize(440, 240);
    expect(mockRafQueue.size).toBe(1);
    flushRaf();
    expect(mockChart.resize).toHaveBeenCalledTimes(2);
    expect(mockChart.resize).toHaveBeenLastCalledWith({ width: 440, height: 240 });

    // A container that collapses to zero must never resize the instance.
    fireResize(0, 0);
    fireResize(0, 120);
    flushRaf();
    expect(mockChart.resize).toHaveBeenCalledTimes(2);

    unmount();
    expect(mockRoDisconnect).toHaveBeenCalledTimes(1);
    expect(mockChart.dispose).toHaveBeenCalledTimes(1);
  });
});
