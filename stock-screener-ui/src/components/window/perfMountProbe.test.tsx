// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext } from "../dock/types";
import type { CanvasSize } from "./layout";
import { WINDOW_PANELS } from "./panelRegistry";
import { WindowManager } from "./WindowManager";
import type { WindowState } from "./types";

const ctl = vi.hoisted(() => ({ fetches: 0 }));

vi.mock("@/api/marketScreener", () => ({
  fetchMarketSnapshot: vi.fn(async () => {
    ctl.fetches += 1;
    return {
      asOf: "2026-11-19T10:00:00Z",
      universe: "all_equity",
      total: 1,
      updateMode: "delayed_streaming_600",
      rows: [{
        symbol: "RELIANCE", name: "RELIANCE", sector: "Energy", exchange: "NSE",
        close: 100, change: 1, relativeVolume: 1.2, marketCapCr: 100000, capTier: "large",
        rsi: 55, adx: 20, sma20: null, sma50: null, sma200: null, perfW: null, perf1m: null,
        high52w: null, low52w: null, pos52w: null, peRatio: 20, pbRatio: 3,
        dividendYield: 1, roe: 15, fno: true, etf: false,
      }],
      stale: false, ageSec: 1, cached: false,
    };
  }),
  readCachedMarketSnapshot: () => null,
  writeCachedMarketSnapshot: () => {},
}));

vi.mock("@/state/holidays", () => ({
  isMarketOpenNow: () => false,
  isMarketClosedToday: () => false,
  getHolidayList: () => [],
}));

vi.mock("@/api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/optionsDock")>();
  return {
    ...actual,
    fetchChain: vi.fn(async () => {
      ctl.fetches += 1;
      return {
        expiry: "2026-11-26", spot: 24000, pcr: 1, atmIv: 14, spotChangePct: 0.2,
        rows: [], asOf: "2026-11-26T10:00:00Z", levels: null,
      };
    }),
  };
});

vi.mock("@/api/sector", () => ({
  fetchSectorPerformance: vi.fn(async (market: string) => {
    ctl.fetches += 1;
    return {
      sectors: [{ sector: "Energy", avg_change: 1, stock_count: 2, advances: 1, declines: 1, avg_rsi: 50, avg_adx: 20, top_movers: "X" }],
      top_stock_movers: [{ symbol: "RELIANCE", change: 1 }],
      last_updated: "2026-11-19T10:00:00Z",
      market,
    };
  }),
}));

vi.mock("@/api/news", () => ({
  fetchNews: vi.fn(async () => {
    ctl.fetches += 1;
    return [{ id: "1", title: "A real headline", source: "Reuters", timestamp: "2026-11-19T10:00:00Z", url: "https://example.com", sourceUrl: "https://example.com" }];
  }),
  fetchNewsSources: vi.fn(async () => []),
}));

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => ({ setOption: () => {}, on: () => {}, resize: () => {}, dispose: () => {} }),
  }),
}));

vi.mock("../common/symbolDockContext", () => ({
  useSymbolDock: () => ({ open: vi.fn(), preview: vi.fn(), endPreview: vi.fn() }),
}));

const CANVAS: CanvasSize = { w: 1000, h: 700 };
const CONTEXT: Accessor<DockPanelContext> = () => ({
  symbol: "NIFTY", market: "india", timeframe: "1m", expiry: "2026-11-26",
});

function PickerDesk(props: { type: string }) {
  const [windows, setWindows] = createSignal<WindowState[]>([]);
  return (
    <>
      <button
        type="button"
        data-testid="add-window"
        onClick={() => setWindows([{
          id: "w1", type: props.type, title: props.type,
          x: 10, y: 10, w: 700, h: 460, z: 1,
        }])}
      >
        add
      </button>
      <WindowManager
        layout={{ windows: windows() }}
        context={CONTEXT}
        onLayoutChange={() => {}}
        canvas={CANVAS}
        specs={WINDOW_PANELS}
      />
    </>
  );
}

beforeEach(() => { ctl.fetches = 0; });
afterEach(() => cleanup());

describe("PERF PROBE — panel mount cost (picker click -> first paint)", () => {
  const cases = [
    { type: "market.heatmap", body: "market-heatmap-panel", content: "market-heatmap-context" },
    { type: "options.chain", body: "options-chain-window", content: "options-chain-controls" },
    { type: "sector.table", body: "sector-table-panel", content: "sector-table-panel" },
    { type: "news.feed", body: "panel-news-feed", content: "panel-news-feed" },
  ];

  for (const c of cases) {
    it(`${c.type}: synthetic picker click measured to first body paint`, async () => {
      render(() => <UIProvider><PickerDesk type={c.type} /></UIProvider>);
      const t0 = performance.now();
      fireEvent.click(screen.getByTestId("add-window"));
      const tMount = performance.now() - t0;
      await waitFor(() => expect(screen.getByTestId(c.body)).toBeInTheDocument());
      const tPaint = performance.now() - t0;
      expect(screen.getByTestId(c.content)).toBeInTheDocument();

      console.log("[PERF mount]", JSON.stringify({
        panel: c.type,
        mountMs: Number(tMount.toFixed(2)),
        firstPaintMs: Number(tPaint.toFixed(2)),
        fetchedOnMount: ctl.fetches,
      }));
      // Happy-dom is a paint-less proxy: this guards against a re-render storm
      // or a synchronous fetch waterfall, not against real browser paint cost.
      expect(tPaint).toBeLessThan(300);
    });
  }
});
