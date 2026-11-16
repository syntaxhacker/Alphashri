// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", async () => (await import("./apiTestMocks")).fetchWithAuthModuleMock());

import { fetchWithAuth } from "../state/auth";
import { errorResponse, okResponse } from "./apiTestMocks";
import {
  OptionDockError,
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

  it("passes the abort signal through to fetchWithAuth", async () => {
    mockedFetch.mockResolvedValue(okResponse(UNDERLYING_BODY));
    const controller = new AbortController();

    await fetchUnderlying("NIFTY", controller.signal);

    expect(mockedFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
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
});
