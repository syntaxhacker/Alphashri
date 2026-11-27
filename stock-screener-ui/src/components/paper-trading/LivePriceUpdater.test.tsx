// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { LivePriceUpdater, SSE_RECONNECT_BASE_MS } from "./LivePriceUpdater";
import { fetchHolidays } from "../../api/holidays_api";
import { loadHolidays, resetHolidays } from "../../state/holidays";

type SseFrame = { event: string; data: string };

// Fixed IST instants are injected into the real session helper. The holiday-only
// helper stays holiday-only so the after-hours regressions fail on the old code.
const clock = vi.hoisted(() => ({ now: new Date("2026-11-16T05:30:00Z") })); // Mon 11:00 IST

const frameHandlers: Array<(frame: SseFrame) => void> = [];

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  // Mirror the real setter so consecutive ticks observe the previous tick's
  // prices instead of replaying against the original snapshot.
  setPositions: vi.fn((positions: any) => {
    currentState = { ...currentState, positions };
  }),
}));

vi.mock("../../api/holidays_api", () => ({
  fetchHolidays: vi.fn(async () => []),
  fetchHolidayCheck: vi.fn(),
}));

vi.mock("../../state/holidays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/holidays")>();
  const istDate = (now: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return {
    ...actual,
    isMarketClosedToday: (now?: Date) => actual.isTradingHoliday(istDate(now ?? clock.now)),
    isMarketOpenNow: (now?: Date) => actual.isMarketOpenNow(now ?? clock.now),
  };
});

vi.mock("../../state/auth", () => ({
  getAccessToken: vi.fn(() => "tok"),
}));

vi.mock("@/api/config", () => ({
  API_BASE: "http://test.local",
}));

vi.mock("../../api/sse", () => ({
  readSseStream: vi.fn(async (_response: unknown, handler: (frame: SseFrame) => void) => {
    frameHandlers.push(handler);
  }),
}));

let currentState: any = { positions: [] };

const mockFetch = vi.fn(async () => ({ ok: true }) as Response);

function notifyLivePrices(prices: Record<string, any>) {
  for (const price of Object.values(prices)) {
    for (const handler of frameHandlers) {
      handler({ event: "price", data: JSON.stringify(price) });
    }
  }
}

async function waitForStreamAttached() {
  await vi.waitFor(() => {
    expect(frameHandlers.length).toBeGreaterThan(0);
  });
}

function setState(overrides: any) {
  currentState = {
    positions: [],
    ...overrides,
  };
}

function resetState() {
  setState({});
}

function setClock(utcIso: string) {
  clock.now = new Date(utcIso);
}

async function setHoliday(date: string, description: string) {
  vi.mocked(fetchHolidays).mockResolvedValueOnce([{ date, description, type: "trading" }]);
  resetHolidays();
  await loadHolidays();
}

describe("LivePriceUpdater", () => {
  beforeEach(() => {
    resetState();
    frameHandlers.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    setClock("2026-11-16T05:30:00Z");
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    resetHolidays();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("renders hidden div with data-testid", async () => {
    render(() => <LivePriceUpdater />);
    expect(screen.getByTestId("live-price-updater")).toBeInTheDocument();
    await waitForStreamAttached();
  });

  test("updates position price when live prices arrive", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 10,
          entry_price: 1600,
          current_price: 1600,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 1550,
          take_profit: 1700,
        },
      ],
    });

    const { setPositions } = await import("../../state/paperTrading");

    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();

    notifyLivePrices({
      RELIANCE: {
        symbol: "RELIANCE",
        ltp: 1650,
        ltq: "1",
        instrument_key: "NSE_EQ|INE002A01018",
      },
    });

    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });

    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    const reliance = updated.find((p: any) => p.symbol === "RELIANCE");
    expect(reliance.current_price).toBe(1650);
    expect(reliance.pnl).toBe(500);
    expect(reliance.pnl_pct).toBeCloseTo(3.125, 1);
  });

  test("preserves positions not in live price update", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 10,
          entry_price: 1600,
          current_price: 1600,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 1550,
          take_profit: 1700,
        },
        {
          symbol: "TCS",
          side: "BUY",
          quantity: 5,
          entry_price: 3400,
          current_price: 3400,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 3300,
          take_profit: 3600,
        },
      ],
    });

    const { setPositions } = await import("../../state/paperTrading");

    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();

    notifyLivePrices({
      RELIANCE: { symbol: "RELIANCE", ltp: 1650 },
    });

    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });

    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    const tcs = updated.find((p: any) => p.symbol === "TCS");
    expect(tcs.current_price).toBe(3400);
    expect(tcs.pnl).toBe(0);
  });

  test("calculates SELL position P&L correctly", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "SELL",
          quantity: 10,
          entry_price: 1600,
          current_price: 1600,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 1650,
          take_profit: 1500,
        },
      ],
    });

    const { setPositions } = await import("../../state/paperTrading");

    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();

    notifyLivePrices({
      RELIANCE: { symbol: "RELIANCE", ltp: 1550 },
    });

    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });

    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    const reliance = updated.find((p: any) => p.symbol === "RELIANCE");
    expect(reliance.current_price).toBe(1550);
    expect(reliance.pnl).toBe(500);
    expect(reliance.pnl_pct).toBeCloseTo(3.125, 1);
  });

  test("does not crash or re-emit when there are no positions", async () => {
    setState({ positions: [] });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: 1650 } });
    await new Promise((r) => setTimeout(r, 50));
    expect(setPositions).not.toHaveBeenCalled();
  });

  test("ignores live price for symbol not in positions list without re-emitting", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 10,
          entry_price: 1600,
          current_price: 1600,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 1550,
          take_profit: 1700,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ TCS: { symbol: "TCS", ltp: 3400 } });
    await new Promise((r) => setTimeout(r, 50));
    expect(setPositions).not.toHaveBeenCalled();
  });

  test("skips live price update with null ltp", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 10,
          entry_price: 1600,
          current_price: 1600,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 1550,
          take_profit: 1700,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: null } });
    expect(setPositions).not.toHaveBeenCalled();
  });

  test("handles undefined ltp without crashing", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 10,
          entry_price: 1600,
          current_price: 1600,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 1550,
          take_profit: 1700,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: undefined } });
    // Guard: !Number.isFinite(ltp) => skip update, should NOT call setPositions
    await new Promise((r) => setTimeout(r, 50));
    expect(setPositions).not.toHaveBeenCalled();
  });

  test("calculates P&L correctly when position has stop_loss = 0", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 10,
          entry_price: 1600,
          current_price: 1600,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 0,
          take_profit: 0,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: 1650 } });
    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });
    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    const pos = updated.find((p: any) => p.symbol === "RELIANCE");
    expect(pos.current_price).toBe(1650);
    expect(pos.pnl).toBe(500);
    expect(pos.pnl_pct).toBeCloseTo(3.125, 1);
  });

  test("handles zero quantity correctly (pnl is 0, pnl_pct still calculated)", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 0,
          entry_price: 1600,
          current_price: 1600,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 0,
          take_profit: 0,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: 1650 } });
    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });
    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    const pos = updated.find((p: any) => p.symbol === "RELIANCE");
    expect(pos.pnl).toBe(0);
    expect(pos.pnl_pct).toBeCloseTo(3.125, 1);
  });

  test("handles zero entry price (pnl_pct becomes Infinity, no crash)", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 10,
          entry_price: 0,
          current_price: 0,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 0,
          take_profit: 0,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: 50 } });
    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });
    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    const pos = updated.find((p: any) => p.symbol === "RELIANCE");
    expect(pos.pnl).toBe(500);
    expect(pos.pnl_pct).toBe(Infinity);
  });

  test("does not crash with very large P&L values (1 billion+)", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 100000,
          entry_price: 1,
          current_price: 1,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 0,
          take_profit: 0,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: 10001 } });
    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });
    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    const pos = updated.find((p: any) => p.symbol === "RELIANCE");
    expect(pos.pnl).toBe(100000 * (10001 - 1));
    expect(pos.current_price).toBe(10001);
  });

  test("applies same-ltp ticks for two strategies holding the same symbol", async () => {
    const makePos = (strategyId: number, quantity: number) => ({
      symbol: "INFY",
      side: "BUY",
      quantity,
      entry_price: 100,
      current_price: 100,
      pnl: 0,
      pnl_pct: 0,
      strategy_id: strategyId,
      order_id: `order-${strategyId}`,
      stop_loss: 90,
      take_profit: 120,
    });
    setState({ positions: [makePos(1, 1), makePos(2, 3)] });
    const { setPositions } = await import("../../state/paperTrading");

    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();

    notifyLivePrices({ s1: { symbol: "INFY", ltp: 110, strategy_id: 1 } });
    notifyLivePrices({ s2: { symbol: "INFY", ltp: 110, strategy_id: 2 } });

    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalledTimes(2);
    });
    const final = (vi.mocked(setPositions) as any).mock.calls[1][0];
    const first = final.find((p: any) => p.strategy_id === 1);
    const second = final.find((p: any) => p.strategy_id === 2);
    expect(first.current_price).toBe(110);
    expect(first.pnl).toBe(10);
    expect(second.current_price).toBe(110);
    expect(second.pnl).toBe(30);
  });

  test("applies an unchanged-price tick to a position added after the previous tick", async () => {
    const existing = {
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 1,
      entry_price: 100,
      current_price: 100,
      pnl: 0,
      pnl_pct: 0,
      strategy_id: 1,
      stop_loss: 90,
      take_profit: 120,
    };
    setState({ positions: [existing] });
    const { setPositions } = await import("../../state/paperTrading");

    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();

    notifyLivePrices({ t1: { symbol: "RELIANCE", ltp: 101 } });
    await vi.waitFor(() => expect(setPositions).toHaveBeenCalledTimes(1));

    // The 20s REST poll brings in a second strategy's position whose current
    // price is still the entry price; the next tick has the same ltp as before.
    const afterFirst = (vi.mocked(setPositions) as any).mock.calls[0][0];
    setState({
      positions: [
        afterFirst[0],
        { ...afterFirst[0], strategy_id: 9, entry_price: 90, current_price: 90, quantity: 3, order_id: "late" },
      ],
    });
    notifyLivePrices({ t2: { symbol: "RELIANCE", ltp: 101 } });

    await vi.waitFor(() => expect(setPositions).toHaveBeenCalledTimes(2));
    const final = (vi.mocked(setPositions) as any).mock.calls[1][0];
    const late = final.find((p: any) => p.order_id === "late");
    expect(late.current_price).toBe(101);
    expect(late.pnl).toBe(33);
  });

  test("does not notify subscribers for a tick that matches no position", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 1,
          entry_price: 100,
          current_price: 100,
          pnl: 0,
          pnl_pct: 0,
          stop_loss: 90,
          take_profit: 120,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();

    for (let i = 0; i < 20; i++) {
      notifyLivePrices({ nope: { symbol: "UNHELD", ltp: 100 + i } });
    }
    expect(setPositions).not.toHaveBeenCalled();
  });

  test("recalculates SELL P&L with the correct side and quantity over repeated ticks", async () => {
    setState({
      positions: [
        {
          symbol: "TCS",
          side: "SELL",
          quantity: 4,
          entry_price: 2000,
          current_price: 2000,
          pnl: 0,
          pnl_pct: 0,
          stop_loss: 2100,
          take_profit: 1800,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();

    for (const ltp of [2010, 1990, 1980]) {
      notifyLivePrices({ tcs: { symbol: "TCS", ltp } });
    }

    const calls = (vi.mocked(setPositions) as any).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0][0][0].pnl).toBe(-40);
    expect(calls[1][0][0].pnl).toBe(40);
    expect(calls[2][0][0].pnl).toBe(80);
    expect(calls[2][0][0].pnl_pct).toBeCloseTo(1, 5);
  });

  test("drives 120 rapid ticks and lands on the final value with no stale intermediate", async () => {
    setState({
      positions: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 2,
          entry_price: 1000,
          current_price: 1000,
          pnl: 0,
          pnl_pct: 0,
          entry_time: new Date().toISOString(),
          stop_loss: 900,
          take_profit: 1200,
        },
      ],
    });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();

    for (let i = 1; i <= 120; i++) {
      notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: 1000 + i } });
    }

    const calls = (vi.mocked(setPositions) as any).mock.calls;
    expect(calls.length).toBe(120);
    const last = calls[calls.length - 1][0];
    expect(last[0].current_price).toBe(1120);
    expect(last[0].pnl).toBe(2 * 120);
    // No stale intermediate value in the final state: every earlier price was
    // superseded by the last write.
    expect(new Set(calls.map((c: any) => c[0][0].current_price)).size).toBe(120);
  });
});

// The stream is expensive to hold open: after the close it must never be opened.
describe("LivePriceUpdater — market session guard", () => {
  beforeEach(() => {
    resetState();
    frameHandlers.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    setClock("2026-11-16T05:30:00Z");
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    resetHolidays();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not open the SSE stream at 17:11 IST on a weekday", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST
    render(() => <LivePriceUpdater />);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(frameHandlers).toHaveLength(0);
  });

  it("opens the SSE stream at 11:00 IST on a weekday", async () => {
    setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/live/stream"),
      expect.any(Object),
    );
  });

  it("does not open the SSE stream on a holiday at 11:00 IST", async () => {
    setClock("2026-01-26T05:30:00Z"); // Republic Day, Monday 11:00 IST
    await setHoliday("2026-01-26", "Republic Day");
    render(() => <LivePriceUpdater />);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(frameHandlers).toHaveLength(0);
  });

  it("__E2E_MOCK_MARKET_OPEN__ opens the stream even on a holiday at 11:00 IST", async () => {
    setClock("2026-01-26T05:30:00Z");
    await setHoliday("2026-01-26", "Republic Day");
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    expect(mockFetch).toHaveBeenCalled();
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  });
});

describe("LivePriceUpdater — stream reconnect", () => {
  beforeEach(() => {
    resetState();
    frameHandlers.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    setClock("2026-11-16T05:30:00Z");
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    resetHolidays();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("reopens the stream with backoff after it ends and stops on unmount", async () => {
    const { unmount } = render(() => <LivePriceUpdater />);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_BASE_MS);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_BASE_MS * 2);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
