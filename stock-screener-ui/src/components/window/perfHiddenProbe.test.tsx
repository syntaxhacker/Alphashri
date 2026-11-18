// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { resetSectorState } from "@/state/sector";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import type { CanvasSize } from "./layout";
import { WindowManager } from "./WindowManager";
import type { WindowState } from "./types";

const ctl = vi.hoisted(() => ({ sectorFetches: 0, chainFetches: 0, newsFetches: 0 }));

vi.mock("@/api/sector", () => ({
  fetchSectorPerformance: vi.fn(async (market: string) => {
    ctl.sectorFetches += 1;
    return { sectors: [], top_stock_movers: [], last_updated: "2026-11-19T10:00:00Z", market };
  }),
}));
vi.mock("@/api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/optionsDock")>();
  return {
    ...actual,
    fetchChain: vi.fn(async () => { ctl.chainFetches += 1; return null; }),
  };
});
vi.mock("@/api/news", () => ({
  fetchNews: vi.fn(async () => {
    ctl.newsFetches += 1;
    return [{ id: "1", title: "Headline", source: "Reuters", timestamp: "2026-11-19T10:00:00Z", url: "https://example.com" }];
  }),
  fetchNewsSources: vi.fn(async () => []),
}));
vi.mock("../options-dock/OptionChainTable", () => ({ OptionChainTable: () => <div data-testid="stub-chain" /> }));
vi.mock("../sector/SectorTable", () => ({ SectorTable: () => <div data-testid="stub-sector-table" /> }));
vi.mock("../sector/SectorHeatmapView", () => ({ SectorHeatmapView: () => <div data-testid="stub-sector-map" /> }));
vi.mock("../common/symbolDockContext", () => ({
  useSymbolDock: () => ({ open: vi.fn(), preview: vi.fn(), endPreview: vi.fn() }),
}));
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({ init: () => ({ setOption: () => {}, on: () => {}, resize: () => {}, dispose: () => {} }) }),
}));

const CANVAS: CanvasSize = { w: 1000, h: 700 };
const CONTEXT: Accessor<DockPanelContext> = () => ({ symbol: "NIFTY", market: "india", expiry: "2026-11-26" });

function Desk(props: { windows: WindowState[]; specs: DockPanelSpec[] }) {
  const [layout, setLayout] = createSignal({ windows: props.windows });
  return (
    <WindowManager
      layout={layout()}
      context={CONTEXT}
      onLayoutChange={(next) => setLayout({ windows: next.windows })}
      canvas={CANVAS}
      specs={props.specs}
    />
  );
}

const win = (id: string, type: string): WindowState => ({
  id, type, title: type, x: 10, y: 10, w: 500, h: 300, z: 1,
});

beforeEach(() => {
  ctl.sectorFetches = 0;
  ctl.chainFetches = 0;
  ctl.newsFetches = 0;
  resetSectorState();
});
afterEach(() => {
  cleanup();
  resetSectorState();
  vi.useRealTimers();
});

describe("PERF PROBE — hidden windows stop their work", () => {
  it("(4) sector: minimize the last sector window clears its 60s poll timer", async () => {
    vi.useFakeTimers();
    const { SECTOR_TABLE_PANEL } = await import("./panels/sectorTable");
    render(() => (
      <UIProvider><Desk windows={[win("s", "sector.table")]} specs={[SECTOR_TABLE_PANEL]} /></UIProvider>
    ));
    await Promise.resolve();
    await Promise.resolve();
    const before = vi.getTimerCount();
    fireEvent.click(screen.getByTestId("window-minimize-s"));
    const after = vi.getTimerCount();
    vi.advanceTimersByTime(130_000);
    console.log("[PERF hidden-sector]", JSON.stringify({
      timersWhileVisible: before, timersWhileMinimized: after,
      fetchesOver130sMinimized: ctl.sectorFetches - 1,
    }));
    expect(before).toBe(1);
    expect(after).toBe(0);
    expect(ctl.sectorFetches).toBe(1);
  });

  it("(4) news and chain have no polling loop to leave alive", async () => {
    vi.useFakeTimers();
    const { NEWS_FEED_PANEL } = await import("./panels/newsFeed");
    const { OPTIONS_CHAIN_PANEL } = await import("./panels/optionsChain");
    render(() => (
      <UIProvider>
        <Desk
          windows={[win("n", "news.feed"), win("c", "options.chain")]}
          specs={[NEWS_FEED_PANEL, OPTIONS_CHAIN_PANEL]}
        />
      </UIProvider>
    ));
    await Promise.resolve();
    await Promise.resolve();
    const before = vi.getTimerCount();
    fireEvent.click(screen.getByTestId("window-minimize-n"));
    fireEvent.click(screen.getByTestId("window-minimize-c"));
    const after = vi.getTimerCount();
    vi.advanceTimersByTime(130_000);
    console.log("[PERF hidden-news-chain]", JSON.stringify({
      timersWhileVisible: before, timersWhileMinimized: after,
      fetchesOver130sMinimized: ctl.newsFetches + ctl.chainFetches - 2,
    }));
    expect(after).toBe(0);
    expect(ctl.newsFetches).toBe(1);
    expect(ctl.chainFetches).toBe(1);
  });
});
