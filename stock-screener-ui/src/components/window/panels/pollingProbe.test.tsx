// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext } from "../../dock/types";
import type { CanvasSize } from "../layout";
import type { WindowState } from "../types";
import { WindowManager } from "../WindowManager";
import { MARKET_HEATMAP_PANEL } from "./marketHeatmap";

const ctl = vi.hoisted(() => ({
  snapshotFetches: 0,
  dockOpen: vi.fn(),
}));

vi.mock("@/api/marketScreener", () => ({
  fetchMarketSnapshot: vi.fn(async () => {
    ctl.snapshotFetches += 1;
    return {
      asOf: "2026-11-19T10:00:00Z",
      universe: "all_equity",
      total: 0,
      updateMode: "delayed_streaming_600",
      rows: [],
      stale: false,
      ageSec: 1,
      cached: false,
    };
  }),
  readCachedMarketSnapshot: () => null,
  writeCachedMarketSnapshot: () => {},
}));

vi.mock("@/state/holidays", () => ({
  isMarketOpenNow: () => true,
  isMarketClosedToday: () => false,
  getHolidayList: () => [],
}));

vi.mock("../../market/MarketMapView", () => ({
  MarketMapView: () => <div data-testid="market-map-view" />,
}));

vi.mock("../../common/symbolDockContext", () => ({
  useSymbolDock: () => ({ open: ctl.dockOpen, preview: vi.fn(), endPreview: vi.fn() }),
}));

const CANVAS: CanvasSize = { w: 1280, h: 800 };
const CONTEXT: Accessor<DockPanelContext> = () => ({ symbol: "NIFTY" });
const spec = MARKET_HEATMAP_PANEL;

const win = (i: number): WindowState => ({
  id: `m${i}`,
  type: "market.heatmap",
  title: `HEATMAP ${i}`,
  x: 40 + i * 40,
  y: 40,
  w: 400,
  h: 260,
  z: i + 1,
});

function Desk() {
  const [layout, setLayout] = createSignal<{ windows: WindowState[] }>({
    windows: [win(0), win(1)],
  });
  return (
    <WindowManager
      layout={layout()}
      context={CONTEXT}
      onLayoutChange={(next) => setLayout({ windows: next.windows })}
      canvas={CANVAS}
      specs={[spec]}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  ctl.snapshotFetches = 0;
  ctl.dockOpen.mockClear();
});

describe("PERF PROBE — real panel fetch counts", () => {
  it("(5) two market heatmaps: actual snapshot request count on mount", async () => {
    vi.useFakeTimers();
    render(() => (
      <UIProvider>
        <Desk />
      </UIProvider>
    ));
    await vi.advanceTimersByTimeAsync(20);

    console.log("[PERF market-fetch]", JSON.stringify({
      windows: 2,
      requestsOnMount: ctl.snapshotFetches,
    }));

    expect(screen.getAllByTestId("market-heatmap-empty")).toHaveLength(2);
    // Baseline measurement; not an assertion of desired behaviour — logged above.
    expect(ctl.snapshotFetches).toBeGreaterThanOrEqual(1);
  });

  it("(4) minimizing one of two heatmaps: fetch count while minimized", async () => {
    vi.useFakeTimers();
    render(() => (
      <UIProvider>
        <Desk />
      </UIProvider>
    ));
    await vi.advanceTimersByTimeAsync(20);
    const afterMount = ctl.snapshotFetches;

    fireEvent.click(screen.getByTestId("window-minimize-m0"));
    await vi.advanceTimersByTimeAsync(11_000);
    const afterMinimize = ctl.snapshotFetches;
    await vi.advanceTimersByTimeAsync(11_000);
    const afterMore = ctl.snapshotFetches;

    console.log("[PERF minimize-fetch]", JSON.stringify({
      afterMount,
      afterMinimize,
      afterMore,
      requestsFromMinimizedOver22s: afterMore - afterMount,
    }));

    expect(screen.queryByTestId("window-body-m0")).not.toBeInTheDocument();
    expect(screen.getByTestId("window-body-m1")).toBeInTheDocument();
    // Steady state: one visible panel polls at MARKET_LIVE_POLL_MS=5s, so ~2
    // requests per 11s. Two live panels would produce ~4 in the same window.
    expect(afterMore - afterMinimize).toBeLessThanOrEqual(2);
  });
});
