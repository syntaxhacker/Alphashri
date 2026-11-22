import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import type { ScreenerDashboardResponse } from "../types/screenerDashboard";
import {
  clearDashboardClientCache,
  DASHBOARD_CLIENT_CACHE_TTL_MS,
  fetchScreenerDashboard,
} from "./screenerDashboard";

const mockedFetch = vi.mocked(fetchWithAuth);

function payload(universe = "nifty500"): ScreenerDashboardResponse {
  return {
    universe,
    as_of: "2026-11-22T09:15:00+05:30",
    total: 2,
    cached: false,
    age_sec: 0,
    sections: [
      {
        id: "movers",
        title: "Movers",
        panels: [
          {
            id: "gainers",
            title: "Top Gainers",
            metric_label: "Change %",
            qualify: 2,
            rows: [
              { symbol: "BBB", name: "B", close: 2, change: 9, logo: null, sub_label: "x", sub_value: "y", spark: [] },
              { symbol: "AAA", name: "A", close: 1, change: 5, logo: null, sub_label: "x", sub_value: "y", spark: [] },
            ],
          },
        ],
      },
    ],
  };
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDashboardClientCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchScreenerDashboard snapshot cache", () => {
  it("reuses one snapshot across identical reads but refetches on scope changes", async () => {
    mockedFetch.mockResolvedValue(ok(payload()));

    await fetchScreenerDashboard();
    await fetchScreenerDashboard();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await fetchScreenerDashboard("nifty50");
    await fetchScreenerDashboard("nifty500", undefined, { limit: 30 });
    await fetchScreenerDashboard("nifty500", undefined, { minMarketCapCr: 0 });
    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });

  it("keeps the payload byte-identical and the ranking order on a cache hit", async () => {
    const first = payload();
    mockedFetch.mockResolvedValue(ok(first));

    await fetchScreenerDashboard();
    const hit = await fetchScreenerDashboard();

    expect(hit).toBe(first);
    expect(hit.sections[0].panels[0].rows.map((r) => r.symbol)).toEqual(["BBB", "AAA"]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("refresh bypasses the cache, sends refresh=1, and replaces the cached snapshot", async () => {
    const fresh = { ...payload(), cached: true, age_sec: 42 };
    mockedFetch.mockResolvedValueOnce(ok(payload())).mockResolvedValueOnce(ok(fresh));

    await fetchScreenerDashboard();
    const forced = await fetchScreenerDashboard(undefined, undefined, { refresh: true });
    expect(forced).toEqual(fresh);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch.mock.calls[1][0]).toContain("refresh=1");

    await fetchScreenerDashboard();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("exposes explicit invalidation", async () => {
    mockedFetch.mockResolvedValue(ok(payload()));

    await fetchScreenerDashboard();
    clearDashboardClientCache();
    await fetchScreenerDashboard();

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("expires a snapshot after the client TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T09:15:00Z"));
    mockedFetch.mockResolvedValue(ok(payload()));

    await fetchScreenerDashboard();
    vi.setSystemTime(new Date(Date.now() + DASHBOARD_CLIENT_CACHE_TTL_MS + 1));
    await fetchScreenerDashboard();

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed responses", async () => {
    mockedFetch
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ detail: "down" }) } as Response)
      .mockResolvedValueOnce(ok(payload()));

    await expect(fetchScreenerDashboard()).rejects.toThrow();
    const recovered = await fetchScreenerDashboard();

    expect(recovered.universe).toBe("nifty500");
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the default 2-arg request shape byte-identical", async () => {
    mockedFetch.mockResolvedValue(ok(payload()));

    await fetchScreenerDashboard("nifty500", undefined);

    expect(mockedFetch.mock.calls[0][0]).toContain("/api/screener/dashboard?universe=nifty500");
    expect(mockedFetch.mock.calls[0][0]).not.toContain("limit=");
    expect(mockedFetch.mock.calls[0][0]).not.toContain("min_market_cap_cr=");
    expect(mockedFetch.mock.calls[0][0]).not.toContain("refresh=");
  });
});
