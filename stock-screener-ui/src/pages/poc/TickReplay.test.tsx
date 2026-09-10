// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TickReplay from "./TickReplay";
import SmcTrades from "./SmcTrades";

vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: "solid" },
  CandlestickSeries: {},
  LineSeries: {},
  createSeriesMarkers: vi.fn(),
  createChart: vi.fn(() => ({
    addSeries: () => ({
      setData: vi.fn(),
      update: vi.fn(),
      createPriceLine: vi.fn(),
      priceToCoordinate: () => 100,
    }),
    timeScale: () => ({
      setVisibleRange: vi.fn(),
      scrollToPosition: vi.fn(),
      timeToCoordinate: () => 100,
      fitContent: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
    }),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  })),
}));

// 2026-08-26 09:00:00 IST
const T0 = Math.floor(Date.UTC(2026, 7, 26, 3, 30, 0) / 1000);

const mockBundle = {
  candles: [0, 1, 2].map((i) => ({
    time: T0 + i * 60,
    open: 24000 + i,
    high: 24005 + i,
    low: 23995 + i,
    close: 24002 + i,
  })),
  subs: [0, 5, 10, 15, 20, 25].map((s) => ({
    time: T0 + s,
    open: 24000,
    high: 24003,
    low: 23998,
    close: 24001,
  })),
  vwap: [0, 1, 2].map((i) => ({ time: T0 + i * 60, value: 24001 })),
  or_high: 24010,
  or_low: 23990,
  or_minutes: 15,
  or_end: T0 + 15 * 60,
  trades: [
    {
      time: T0 - 120,
      exit_time: T0 - 60,
      side: "LONG",
      kind: "orb",
      entry: 24000,
      sl: 23990,
      tp: 24020,
      exit: 24020,
      result: "TP",
      pnl: 10.5,
      rr: 2,
    },
  ],
  basis: 1.5,
};

const smcBars = [0, 1, 2, 3, 4, 5].map((i) => ({
  time: T0 + i * 60,
  open: 24000 + i,
  high: 24005 + i,
  low: 23995 + i,
  close: 24002 + i,
}));

const smcInv = {
  bars: smcBars,
  basis: 1.2,
  trades: [
    {
      time: T0 + 60,
      exit_time: T0 + 3600,
      side: "LONG",
      kind: "inv",
      entry: 24000,
      sl: 23990,
      tp: 24030,
      exit: 24030,
      result: "TP",
      pnl: 30,
      rr: 3,
    },
  ],
};

const smcRetest = {
  bars: smcBars,
  basis: 1.2,
  trades: [
    {
      time: T0 + 120,
      exit_time: T0 + 1800,
      side: "SHORT",
      kind: "retest",
      entry: 24010,
      sl: 24020,
      tp: 23990,
      exit: 24020,
      result: "SL",
      pnl: -10,
      rr: -1,
    },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(_callback: ResizeObserverCallback) {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    json: () => Promise.resolve(mockBundle),
  } as unknown as Response);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TickReplay", () => {
  test("renders date chips, Play button, speed + OR TF dropdowns, slider, summary header", async () => {
    render(<TickReplay />);

    // date chips
    expect(screen.getByText("2026-09-02")).toBeInTheDocument();
    expect(screen.getByText("2026-08-26")).toBeInTheDocument();
    // Play button
    expect(screen.getByRole("button", { name: /Play/ })).toBeInTheDocument();
    // speed + OR TF dropdowns
    expect(screen.getByLabelText("Speed")).toBeInTheDocument();
    expect(screen.getByLabelText("OR TF")).toBeInTheDocument();
    // slider
    expect(
      screen.getByRole("slider", { name: /replay position/i }),
    ).toBeInTheDocument();
    // summary header (settles once the mocked bundle loads)
    expect(await screen.findByText(/Trades —/)).toBeInTheDocument();
  });

  test("clicking a date chip refetches with that date in the URL", async () => {
    const user = userEvent.setup();
    render(<TickReplay />);

    await screen.findByText("2026-09-02");
    await user.click(screen.getByText("2026-08-26"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("date=2026-08-26"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  test("changing OR TF refetches with orb= param", async () => {
    const user = userEvent.setup();
    render(<TickReplay />);

    await screen.findByText(/Trades —/);
    await user.click(screen.getByLabelText("OR TF"));
    const opt30 = await screen.findByRole("option", { name: "30m" });
    await user.click(opt30);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("orb=30"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  test("summary shows trades + net from the mocked bundle", async () => {
    render(<TickReplay />);

    // 1 closed trade, net +10.5 from the mocked bundle
    expect(
      await screen.findByText(/1 closed · net \+10\.5 pts/),
    ).toBeInTheDocument();
    const row = screen.getByTestId(/replay-trade-row-.*-LONG/);
    expect(row.textContent).toContain("TP");      // exit badge
    expect(row.textContent).toContain("+10.5");   // P&L points cell
  });
});

describe("SmcTrades", () => {
  test("window switch + early-inversion switch exist; date chips + stack chips render", async () => {
    fetchMock.mockImplementation((url: unknown) => {
      const u = String(url);
      const body = u.includes("entries=retest") ? smcRetest : smcInv;
      return Promise.resolve({
        json: () => Promise.resolve(body),
      } as unknown as Response);
    });
    render(<SmcTrades />);

    // date chips
    expect(await screen.findByText("2026-09-02")).toBeInTheDocument();
    expect(screen.getByText("2026-08-26")).toBeInTheDocument();
    // stack chips with per-stack net
    expect(await screen.findByText(/MOMENTUM \+30\.0/)).toBeInTheDocument();
    expect(screen.getByText(/REVERSION -10\.0/)).toBeInTheDocument();
    // both switches
    expect(screen.getByLabelText(/early-inversion/)).toBeInTheDocument();
    expect(screen.getByLabelText(/window only/)).toBeInTheDocument();
  });
});
