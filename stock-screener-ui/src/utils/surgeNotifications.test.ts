// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScreenerData } from "../types";

const { mockEnqueueSnackbar } = vi.hoisted(() => ({
  mockEnqueueSnackbar: vi.fn(),
}));

vi.mock("notistack", () => ({
  enqueueSnackbar: mockEnqueueSnackbar,
}));

vi.mock("../api/notifications", () => ({
  recordSurge: vi.fn().mockResolvedValue(undefined),
}));

import { checkPriceSurges, clearSurgeCache } from "./surgeNotifications";

function makeStock(overrides: Record<string, any> = {}) {
  return { symbol: "TEST", score: 50, sector: "Test", ...overrides };
}

function makeSurgeData(
  screener: string,
  approaching: Record<string, any>[] = [],
  touched: Record<string, any>[] = [],
): ScreenerData {
  return {
    screener,
    provider: "upstox",
    mode: "intraday",
    last_updated: new Date().toISOString(),
    approaching: approaching.map((o) => makeStock(o)),
    touched: touched.map((o) => makeStock(o)),
  };
}

describe("checkPriceSurges", () => {
  beforeEach(() => {
    // Pin the clock to a weekday inside Indian market hours (3:45-10:00 UTC)
    // so checkPriceSurges does not early-return from its isMarketHours() gate.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T04:00:00Z")); // Wed 09:30 IST
    vi.clearAllMocks();
    clearSurgeCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows notification for stock above surge threshold", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "RELIANCE", move_5m: 4.2, upstox_price: 2850 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
    const call = mockEnqueueSnackbar.mock.calls[0][0];
    expect(call.title).toContain("RELIANCE");
    expect(call.title).toContain("+4.2%");
    expect(call.color).toBe("green");
    expect(call["data-surge-symbol"]).toBe("RELIANCE");
  });

  it("skips stock below threshold", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "RELIANCE", move_5m: 2.1 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
  });

  it("uses day_change for unknown screener profile", () => {
    const data = makeSurgeData("trending", [{ symbol: "TCS", day_change: 6.0 }]);
    checkPriceSurges(data, "trending", "Trending");

    expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSnackbar.mock.calls[0][0].title).toContain("TCS");
    expect(mockEnqueueSnackbar.mock.calls[0][0].title).toContain("+6.0%");
  });

  it("uses default threshold of 5 for unknown profiless", () => {
    const data = makeSurgeData("trending", [{ symbol: "TCS", day_change: 4.9 }]);
    checkPriceSurges(data, "trending", "Trending");

    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
  });

  it("respects cooldown per symbol", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "INFY", move_5m: 5.0 }]);

    checkPriceSurges(data, "intraday_5m", "5-Min Movers");
    expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);

    checkPriceSurges(data, "intraday_5m", "5-Min Movers");
    expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
  });

  it("shows red notification for negative surges", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "WIPRO", move_5m: -4.1 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
    const call = mockEnqueueSnackbar.mock.calls[0][0];
    expect(call.title).toContain("-4.1%");
    expect(call.color).toBe("red");
  });

  it("handles multiple surging stocks", () => {
    const data = makeSurgeData("intraday_5m", [
      { symbol: "A", move_5m: 5.0 },
      { symbol: "B", move_5m: 6.0 },
    ]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(2);
  });

  it("checks stocks in both sections", () => {
    const data = makeSurgeData("intraday_10m", [],
      [{ symbol: "HDFC", move_10m: 4.5 }],
    );
    checkPriceSurges(data, "intraday_10m", "10-Min Movers");

    expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSnackbar.mock.calls[0][0].title).toContain("HDFC");
  });

  it("does nothing with empty data", () => {
    const data = makeSurgeData("trending");
    checkPriceSurges(data, "trending", "Trending");
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
  });

  it("includes price in message when available", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "SBIN", move_5m: 5.0, upstox_price: 750 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockEnqueueSnackbar.mock.calls[0][0].message).toContain("₹750");
  });

  it("includes screener label in message", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "AXIS", move_5m: 4.0 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockEnqueueSnackbar.mock.calls[0][0].message).toContain("5-Min Movers");
  });
});
