// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", async () => (await import("./apiTestMocks")).fetchWithAuthModuleMock());

import { fetchWithAuth } from "../state/auth";
import { errorResponse, okResponse } from "./apiTestMocks";
import {
  OptionDockError,
  REQUEST_TIMEOUT_MS,
  fetchChain,
  fetchUnderlying,
  normalizeChain,
  normalizeUnderlying,
} from "./optionsDock";

const mockedFetch = vi.mocked(fetchWithAuth);

const UNDERLYING_BODY = {
  symbol: "NIFTY",
  exchange: "NSE",
  fno: true,
  instrument_key: "NSE_INDEX|Nifty 50",
  spot: 24031.5,
  expiries: [
    { date: "2026-03-26", weekly: true, dte_days: 2, lot_size: 65, tick_size: 0.05 },
    { date: "2026-03-25", weekly: false, dte_days: 1, lot_size: 65, tick_size: 0.05 },
  ],
  default_expiry: "2026-03-26",
  market_state: "open",
};

function rawChain() {
  return {
    status: "ok",
    underlying: "NIFTY",
    expiry: "2026-03-26",
    spot: 24031.5,
    timestamp: "2026-03-24T14:52:00+05:30",
    chain: [
      {
        strike: 24000,
        ce: {
          instrument_key: "NSE_FO|1",
          market_data: { ltp: 114.4, oi: 8600000, prev_oi: 8500000, volume: 331000, bid_price: 114, ask_price: 115 },
          option_greeks: { delta: 0.55, gamma: 0.002, theta: -6, vega: 12, iv: 13.8, pop: 0.42 },
        },
        pe: {
          instrument_key: "NSE_FO|2",
          market_data: { ltp: 82.9, oi: 10200000, prev_oi: 10000000, volume: 441000, bid_price: 82, ask_price: 83 },
          // Upstox omits greeks on illiquid legs: presence, not truthiness.
          option_greeks: null,
        },
      },
      {
        strike: 23900,
        ce: {
          instrument_key: "NSE_FO|3",
          market_data: { ltp: 177.5, oi: 5200000, prev_oi: 5000000, volume: 402000, bid_price: 177, ask_price: 178 },
          option_greeks: { delta: 0.71, gamma: 0.002, theta: -5, vega: 11, iv: 13.9, pop: 0.55 },
        },
        pe: null,
      },
    ],
    summary: { pcr: 9.99, max_pain: 24000, total_ce_oi: 13800000, total_pe_oi: 10200000 },
  };
}

function rawLevels() {
  return {
    spot: 24031.5,
    step: 50,
    thin: false,
    call_wall: { strike: 24100, side: "above", strength: 0.18, oi: 13_599_300 },
    put_wall: { strike: 23900, side: "below", strength: 0.14, oi: 9_821_500 },
    call_walls: [{ strike: 24100, side: "above", strength: 0.18, oi: 13_599_300 }],
    put_walls: [{ strike: 23900, side: "below", strength: 0.14, oi: 9_821_500 }],
    max_pain: { strike: 24000, side: "below", strength: 0.31, payout: 1_234_567 },
    gex: {
      support: { strike: 23950, side: "below", strength: 0.37, net_gex: 0.57 },
      resistance: { strike: 24200, side: "above", strength: 1, net_gex: 2.3 },
      fuel_up: { strike: 24150, side: "above", strength: 0.45, net_gex: -0.69 },
      fuel_down: { strike: 23850, side: "below", strength: 0.74, net_gex: -4.59 },
      flip: 24150,
      regime: "short",
      degraded: false,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchUnderlying", () => {
  it("GETs the E1 endpoint and normalizes expiries sorted by date", async () => {
    mockedFetch.mockResolvedValue(okResponse(UNDERLYING_BODY));

    const info = await fetchUnderlying("NIFTY");

    expect(mockedFetch.mock.calls[0][0]).toContain("/api/options/underlying/NIFTY");
    expect(info?.symbol).toBe("NIFTY");
    expect(info?.fno).toBe(true);
    expect(info?.expiries.map((e) => e.date)).toEqual(["2026-03-25", "2026-03-26"]);
    expect(info?.expiries[1]).toEqual({
      date: "2026-03-26",
      weekly: true,
      dteDays: 2,
      lotSize: 65,
      tickSize: 0.05,
    });
    expect(info?.defaultExpiry).toBe("2026-03-26");
    expect(info?.marketState).toBe("open");
  });

  it("maps a 404 not_fno body to a typed error", async () => {
    mockedFetch.mockResolvedValue(
      errorResponse(404, { detail: { code: "not_fno", detail: "Unknown underlying: RELIANCE" } }),
    );

    await expect(fetchUnderlying("RELIANCE")).rejects.toMatchObject({
      name: "OptionDockError",
      kind: "not_fno",
      status: 404,
    });
  });

  it("maps 401 to the reconnect message and does not retry", async () => {
    mockedFetch.mockResolvedValue(errorResponse(401, { detail: "expired" }));

    await expect(fetchUnderlying("NIFTY")).rejects.toMatchObject({
      kind: "auth",
      message: "Reconnect Upstox in Settings",
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to rate_limited with the Retry-After header when present", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === "Retry-After" ? "8" : null) },
      json: async () => ({ detail: { code: "rate_limited" } }),
    } as unknown as Response);

    const error = await fetchUnderlying("NIFTY").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OptionDockError);
    expect((error as OptionDockError).kind).toBe("rate_limited");
    expect((error as OptionDockError).retryAfterMs).toBe(8000);
  });

  it("retries a 503 exactly once, then resolves", async () => {
    vi.useFakeTimers();
    mockedFetch
      .mockResolvedValueOnce(errorResponse(503, { detail: "upstream down" }))
      .mockResolvedValueOnce(okResponse(UNDERLYING_BODY));

    const pending = fetchUnderlying("NIFTY");
    await vi.advanceTimersByTimeAsync(300);
    const info = await pending;

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(info?.symbol).toBe("NIFTY");
    vi.useRealTimers();
  });

  it("resolves null for an aborted request instead of throwing", async () => {
    const controller = new AbortController();
    mockedFetch.mockImplementationOnce(() => {
      controller.abort();
      const abort = new Error("aborted");
      abort.name = "AbortError";
      return Promise.reject(abort);
    });

    await expect(fetchUnderlying("NIFTY", controller.signal)).resolves.toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null without calling fetch when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetchUnderlying("NIFTY", controller.signal)).resolves.toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("links the caller's signal to the per-attempt signal passed to fetchWithAuth", async () => {
    const controller = new AbortController();
    mockedFetch.mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          const abort = new Error("aborted");
          abort.name = "AbortError";
          reject(abort);
        });
      });
    });

    const pending = fetchUnderlying("NIFTY", controller.signal);
    const attemptSignal = mockedFetch.mock.calls[0][1]?.signal;
    expect(attemptSignal).toBeDefined();
    expect(attemptSignal).not.toBe(controller.signal);
    expect(attemptSignal!.aborted).toBe(false);

    controller.abort();
    expect(attemptSignal!.aborted).toBe(true);
    await expect(pending).resolves.toBeNull();
  });
});

describe("normalizeUnderlying", () => {
  it("treats a missing expiry listing as non-F&O even when fno is true", () => {
    const info = normalizeUnderlying({ symbol: "abc", fno: true, expiries: [] });
    expect(info.fno).toBe(false);
    expect(info.symbol).toBe("ABC");
    expect(info.expiries).toEqual([]);
    expect(info.marketState).toBe("closed");
  });

  it("drops a malformed expiry date", () => {
    const info = normalizeUnderlying({
      expiries: [{ date: "26-03-2026" }, { date: "2026-03-26", dte_days: 1 }],
    });
    expect(info.expiries.map((e) => e.date)).toEqual(["2026-03-26"]);
  });
});

describe("fetchChain", () => {
  it("GETs the E2 endpoint with the expiry as a query parameter", async () => {
    mockedFetch.mockResolvedValue(okResponse(rawChain()));

    await fetchChain("NIFTY", "2026-03-26");

    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/options/chain/NIFTY");
    expect(url).toContain("expiry=2026-03-26");
  });

  it("carries the levels block through to the DTO", async () => {
    mockedFetch.mockResolvedValue(okResponse({ ...rawChain(), levels: rawLevels() }));

    const chain = await fetchChain("NIFTY", "2026-03-26");

    expect(chain?.levels?.maxPain?.strike).toBe(24000);
    expect(chain?.levels?.gex.resistance?.strength).toBe(1);
  });
});

describe("request deadline", () => {
  it("rejects a hung chain with a typed timeout after the deadline, without retrying", async () => {
    vi.useFakeTimers();
    mockedFetch.mockImplementation(() => new Promise(() => undefined));

    const pending = fetchChain("NIFTY", "2026-03-26");
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    const error = await settled;
    expect(error).toBeInstanceOf(OptionDockError);
    expect(error).toMatchObject({ kind: "timeout" });
    // A timeout is surfaced to the UI's Retry banner, not silently retried.
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("clears the deadline on a resolved response", async () => {
    vi.useFakeTimers();
    mockedFetch.mockResolvedValue(okResponse(UNDERLYING_BODY));

    const info = await fetchUnderlying("NIFTY");
    expect(info?.symbol).toBe("NIFTY");
    // Advancing past the deadline must not reject an already-settled request.
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    vi.useRealTimers();
  });

  it("aborts the in-flight attempt when the deadline fires, instead of leaving it running", async () => {
    vi.useFakeTimers();
    let attemptSignal: AbortSignal | undefined;
    mockedFetch.mockImplementation((_url: string, options?: RequestInit) => {
      attemptSignal = options?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const settled = fetchChain("NIFTY", "2026-03-26").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    expect(await settled).toMatchObject({ kind: "timeout" });
    expect(attemptSignal).toBeDefined();
    expect(attemptSignal!.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("keeps a caller abort as an abort, not a timeout, even when the fetch hangs", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    mockedFetch.mockImplementation(() => new Promise<Response>(() => undefined));

    const settled = fetchChain("NIFTY", "2026-03-26", controller.signal)
      .then((value) => ({ value }))
      .catch((error: unknown) => ({ error }));

    controller.abort();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    // Abort resolves to null; a timeout would have rejected with an error.
    expect(await settled).toEqual({ value: null });
    vi.useRealTimers();
  });
});

describe("normalizeChain", () => {
  it("flattens market_data and keeps missing greeks null", () => {
    const chain = normalizeChain(rawChain());

    expect(chain.expiry).toBe("2026-03-26");
    expect(chain.spot).toBe(24031.5);
    expect(chain.rows.map((row) => row.strike)).toEqual([23900, 24000]);
    const atm = chain.rows[1];
    expect(atm.ce.ltp).toBe(114.4);
    expect(atm.ce.oi).toBe(8_600_000);
    expect(atm.ce.delta).toBe(0.55);
    // `option_greeks: null` must not become 0.
    expect(atm.pe.iv).toBeNull();
    expect(atm.pe.delta).toBeNull();
    expect(atm.pe.ltp).toBe(82.9);
  });

  it("computes ATM IV from the strike nearest spot", () => {
    const chain = normalizeChain(rawChain());
    expect(chain.atmIv).toBe(13.8);
  });

  it("derives PCR from the rows, not the summary", () => {
    const chain = normalizeChain(rawChain());
    expect(chain.pcr).toBeCloseTo(10_200_000 / 13_800_000, 6);
  });

  it("returns null PCR rather than 0 when CE OI is zero", () => {
    const chain = normalizeChain({
      chain: [{ strike: 100, ce: { market_data: { oi: 0 } }, pe: { market_data: { oi: 500 } } }],
      summary: null,
    });
    expect(chain.pcr).toBeNull();
  });

  it("survives a missing chain array", () => {
    const chain = normalizeChain({ expiry: "2026-03-26", spot: 100 });
    expect(chain.rows).toEqual([]);
    expect(chain.atmIv).toBeNull();
    expect(chain.pcr).toBeNull();
  });

  it("keeps a null spot change out of the payload as null, never 0", () => {
    const chain = normalizeChain(rawChain());
    expect(chain.spotChangePct).toBeNull();
  });

  it("normalizes the levels block null-preservingly", () => {
    const chain = normalizeChain({ ...rawChain(), levels: rawLevels() });
    const lv = chain.levels!;

    expect(lv.spot).toBe(24031.5);
    expect(lv.step).toBe(50);
    expect(lv.thin).toBe(false);
    expect(lv.callWall).toEqual({
      strike: 24100, side: "above", strength: 0.18, oi: 13_599_300, payout: null, netGex: null,
    });
    expect(lv.putWall?.oi).toBe(9_821_500);
    expect(lv.callWalls).toHaveLength(1);
    expect(lv.putWalls).toHaveLength(1);
    expect(lv.maxPain).toEqual({
      strike: 24000, side: "below", strength: 0.31, oi: null, payout: 1_234_567, netGex: null,
    });
    expect(lv.gex.support?.netGex).toBe(0.57);
    expect(lv.gex.resistance?.strength).toBe(1);
    expect(lv.gex.fuelUp?.netGex).toBe(-0.69);
    expect(lv.gex.fuelDown?.strike).toBe(23850);
    expect(lv.gex.flip).toBe(24150);
    expect(lv.gex.regime).toBe("short");
    expect(lv.gex.degraded).toBe(false);
  });

  it("keeps a legacy payload's levels null", () => {
    expect(normalizeChain(rawChain()).levels).toBeNull();
    expect(normalizeChain({ levels: null }).levels).toBeNull();
    expect(normalizeChain({ levels: "nope" }).levels).toBeNull();
  });

  it("never invents a missing level metric and drops malformed levels", () => {
    const chain = normalizeChain({
      levels: {
        call_wall: { strike: 100 },
        put_wall: { oi: 5 },
        max_pain: { strike: 200, strength: null, payout: null },
        gex: { support: null, resistance: {}, fuel_up: "x", flip: null, regime: null, degraded: null },
        call_walls: [null, { strike: 300 }, "bad"],
      },
    });
    const lv = chain.levels!;

    expect(lv.callWall).toEqual({
      strike: 100, side: null, strength: null, oi: null, payout: null, netGex: null,
    });
    expect(lv.putWall).toBeNull();
    expect(lv.maxPain?.strength).toBeNull();
    expect(lv.maxPain?.payout).toBeNull();
    expect(lv.gex.support).toBeNull();
    expect(lv.gex.resistance).toBeNull();
    expect(lv.gex.fuelUp).toBeNull();
    expect(lv.gex.flip).toBeNull();
    expect(lv.gex.regime).toBeNull();
    expect(lv.gex.degraded).toBeNull();
    expect(lv.callWalls).toEqual([
      { strike: 300, side: null, strength: null, oi: null, payout: null, netGex: null },
    ]);
    expect(lv.putWalls).toEqual([]);
  });
});
