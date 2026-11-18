// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", async () => (await import("./apiTestMocks")).fetchWithAuthModuleMock());

import { fetchWithAuth } from "../state/auth";
import { errorResponse, nonJsonErrorResponse, okResponse } from "./apiTestMocks";
import {
  ContractChartError,
  decodeContractCandles,
  fetchContractCandles,
} from "./optionsContractChart";

const mockedFetch = vi.mocked(fetchWithAuth);

const KEY = "NSE_FO|12345";

function rawCandle(overrides: Record<string, unknown> = {}) {
  return { t: "2026-11-17T09:15:00+05:30", o: 3.2, h: 3.5, l: 3.1, c: 3.4, v: 1200, oi: 4500, ...overrides };
}

function rawPayload(overrides: Record<string, unknown> = {}) {
  return {
    instrument_key: KEY,
    interval: "1m",
    candles: [rawCandle()],
    source: "upstox",
    cached: false,
    empty_reason: null,
    ...overrides,
  };
}

function queryOf(call = 0): URLSearchParams {
  const url = String(mockedFetch.mock.calls[call][0]);
  return new URL(url, "http://localhost:8765").searchParams;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchContractCandles", () => {
  it("GETs the contract-chart endpoint with the encoded key, interval and days", async () => {
    mockedFetch.mockResolvedValue(okResponse(rawPayload()));

    await fetchContractCandles({ instrumentKey: KEY, interval: "5m", days: 2 });

    const url = String(mockedFetch.mock.calls[0][0]);
    expect(new URL(url, "http://localhost:8765").pathname).toBe("/api/options/contract-chart");
    expect(queryOf().get("instrument_key")).toBe(KEY);
    expect(queryOf().get("interval")).toBe("5m");
    expect(queryOf().get("days")).toBe("2");
  });

  it("defaults days to 1 and forwards the caller's init/signal", async () => {
    const controller = new AbortController();
    const init = { signal: controller.signal };
    mockedFetch.mockResolvedValue(okResponse(rawPayload()));

    await fetchContractCandles({ instrumentKey: KEY, interval: "1m" }, init);

    expect(queryOf().get("days")).toBe("1");
    expect(mockedFetch.mock.calls[0][1]).toBe(init);
  });

  it("rejects an empty instrument key before any request", async () => {
    await expect(fetchContractCandles({ instrumentKey: "  ", interval: "1m" })).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("propagates an AbortError unchanged instead of wrapping it as a failure", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    mockedFetch.mockRejectedValue(abort);

    await expect(fetchContractCandles({ instrumentKey: KEY, interval: "1m" })).rejects.toBe(abort);
  });

  it("maps 401 to an auth error and keeps the upstream detail for other failures", async () => {
    mockedFetch.mockResolvedValueOnce(errorResponse(401, { detail: "expired" }));
    await expect(fetchContractCandles({ instrumentKey: KEY, interval: "1m" })).rejects.toMatchObject({
      kind: "auth",
      status: 401,
    });

    mockedFetch.mockResolvedValueOnce(errorResponse(502, { detail: "Upstream unavailable" }));
    await expect(fetchContractCandles({ instrumentKey: KEY, interval: "1m" })).rejects.toMatchObject({
      kind: "http",
      status: 502,
      message: "Upstream unavailable",
    });
  });

  it("translates backend error codes into actionable copy", async () => {
    mockedFetch.mockResolvedValueOnce(errorResponse(502, { detail: "options_contract_chart_unavailable" }));
    await expect(fetchContractCandles({ instrumentKey: KEY, interval: "1m" })).rejects.toMatchObject({
      kind: "http",
      status: 502,
      message: "The option chart service is unavailable right now",
    });

    mockedFetch.mockResolvedValueOnce(errorResponse(429, { detail: "upstox_rate_limited" }));
    await expect(fetchContractCandles({ instrumentKey: KEY, interval: "1m" })).rejects.toMatchObject({
      status: 429,
      message: "Option chart is rate limited — try again shortly",
    });
  });

  it("treats a non-JSON success body and an HTML error body as typed failures", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("not json");
      },
    } as unknown as Response);
    await expect(fetchContractCandles({ instrumentKey: KEY, interval: "1m" })).rejects.toMatchObject({
      kind: "malformed",
    });

    mockedFetch.mockResolvedValueOnce(nonJsonErrorResponse(500));
    await expect(fetchContractCandles({ instrumentKey: KEY, interval: "1m" })).rejects.toMatchObject({
      kind: "http",
      status: 500,
    });
  });

  it("wraps a transport failure as a network error", async () => {
    mockedFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const failure = await fetchContractCandles({ instrumentKey: KEY, interval: "1m" }).catch((error) => error);
    expect(failure).toBeInstanceOf(ContractChartError);
    expect(failure.kind).toBe("network");
  });
});

describe("decodeContractCandles", () => {
  it("maps snake_case to camelCase and sorts candles ascending", async () => {
    mockedFetch.mockResolvedValue(
      okResponse(
        rawPayload({
          candles: [
            rawCandle({ t: "2026-11-17T09:17:00+05:30", c: 3.6 }),
            rawCandle({ t: "2026-11-17T09:15:00+05:30" }),
            rawCandle({ t: "2026-11-17T09:16:00+05:30", c: 3.5 }),
          ],
        }),
      ),
    );

    const frame = await fetchContractCandles({ instrumentKey: KEY, interval: "1m" });

    expect(frame.instrumentKey).toBe(KEY);
    expect(frame.interval).toBe("1m");
    expect(frame.source).toBe("upstox");
    expect(frame.cached).toBe(false);
    expect(frame.emptyReason).toBeNull();
    expect(frame.candles.map((candle) => candle.timestamp)).toEqual([
      "2026-11-17T09:15:00+05:30",
      "2026-11-17T09:16:00+05:30",
      "2026-11-17T09:17:00+05:30",
    ]);
    expect(frame.candles[0]).toEqual({
      timestamp: "2026-11-17T09:15:00+05:30",
      open: 3.2,
      high: 3.5,
      low: 3.1,
      close: 3.4,
      volume: 1200,
      oi: 4500,
    });
  });

  it("drops malformed rows but keeps the valid series", () => {
    const frame = decodeContractCandles(
      rawPayload({
        candles: [
          rawCandle(),
          rawCandle({ o: "not-a-number" }),
          rawCandle({ t: "yesterday" }),
          rawCandle({ h: 2, l: 4 }),
          rawCandle({ v: "lots" }),
          rawCandle({ t: "2026-11-17T09:16:00+05:30", c: 3.5 }),
        ],
      }),
    );

    expect(frame.candles).toHaveLength(2);
    expect(frame.candles.map((candle) => candle.close)).toEqual([3.4, 3.5]);
  });

  it("fills an absent volume/OI with 0 and keeps an explicit empty_reason", () => {
    const frame = decodeContractCandles(
      rawPayload({
        candles: [rawCandle({ v: undefined, oi: null })],
        cached: true,
        empty_reason: "no_session",
      }),
    );

    expect(frame.candles[0].volume).toBe(0);
    expect(frame.candles[0].oi).toBe(0);
    expect(frame.cached).toBe(true);
    expect(frame.emptyReason).toBe("no_session");
  });

  it("rejects an unreadable envelope instead of returning an empty chart", () => {
    expect(() => decodeContractCandles(null)).toThrow(ContractChartError);
    expect(() => decodeContractCandles({ instrument_key: KEY, interval: "1m", candles: "nope" })).toThrow(
      /candle list/,
    );
    expect(() => decodeContractCandles({ instrument_key: KEY, interval: "7m", candles: [] })).toThrow(
      /unknown interval/,
    );
    expect(() => decodeContractCandles({ interval: "1m", candles: [] })).toThrow(/identify the contract/);
  });

  it("falls back to the requested contract when the envelope omits its identity", () => {
    const frame = decodeContractCandles(
      { candles: [], empty_reason: "market_closed" },
      { instrumentKey: KEY, interval: "15m" },
    );

    expect(frame.instrumentKey).toBe(KEY);
    expect(frame.interval).toBe("15m");
    expect(frame.candles).toEqual([]);
    expect(frame.emptyReason).toBe("market_closed");
  });
});
