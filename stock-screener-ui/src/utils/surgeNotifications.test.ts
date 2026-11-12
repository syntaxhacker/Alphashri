// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "solid-js/web";
import type { ScreenerData } from "../types";

const { mockShowToast } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
}));

vi.mock("solid-notifications", () => ({
  showToast: mockShowToast,
}));

vi.mock("../api/notifications", () => ({
  recordSurge: vi.fn().mockResolvedValue(undefined),
}));

import { checkPriceSurges, clearSurgeCache } from "./surgeNotifications";

/** Render the JSX toast content so the assertions read real text. */
function toastText(content: unknown): string {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(() => content as never, container);
  const text = container.textContent ?? "";
  container.remove();
  return text;
}

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

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [content, options] = mockShowToast.mock.calls[0] as [unknown, { type: string; duration: number }];
    const text = toastText(content);
    expect(text).toContain("RELIANCE");
    expect(text).toContain("+4.2%");
    expect(options.type).toBe("success");
    expect(options.duration).toBe(8000);
  });

  it("skips stock below threshold", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "RELIANCE", move_5m: 2.1 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("uses day_change for unknown screener profile", () => {
    const data = makeSurgeData("trending", [{ symbol: "TCS", day_change: 6.0 }]);
    checkPriceSurges(data, "trending", "Trending");

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const text = toastText(mockShowToast.mock.calls[0][0]);
    expect(text).toContain("TCS");
    expect(text).toContain("+6.0%");
  });

  it("uses default threshold of 5 for unknown profiless", () => {
    const data = makeSurgeData("trending", [{ symbol: "TCS", day_change: 4.9 }]);
    checkPriceSurges(data, "trending", "Trending");

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("respects cooldown per symbol", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "INFY", move_5m: 5.0 }]);

    checkPriceSurges(data, "intraday_5m", "5-Min Movers");
    expect(mockShowToast).toHaveBeenCalledTimes(1);

    checkPriceSurges(data, "intraday_5m", "5-Min Movers");
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it("shows red notification for negative surges", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "WIPRO", move_5m: -4.1 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [content, options] = mockShowToast.mock.calls[0] as [unknown, { type: string }];
    const text = toastText(content);
    expect(text).toContain("WIPRO");
    expect(text).toContain("-4.1%");
    expect(options.type).toBe("error");
  });

  it("handles multiple surging stocks", () => {
    const data = makeSurgeData("intraday_5m", [
      { symbol: "A", move_5m: 5.0 },
      { symbol: "B", move_5m: 6.0 },
    ]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(mockShowToast).toHaveBeenCalledTimes(2);
  });

  it("checks stocks in both sections", () => {
    const data = makeSurgeData("intraday_10m", [],
      [{ symbol: "HDFC", move_10m: 4.5 }],
    );
    checkPriceSurges(data, "intraday_10m", "10-Min Movers");

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(toastText(mockShowToast.mock.calls[0][0])).toContain("HDFC");
  });

  it("does nothing with empty data", () => {
    const data = makeSurgeData("trending");
    checkPriceSurges(data, "trending", "Trending");
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("includes price in message when available", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "SBIN", move_5m: 5.0, upstox_price: 750 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(toastText(mockShowToast.mock.calls[0][0])).toContain("₹750");
  });

  it("includes screener label in message", () => {
    const data = makeSurgeData("intraday_5m", [{ symbol: "AXIS", move_5m: 4.0 }]);
    checkPriceSurges(data, "intraday_5m", "5-Min Movers");

    expect(toastText(mockShowToast.mock.calls[0][0])).toContain("5-Min Movers");
  });
});
