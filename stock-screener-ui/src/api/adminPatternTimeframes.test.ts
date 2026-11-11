import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import type { AdminPatternTimeframe } from "../types/admin";
import {
  addAdminPatternTimeframe,
  deleteAdminPatternTimeframe,
  fetchAdminPatternTimeframes,
  reorderAdminPatternTimeframes,
  setAdminPatternTimeframeEnabled,
} from "./adminPatternTimeframes";
import { errorResponse, nonJsonErrorResponse, okResponse } from "./apiTestMocks";

const mockedFetch = vi.mocked(fetchWithAuth);

const TIMEFRAME: AdminPatternTimeframe = {
  id: "1d",
  label: "1 Day",
  minutes: 1440,
  native: true,
  source_tf: null,
  max_lookback_days: 365,
  min_bars: 50,
  enabled: true,
  sort_order: 1,
  custom: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAdminPatternTimeframes", () => {
  it("GETs the timeframes list and returns it", async () => {
    mockedFetch.mockResolvedValue(okResponse({ timeframes: [TIMEFRAME] }));

    const result = await fetchAdminPatternTimeframes(mockedFetch);
    expect(result).toEqual([TIMEFRAME]);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/pattern-timeframes"),
    );
    const [, options] = mockedFetch.mock.calls[0];
    expect(options?.method).toBeUndefined();
  });

  it("defaults to an empty list when timeframes is missing", async () => {
    mockedFetch.mockResolvedValue(okResponse({}));
    const result = await fetchAdminPatternTimeframes(mockedFetch);
    expect(result).toEqual([]);
  });

  it("throws the server detail on failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "admin list failed" }));
    await expect(fetchAdminPatternTimeframes(mockedFetch)).rejects.toThrow(
      "admin list failed",
    );
  });

  it("falls back to the status message when the error body is not JSON", async () => {
    mockedFetch.mockResolvedValue(nonJsonErrorResponse(502));
    await expect(fetchAdminPatternTimeframes(mockedFetch)).rejects.toThrow(
      "HTTP 502",
    );
  });
});

describe("setAdminPatternTimeframeEnabled", () => {
  it("PATCHes the timeframe with { enabled } and returns it", async () => {
    mockedFetch.mockResolvedValue(okResponse({ timeframe: { ...TIMEFRAME, enabled: false } }));

    const result = await setAdminPatternTimeframeEnabled(mockedFetch, "1d", false);
    expect(result).toEqual({ ...TIMEFRAME, enabled: false });

    const [url, options] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/admin/pattern-timeframes/1d");
    expect(options?.method).toBe("PATCH");
    expect(options?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(options?.body).toBe(JSON.stringify({ enabled: false }));
  });

  it("URL-encodes the timeframe id", async () => {
    mockedFetch.mockResolvedValue(okResponse({ timeframe: TIMEFRAME }));
    await setAdminPatternTimeframeEnabled(mockedFetch, "weird/id", true);
    expect(mockedFetch.mock.calls[0][0]).toContain("/api/admin/pattern-timeframes/weird%2Fid");
  });

  it("throws the server detail on non-OK", async () => {
    mockedFetch.mockResolvedValue(errorResponse(403, { detail: "Admin access required" }));
    await expect(
      setAdminPatternTimeframeEnabled(mockedFetch, "1d", true),
    ).rejects.toThrow("Admin access required");
  });
});

describe("addAdminPatternTimeframe", () => {
  it("POSTs the payload and returns the created timeframe", async () => {
    mockedFetch.mockResolvedValue(okResponse({ timeframe: TIMEFRAME }));
    const payload = {
      id: "custom-1h",
      label: "Custom 1H",
      minutes: 60,
      source_tf: "60",
      max_lookback_days: 90,
      min_bars: 100,
    };

    const result = await addAdminPatternTimeframe(mockedFetch, payload);
    expect(result).toEqual(TIMEFRAME);

    const [url, options] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/admin/pattern-timeframes");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(JSON.stringify(payload));
  });

  it("throws the server detail on non-OK", async () => {
    mockedFetch.mockResolvedValue(errorResponse(400, { detail: "duplicate id" }));
    await expect(addAdminPatternTimeframe(mockedFetch, { id: "x", label: "x", minutes: 60 })).rejects.toThrow(
      "duplicate id",
    );
  });
});

describe("deleteAdminPatternTimeframe", () => {
  it("DELETEs the timeframe and returns the deleted id from the body", async () => {
    mockedFetch.mockResolvedValue(okResponse({ deleted: "removed-1d" }));

    const result = await deleteAdminPatternTimeframe(mockedFetch, "1d");
    expect(result).toBe("removed-1d");

    const [url, options] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/admin/pattern-timeframes/1d");
    expect(options?.method).toBe("DELETE");
  });

  it("falls back to the requested id when the body omits deleted", async () => {
    mockedFetch.mockResolvedValue(okResponse({}));
    const result = await deleteAdminPatternTimeframe(mockedFetch, "1d");
    expect(result).toBe("1d");
  });

  it("URL-encodes the timeframe id", async () => {
    mockedFetch.mockResolvedValue(okResponse({ deleted: "weird/id" }));
    await deleteAdminPatternTimeframe(mockedFetch, "weird/id");
    expect(mockedFetch.mock.calls[0][0]).toContain("/api/admin/pattern-timeframes/weird%2Fid");
  });

  it("throws the server detail on non-OK", async () => {
    mockedFetch.mockResolvedValue(errorResponse(404, { detail: "not found" }));
    await expect(deleteAdminPatternTimeframe(mockedFetch, "1d")).rejects.toThrow("not found");
  });
});

describe("reorderAdminPatternTimeframes", () => {
  it("PUTs the ordered ids to /order and returns the new list", async () => {
    mockedFetch.mockResolvedValue(okResponse({ timeframes: [TIMEFRAME] }));

    const result = await reorderAdminPatternTimeframes(mockedFetch, ["1d", "1h", "15m"]);
    expect(result).toEqual([TIMEFRAME]);

    const [url, options] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/admin/pattern-timeframes/order");
    expect(options?.method).toBe("PUT");
    expect(options?.body).toBe(JSON.stringify({ ids: ["1d", "1h", "15m"] }));
  });

  it("defaults to an empty list when timeframes is missing", async () => {
    mockedFetch.mockResolvedValue(okResponse({}));
    const result = await reorderAdminPatternTimeframes(mockedFetch, ["1d"]);
    expect(result).toEqual([]);
  });
});
