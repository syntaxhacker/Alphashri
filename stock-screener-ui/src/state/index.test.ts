// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as indexModule from "./index";
import type { ScreenerData, ScreenerOption, ProfileMeta, ChangeNotification } from "../types";

// Track unsubscribe functions for cleanup
let unsubscribes: (() => void)[] = [];

function subscribeForTest(callback: () => void) {
  const unsub = indexModule.subscribe(callback);
  unsubscribes.push(unsub);
  return unsub;
}

beforeEach(() => {
  // Reset state to initial values
  indexModule.setData({ ...indexModule.DEFAULT_SCREENER_DATA });
  indexModule.setIsLoading(false);
  indexModule.setError(null);
  indexModule.setAutoRefreshInterval(null);
  indexModule.setAutoRefreshSeconds(indexModule.DEFAULT_SCREENER_DATA ? 30 : 30); // reset to default
  indexModule.setSortColumn(null);
  indexModule.setSortDirection("desc");
  indexModule.setScreenerOptions([]);
  indexModule.setActiveScreener("trending");
  indexModule.setProfileMetaById({});
  indexModule.setNotifications([]);
  indexModule.clearNotifications(); // resets notifSeq to 1
  indexModule.setNotifPanelOpen(true);
  indexModule.setNotifFilter("all");
  indexModule.setRecentAddedSymbols({});
});

afterEach(() => {
  // Clean up all subscriptions
  unsubscribes.forEach((unsub) => unsub());
  unsubscribes = [];
});

describe("initial state", () => {
  it("has correct DEFAULT_SCREENER_DATA", () => {
    expect(indexModule.DEFAULT_SCREENER_DATA).toEqual({
      approaching: [],
      touched: [],
      last_updated: "",
      provider: "upstox",
      mode: "intraday",
      screener: "trending",
    });
  });
});

describe("setData", () => {
  it("updates data and notifies subscribers", () => {
    const callback = vi.fn();
    subscribeForTest(callback);
    const newData: ScreenerData = {
      ...indexModule.DEFAULT_SCREENER_DATA,
      last_updated: "2025-01-01T00:00:00Z",
    };

    indexModule.setData(newData);

    expect(indexModule.data).toEqual(newData);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("setIsLoading", () => {
  it("updates isLoading and notifies", () => {
    const callback = vi.fn();
    subscribeForTest(callback);

    indexModule.setIsLoading(true);

    expect(indexModule.isLoading).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("setError", () => {
  it("updates error and notifies", () => {
    const callback = vi.fn();
    subscribeForTest(callback);

    indexModule.setError("test error");

    expect(indexModule.error).toBe("test error");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("clears error when passed null", () => {
    const callback = vi.fn();
    subscribeForTest(callback);

    indexModule.setError("error");
    indexModule.setError(null);

    expect(indexModule.error).toBeNull();
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

describe("sort state", () => {
  it("setSortColumn updates column and notifies", () => {
    const callback = vi.fn();
    subscribeForTest(callback);

    indexModule.setSortColumn("symbol");

    expect(indexModule.sortColumn).toBe("symbol");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("setSortDirection updates direction and notifies", () => {
    const callback = vi.fn();
    subscribeForTest(callback);

    indexModule.setSortDirection("asc");

    expect(indexModule.sortDirection).toBe("asc");
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("screener state", () => {
  it("setScreenerOptions updates options and notifies", () => {
    const callback = vi.fn();
    subscribeForTest(callback);
    const options: ScreenerOption[] = [{ symbol: "TCS", price: 100 }];

    indexModule.setScreenerOptions(options);

    expect(indexModule.screenerOptions).toEqual(options);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("setActiveScreener updates active screener and notifies", () => {
    const callback = vi.fn();
    subscribeForTest(callback);

    indexModule.setActiveScreener("52w-high");

    expect(indexModule.activeScreener).toBe("52w-high");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("setProfileMetaById updates profile meta", () => {
    const meta: Record<string, ProfileMeta> = {
      TCS: { name: "Tata Consultancy", industry: "IT" },
    };

    indexModule.setProfileMetaById(meta);

    expect(indexModule.profileMetaById).toEqual(meta);
  });
});

describe("auto-refresh state", () => {
  it("setAutoRefreshSeconds updates interval and notifies", () => {
    const callback = vi.fn();
    subscribeForTest(callback);

    indexModule.setAutoRefreshSeconds(30);

    expect(indexModule.autoRefreshSeconds).toBe(30);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("setAutoRefreshInterval stores interval reference", () => {
    const mockInterval = setInterval(() => {}, 1000);

    indexModule.setAutoRefreshInterval(mockInterval);

    expect(indexModule.autoRefreshInterval).toBe(mockInterval);

    clearInterval(mockInterval);
  });
});

describe("notification state", () => {
  it("addNotification adds to array without notify", () => {
    const initialLength = indexModule.notifications.length;
    const notification: ChangeNotification = {
      id: 1,
      symbol: "TCS",
      type: "price_change",
      message: "Price changed",
      timestamp: Date.now(),
      read: false,
    };

    indexModule.addNotification(notification);

    expect(indexModule.notifications).toContain(notification);
    expect(indexModule.notifications.length).toBe(initialLength + 1);
  });

  it("setNotifications replaces all notifications", () => {
    const newNotifications: ChangeNotification[] = [
      {
        id: 1,
        symbol: "TCS",
        type: "price_change",
        message: "Test 1",
        timestamp: Date.now(),
        read: false,
      },
      {
        id: 2,
        symbol: "INFY",
        type: "volume_spike",
        message: "Test 2",
        timestamp: Date.now(),
        read: false,
      },
    ];

    indexModule.setNotifications(newNotifications);

    expect(indexModule.notifications).toEqual(newNotifications);
  });

  it("clearNotifications resets array and seq", () => {
    indexModule.addNotification({
      id: 1,
      symbol: "TCS",
      type: "price_change",
      message: "Test",
      timestamp: Date.now(),
      read: false,
    });

    indexModule.clearNotifications();

    expect(indexModule.notifications).toEqual([]);
    expect(indexModule.notifSeq).toBe(1);
  });

  it("incrementNotifSeq increments sequence", () => {
    const initialSeq = indexModule.notifSeq;
    indexModule.incrementNotifSeq();
    expect(indexModule.notifSeq).toBe(initialSeq + 1);
  });

  it("setNotifPanelOpen updates panel state", () => {
    indexModule.setNotifPanelOpen(false);
    expect(indexModule.notifPanelOpen).toBe(false);
  });

  it("setNotifFilter updates filter", () => {
    indexModule.setNotifFilter("unread");
    expect(indexModule.notifFilter).toBe("unread");
  });
});

describe("recent added symbols tracking", () => {
  it("setRecentAddedSymbols updates tracking object", () => {
    const symbols: Record<string, number> = { TCS: 100, INFY: 200 };

    indexModule.setRecentAddedSymbols(symbols);

    expect(indexModule.recentAddedSymbols).toEqual(symbols);
  });
});

describe("subscribe", () => {
  it("returns unsubscribe function", () => {
    const callback = vi.fn();
    const unsubscribe = indexModule.subscribe(callback);

    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("calls callback on notifySubscribers", () => {
    const callback = vi.fn();
    indexModule.subscribe(callback);

    indexModule.notifySubscribers();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes callback from subscribers", () => {
    const callback = vi.fn();
    const unsubscribe = indexModule.subscribe(callback);

    unsubscribe();
    indexModule.notifySubscribers();

    expect(callback).not.toHaveBeenCalled();
  });

  it("multiple subscribers all get notified", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    indexModule.subscribe(cb1);
    indexModule.subscribe(cb2);
    indexModule.subscribe(cb3);

    indexModule.notifySubscribers();

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb3).toHaveBeenCalledTimes(1);
  });

  it("callbacks can unsubscribe individually", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = indexModule.subscribe(cb1);
    indexModule.subscribe(cb2);

    unsub1();
    indexModule.notifySubscribers();

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
