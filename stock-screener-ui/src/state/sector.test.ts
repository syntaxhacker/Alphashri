// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFetchSectorPerformance } = vi.hoisted(() => ({
  mockFetchSectorPerformance: vi.fn(),
}));

vi.mock("../api/sector", () => ({
  fetchSectorPerformance: (...args: any[]) => mockFetchSectorPerformance(...args),
}));

vi.mock("../api/heatmap", () => ({
  fetchHeatmapData: vi.fn(),
}));

vi.mock("./holidays", () => ({
  isMarketOpenNow: () => true,
  subscribeToHolidays: () => () => {},
}));

import * as sector from "./sector";

describe("sector store (hoisted out of SectorPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    sector.resetSectorState();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("(a) setting market changes what a reader sees", () => {
    sector.resetSectorState();
    expect(sector.getSectorState().market).toBe("india");
    sector.setMarket("america");
    expect(sector.getSectorState().market).toBe("america");
  });

  it("(b) preserves the URL-seeded initial values", () => {
    window.history.replaceState({}, "", "/sector?tab=rotation&dash=visual");
    sector.resetSectorState();
    expect(sector.getSectorState().activeTab).toBe("rotation");
    expect(sector.getSectorState().dashboardView).toBe("visual");
  });

  it("(c) notifies a subscriber once per change", () => {
    sector.resetSectorState();
    const callback = vi.fn();
    const unsubscribe = sector.subscribe(callback);

    sector.setMarket("america");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();

    sector.setViewMode("stock");
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
    sector.setMarket("india");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("(d) unmount/reset leaves no running timer", async () => {
    vi.useFakeTimers();
    mockFetchSectorPerformance.mockResolvedValue({
      sectors: [],
      top_stock_movers: [],
      last_updated: null,
    });

    sector.resetSectorState();
    sector.configurePolling("dashboard", "india");
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Page unmount tears the store's polling/timers down.
    sector.resetSectorState();
    expect(vi.getTimerCount()).toBe(0);
  });
});
