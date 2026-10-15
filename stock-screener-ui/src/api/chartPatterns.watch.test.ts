import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { buildWatchQuery, fetchWatch, fetchWatchSetups } from "./chartPatterns";

const mockedFetch = vi.mocked(fetchWithAuth);

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildWatchQuery", () => {
  it("serializes every watch param", () => {
    const qs = buildWatchQuery({
      setup: "breakout",
      universe: "nifty500",
      timeframe: "1D",
      minBaseDays: 60,
      minRelVolume: 1.5,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("setup")).toBe("breakout");
    expect(params.get("universe")).toBe("nifty500");
    expect(params.get("timeframe")).toBe("1D");
    expect(params.get("min_base_days")).toBe("60");
    expect(params.get("min_rel_volume")).toBe("1.5");
  });

  it("omits null optional params", () => {
    const qs = buildWatchQuery({
      setup: "breakout",
      universe: "nifty500",
      timeframe: "1D",
      minBaseDays: null,
      minRelVolume: null,
    });
    const params = new URLSearchParams(qs);
    expect(params.has("min_base_days")).toBe(false);
    expect(params.has("min_rel_volume")).toBe(false);
    expect(params.get("setup")).toBe("breakout");
  });
});

describe("fetchWatchSetups", () => {
  it("GETs /watch/setups and returns the list", async () => {
    const setups = [
      { id: "breakout", label: "Breakout", description: "Base breakout", default_min_rel_volume: 1.5 },
    ];
    mockedFetch.mockResolvedValue(okResponse({ setups }));
    await expect(fetchWatchSetups()).resolves.toEqual(setups);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/chart-patterns/watch/setups"),
    );
  });

  it("defaults to [] when the body has no setups", async () => {
    mockedFetch.mockResolvedValue(okResponse({}));
    await expect(fetchWatchSetups()).resolves.toEqual([]);
  });

  it("throws server detail on failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "boom" }));
    await expect(fetchWatchSetups()).rejects.toThrow("boom");
  });
});

describe("fetchWatch", () => {
  it("GETs /watch with the serialized query", async () => {
    const payload = {
      setup: "breakout",
      min_rel_volume: 1.5,
      updated_at: "2026-09-30T15:30:00+05:30",
      items: [
        {
          symbol: "RELIANCE",
          setup_id: "breakout",
          trigger_level: 3000,
          invalidate_level: 2800,
          base_days: 90,
          range_pct: 8.5,
          confidence: 78,
          status: "forming",
          end_date: "2026-09-30",
          ltp: 2950,
          rel_volume: 2.1,
          pct_to_trigger: 1.69,
          state: "armed",
        },
      ],
    };
    mockedFetch.mockResolvedValue(okResponse(payload));

    const result = await fetchWatch({
      setup: "breakout",
      universe: "nifty500",
      timeframe: "1D",
      minBaseDays: 60,
      minRelVolume: 1.5,
    });
    expect(result).toEqual(payload);

    const [url] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/chart-patterns/watch?");
    const query = new URLSearchParams(String(url).split("?")[1]);
    expect(query.get("setup")).toBe("breakout");
    expect(query.get("universe")).toBe("nifty500");
    expect(query.get("timeframe")).toBe("1D");
    expect(query.get("min_base_days")).toBe("60");
    expect(query.get("min_rel_volume")).toBe("1.5");
  });

  it("throws server detail on failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "watch failed" }));
    await expect(
      fetchWatch({ setup: "breakout", universe: "nifty500", timeframe: "1D" }),
    ).rejects.toThrow("watch failed");
  });
});
