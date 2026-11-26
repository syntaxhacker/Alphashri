// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import { chainRow, reportWith } from "./reportCells.fixtures";
import { chainAt } from "./reportTestFixtures";
import type { HeatmapTapeRow } from "./niftyOiHeatmap";

const env = vi.hoisted(() => ({ mobile: true }));

const [report] = createSignal(
  reportWith({
    spot: 25_000,
    strikes: [24_800, 24_900, 25_000, 25_100, 25_200].map(chainRow),
  }),
);
const [sideTab] = createSignal("chain");
const [tapeRows, setTapeRows] = createSignal<HeatmapTapeRow[]>([]);

const mockStore = {
  data: {
    report,
    breadth: () => ({ available: true, count: 1, up: 1, rows: [] }),
    oiScale: () => ({ maxCeOiChange: 200, maxPeOiChange: 200 }),
    atmStrike: () => 25_000,
    oiWalls: () => null,
    visibleStrikes: () => report()?.strikes ?? [],
    effectiveBursts: () => [],
    tape: () => [],
    oiPoints: () => [],
    flipAt: () => null,
    tapeRows: () => tapeRows(),
    metrics: () => null,
    intradayStart: () => null,
  },
  walls: { data: () => null },
  selection: { mode: () => "live", symbol: () => "NIFTY" },
  replay: { frameT: () => null },
  ui: {
    isDesk: () => true,
    setDeskOpen: () => {},
    deskOpen: () => false,
    sideTab,
    chartSize: () => "fill",
    heatMetric: () => "oi",
    view: () => "chart",
    chartTf: () => "1m",
    handleChartTf: () => {},
    handleChartSize: () => {},
    openChartFull: () => {},
    setSideTab: () => {},
    setHeatMetric: () => {},
    setHeatExpand: () => {},
    openOiExpand: () => {},
    setGexOpen: () => {},
    setIvOpen: () => {},
    deskDockTab: () => "flow",
    setDeskDockTab: () => {},
  },
};

vi.mock("./ReportContext", () => ({ useNiftyReport: () => mockStore }));
vi.mock("./NiftyChartPanel", () => ({ NiftyChartPanel: () => <div data-testid="chart-stub" /> }));
vi.mock("./NiftyDeltaPositioning", () => ({ NiftyDeltaPositioning: () => null }));
vi.mock("./NiftyGexProfile", () => ({ NiftyGexProfile: () => null }));
vi.mock("./NiftyIvSkew", () => ({ NiftyIvSkew: () => null }));
vi.mock("./NiftyOiHeatmap", () => ({ NiftyOiHeatmap: () => null }));

const { ReportWorkspace } = await import("./ReportWorkspace");

const realMatchMedia = window.matchMedia;
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("max-width: 600px") ? env.mobile : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});
afterAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: realMatchMedia,
  });
});
afterEach(() => {
  cleanup();
  setTapeRows([]);
});

function mount() {
  return render(() => (
    <UIProvider>
      <ReportWorkspace secondaryTabs={[]} />
    </UIProvider>
  ));
}

describe("ReportWorkspace — 390 chain rail and dock footer", () => {
  test("the phone row shows both side tabs, the chain header, two strike rows with ATM and a scroll cue", () => {
    env.mobile = true;
    mount();

    const grid = screen.getByTestId("nifty-main-row");
    expect(grid).toHaveAttribute("data-report-order", "chart");
    expect(grid.className).toContain("max-[600px]:grid-rows-[minmax(0,1fr)_minmax(0,156px)]!");
    expect(grid.className).not.toContain("min-h-[300px]");
    expect(grid.className).not.toContain("max-h-[58vh]");
    expect(screen.getByTestId("nifty-side-tab-chain")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-side-tab-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-panel")).toHaveTextContent("Option-chain OI (±750 ATM)");

    const table = screen.getByTestId("nifty-oi-table");
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("nifty-strike-atm")).toHaveTextContent("25,000");
    expect(rows.some((row) => row.getAttribute("data-chain-focus") === "1")).toBe(true);

    const wrap = screen.getByTestId("nifty-oi-wrap");
    expect(wrap).toHaveAttribute("data-chain-scroll", "1");
    expect(wrap).toHaveAttribute("data-chain-v-scroll", "1");
    expect(wrap.className).toContain("max-[600px]:max-h-full!");
    expect(screen.getByTestId("nifty-chain-scroll-cue")).toHaveTextContent("⇄");
    const sig = screen.getByTestId("nifty-chain-mobile-sig");
    expect(sig).toHaveTextContent("CE SIG");
    expect(sig).toHaveTextContent("PE SIG");
    expect(sig).toHaveTextContent("LB");
    expect(sig).toHaveTextContent("SB");
  });

  test("the collapsed phone heatmap names the CE/PE OI walls from the tape", () => {
    env.mobile = true;
    const strikes = [24_900, 25_000, 25_100];
    setTapeRows([
      {
        t: "2026-10-12T09:15:00+05:30",
        spot: 25_000,
        max_pain: 25_000,
        chain: chainAt(strikes, 1_000, 1_000),
      },
      {
        t: "2026-10-12T09:16:00+05:30",
        spot: 25_010,
        max_pain: 25_000,
        chain: {
          ...chainAt(strikes, 1_000, 1_000),
          "25100": [10, 12, 5_000, 1_000, 1, 1],
          "24900": [10, 12, 1_000, 5_000, 1, 1],
        },
      },
    ]);
    mount();
    expect(screen.getByTestId("nifty-mobile-walls-read")).toHaveTextContent(
      /CE 25,100 · PE 24,900/,
    );
  });

  test("the pinned DESK BAY bar scrolls horizontally with a right-edge fade and chevron", () => {
    env.mobile = true;
    mount();

    const wrap = screen.getByTestId("desk-dock-overflow-wrap");
    expect(wrap.className).toContain("max-[600px]:order-3");
    expect(wrap.className).toContain("max-[600px]:[&_[data-testid='desk-dock']]:flex-nowrap!");
    expect(wrap.className).toContain("max-[600px]:[&_[data-testid='desk-dock']]:overflow-x-auto!");

    const bar = screen.getByTestId("desk-dock");
    expect(bar).toHaveTextContent("DESK BAY");
    expect(screen.getByTestId("desk-dock-setup")).toHaveTextContent("Dealer gamma");

    const cue = screen.getByTestId("desk-dock-overflow-cue");
    expect(cue).toHaveTextContent("›");
    expect(cue.className).toContain("max-[600px]:flex");
    expect(cue.className).toContain("pointer-events-none");
    expect((cue as HTMLElement).style.background).toContain("linear-gradient");
  });
});
