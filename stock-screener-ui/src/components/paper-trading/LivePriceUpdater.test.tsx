// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { LivePriceUpdater } from "./LivePriceUpdater";

type SseFrame = { event: string; data: string };

const frameHandlers: Array<(frame: SseFrame) => void> = [];

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  setPositions: vi.fn(),
}));

vi.mock("../../state/holidays", () => ({
  isMarketClosedToday: vi.fn(() => false),
}));

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

describe("LivePriceUpdater", () => {
  beforeEach(() => {
    resetState();
    frameHandlers.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
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

  test("does not crash when no positions in state", async () => {
    setState({ positions: [] });
    const { setPositions } = await import("../../state/paperTrading");
    render(() => <LivePriceUpdater />);
    await waitForStreamAttached();
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: 1650 } });
    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalledWith([]);
    });
  });

  test("ignores live price for symbol not in positions list", async () => {
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
    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });
    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    expect(updated).toHaveLength(1);
    expect(updated[0].symbol).toBe("RELIANCE");
    expect(updated[0].current_price).toBe(1600);
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
