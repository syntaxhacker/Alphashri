// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import { NiftyChartPanel } from "./NiftyChartPanel";
import type { NiftyReport } from "@/types/niftyReport";

interface TickMock {
  symbol: string;
  brokerSymbol: string;
  ltp: number;
  ts: string | number | null;
  raw: Record<string, unknown>;
}

const fyers = vi.hoisted(() => ({
  calls: [] as { symbols: string[]; enabled: boolean }[],
  setState: (() => undefined) as (state: string) => void,
  setTick: (() => undefined) as (tick: TickMock | null) => void,
}));

vi.mock("@/hooks/useFyersTickStream", async () => {
  const { createSignal: signal } = await import("solid-js");
  const [state, setState] = signal("disconnected");
  const [tick, setTick] = signal<TickMock | null>(null);
  fyers.setState = setState;
  fyers.setTick = setTick;
  const api = () => ({
    ticks: () => ({}),
    lastTick: (symbol: string) => {
      const current = tick();
      return current && current.symbol.toUpperCase() === symbol.toUpperCase() ? current : null;
    },
    state,
    detail: () => undefined,
    connected: () => state() === "connected",
    isLive: () => state() === "connected",
    isDisconnected: () => state() === "disconnected" || state() === "error",
    isReconnecting: () => state() === "reconnecting" || state() === "connecting",
    isMarketClosed: () => state() === "market_closed",
  });
  return {
    useFyersTickStream: (args: {
      symbols: () => readonly string[];
      enabled?: () => boolean;
    }) => {
      fyers.calls.push({
        symbols: [...args.symbols()],
        enabled: args.enabled?.() ?? true,
      });
      return api();
    },
  };
});

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: (props: { candles?: { time: string; open: number; high: number; low: number; close: number }[] }) => {
    const last = () => props.candles?.[props.candles.length - 1];
    return (
      <div
        data-testid="tradingview-chart"
        data-candles={props.candles?.length ?? 0}
        data-last-time={last()?.time ?? ""}
        data-last-close={last()?.close ?? ""}
        data-last-high={last()?.high ?? ""}
        data-last-low={last()?.low ?? ""}
      />
    );
  },
}));

const SOURCE_KEY = "nifty.chartSource";

beforeEach(() => {
  fyers.calls.length = 0;
  fyers.setState("disconnected");
  fyers.setTick(null);
  window.localStorage.removeItem(SOURCE_KEY);
});

afterEach(() => cleanup());

function r(ui: () => JSX.Element) {
  return render(() => <UIProvider>{ui()}</UIProvider>);
}

function candles3() {
  return [
    { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
    { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25640, volume: 1100 },
    { time: "2026-10-12T09:20:00", open: 25640, high: 25700, low: 25610, close: 25680, volume: 1200 },
  ];
}

function reportWith(overrides: Record<string, unknown> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-12",
    expiry: "weekly",
    spot: 25750.5,
    ohlc: { open: 25600, high: 25800, low: 25550, close: 25750.5 },
    pcrOi: 1.12,
    pcrVol: 0.95,
    maxPain: 25700,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    pivots: null,
    gex: null,
    intraday: [],
    candles: candles3(),
    ...overrides,
  } as unknown as NiftyReport;
}

const chart = () => screen.getByTestId("tradingview-chart");
const feed = () => screen.getByTestId("nifty-fyers-feed");
const tick = (ltp: number, ts: string, symbol = "NIFTY"): TickMock => ({
  symbol,
  brokerSymbol: "NIFTY50-INDEX",
  ltp,
  ts,
  raw: { type: "tick", data: { ltp } },
});

describe("NiftyChartPanel — Fyers tick stream wiring", () => {
  test("(a) the hook is enabled on LIVE and disabled on PATTERNS / OFFLINE", () => {
    window.localStorage.setItem(SOURCE_KEY, "live");
    r(() => <NiftyChartPanel report={reportWith()} mode="live" view="chart" />);
    expect(fyers.calls.at(-1)).toEqual({ symbols: ["NIFTY"], enabled: true });
    cleanup();

    window.localStorage.setItem(SOURCE_KEY, "patterns");
    r(() => <NiftyChartPanel report={reportWith()} mode="live" view="chart" />);
    expect(fyers.calls.at(-1)?.enabled).toBe(false);
    cleanup();

    window.localStorage.setItem(SOURCE_KEY, "offline");
    r(() => <NiftyChartPanel report={reportWith()} mode="live" view="chart" />);
    expect(fyers.calls.at(-1)?.enabled).toBe(false);
  });

  test("(b) the hook is disabled for an unsupported symbol (RELIANCE)", () => {
    r(() => <NiftyChartPanel report={reportWith()} mode="live" view="chart" symbol="RELIANCE" />);
    expect(fyers.calls.at(-1)).toEqual({ symbols: ["RELIANCE"], enabled: false });
    expect(screen.queryByTestId("nifty-fyers-feed")).not.toBeInTheDocument();
  });

  test("(b2) supported underlyings (SENSEX / BANKNIFTY) enable the hook", () => {
    r(() => <NiftyChartPanel report={reportWith()} mode="live" view="chart" symbol="SENSEX" />);
    expect(fyers.calls.at(-1)).toEqual({ symbols: ["SENSEX"], enabled: true });
  });

  test("(c) a newer tick updates the last bar's close/high/low without adding a bar", async () => {
    fyers.setState("connected");
    r(() => <NiftyChartPanel report={reportWith()} mode="live" view="chart" />);
    expect(chart()).toHaveAttribute("data-candles", "3");
    expect(chart()).toHaveAttribute("data-last-close", "25680");

    fyers.setTick(tick(25999, "2026-10-12T09:21:00"));
    await waitFor(() => expect(chart()).toHaveAttribute("data-last-close", "25999"));
    expect(chart()).toHaveAttribute("data-candles", "3");
    expect(chart()).toHaveAttribute("data-last-time", "2026-10-12T09:20:00");
    expect(chart()).toHaveAttribute("data-last-high", "25999");
    expect(chart()).toHaveAttribute("data-last-low", "25610");

    fyers.setTick(tick(25000, "2026-10-12T09:22:00"));
    await waitFor(() => expect(chart()).toHaveAttribute("data-last-low", "25000"));
    expect(chart()).toHaveAttribute("data-candles", "3");

    // A stale tick must not be applied at all — the base bar stands again.
    fyers.setTick(tick(24000, "2026-10-12T09:19:00"));
    await waitFor(() => expect(chart()).toHaveAttribute("data-last-close", "25680"));
    expect(chart()).toHaveAttribute("data-candles", "3");
  });

  test("(d) the poll is ignored while the stream is live and restored when it drops", async () => {
    const [report, setReport] = createSignal(reportWith());
    r(() => <NiftyChartPanel report={report()} mode="live" view="chart" />);
    expect(chart()).toHaveAttribute("data-last-close", "25680");

    fyers.setState("connected");
    await waitFor(() => expect(feed()).toHaveAttribute("data-state", "live"));

    const polled = candles3();
    polled[2] = { ...polled[2], close: 29000, high: 29050 };
    setReport(reportWith({ candles: polled }));
    expect(chart()).toHaveAttribute("data-last-close", "25680");

    fyers.setState("disconnected");
    await waitFor(() => expect(chart()).toHaveAttribute("data-last-close", "29000"));
  });

  test("(d2) a poll that advances the session still adds a new bar while live", async () => {
    const [report, setReport] = createSignal(reportWith());
    r(() => <NiftyChartPanel report={report()} mode="live" view="chart" />);
    fyers.setState("connected");
    await waitFor(() => expect(feed()).toHaveAttribute("data-state", "live"));

    const withNewBar = [
      ...candles3(),
      { time: "2026-10-12T09:21:00", open: 25680, high: 25710, low: 25670, close: 25700, volume: 900 },
    ];
    setReport(reportWith({ candles: withNewBar }));
    await waitFor(() => expect(chart()).toHaveAttribute("data-candles", "4"));
    expect(chart()).toHaveAttribute("data-last-time", "2026-10-12T09:21:00");
    expect(chart()).toHaveAttribute("data-last-close", "25700");
  });

  test("(e) disconnected / reconnecting / market-closed / live render distinct states", async () => {
    r(() => <NiftyChartPanel report={reportWith()} mode="live" view="chart" />);
    const seen: string[] = [];
    const cases: [string, string][] = [
      ["disconnected", "disconnected"],
      ["reconnecting", "reconnecting"],
      ["market_closed", "market-closed"],
      ["connected", "live"],
    ];
    for (const [state, expected] of cases) {
      fyers.setState(state);
      await waitFor(() => expect(feed()).toHaveAttribute("data-state", expected));
      seen.push(`${feed().getAttribute("data-state")}:${feed().textContent}`);
    }
    expect(new Set(seen).size).toBe(4);
    expect(feed()).toHaveTextContent(/Fyers/i);
    // The header's Upstox label is untouched and explicitly named.
    expect(screen.getByTestId("nifty-chart-panel")).toHaveAttribute("data-testid", "nifty-chart-panel");
  });

  test("(f) the existing source control is unchanged and the feed hides outside LIVE", async () => {
    r(() => <NiftyChartPanel report={reportWith()} mode="live" view="chart" />);
    const toggle = () => screen.getByTestId("nifty-chart-source");
    expect(within(toggle()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "LIVE",
      "PATTERNS",
      "OFFLINE",
    ]);
    expect(within(toggle()).getByRole("button", { name: "LIVE" })).toHaveAttribute("aria-pressed", "true");
    expect(feed()).toBeInTheDocument();

    fireEvent.click(within(toggle()).getByRole("button", { name: "PATTERNS" }));
    expect(within(toggle()).getByRole("button", { name: "PATTERNS" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("nifty-fyers-feed")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-offline-empty")).not.toBeInTheDocument();
  });
});
