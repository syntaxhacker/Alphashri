// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";

import {
  fetchReplayFrames,
  placeOptionPaperOrder,
  previewOptionPaperOrder,
} from "@/api/optionsPaper";
import {
  resetOptionsPaper,
  setPendingOrder,
} from "@/state/optionsPaper";
import { setOptionsDockState } from "@/state/optionsDock";
import type {
  OptionPaperOrderRequest,
  OptionPaperPosition,
  OptionReplayResult,
} from "@/types/optionsPaper";
import { OptionsReplayPage } from "./OptionsReplayPage";
import { projectedMonthlyExpiries, ReplayPanel } from "./ReplayPanel";
import * as palette from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import {
  LOSS_AREA_TINT,
  payoffChartOption,
  pathChartOption,
  PROFIT_AREA_TINT,
} from "./replayCharts";
import { buildPayoff, formatPop } from "@/components/options-dock/PayoffChartCore";
import { toDockLegs } from "@/components/options/PayoffWorkbench";
import { dteYearsBetween } from "@/utils/optionsMath";
import { formatNumberIN } from "@/utils/ui-helpers";

type ChartRow = {
  areaStyle?: { color?: string; opacity?: number };
  markPoint?: { data: Array<{ coord: unknown[] }> };
  markLine?: { data: Array<{ label?: { formatter?: string; backgroundColor?: string } }> };
};
type ChartOption = {
  xAxis: { axisLabel: { fontSize: number } };
  tooltip: {
    backgroundColor: string;
    textStyle: { color: string };
    formatter: (raw: unknown) => string;
  };
  series: ChartRow[];
};

const setChartOption = vi.fn().mockResolvedValue(undefined);
const matrixMocks = vi.hoisted(() => ({
  heatmapProps: {} as Record<string, unknown>,
  notify: vi.fn(),
}));
const tableMocks = vi.hoisted(() => ({
  props: {} as Record<string, unknown>,
}));
const workbenchMocks = vi.hoisted(() => ({
  props: {} as Record<string, unknown>,
}));
const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  searchParams: {} as { underlying?: string; expiry?: string },
  params: {} as { positionId?: string },
}));

vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
    useSearchParams: () => [routerMocks.searchParams],
    useParams: () => routerMocks.params,
  };
});
vi.mock("../report/echartsSolid", () => ({
  createECharts: () => ({ ref: () => {}, setChartOption }),
}));
vi.mock("@/api/optionsPaper", () => ({
  previewOptionPaperOrder: vi.fn(),
  fetchReplayFrames: vi.fn(),
  placeOptionPaperOrder: vi.fn(),
}));
vi.mock("@/components/options/PayoffHeatmap", async () => {
  const { createEffect } = await import("solid-js");
  return {
    PayoffHeatmap: (props: Record<string, unknown>) => {
      createEffect(() => {
        matrixMocks.heatmapProps = {
          legs: props.legs,
          spot: props.spot,
          expiries: props.expiries,
          iv: props.iv,
          rangePct: props.rangePct,
          asOf: props.asOf,
          selectedExpiry: props.selectedExpiry,
        };
      });
      return (
        <div data-testid="mock-payoff-heatmap">
          <button
            data-testid="mock-select-expiry"
            onClick={() => (props.onSelectExpiry as (expiry: string) => void)("2026-11-23")}
          >
            select expiry
          </button>
          <button
            data-testid="mock-select-cell"
            onClick={() => (props.onSelectCell as (strike: number, expiry: string) => void)(85, "2026-11-23")}
          >
            select cell
          </button>
        </div>
      );
    },
  };
});
vi.mock("@/components/options/PayoffTable", async () => {
  const { createEffect } = await import("solid-js");
  return {
    PayoffTable: (props: Record<string, unknown>) => {
      createEffect(() => {
        tableMocks.props = {
          legs: props.legs,
          spot: props.spot,
          iv: props.iv,
          rangePct: props.rangePct,
          asOf: props.asOf,
        };
      });
      return (
        <div data-testid="mock-payoff-table">
          <div data-testid="mock-table-identity">IRFC · 2026-11-23</div>
          <div data-testid="mock-table-kpi-strip">table KPIs</div>
          <table data-testid="mock-table-grid">
            <thead>
              <tr>
                <th data-testid="mock-table-col-spot">SPOT</th>
                <th data-testid="mock-table-col-0">23 NOV</th>
                <th data-testid="mock-table-col-1">18 DEC</th>
              </tr>
            </thead>
            <tbody>
              <tr data-testid="mock-table-row-82.5"><td>82.50</td><td>—</td><td>—</td></tr>
              <tr data-testid="mock-table-row-85"><td>85.00</td><td>—</td><td>—</td></tr>
            </tbody>
          </table>
          <button
            data-testid="mock-table-select-cell"
            onClick={() => (props.onSelectCell as (strike: number, expiry: string) => void)(85, "2026-11-23")}
          >
            select cell
          </button>
          <button
            data-testid="mock-table-range"
            onClick={() => (props.onRangeChange as (value: number) => void)(3)}
          >
            set range
          </button>
          <button
            data-testid="mock-table-view-pnl"
            onClick={() => (props.onViewChange as (view: string) => void)("pnl$")}
          >
            view pnl
          </button>
          <button
            data-testid="mock-table-view-contract"
            onClick={() => (props.onViewChange as (view: string) => void)("contract value")}
          >
            view contract
          </button>
          <button
            data-testid="mock-table-view-table"
            onClick={() => (props.onViewChange as (view: string) => void)("table")}
          >
            view table
          </button>
        </div>
      );
    },
  };
});
// The workbench renders its own ECharts canvas; stub the loader so no real
// echarts import runs in happy-dom. The component itself stays real so the KPI
// values under test come from the same model as production.
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({
    init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
  })),
}));
// Spy wrapper: capture the wiring props while delegating rendering to the real
// workbench (its legacy testids are what the assertions below read).
vi.mock("@/components/options/PayoffWorkbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/options/PayoffWorkbench")>();
  const { createEffect } = await import("solid-js");
  return {
    ...actual,
    PayoffWorkbench: (props: Record<string, any>) => {
      createEffect(() => {
        workbenchMocks.props = {
          legs: props.legs,
          spot: props.spot,
          ivVolPoints: props.ivVolPoints,
          asOf: props.asOf,
          expiry: props.expiry,
          rangePct: props.rangePct,
        };
      });
      return <actual.PayoffWorkbench {...(props as any)} />;
    },
  };
});
vi.mock("@/ui/notifications", () => ({ showNotification: matrixMocks.notify }));

const preview = vi.mocked(previewOptionPaperOrder);
const frames = vi.mocked(fetchReplayFrames);
const place = vi.mocked(placeOptionPaperOrder);

const request: OptionPaperOrderRequest = {
  underlying: "IRFC",
  expiry: "2026-11-23",
  source: "replay",
  entryTs: "2026-11-17T09:47:00+05:30",
  legs: [
    { action: "BUY", opt: "CE", strike: 82.5, lots: 1 },
    { action: "SELL", opt: "CE", strike: 85, lots: 1 },
  ],
};

const replay: OptionReplayResult = {
  positionId: null,
  underlying: "IRFC",
  expiry: "2026-11-23",
  source: "replay",
  legs: [
    { action: "BUY", opt: "CE", strike: 82.5, lots: 1, qty: 5425, entryPremium: 4.8 },
    { action: "SELL", opt: "CE", strike: 85, lots: 1, qty: 5425, entryPremium: 0.5 },
  ],
  frames: [
    {
      t: "2026-11-17T09:48:00+05:30",
      spot: 82.5,
      marks: { "82.5-CE": 4.8, "85-CE": 0 },
      priced: true,
      grossPnl: 0,
      netPnl: -125,
      netDebit: 2400,
      equity: -125,
    },
    {
      t: "2026-11-17T09:49:00+05:30",
      spot: 83,
      marks: { "82.5-CE": 5.1, "85-CE": 0.1 },
      priced: true,
      grossPnl: 100,
      netPnl: -25,
      netDebit: 2400,
      equity: -25,
    },
  ],
  summary: { realized: 0, unrealized: -25, total: -25, maxDrawdown: 125, costs: 125 },
  coverage: { frames: 2, first: "2026-11-17T09:48:00+05:30", last: "2026-11-17T09:49:00+05:30", gaps: 0 },
  payoff: { spots: [80, 85, 90], expiry: [-2400, 100, 2600] },
  breakevens: [84.9],
  netDebit: 2400,
  maxProfit: 2600,
  maxLoss: 2400,
  skipped: null,
};

const position: OptionPaperPosition = {
  id: 9,
  uuid: "pos-9",
  userId: 1,
  source: "replay",
  status: "open",
  underlying: "IRFC",
  expiry: "2026-11-23",
  name: "",
  entryTs: "2026-11-17T09:47:00+05:30",
  entrySpot: 82.4,
  lots: 1,
  netDebit: 2400,
  costsEst: 125,
  maxProfit: 2600,
  maxLoss: 2400,
  breakevens: [84.9],
  realizedPnl: 0,
  closeReason: null,
  closedAt: null,
  notes: "",
  legs: [],
  unrealizedPnl: -25,
  totalPnl: -25,
  markSpot: 83,
  markTs: "2026-11-17T09:49:00+05:30",
  dte: 1,
  createdAt: "2026-11-17T09:47:00+05:30",
  updatedAt: "2026-11-17T09:49:00+05:30",
};

const ASOF_LAST_FRAME = "2026-11-17T09:49:00+05:30";

function workbenchInr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}₹${formatNumberIN(value)}`;
}

// The DS Slider exposes keyboard on its max thumb; happy-dom has no track
// geometry, so pointer dragging is covered by the primitive's own suite.
function moveSlider(testId: string, key: "Home" | "End") {
  fireEvent.keyDown(screen.getByTestId(`${testId}-max`), { key });
}

/** The snapshot the workbench derives from the same props ReplayPanel passes. */
function workbenchSnapshot(ivVolPoints: number | null = null, spot = 83, rangePct = 8) {
  const legs = toDockLegs(
    [
      { action: "BUY", opt: "CE", strike: 82.5, qty: 5425, entryPremium: 4.8 },
      { action: "SELL", opt: "CE", strike: 85, qty: 5425, entryPremium: 0.5 },
    ],
    "2026-11-23",
  );
  const iv = ivVolPoints != null && Number.isFinite(ivVolPoints) && ivVolPoints > 0
    ? ivVolPoints / 100
    : Number.NaN;
  return buildPayoff(legs, spot, iv, dteYearsBetween(ASOF_LAST_FRAME, "2026-11-23"), {
    widthPct: rangePct,
  })!;
}

describe("ReplayPanel", () => {
  beforeEach(() => {
    resetOptionsPaper();
    vi.clearAllMocks();
    matrixMocks.heatmapProps = {};
    tableMocks.props = {};
    workbenchMocks.props = {};
    setOptionsDockState("chain", null);
    setOptionsDockState("expiries", []);
    routerMocks.navigate.mockClear();
    routerMocks.searchParams = {};
    routerMocks.params = {};
    preview.mockResolvedValue(replay);
    frames.mockResolvedValue(replay);
    place.mockResolvedValue({ dryRun: false, position, replay: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubNarrowViewport() {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width: 639px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  }

  test("renders an empty state with no pending structure", () => {
    render(() => <ReplayPanel />);
    expect(screen.getByTestId("replay-empty")).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });

  test("keeps the route shell fixed and gives the replay panel its own scrollport", () => {
    render(() => <OptionsReplayPage />);
    const shell = screen.getByTestId("options-replay-page");
    expect(shell).toHaveClass("h-full", "min-h-0", "flex", "flex-col", "overflow-hidden");

    const panel = screen.getByTestId("options-replay-panel");
    expect(panel).toHaveClass("h-full", "min-h-0", "flex-col", "overflow-hidden");
  });

  test("empty header names the missing structure instead of an em-dash meta", () => {
    render(() => <ReplayPanel />);
    const panel = screen.getByTestId("options-replay-panel");
    expect(panel).not.toHaveTextContent("—");

    const meta = screen.getByTestId("replay-meta");
    expect(meta).toHaveTextContent("NO STRUCTURE SELECTED");
    expect(meta.style.gap).toBe("16px");
    const symbol = screen.getByTestId("replay-symbol-chip");
    expect(symbol).toHaveTextContent("NO STRUCTURE SELECTED");
    expect(symbol.style.color).toBe("var(--ui-badge-muted-main)");
    expect(screen.queryByTestId("replay-expiry-chip")).toBeNull();
    expect(screen.queryByTestId("replay-commit-badge")).toBeNull();
  });

  test("deep-link query seeds the header chips even with no pending structure", () => {
    routerMocks.searchParams = { underlying: "IRFC", expiry: "2026-11-23" };
    render(() => <OptionsReplayPage />);

    const meta = screen.getByTestId("replay-meta");
    expect(screen.getByTestId("replay-symbol-chip")).toHaveTextContent("IRFC");
    expect(screen.getByTestId("replay-expiry-chip")).toHaveTextContent("2026-11-23");
    expect(meta).not.toHaveTextContent("NO STRUCTURE SELECTED");
    expect(screen.queryByTestId("replay-commit-badge")).toBeNull();
    expect(screen.queryByTestId("replay-source-badge")).toBeNull();

    // The empty state and its CTA stay intact for the hint-only deep link.
    expect(screen.getByTestId("replay-empty")).toBeInTheDocument();
    expect(screen.getByTestId("replay-open-dock")).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
    expect(frames).not.toHaveBeenCalled();
  });

  test("hint props render as chips on ReplayPanel without an order", () => {
    render(() => <ReplayPanel hintUnderlying="IRFC" hintExpiry="2026-11-23" />);

    const meta = screen.getByTestId("replay-meta");
    expect(meta).toHaveTextContent("IRFC");
    expect(meta).toHaveTextContent("2026-11-23");
    expect(meta).not.toHaveTextContent("NO STRUCTURE SELECTED");
    expect(screen.getByTestId("replay-empty")).toBeInTheDocument();
  });

  test("empty state centers an icon, a two-line explanation and one Open Options Dock CTA", () => {
    render(() => <ReplayPanel />);
    const empty = screen.getByTestId("replay-empty");
    expect(empty.parentElement!.className).toContain("py-8");
    expect(empty).toHaveAttribute("data-empty-layout", "stack");
    expect(empty).toHaveTextContent("No replay to show");
    expect(empty).toHaveTextContent("Options Dock");

    const cta = screen.getByTestId("replay-open-dock");
    expect(cta).toHaveTextContent("Open Options Dock");
    expect(empty.querySelectorAll("button")).toHaveLength(1);

    fireEvent.click(cta);
    expect(routerMocks.navigate).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith("/screener");
  });

  test("previews the pending structure and slices P&L at the playhead", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    expect(preview).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("replay-total")).toBeInTheDocument();
    expect(screen.getByTestId("replay-total")).toHaveTextContent("-25");
    expect(preview.mock.calls[0][0]).toMatchObject({ source: "replay", underlying: "IRFC" });

    moveSlider("replay-scrubber", "Home");
    expect(screen.getByTestId("replay-total")).toHaveTextContent("-125");
    expect(screen.getByTestId("replay-clock")).toHaveTextContent("2026-11-17 09:48");
    expect(setChartOption).toHaveBeenCalled();
  });

  test("commit posts a non-dry-run order and shows the hold-to-expiry state", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const commit = await screen.findByTestId("replay-commit");
    await waitFor(() => expect(screen.queryByTestId("replay-loading")).toBeNull());
    fireEvent.click(commit);

    expect(await screen.findByTestId("replay-committed-note")).toBeInTheDocument();
    expect(place).toHaveBeenCalledTimes(1);
    expect(place.mock.calls[0][0]).toMatchObject({ source: "replay" });
    expect(place.mock.calls[0][0]).not.toHaveProperty("dryRun");
    expect(screen.getByTestId("replay-commit-badge")).toHaveTextContent("COMMITTED");
  });

  test("loads an existing committed position by id", async () => {
    render(() => <ReplayPanel positionId={9} />);
    expect(await screen.findByTestId("replay-total")).toBeInTheDocument();
    expect(frames).toHaveBeenCalledWith(9);
    expect(preview).not.toHaveBeenCalled();
  });

  test("stat values are never truncated and keep the full value visible", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const debit = await screen.findByTestId("replay-matrix-kpi-debit");
    expect(debit.className).toContain("font-mono");
    expect(debit.className).toContain("tabular-nums");
    expect(debit.className).not.toContain("truncate");
    expect(debit.textContent).toContain("₹");

    const legs = screen.getByTestId("replay-legs");
    const legValues = Array.from(legs.querySelectorAll("[title]")).map((el) => el.getAttribute("title"));
    expect(legValues.some((value) => value?.includes("→"))).toBe(true);
  });

  test("chart containers grow into the viewport with a 240px floor and no height cap", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const panel = await screen.findByTestId("options-replay-panel");
    expect(panel.className).toContain("h-full");
    expect(panel.className).toContain("min-h-0");
    expect(panel.className).toContain("flex-col");
    expect(panel.className).toContain("overflow-hidden");

    const path = await screen.findByTestId("replay-path-chart");
    expect(path.className).toContain("flex-1");
    expect(path.className).toContain("min-h-[240px]");
    expect(path.className).not.toContain("max-h-");
    expect(path.style.height).toBe("");
    expect(path.parentElement?.className).toContain("min-h-0");

    const grid = path.parentElement?.parentElement?.parentElement;
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("lg:grid-cols-2");
    expect(grid?.className).toContain("gap-4");
    expect(grid?.className).toContain("flex-1");
    expect(grid?.className).toContain("min-h-0");

    const workbench = screen.getByTestId("replay-payoff-workbench");
    expect(workbench).toBeInTheDocument();
    expect(screen.getByTestId("replay-payoff-chart")).toBeInTheDocument();
  });

  test("pins controls at the top, legs at the bottom and keeps the KPI strip compact", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const controls = await screen.findByTestId("replay-controls");
    expect(controls.className).toContain("flex");
    expect(controls.className).toContain("items-center");
    expect(controls.className).toContain("shrink-0");

    const playback = screen.getByTestId("replay-playback");
    expect(playback.className).toContain("flex-1");
    expect(playback.className).toContain("min-h-[260px]");

    const legs = screen.getByTestId("replay-legs");
    expect(legs.className).toContain("shrink-0");
    expect(screen.getByTestId("replay-actions").className).toContain("shrink-0");

    const total = screen.getByTestId("replay-total");
    const kpiGrid = total.closest("[class*='divide-x']") as HTMLElement | null;
    expect(kpiGrid).not.toBeNull();
    expect(kpiGrid!.className).toContain("w-full");
    expect(kpiGrid!.style.gap).toBe("8px");
    expect(total.parentElement?.parentElement?.parentElement?.className).toContain("shrink-0");

    const meta = screen.getByTestId("replay-meta");
    expect(meta.className).toContain("items-center");
    expect(meta.style.gap).toBe("16px");
    expect(screen.getByTestId("replay-controls").style.gap).toBe("8px");
    expect(screen.getByTestId("replay-actions").style.gap).toBe("16px");
  });

  test("section headers use label type with a compact vertical rhythm", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const playback = await screen.findByTitle("PLAYBACK");
    for (const heading of [playback, screen.getByTitle("LEGS AT PLAYHEAD")]) {
      expect((heading as HTMLElement).style.fontSize).toBe(`${typeSize("label")}px`);
      const bar = heading.parentElement!;
      expect(bar.className).toContain("py-3");
      expect(bar.className).not.toContain("h-6");
    }
  });

  test("panel root uses the 8px grid gap, never the banned 6px", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    const panel = await screen.findByTestId("options-replay-panel");
    expect(panel.className).toContain("gap-2");
    expect(panel.className).not.toContain("gap-1.5");
  });

  test("legs grid inside the bordered panel drops the divide borders", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-legs");

    const legs = screen.getByTestId("replay-legs");
    const legsGrid = legs.querySelector("[class*='divide-x']") as HTMLElement | null;
    expect(legsGrid).not.toBeNull();
    expect(legsGrid!.className).toContain("[&>*]:border-l-0!");
  });

  test("KPI strip goes 2-up at 390px so full values fit", async () => {
    stubNarrowViewport();
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const total = await screen.findByTestId("replay-total");
    const kpiGrid = total.closest("[class*='divide-x']") as HTMLElement | null;
    expect(kpiGrid).not.toBeNull();
    expect(kpiGrid!.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect((total.querySelector("[title]") as HTMLElement).style.textOverflow).toBe("");
  });

  test("keeps reduced-motion aware transition classes on animated surfaces", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const path = await screen.findByTestId("replay-path-chart");
    expect(path.className).toContain("duration-300");
    expect(path.className).toContain("motion-reduce:transition-none");
    expect(path.className).toContain("motion-reduce:transform-none");

    const workbench = screen.getByTestId("replay-payoff-workbench");
    expect(workbench).toBeInTheDocument();
  });

  test("defaults to the payoff workbench with no IV quote, shows one banner and keeps the secondary tabs reachable", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-payoff-workbench");

    const tableTab = screen.getByTestId("replay-view-tab-table");
    const matrixTab = screen.getByTestId("replay-view-tab-matrix");
    const pathTab = screen.getByTestId("replay-view-tab-path");
    const payoffTab = screen.getByTestId("replay-view-tab-payoff");
    expect(tableTab).toHaveTextContent("ADVANCED");
    expect(tableTab).toHaveTextContent("TABLE");
    expect(tableTab).toHaveTextContent("INTRINSIC ONLY");
    expect(matrixTab).toHaveTextContent("ADVANCED");
    expect(matrixTab).toHaveTextContent("PAYOFF MATRIX");
    expect(matrixTab).toHaveTextContent("INTRINSIC ONLY");
    expect(pathTab).toHaveTextContent("P&L PATH");
    expect(payoffTab).toHaveTextContent("EXPIRY PAYOFF");
    // The workbench is the default; no IV never auto-selects a secondary tab.
    expect(payoffTab).toHaveAttribute("aria-selected", "true");
    expect(tableTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("replay-charts-grid").style.display).toBe("grid");

    // One KPI strip only, owned by the workbench — not a second one in playback.
    expect(screen.getAllByTestId("replay-matrix-kpis")).toHaveLength(1);
    expect(screen.getByTestId("replay-matrix-kpi-debit")).toBeInTheDocument();

    const bannerText = "No IV quote in the recorded chain — payoff shows intrinsic P&L only.";
    expect(screen.getByTestId("replay-iv-banner")).toHaveTextContent(bannerText);
    expect(screen.getAllByText(bannerText)).toHaveLength(1);
    expect(screen.getByTestId("replay-table-intrinsic-badge")).toHaveTextContent("INTRINSIC ONLY");

    fireEvent.click(matrixTab);
    expect(matrixTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("replay-charts-grid").style.display).toBe("none");

    fireEvent.click(tableTab);
    expect(tableTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("replay-charts-grid").style.display).toBe("none");

    fireEvent.click(pathTab);
    expect(pathTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("replay-charts-grid").style.display).toBe("grid");

    fireEvent.click(payoffTab);
    expect(payoffTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("replay-charts-grid").style.display).toBe("grid");
  });

  test("KPI strip renders values from the payoff workbench model", async () => {
    setOptionsDockState("chain", {
      expiry: "2026-11-23", spot: 83, pcr: null, atmIv: 14.2, rows: [], asOf: null,
    } as never);
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-payoff-workbench");

    const expected = workbenchSnapshot(14.2)!;
    expect(screen.getByTestId("replay-matrix-kpi-debit")).toHaveTextContent(workbenchInr(expected.netPremium));
    expect(screen.getByTestId("replay-matrix-kpi-max-loss")).toHaveTextContent(workbenchInr(expected.maxLoss));
    expect(screen.getByTestId("replay-matrix-kpi-max-profit")).toHaveTextContent(workbenchInr(expected.maxProfit));
    expect(screen.getByTestId("replay-matrix-kpi-pop")).toHaveTextContent(formatPop(expected.pop));
    expect(screen.getByTestId("replay-matrix-kpi-breakevens")).toHaveTextContent(
      expected.breakevens.map((be) => `₹${formatNumberIN(be)}`).join(" / ") || "—",
    );
    expect(workbenchMocks.props.ivVolPoints).toBe(14.2);
  });

  test("null pop renders an em-dash and the IV-unavailable tooltip", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-payoff-workbench");

    expect(screen.getByTestId("replay-matrix-kpi-pop")).toHaveTextContent("—");
    expect(screen.getByTestId("replay-matrix-kpi-pop-tooltip-wrapper")).toHaveAttribute(
      "aria-label",
      "IV unavailable — intrinsic only",
    );
    expect(screen.getByTestId("replay-iv-readout")).toHaveTextContent("IV unavailable");
    expect(workbenchMocks.props.ivVolPoints).toBeNull();
  });

  test("range slider updates rangePct on the workbench, matrix and heatmap", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-range-slider");

    expect(matrixMocks.heatmapProps.rangePct).toBe(0.08);
    expect(workbenchMocks.props.rangePct).toBe(8);
    expect(screen.getByTestId("replay-range-label")).toHaveTextContent("±8%");

    moveSlider("replay-range-slider", "End");
    expect(matrixMocks.heatmapProps.rangePct).toBe(0.2);
    expect(screen.getByTestId("replay-range-label")).toHaveTextContent("±20%");
    await waitFor(() => expect(workbenchMocks.props.rangePct).toBe(20));
  });

  test("dense table stays reachable as an ADVANCED tab with identity and dated rows/columns", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("mock-payoff-table");

    expect(screen.getByTestId("replay-view-tab-table")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("replay-view-tab-table")).toHaveTextContent("ADVANCED");
    expect(screen.getByTestId("mock-table-identity")).toBeInTheDocument();
    expect(screen.getByTestId("mock-table-kpi-strip")).toBeInTheDocument();
    expect(screen.getByTestId("mock-table-grid")).toBeInTheDocument();
    expect(screen.getByTestId("mock-table-col-spot")).toHaveTextContent("SPOT");
    expect(screen.getByTestId("mock-table-col-0")).toHaveTextContent("23 NOV");
    expect(screen.getByTestId("mock-table-col-1")).toHaveTextContent("18 DEC");
    expect(screen.getByTestId("mock-table-row-82.5")).toBeInTheDocument();
    expect(screen.getByTestId("mock-table-row-85")).toBeInTheDocument();

    expect(tableMocks.props.spot).toBe(83);
    expect(tableMocks.props.rangePct).toBe(0.08);
    expect(tableMocks.props.asOf).toBe("2026-11-17");
    expect(tableMocks.props.iv).toBeNull();
    expect(Array.isArray(tableMocks.props.legs)).toBe(true);
    expect((tableMocks.props.legs as unknown[]).length).toBe(2);
  });

  test("table onRangeChange drives the shared range slider and both payoff models", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("mock-payoff-table");

    const slider = screen.getByTestId("replay-range-slider-max");
    expect(tableMocks.props.rangePct).toBe(0.08);
    expect(slider).toHaveAttribute("aria-valuenow", "1");

    fireEvent.click(screen.getByTestId("mock-table-range"));
    expect(screen.getByTestId("replay-range-label")).toHaveTextContent("±20%");
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(matrixMocks.heatmapProps.rangePct).toBe(0.2);
    expect(tableMocks.props.rangePct).toBe(0.2);
    await waitFor(() => expect(workbenchMocks.props.rangePct).toBe(20));
  });

  test("table cell selection moves the playhead and announces the strike", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("mock-table-select-cell");

    moveSlider("replay-scrubber", "Home");
    expect(screen.getByTestId("replay-clock")).toHaveTextContent("2026-11-17 09:48");

    fireEvent.click(screen.getByTestId("mock-table-select-cell"));
    expect(screen.getByTestId("replay-cell-note")).toHaveTextContent("₹85 · 2026-11-23");
    expect(screen.getByTestId("replay-cell-note")).toHaveTextContent("clamped to frame 2/2");
    expect(screen.getByTestId("replay-clock")).toHaveTextContent("2026-11-17 09:49");
    expect(matrixMocks.notify).toHaveBeenCalledTimes(1);
  });

  test("table bottom view tabs switch the workstation chart tabs", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("mock-table-view-pnl");
    const grid = screen.getByTestId("replay-charts-grid");

    fireEvent.click(screen.getByTestId("mock-table-view-pnl"));
    expect(screen.getByTestId("replay-view-tab-path")).toHaveAttribute("aria-selected", "true");
    expect(grid.style.display).toBe("grid");

    fireEvent.click(screen.getByTestId("mock-table-view-contract"));
    expect(screen.getByTestId("replay-view-tab-payoff")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByTestId("mock-table-view-table"));
    expect(screen.getByTestId("replay-view-tab-table")).toHaveAttribute("aria-selected", "true");
    expect(grid.style.display).toBe("none");
  });

  test("table receives recorded IV in decimal form and drops the intrinsic badge", async () => {
    setOptionsDockState("chain", {
      expiry: "2026-11-23",
      spot: 83,
      pcr: null,
      atmIv: 14.2,
      rows: [],
      asOf: null,
    } as never);
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("mock-payoff-table");

    expect(tableMocks.props.iv).toBeCloseTo(0.142);
    expect(screen.getByTestId("replay-iv-readout")).toHaveTextContent("14.20% IV");
    expect(screen.queryByTestId("replay-table-intrinsic-badge")).toBeNull();
  });

  test("defaults to the payoff workbench even when the recorded chain has an IV quote", async () => {
    setOptionsDockState("chain", {
      expiry: "2026-11-23",
      spot: 83,
      pcr: null,
      atmIv: 14.2,
      rows: [],
      asOf: null,
    } as never);
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-payoff-workbench");

    expect(screen.getByTestId("replay-view-tab-payoff")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("replay-view-tab-table")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("replay-view-tab-table")).not.toHaveTextContent("INTRINSIC ONLY");
    expect(screen.getByTestId("replay-view-tab-matrix")).not.toHaveTextContent("INTRINSIC ONLY");
    expect(screen.queryByTestId("replay-iv-banner")).toBeNull();
    expect(screen.queryByTestId("replay-table-intrinsic-badge")).toBeNull();
    expect(screen.getByTestId("replay-charts-grid").style.display).toBe("grid");
    expect(workbenchMocks.props.ivVolPoints).toBe(14.2);
  });

  test("uses chain ATM IV in decimal form when the dock has a chain", async () => {
    setOptionsDockState("chain", {
      expiry: "2026-11-23",
      spot: 83,
      pcr: null,
      atmIv: 14.2,
      rows: [],
      asOf: null,
    } as never);
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-iv-readout");

    expect(screen.getByTestId("replay-iv-readout")).toHaveTextContent("14.20% IV");
    expect(matrixMocks.heatmapProps.iv).toBeCloseTo(0.142);
    expect(workbenchMocks.props.ivVolPoints).toBe(14.2);
  });

  test("selecting a heatmap cell clamps the playhead, notes the strike and toasts", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("mock-select-cell");

    moveSlider("replay-scrubber", "Home");
    expect(screen.getByTestId("replay-clock")).toHaveTextContent("2026-11-17 09:48");

    fireEvent.click(screen.getByTestId("mock-select-cell"));
    expect(screen.getByTestId("replay-cell-note")).toHaveTextContent("₹85 · 2026-11-23");
    expect(screen.getByTestId("replay-cell-note")).toHaveTextContent("clamped to frame 2/2");
    expect(screen.getByTestId("replay-clock")).toHaveTextContent("2026-11-17 09:49");
    expect(matrixMocks.notify).toHaveBeenCalledTimes(1);
  });

  test("onSelectExpiry updates the highlighted expiry passed back to the heatmap", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("mock-select-expiry");

    fireEvent.click(screen.getByTestId("mock-select-expiry"));
    expect(matrixMocks.heatmapProps.selectedExpiry).toContain("23 Nov");
  });

  test("projects monthly expiries when the dock has no chain data", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-matrix-kpis");

    expect(screen.getByTestId("replay-projected-note")).toBeInTheDocument();
    const expiries = matrixMocks.heatmapProps.expiries as string[];
    expect(expiries).toHaveLength(3);
    for (const expiry of expiries) {
      expect(expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("projected monthly expiries keep the source weekday and ordinal", () => {
    const out = projectedMonthlyExpiries("2026-11-20");
    expect(out).toHaveLength(3);
    for (const entry of out) {
      expect(entry.projected).toBe(true);
      expect(entry.label).toContain("projected");
      expect(new Date(`${entry.date}T00:00:00Z`).getUTCDay()).toBe(5);
    }
  });

  test("section boundaries and inset separators use distinct semantic border tokens", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    const playback = await screen.findByTestId("replay-playback");
    expect(playback.className).toContain("border-fin-border-default");

    const headerRule = playback.querySelector(".border-b") as HTMLElement;
    expect(headerRule.className).toContain("border-fin-border-subtle");
    const kpiBox = screen.getByTestId("replay-matrix-kpi-breakevens").parentElement?.parentElement as HTMLElement;
    expect(kpiBox.className).toContain("border-fin-border-subtle");
    const tablist = screen.getByTestId("replay-view-tablist");
    expect(tablist.style.borderBottomColor).toBe("var(--color-fin-border-subtle)");
  });

  test("a loaded structure with no frames explains the missing frames", async () => {
    preview.mockResolvedValue({ ...replay, frames: [], coverage: { ...replay.coverage, frames: 0 } });
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    expect(await screen.findByTestId("replay-missing-frames")).toHaveTextContent("No frames were returned");
    expect(screen.getByTestId("replay-empty")).toHaveTextContent("No replay frames");
  });

  test("a failed preview leads with human copy and demotes the API error to detail", async () => {
    preview.mockRejectedValueOnce(new Error("HTTP 502 upstream connect ECONNRESET"));
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const alert = await screen.findByTestId("replay-error");
    expect(alert.textContent ?? "").toContain("Couldn't load this replay");
    expect(alert.textContent?.startsWith("HTTP")).toBe(false);
    expect(alert.querySelector("details")?.textContent).toContain("ECONNRESET");
    expect(alert.querySelector("[title]")).toHaveAttribute("title", "HTTP 502 upstream connect ECONNRESET");
  });

  test("a failed commit leads with human copy and keeps the transport error in detail", async () => {
    place.mockRejectedValueOnce(new Error("POST /api/options/paper/order 500"));
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const commit = await screen.findByTestId("replay-commit");
    await waitFor(() => expect(screen.queryByTestId("replay-loading")).toBeNull());
    fireEvent.click(commit);

    const alert = await screen.findByTestId("replay-error");
    expect(alert.textContent ?? "").toContain("Couldn't commit this structure");
    expect(alert.querySelector("details")?.textContent).toContain("POST /api/options/paper/order 500");
  });

  test("390px keeps tab labels on one line and the dense table scrollable", async () => {
    stubNarrowViewport();
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-table-scroll");

    const tablist = screen.getByTestId("replay-view-tablist");
    expect(tablist.className).toContain("overflow-x-auto");
    for (const testId of [
      "replay-view-tab-payoff", "replay-view-tab-path", "replay-view-tab-table", "replay-view-tab-matrix",
    ]) {
      const tab = screen.getByTestId(testId);
      expect(tab.className).toContain("whitespace-nowrap");
      expect((tab.textContent ?? "").trim().split(/\s+/)).toHaveLength(1);
    }
    expect(screen.getByTestId("replay-view-tab-table")).toHaveTextContent("TABLE");
    expect(screen.getByTestId("replay-view-tab-matrix")).toHaveTextContent("MATRIX");
    expect(screen.queryByTestId("replay-playhead")).toBeNull();

    const scroller = screen.getByTestId("replay-table-scroll");
    expect(scroller.className).toContain("overflow-x-auto");
    expect(scroller).toHaveAttribute("aria-label", "Payoff table, scroll sideways for more strikes");
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("replay-table-scroll-hint")).toHaveTextContent("Scroll sideways");
  });

  test("wide viewports keep descriptive tab labels and a persistent scroll hint", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-table-scroll");

    expect(screen.getByTestId("replay-view-tab-table")).toHaveTextContent("ADVANCED · TABLE");
    expect(screen.getByTestId("replay-view-tab-matrix")).toHaveTextContent("PAYOFF MATRIX");
    expect(screen.getByTestId("replay-table-scroll-hint")).toHaveTextContent("Scroll sideways");
    expect(screen.getByTestId("replay-playhead")).toBeInTheDocument();
  });

  test("payoff-at-spot and summary placeholders explain the missing curve and range", async () => {
    preview.mockResolvedValue({ ...replay, payoff: { spots: [], expiry: [] }, breakevens: [] });
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const stat = await screen.findByTestId("replay-payoff-at-spot");
    const value = stat.querySelector("[title]") as HTMLElement;
    expect(value).toHaveTextContent("—");
    expect(value.getAttribute("title") ?? "").toContain("No payoff curve");
    const be = screen.getByTestId("replay-matrix-kpi-breakevens");
    expect(be).toBeInTheDocument();
  });

  test("projected expiries are labelled individually in the projection note", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-projected-note");

    const note = screen.getByTestId("replay-projected-note");
    expect(note.textContent ?? "").toMatch(/2026-12-\d\d · projected/);
    expect(note).toHaveTextContent("no prices are inferred");
  });

  test("tabs, sliders and the play control expose stable keyboard affordances", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-matrix-kpis");

    const tabs = [
      ["replay-view-tab-table", "TABLE"],
      ["replay-view-tab-matrix", "PAYOFF MATRIX"],
      ["replay-view-tab-path", "P&L PATH"],
      ["replay-view-tab-payoff", "EXPIRY PAYOFF"],
    ] as const;
    for (const [testId, name] of tabs) {
      const tab = screen.getByTestId(testId);
      expect(tab.textContent?.trim()).toContain(name);
      expect(tab).toHaveAttribute("role", "tab");
    }
    expect(screen.getByTestId("replay-view-tab-table")).toHaveTextContent("INTRINSIC ONLY");
    expect(screen.getByTestId("replay-view-tab-matrix")).toHaveTextContent("INTRINSIC ONLY");

    const scrubber = screen.getByTestId("replay-scrubber-max");
    expect(scrubber).toHaveAttribute("aria-label", "Replay playhead maximum");
    expect(scrubber.getAttribute("aria-valuetext") ?? "").toContain("Frame 2 of 2");
    const range = screen.getByTestId("replay-range-slider-max");
    expect(range).toHaveAttribute("aria-label", "Payoff matrix spot range maximum");
    expect(range.getAttribute("aria-valuetext") ?? "").toContain("8 percent");

    const play = screen.getByTestId("replay-play");
    expect(play).toHaveAttribute("aria-label", "Play replay");
    expect(play).toHaveAttribute("title", "Play replay (Space)");
    fireEvent.click(play);
    expect(play).toHaveAttribute("aria-label", "Pause replay");
    expect(play).toHaveAttribute("title", "Pause replay (Space)");
  });

  test("heatmap keyboard mirror and cell note share one announced selection path", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("mock-select-cell");
    expect(screen.getByTestId("replay-keyboard-hint")).toHaveTextContent("arrow keys move");

    fireEvent.click(screen.getByTestId("mock-select-cell"));
    const note = screen.getByTestId("replay-cell-note");
    expect(note.parentElement).toHaveAttribute("role", "status");
    expect(note.parentElement).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("replay-clock")).toHaveTextContent("2026-11-17 09:49");
  });

  test("chart grid keeps a 240px floor while either chart tab is visible", async () => {
    setPendingOrder(request);
    render(() => <ReplayPanel />);
    await screen.findByTestId("replay-charts-grid");
    const grid = screen.getByTestId("replay-charts-grid");
    expect(grid.style.minHeight).toBe("240px");

    fireEvent.click(screen.getByTestId("replay-view-tab-path"));
    expect(grid.style.display).toBe("grid");
    expect(grid.style.minHeight).toBe("240px");
    expect(grid.querySelector("[data-testid='replay-path-chart']")).not.toBeNull();
  });

  test("chart options use readable labels, tinted areas and surfaced mark labels", () => {
    const path = pathChartOption(replay, replay.frames[1].t) as unknown as ChartOption;
    expect(path.xAxis.axisLabel.fontSize).toBe(typeSize("micro"));
    expect(path.tooltip.backgroundColor).toBe(palette.TOOLTIP_BG);
    expect(path.tooltip.textStyle.color).toBe(palette.TOOLTIP_TEXT);
    expect(path.tooltip.formatter([
      { seriesName: "net P&L", axisValue: replay.frames[1].t, value: [replay.frames[1].t, -25] },
    ])).toContain("Mark-to-market");

    const rows = path.series;
    expect(rows[0].areaStyle?.color).toBe(PROFIT_AREA_TINT);
    expect(rows[0].areaStyle?.opacity).toBeUndefined();
    expect(rows[2].markLine?.data[0].label?.backgroundColor).toBe(palette.SURFACE);
    expect(rows[2].markPoint?.data[0].coord).toEqual([replay.frames[1].t, -25]);

    const payoff = payoffChartOption(replay, 83, -900) as unknown as ChartOption;
    const pRows = payoff.series;
    expect(pRows[1].areaStyle?.color).toBe(LOSS_AREA_TINT);
    expect(pRows[2].markPoint?.data[0].coord).toEqual([83, -900]);
    const spot = pRows[2].markLine?.data.find((mark) => mark.label?.formatter === "SPOT");
    expect(spot?.label?.backgroundColor).toBe(palette.SURFACE);
    expect(payoff.tooltip.formatter({ value: [83, -900] })).toContain("Expiry payoff");
  });
});

describe("ReplayPanel data provenance", () => {
  beforeEach(() => {
    resetOptionsPaper();
    vi.clearAllMocks();
    matrixMocks.heatmapProps = {};
    workbenchMocks.props = {};
    setOptionsDockState("symbol", null);
    setOptionsDockState("chain", null);
    setOptionsDockState("expiries", []);
    preview.mockResolvedValue(replay);
    frames.mockResolvedValue(replay);
    setChartOption.mockImplementation(() => Promise.resolve(undefined));
  });

  afterEach(() => {
    setChartOption.mockImplementation(() => Promise.resolve(undefined));
  });

  const dockChain = (atmIv: number) => ({
    expiry: "2026-11-23", spot: 24000, pcr: null, atmIv, rows: [], asOf: null,
  } as never);

  test("a live dock chain for a different underlying never prices the replay", async () => {
    setOptionsDockState("symbol", "NIFTY");
    setOptionsDockState("chain", dockChain(18.4));
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    expect(await screen.findByTestId("replay-iv-readout")).toHaveTextContent("IV unavailable");
    expect(screen.getByTestId("replay-iv-banner")).toBeInTheDocument();
    expect(workbenchMocks.props.ivVolPoints).toBeNull();
  });

  test("a zero ATM IV from the dock does not hide the recorded preview IV", async () => {
    setOptionsDockState("symbol", "IRFC");
    setOptionsDockState("chain", dockChain(0));
    setPendingOrder({ ...request, atmIv: 14.2 } as never);
    render(() => <ReplayPanel />);

    expect(await screen.findByTestId("replay-iv-readout")).toHaveTextContent("14.20% IV");
    expect(screen.queryByTestId("replay-iv-banner")).toBeNull();
    expect(workbenchMocks.props.ivVolPoints).toBe(14.2);
  });

  test("expiries come from the dock only when it holds the replay underlying", async () => {
    setOptionsDockState("symbol", "NIFTY");
    setOptionsDockState("expiries", [
      { date: "2026-12-10" }, { date: "2027-01-14" },
    ] as never);
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    await screen.findByTestId("replay-matrix-kpis");
    const expiries = matrixMocks.heatmapProps.expiries as string[];
    expect(expiries).toHaveLength(3);
    expect(expiries).not.toContain("2026-12-10");
    expect(screen.getByTestId("replay-projected-note")).toBeInTheDocument();
  });

  test("a failed chart chunk load is shown instead of failing silently", async () => {
    setChartOption.mockImplementation(() => Promise.reject(new Error("echarts chunk failed")));
    setPendingOrder(request);
    render(() => <ReplayPanel />);

    const alert = await screen.findByTestId("replay-chart-error");
    expect(alert).toHaveTextContent("The P&L chart couldn't be drawn");
    expect(alert.querySelector("details")?.textContent).toContain("echarts chunk failed");
    expect(alert.querySelector("[title]")).toHaveAttribute("title", "echarts chunk failed");
  });

  test("a cached preview is reused only for the exact structure that produced it", async () => {
    const first = {
      ...replay,
      frames: [replay.frames[0]],
      summary: { ...replay.summary, total: -125 },
    };
    preview.mockResolvedValueOnce(first);
    setPendingOrder(request);
    const firstView = render(() => <ReplayPanel />);
    expect(await screen.findByTestId("replay-total")).toHaveTextContent("-125");
    firstView.unmount();

    const secondRequest = { ...request, entryTs: "2026-11-18T09:47:00+05:30" };
    preview.mockResolvedValueOnce({
      ...replay,
      frames: [replay.frames[1]],
      summary: { ...replay.summary, total: -25 },
    });
    setPendingOrder(secondRequest);
    render(() => <ReplayPanel />);

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("replay-total")).toHaveTextContent("-25");
  });
});
