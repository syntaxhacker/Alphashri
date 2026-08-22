// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

let currentState: any = { positions: [] };
let mockListeners: Set<Function> = new Set();
let mockSubscribe: any;

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  setPositions: vi.fn(),
}));

vi.mock("../../hooks/useLivePrices", () => ({
  useLivePrices: vi.fn(() => ({
    subscribe: (fn: Function) => {
      mockListeners.add(fn);
      return () => mockListeners.delete(fn);
    },
    getPrices: vi.fn(() => ({})),
  })),
}));

function notifyLivePrices(prices: Record<string, any>) {
  for (const [symbol, price] of Object.entries(prices)) {
    mockListeners.forEach((fn) => fn(symbol, price));
  }
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
    mockListeners = new Set();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders hidden div with data-testid", async () => {
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    r(<LivePriceUpdater />);
    expect(screen.getByTestId("live-price-updater")).toBeInTheDocument();
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

    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");

    r(<LivePriceUpdater />);

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

    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");

    r(<LivePriceUpdater />);

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

    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");

    r(<LivePriceUpdater />);

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
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");
    r(<LivePriceUpdater />);
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
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");
    r(<LivePriceUpdater />);
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
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");
    r(<LivePriceUpdater />);
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
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");
    r(<LivePriceUpdater />);
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
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");
    r(<LivePriceUpdater />);
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
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");
    r(<LivePriceUpdater />);
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
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");
    r(<LivePriceUpdater />);
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
    const { LivePriceUpdater } = await import("./LivePriceUpdater");
    const { setPositions } = await import("../../state/paperTrading");
    r(<LivePriceUpdater />);
    notifyLivePrices({ RELIANCE: { symbol: "RELIANCE", ltp: 10001 } });
    await vi.waitFor(() => {
      expect(setPositions).toHaveBeenCalled();
    });
    const updated = (vi.mocked(setPositions) as any).mock.calls[0][0];
    const pos = updated.find((p: any) => p.symbol === "RELIANCE");
    expect(pos.pnl).toBe(100000 * (10001 - 1));
    expect(pos.current_price).toBe(10001);
  });
});
