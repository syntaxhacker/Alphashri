// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

const FLOOR = 11;
const ROOT = process.cwd();
const OWNED_FILES = [
  "src/pages/report/NiftyChartPanel.tsx",
  "src/components/layout/MarketTicker.tsx",
] as const;

const FONT_SIZE =
  /text-\[(\d+(?:\.\d+)?)px\]|"font-size":\s*"(\d+(?:\.\d+)?)px"|font-size="(\d+(?:\.\d+)?)"|fontSize:\s*(\d+(?:\.\d+)?)\b/g;

function literalSizes(): Array<{ file: string; line: number; px: number }> {
  return OWNED_FILES.flatMap((file) => {
    const out: Array<{ file: string; line: number; px: number }> = [];
    readFileSync(join(ROOT, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const match of line.matchAll(FONT_SIZE)) {
          out.push({
            file,
            line: i + 1,
            px: Number(match[1] ?? match[2] ?? match[3] ?? match[4]),
          });
        }
      });
    return out;
  });
}

const CHART_TESTIDS = [
  "nifty-chart-panel",
  "nifty-chart-source",
  "nifty-tf-toggle",
  "nifty-chart-size",
  "nifty-patterns-scan",
  "nifty-chart-expand",
  "nifty-chart-view",
] as const;

const TICKER_TESTIDS = [
  "market-ticker",
  "ticker-nsei",
  "ticker-nsebank",
  "ticker-gcf",
  "ticker-sif",
  "ticker-clf",
  "ticker-usdinrx",
  "ticker-price-nsei",
  "ticker-change-nsei",
  "ticker-change-nsebank",
  "ticker-change-gcf",
  "ticker-change-sif",
  "ticker-change-clf",
  "ticker-change-usdinrx",
] as const;

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

const { NiftyChartPanel } = await import("./NiftyChartPanel");
const { MarketTicker, MarketStatus } = await import("@/components/layout/MarketTicker");

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

const tickerData = {
  tickers: {
    "^NSEI": { symbol: "^NSEI", name: "Nifty 50", price: 22000, change: 150, change_percent: 0.68, is_positive: true },
    "^NSEBANK": { symbol: "^NSEBANK", name: "Bank Nifty", price: 45000, change: -200, change_percent: -0.44, is_positive: false },
    "GC=F": { symbol: "GC=F", name: "Gold", price: 1800, change: 10, change_percent: 0.56, is_positive: true },
    "SI=F": { symbol: "SI=F", name: "Silver", price: 25, change: 0.5, change_percent: 2.0, is_positive: true },
    "CL=F": { symbol: "CL=F", name: "Crude Oil", price: 75, change: -0.29, change_percent: -0.35, is_positive: false },
    "USDINR=X": { symbol: "USDINR=X", name: "USD/INR", price: 84, change: -0.13, change_percent: -0.14, is_positive: false },
  },
  last_updated: "2025-06-15T10:30:00Z",
  loading: false,
  error: null,
};

const expectedChange: Record<string, string> = {
  nsei: "+150.00 (0.68%)",
  nsebank: "-200.00 (-0.44%)",
  gcf: "+10.00 (0.56%)",
  sif: "+0.50 (2.00%)",
  clf: "-0.29 (-0.35%)",
  usdinrx: "-0.13 (-0.14%)",
};

function mountChart(onTimeframeChange = vi.fn(), onSizeChange = vi.fn()) {
  render(() => (
    <UIProvider>
      <NiftyChartPanel
        report={report}
        mode="live"
        view="chart"
        timeframe="1m"
        onTimeframeChange={onTimeframeChange}
        onSizeChange={onSizeChange}
        onExpand={() => {}}
      />
    </UIProvider>
  ));
  return { onTimeframeChange, onSizeChange };
}

function fontSizeOf(el: Element | null): number {
  expect(el, "font-size node must exist").not.toBeNull();
  return Number.parseFloat(getComputedStyle(el!).fontSize);
}

beforeEach(() => {
  window.localStorage.clear();
  (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => tickerData })),
  );
});

afterEach(() => {
  cleanup();
  delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  vi.unstubAllGlobals();
});

describe("Chart + ticker type floor — owned files", () => {
  test("(a) no font-size literal below 11px in either owned file", () => {
    const offenders = literalSizes().filter(({ px }) => px < FLOOR);
    expect(
      offenders.map(({ file, line, px }) => `${file}:${line} = ${px}px`),
      "\n" + offenders.map(({ file, line, px }) => `${file}:${line} = ${px}px`).join("\n"),
    ).toEqual([]);
  });

  test("(a) rendered chart controls and ticker values are all at or above 11px", async () => {
    mountChart();
    for (const id of ["nifty-chart-source", "nifty-tf-toggle", "nifty-chart-size"]) {
      const host = screen.getByTestId(id);
      for (const button of within(host).getAllByRole("button")) {
        expect(fontSizeOf(button), `${id} ${button.textContent}`).toBeGreaterThanOrEqual(FLOOR);
      }
    }
    expect(fontSizeOf(screen.getByTestId("nifty-patterns-scan"))).toBeGreaterThanOrEqual(FLOOR);

    cleanup();

    render(() => (
      <UIProvider>
        <MarketTicker />
        <MarketStatus />
      </UIProvider>
    ));
    for (const key of Object.keys(expectedChange)) {
      const change = await screen.findByTestId(`ticker-change-${key}`);
      const value = change.lastElementChild;
      expect(fontSizeOf(value), `ticker-change-${key} value`).toBeGreaterThanOrEqual(FLOOR);
      expect(change.firstElementChild?.className, `ticker-change-${key} arrow class`).toContain(
        "text-[11px]",
      );
    }
    const item = screen.getByTestId("ticker-nsei");
    expect(fontSizeOf(within(item).getByText("Nifty 50"))).toBeGreaterThanOrEqual(FLOOR);
    expect(fontSizeOf(screen.getByText("Market live"))).toBeGreaterThanOrEqual(FLOOR);
  });

  test("(b) source, timeframe and size controls still respond", () => {
    const { onTimeframeChange, onSizeChange } = mountChart();

    const source = screen.getByTestId("nifty-chart-source");
    const patterns = within(source).getByRole("button", { name: "PATTERNS" });
    expect(patterns).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(patterns);
    expect(within(source).getByRole("button", { name: "PATTERNS" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const tf = screen.getByTestId("nifty-tf-toggle");
    fireEvent.click(within(tf).getByRole("button", { name: "5m" }));
    expect(onTimeframeChange).toHaveBeenCalledWith("5m");

    const size = screen.getByTestId("nifty-chart-size");
    fireEvent.click(within(size).getByRole("button", { name: "XL" }));
    expect(onSizeChange).toHaveBeenCalledWith("xl");
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ height: "760px" });
  });

  test("(c) the ticker renders every symbol's change value", async () => {
    render(() => (
      <UIProvider>
        <MarketTicker />
      </UIProvider>
    ));
    for (const [key, value] of Object.entries(expectedChange)) {
      const change = await screen.findByTestId(`ticker-change-${key}`);
      expect(change, `ticker-change-${key}`).toHaveTextContent(value);
    }
  });

  test("(d) no owned data-testid was removed", async () => {
    mountChart();
    for (const id of CHART_TESTIDS) expect(screen.getByTestId(id), id).toBeInTheDocument();
    cleanup();

    render(() => (
      <UIProvider>
        <MarketTicker />
      </UIProvider>
    ));
    await screen.findByTestId("ticker-nsei");
    for (const id of TICKER_TESTIDS) expect(screen.getByTestId(id), id).toBeInTheDocument();
  });
});
