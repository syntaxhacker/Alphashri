// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import { MOBILE_CHART_TARGET } from "./NiftyChartPanel";

const env = vi.hoisted(() => ({ mobile: false }));

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: () => <div data-testid="tradingview-chart" />,
}));
vi.mock("@/hooks/useFyersTickStream", () => ({
  useFyersTickStream: () => ({
    isLive: () => false,
    isReconnecting: () => false,
    isMarketClosed: () => false,
    isDisconnected: () => false,
    lastTick: () => null,
  }),
}));
vi.mock("./useNiftyPatternScan", () => ({
  PATTERN_LOOKBACK_BARS: 40,
  useNiftyPatternScan: () => ({
    state: () => ({ status: "idle", hits: [], tf: "1m", dataThrough: null, message: "" }),
    scan: () => {},
  }),
}));

const { NiftyChartPanel: Panel } = await import("./NiftyChartPanel");

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
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

afterEach(() => {
  cleanup();
  env.mobile = false;
  window.localStorage.clear();
});

const report = {
  mode: "live",
  date: "2026-10-12",
  expiry: "weekly",
  spot: 25_750,
  ohlc: { open: 25_600, high: 25_800, low: 25_550, close: 25_750 },
  pcrOi: 1.1,
  pcrVol: 0.9,
  maxPain: 25_700,
  strikes: [],
  walls: null,
  gex: null,
  candles: [
    { time: "2026-10-12T09:15:00", open: 25_600, high: 25_650, low: 25_580, close: 25_620 },
    { time: "2026-10-12T09:16:00", open: 25_620, high: 25_680, low: 25_600, close: 25_640 },
  ],
} as any;

function mount() {
  return render(() => (
    <UIProvider>
      <Panel report={report} mode="live" view="chart" onExpand={() => {}} />
    </UIProvider>
  ));
}

describe("NiftyChartPanel — mobile header controls (390px)", () => {
  test("only the source toggle stays inline; the other four groups sit behind MORE", () => {
    env.mobile = true;
    mount();

    const row = screen.getByTestId("nifty-chart-controls-mobile");
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    expect(screen.getByTestId("nifty-chart-source")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-controls-more")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByTestId("nifty-tf-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-size")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-patterns-scan")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-expand")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("nifty-chart-controls-more"));
    expect(screen.getByTestId("nifty-chart-controls-more")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const extra = screen.getByTestId("nifty-chart-controls-extra");
    expect(extra.scrollWidth).toBeLessThanOrEqual(extra.clientWidth);
    for (const id of ["nifty-tf-toggle", "nifty-chart-size", "nifty-patterns-scan", "nifty-chart-expand"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  test("the chart body keeps its 240px floor and the panel gutter is zeroed on mobile only", () => {
    env.mobile = true;
    mount();
    expect(MOBILE_CHART_TARGET).toBeGreaterThanOrEqual(220);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute(
      "data-mobile-chart-min",
      String(MOBILE_CHART_TARGET),
    );
    // Every inset override is guarded by the phone breakpoint; desktop rects
    // cannot move because these rules only match max-width:600px.
    const cls = screen.getByTestId("nifty-chart-panel").className;
    expect(cls).toContain("max-[600px]:[&_[data-compact-card-content]]:p-0");
    expect(cls).toContain("max-[600px]:[&_[data-compact-card-content]]:gap-0");
  });

  test("the chart title stacks above the controls below 640px and keeps its full text", () => {
    env.mobile = true;
    mount();

    const panel = screen.getByTestId("nifty-chart-panel");
    const header = panel.firstElementChild as HTMLElement;
    const title = screen.getByTestId("nifty-chart-title");
    const controls = screen.getByTestId("nifty-chart-controls-mobile");
    expect(header.children[0]).toContainElement(title);
    expect(header.children[1]).toBe(controls);

    expect(title).toHaveTextContent("NIFTY chart");
    expect(title.className).toContain("max-[640px]:whitespace-normal");
    expect(title.className).toContain("max-[640px]:shrink");
    expect(title.style.whiteSpace).toBe("");

    const cls = panel.className;
    for (const rule of [
      "max-[640px]:[&>div:first-child]:flex-col",
      "max-[640px]:[&>div:first-child]:items-stretch",
      "max-[640px]:[&>div:first-child]:gap-y-1",
    ]) {
      expect(cls).toContain(rule);
    }
  });

  test("desktop keeps the original single control row", () => {
    env.mobile = false;
    mount();
    expect(screen.queryByTestId("nifty-chart-controls-mobile")).not.toBeInTheDocument();
    for (const id of ["nifty-chart-source", "nifty-tf-toggle", "nifty-chart-size", "nifty-patterns-scan", "nifty-chart-expand"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});
