// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import { MarketMapView } from "../market/MarketMapView";
import type { CanvasSize } from "./layout";
import { WindowManager } from "./WindowManager";
import type { WindowState } from "./types";

const ctl = vi.hoisted(() => ({
  charts: [] as { resize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
  observed: [] as Element[],
  fireObservers: null as ((el: Element, w: number, h: number) => void) | null,
}));

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => {
      const chart = {
        setOption: vi.fn(),
        on: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(),
      };
      ctl.charts.push(chart);
      return chart;
    },
  }),
}));

/** A ResizeObserver that fires only when a size actually changes (browser semantics). */
class SizedResizeObserver {
  private cb: ResizeObserverCallback;
  private targets = new Set<Element>();
  private last = new Map<Element, { w: number; h: number }>();
  static all: SizedResizeObserver[] = [];
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    SizedResizeObserver.all.push(this);
    ctl.fireObservers = (el, w, h) => {
      const rect = { width: w, height: h } as DOMRectReadOnly;
      for (const ro of SizedResizeObserver.all) {
        if (!ro.targets.has(el)) continue;
        const prev = ro.last.get(el);
        if (prev && prev.w === w && prev.h === h) continue;
        ro.last.set(el, { w, h });
        ro.cb([{ contentRect: rect, target: el } as ResizeObserverEntry], ro as unknown as ResizeObserver);
      }
    };
  }
  observe(el: Element) {
    this.targets.add(el);
    ctl.observed.push(el);
  }
  disconnect() {
    this.targets.clear();
  }
}

const CANVAS: CanvasSize = { w: 1000, h: 700 };
const CONTEXT: () => DockPanelContext = () => ({ symbol: "NIFTY" });

const rows = [
  { symbol: "RELIANCE", name: "RELIANCE", change: 1, marketCapCr: 100000, peRatio: 20, roe: 15, etf: false, fno: true },
  { symbol: "TCS", name: "TCS", change: -1, marketCapCr: 90000, peRatio: 22, roe: 18, etf: false, fno: true },
] as never[];

function mapSpec(): DockPanelSpec {
  return {
    id: "probe.map",
    page: "screener",
    title: "MAP",
    size: 1,
    minWidth: 200,
    singleton: false,
    requires: [],
    mount: () => {
      const data = createMemo(() => rows);
      const [sizeBy] = createSignal<"change_pct">("change_pct");
      return (
        <div class="h-full w-full">
          <ChartsStub rows={data()} sizeBy={sizeBy()} />
        </div>
      );
    },
  };
}

// Mount the real MarketMapView canvas (the ECharts + ResizeObserver owner).
function ChartsStub(props: { rows: never[]; sizeBy: "change_pct" }) {
  return <MarketMapView rows={props.rows} sizeBy={props.sizeBy} showSizeControl={false} />;
}

const win = (id: string, i: number): WindowState => ({
  id,
  type: "probe.map",
  title: `MAP ${i}`,
  x: 20 + i * 300,
  y: 20,
  w: 280,
  h: 200,
  z: i + 1,
});

afterEach(() => {
  cleanup();
  ctl.charts = [];
  ctl.observed = [];
  SizedResizeObserver.all = [];
  vi.unstubAllGlobals();
});

describe("PERF PROBE — chart resize isolation", () => {
  it("(6) dragging one window: 0 chart.resize() on every other window's chart", async () => {
    vi.stubGlobal("ResizeObserver", SizedResizeObserver);
    render(() => (
      <UIProvider>
        <WindowManager
          layout={{ windows: [win("a", 0), win("b", 1)] }}
          context={CONTEXT}
          onLayoutChange={() => {}}
          canvas={CANVAS}
          specs={[mapSpec()]}
          lockedInitially
        />
      </UIProvider>
    ));
    await waitFor(() => expect(ctl.charts).toHaveLength(2));
    expect(ctl.observed).toHaveLength(2);

    const bar = screen.getByTestId("window-title-a");
    fireEvent.pointerDown(bar, { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
    for (let i = 1; i <= 60; i += 1) {
      fireEvent.pointerMove(window, { clientX: 20 + i * 2, clientY: 20 + i, pointerId: 1 });
    }
    fireEvent.pointerUp(window, { clientX: 140, clientY: 80, pointerId: 1 });

    const afterDrag = ctl.charts.map((c) => c.resize.mock.calls.length);

    ctl.fireObservers?.(ctl.observed[0], 400, 240);
    await waitFor(() => expect(ctl.charts[0].resize).toHaveBeenCalledTimes(1));
    const afterOwnResize = ctl.charts.map((c) => c.resize.mock.calls.length);

    console.log("[PERF chart-resize]", JSON.stringify({
      charts: 2,
      pointerMoves: 60,
      resizeCallsAfterDrag: afterDrag,
      resizeCallsAfterOwnResize: afterOwnResize,
    }));
    expect(afterDrag).toEqual([0, 0]);
    expect(afterOwnResize[1]).toBe(0);
  });
});
