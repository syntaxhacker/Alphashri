// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", async () => (await import("./apiTestMocks")).fetchWithAuthModuleMock());

import { fetchWithAuth } from "../state/auth";
import { errorResponse, okResponse } from "./apiTestMocks";
import { OptionDockError, fetchAnalytics, normalizeAnalytics } from "./optionsAnalytics";

const mockedFetch = vi.mocked(fetchWithAuth);

function rawAnalytics() {
  return {
    underlying: "nifty",
    spot: 25215.7,
    as_of: "2026-11-16T15:00:00+05:30",
    quotes_live: true,
    expiries: [
      {
        date: "2026-11-26",
        dte: 10,
        atm_iv: 11.9,
        rr25: -0.4,
        bf25: 0.6,
        slope: -0.03,
        fit_r2: 0.91,
        points: [
          { strike: 25400, delta: 0.24, iv: 12.1, oi: 1200, moneyness: 0.007 },
          { strike: 25000, delta: -0.28, iv: 13.3, oi: 900, moneyness: -0.009 },
        ],
      },
      {
        date: "2026-11-19",
        dte: 3,
        atm_iv: 12.4,
        rr25: 1.1,
        bf25: 0.8,
        slope: -0.05,
        fit_r2: 0.94,
        points: [{ strike: 25200, delta: 0.5, iv: 12.4, oi: 500 }],
      },
    ],
    term: [{ dte: 3, atm_iv: 12.4, rr25: 1.1 }, { dte: 10, atm_iv: 11.9 }],
    surface: { strikes: [25000, 25200], expiries: ["2026-11-19"], iv: [[13, null]] },
    levels: { call_wall: 25500, gex: { support: 25000, fuel_up: null } },
    probability: { model: "rnd-svi", flat_pop: 0.61, quantiles: { p50: 25200 } },
    warnings: [{ code: "thin_chain", detail: "Few strikes" }, "partial fit"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchAnalytics", () => {
  it("GETs the multi-expiry endpoint once and normalizes snake_case fields", async () => {
    mockedFetch.mockResolvedValue(okResponse(rawAnalytics()));

    const data = await fetchAnalytics("nifty");

    expect(mockedFetch.mock.calls[0][0]).toContain("/api/options/analytics/NIFTY");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(data?.symbol).toBe("NIFTY");
    expect(data?.spot).toBe(25215.7);
    expect(data?.asOf).toBe("2026-11-16T15:00:00+05:30");
    expect(data?.quotesLive).toBe(true);
    expect(data?.expiries.map((e) => e.date)).toEqual(["2026-11-19", "2026-11-26"]);
    expect(data?.expiries[1]).toMatchObject({
      dte: 10,
      atmIv: 11.9,
      rr25: -0.4,
      bf25: 0.6,
      slope: -0.03,
      fitR2: 0.91,
    });
    expect(data?.expiries[1].points.map((p) => p.strike)).toEqual([25000, 25400]);
    expect(data?.expiries[1].points[1]).toEqual({
      strike: 25400,
      moneyness: 0.007,
      iv: 12.1,
      delta: 0.24,
      oi: 1200,
    });
    expect(data?.term[1].atmIv).toBe(11.9);
    expect(data?.levels.callWall).toBe(25500);
    expect(data?.levels.gex.fuelUp).toBeNull();
    expect(data?.probability.flatPop).toBe(0.61);
    expect(data?.probability.quantiles.p50).toBe(25200);
    expect(data?.probability.quantiles.p95).toBeNull();
    expect(data?.surface.iv).toEqual([[13, null]]);
  });

  it("keeps missing numerics null, never 0, and drops non-finite values", async () => {
    mockedFetch.mockResolvedValue(
      okResponse({
        underlying: "NIFTY",
        spot: Number.NaN,
        expiries: [
          {
            date: "2026-11-19",
            points: [
              { strike: 25000, iv: null, delta: undefined },
              { strike: 25100, iv: "n/a", delta: Infinity },
              { strike: Number.NaN, iv: 12 },
            ],
          },
        ],
      }),
    );

    const data = await fetchAnalytics("NIFTY");

    expect(data?.spot).toBeNull();
    expect(data?.expiries[0].atmIv).toBeNull();
    expect(data?.expiries[0].dte).toBeNull();
    expect(data?.expiries[0].points).toHaveLength(2);
    expect(data?.expiries[0].points[0]).toEqual({
      strike: 25000,
      moneyness: null,
      iv: null,
      delta: null,
      oi: null,
    });
    expect(data?.expiries[0].points[1].iv).toBeNull();
    expect(data?.expiries[0].points[1].delta).toBeNull();
  });

  it("normalizes warnings from objects and strings", async () => {
    mockedFetch.mockResolvedValue(okResponse(rawAnalytics()));

    const data = await fetchAnalytics("NIFTY");

    expect(data?.warnings).toEqual([
      { code: "thin_chain", message: "Few strikes" },
      { code: null, message: "partial fit" },
    ]);
  });

  it("maps 401 to auth without retrying", async () => {
    mockedFetch.mockResolvedValue(errorResponse(401, { detail: "expired" }));

    await expect(fetchAnalytics("NIFTY")).rejects.toMatchObject({
      name: "OptionDockError",
      kind: "auth",
      message: "Reconnect Upstox in Settings",
      status: 401,
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("maps 404 to not_fno", async () => {
    mockedFetch.mockResolvedValue(
      errorResponse(404, { detail: { code: "not_fno", detail: "Unknown underlying" } }),
    );

    await expect(fetchAnalytics("RELIANCE")).rejects.toMatchObject({
      kind: "not_fno",
      status: 404,
    });
  });

  it("maps 429 to rate_limited with the Retry-After header", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === "Retry-After" ? "8" : null) },
      json: async () => ({ detail: { code: "rate_limited" } }),
    } as unknown as Response);

    const error = await fetchAnalytics("NIFTY").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OptionDockError);
    expect((error as OptionDockError).kind).toBe("rate_limited");
    expect((error as OptionDockError).retryAfterMs).toBe(8000);
  });

  it("retries a 5xx exactly once then resolves", async () => {
    vi.useFakeTimers();
    mockedFetch
      .mockResolvedValueOnce(errorResponse(503, { detail: "upstream down" }))
      .mockResolvedValueOnce(okResponse(rawAnalytics()));

    const pending = fetchAnalytics("NIFTY");
    await vi.advanceTimersByTimeAsync(300);
    const data = await pending;

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(data?.symbol).toBe("NIFTY");
    vi.useRealTimers();
  });

  it("resolves null for an already-aborted signal without calling fetch", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetchAnalytics("NIFTY", controller.signal)).resolves.toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("resolves null for an in-flight abort instead of throwing", async () => {
    const controller = new AbortController();
    mockedFetch.mockImplementationOnce(() => {
      controller.abort();
      const abort = new Error("aborted");
      abort.name = "AbortError";
      return Promise.reject(abort);
    });

    await expect(fetchAnalytics("NIFTY", controller.signal)).resolves.toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("passes the abort signal through to fetchWithAuth", async () => {
    mockedFetch.mockResolvedValue(okResponse(rawAnalytics()));
    const controller = new AbortController();

    await fetchAnalytics("NIFTY", controller.signal);

    expect(mockedFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});

describe("normalizeAnalytics", () => {
  it("survives a missing payload with empty collections and null numerics", () => {
    const data = normalizeAnalytics(null);
    expect(data).toMatchObject({
      symbol: "",
      spot: null,
      quotesLive: false,
      expiries: [],
      term: [],
      warnings: [],
    });
    expect(data.surface.strikes).toEqual([]);
    expect(data.levels.maxPain).toBeNull();
    expect(data.probability.model).toBeNull();
  });

  it("drops expiries with a malformed date", () => {
    const data = normalizeAnalytics({
      expiries: [{ date: "19-11-2026" }, { date: "2026-11-19" }],
    });
    expect(data.expiries.map((e) => e.date)).toEqual(["2026-11-19"]);
  });
});
