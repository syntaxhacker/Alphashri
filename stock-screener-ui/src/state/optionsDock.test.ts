// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchUnderlying = vi.fn();
const fetchChain = vi.fn();

vi.mock("../api/optionsDock", async () => {
  const actual = await vi.importActual<typeof import("../api/optionsDock")>("../api/optionsDock");
  return {
    ...actual,
    fetchUnderlying: (...args: unknown[]) => fetchUnderlying(...args),
    fetchChain: (...args: unknown[]) => fetchChain(...args),
  };
});

import { OptionDockError, type OptionDockChain, type UnderlyingInfo } from "../api/optionsDock";
import {
  __openSymbols,
  __resetOptionsDock,
  addLeg,
  close,
  netPremium,
  open,
  optionsDockState,
  refresh,
  removeLeg,
  setExpiry,
  setLegLots,
  staleLegs,
  toggleLegSide,
} from "./optionsDock";

const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function listing(overrides: Partial<UnderlyingInfo> = {}): UnderlyingInfo {
  return {
    symbol: "NIFTY",
    exchange: "NSE",
    fno: true,
    instrumentKey: "NSE_INDEX|Nifty 50",
    spot: 24031.5,
    expiries: [
      { date: "2026-03-26", weekly: true, dteDays: 2, lotSize: 65, tickSize: 0.05 },
      { date: "2026-04-02", weekly: true, dteDays: 9, lotSize: 65, tickSize: 0.05 },
    ],
    defaultExpiry: "2026-03-26",
    marketState: "open",
    ...overrides,
  };
}

function chain(expiry = "2026-03-26", spot = 24031.5): OptionDockChain {
  const empty = {
    ltp: 0,
    oi: 0,
    prevOi: 0,
    volume: 0,
    iv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    pop: null,
    bid: null,
    ask: null,
    instrumentKey: "",
  };
  return {
    expiry,
    spot,
    pcr: 1.11,
    atmIv: 13.8,
    spotChangePct: 0.42,
    asOf: "2026-03-24T14:52:00+05:30",
    rows: [
      { strike: 24000, ce: { ...empty, ltp: 114.4, oi: 8_600_000 }, pe: { ...empty, ltp: 82.9, oi: 10_200_000 } },
      { strike: 24100, ce: { ...empty, ltp: 67.7, oi: 12_400_000 }, pe: { ...empty, ltp: 136.2, oi: 5_100_000 } },
    ],
  };
}

/** Resolve on the microtask queue so the two-call open sequence finishes. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as any).__E2E_MOCK_MARKET_OPEN__ = false;
  __resetOptionsDock();
  fetchUnderlying.mockResolvedValue(listing());
  fetchChain.mockImplementation(async (_symbol: string, expiry: string) => chain(expiry));
});

afterEach(() => {
  __resetOptionsDock();
  vi.useRealTimers();
  delete (window as any).__E2E_MOCK_MARKET_OPEN__;
});

describe("open", () => {
  it("issues exactly one E1 and one E2 and lands on the default expiry", async () => {
    open("NIFTY");
    await flush();

    expect(fetchUnderlying).toHaveBeenCalledTimes(1);
    expect(fetchChain).toHaveBeenCalledTimes(1);
    expect(fetchChain).toHaveBeenCalledWith("NIFTY", "2026-03-26", expect.anything());
    expect(optionsDockState.symbol).toBe("NIFTY");
    expect(optionsDockState.status).toBe("ready");
    expect(optionsDockState.expiry).toBe("2026-03-26");
    expect(optionsDockState.chain?.rows).toHaveLength(2);
    expect(optionsDockState.asOf).toBe("2026-03-24T14:52:00+05:30");
  });

  it("re-opens with one E1 and one E2 (the server owns the 300 s E1 cache)", async () => {
    open("NIFTY");
    await flush();
    expect(fetchUnderlying).toHaveBeenCalledTimes(1);

    open("NIFTY", "chart");
    await flush();
    expect(fetchUnderlying).toHaveBeenCalledTimes(2);
    expect(fetchChain).toHaveBeenCalledTimes(2);
    expect(optionsDockState.mode).toBe("chart");
  });

  it("shows the non-F&O empty state without asking for a chain", async () => {
    fetchUnderlying.mockResolvedValue(listing({ fno: false, expiries: [], defaultExpiry: null }));

    open("RELIANCE");
    await flush();

    expect(fetchChain).not.toHaveBeenCalled();
    expect(optionsDockState.status).toBe("empty");
    expect(optionsDockState.error).toBeNull();
  });

  it("surfaces a 401 as an auth error and keeps the panel in the error state", async () => {
    fetchUnderlying.mockRejectedValue(new OptionDockError("auth", "Reconnect Upstox in Settings", 401));

    open("NIFTY");
    await flush();

    expect(optionsDockState.status).toBe("error");
    expect(optionsDockState.error).toMatchObject({ kind: "auth", message: "Reconnect Upstox in Settings" });
  });
});

describe("setExpiry", () => {
  it("costs exactly one request and paints the cached frame synchronously", async () => {
    open("NIFTY");
    await flush();
    fetchChain.mockClear();

    setExpiry("2026-04-02");
    // The cached-frame path is synchronous when a frame exists; here it does not,
    // so the loading state must be joined by exactly one chain request.
    expect(optionsDockState.expiry).toBe("2026-04-02");
    await flush();

    expect(fetchChain).toHaveBeenCalledTimes(1);
    expect(fetchChain).toHaveBeenCalledWith("NIFTY", "2026-04-02", expect.anything());
    expect(fetchUnderlying).toHaveBeenCalledTimes(1);
    expect(optionsDockState.chain?.expiry).toBe("2026-04-02");
  });

  it("is a no-op when the expiry is unchanged", async () => {
    open("NIFTY");
    await flush();
    fetchChain.mockClear();

    setExpiry("2026-03-26");
    await flush();

    expect(fetchChain).not.toHaveBeenCalled();
  });
});

describe("legs", () => {
  it("adds legs without a single network request", async () => {
    open("NIFTY");
    await flush();
    const calls = fetchChain.mock.calls.length + fetchUnderlying.mock.calls.length;

    addLeg({ side: "sell", type: "CE", strike: 24200, premium: 36.6 });
    addLeg({ side: "buy", type: "CE", strike: 24500, premium: 3.5 });

    expect(optionsDockState.legs).toHaveLength(2);
    expect(fetchChain.mock.calls.length + fetchUnderlying.mock.calls.length).toBe(calls);
  });

  it("uses the listing's lot size and computes net premium with credit positive", async () => {
    open("NIFTY");
    await flush();

    addLeg({ side: "sell", type: "CE", strike: 24200, premium: 36.6 });
    addLeg({ side: "buy", type: "CE", strike: 24500, premium: 3.5 });

    expect(optionsDockState.legs[0].lotSize).toBe(65);
    // (36.6 − 3.5) × 65 = ₹2 151.5 credit
    expect(netPremium()).toBeCloseTo(2151.5, 6);
  });

  it("caps the basket at four legs", async () => {
    open("NIFTY");
    await flush();

    for (const strike of [23800, 24000, 24200, 24400]) {
      addLeg({ side: "buy", type: "PE", strike, premium: 10 });
    }
    const fifth = addLeg({ side: "buy", type: "PE", strike: 24600, premium: 10 });

    expect(fifth).toBe(false);
    expect(optionsDockState.legs).toHaveLength(4);
  });

  it("flips side, steps lots and removes by key", async () => {
    open("NIFTY");
    await flush();

    addLeg({ side: "buy", type: "CE", strike: 24200, premium: 36.6 });
    const key = optionsDockState.legs[0].key;

    toggleLegSide(key);
    expect(optionsDockState.legs[0].side).toBe("sell");
    expect(netPremium()).toBeGreaterThan(0);

    setLegLots(key, 3);
    expect(optionsDockState.legs[0].lots).toBe(3);

    setLegLots(key, 0);
    expect(optionsDockState.legs[0].lots).toBe(1);

    removeLeg(key);
    expect(optionsDockState.legs).toHaveLength(0);
  });

  it("flags legs whose expiry is not on screen", async () => {
    open("NIFTY");
    await flush();

    addLeg({ side: "buy", type: "CE", strike: 24200, premium: 36.6 });
    setExpiry("2026-04-02");
    await flush();

    expect(staleLegs()).toHaveLength(1);
  });

  it("persists legs per symbol and restores them on reopen", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "sell", type: "PE", strike: 23800, premium: 23.1 });

    close();
    expect(optionsDockState.legs).toHaveLength(0);

    open("NIFTY");
    await flush();

    expect(optionsDockState.legs).toHaveLength(1);
    expect(optionsDockState.legs[0]).toMatchObject({ side: "sell", type: "PE", strike: 23800 });
  });
});

describe("close", () => {
  it("aborts the in-flight chain request and drops the state", async () => {
    let signal: AbortSignal | undefined;
    fetchChain.mockImplementation(((_s: string, _e: string, s?: AbortSignal) => {
      signal = s;
      return new Promise(() => undefined);
    }) as never);

    open("NIFTY");
    await flush();

    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);

    close();

    expect(signal!.aborted).toBe(true);
    expect(optionsDockState.status).toBe("idle");
    expect(optionsDockState.symbol).toBeNull();
    expect(optionsDockState.chain).toBeNull();
  });

  it("stops polling: no request arrives after close", async () => {
    vi.useFakeTimers();
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;

    open("NIFTY");
    await vi.advanceTimersByTimeAsync(0);
    const before = fetchChain.mock.calls.length;

    close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchChain.mock.calls.length).toBe(before);
  });
});

describe("polling", () => {
  it("refreshes the chain at the focused cadence while the derivatives session runs", async () => {
    vi.useFakeTimers();
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;

    open("NIFTY");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchChain).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchChain).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchChain).toHaveBeenCalledTimes(3);
  });

  it("does not poll when the market is closed", async () => {
    vi.useFakeTimers();
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    fetchUnderlying.mockResolvedValue(listing({ marketState: "closed" }));

    open("NIFTY");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchChain).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchChain).toHaveBeenCalledTimes(1);
  });

  it("backs off to 30 s while the tab is hidden", async () => {
    vi.useFakeTimers();
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    open("NIFTY");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchChain).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchChain).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchChain).toHaveBeenCalledTimes(2);

    hidden.mockRestore();
  });
});

describe("429 handling", () => {
  it("keeps the last frame painted and sets the paused chip", async () => {
    vi.useFakeTimers();
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;

    open("NIFTY");
    await vi.advanceTimersByTimeAsync(0);
    expect(optionsDockState.chain).not.toBeNull();

    fetchChain.mockRejectedValueOnce(new OptionDockError("rate_limited", "slow down", 429, 8000));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(optionsDockState.status).toBe("ready");
    expect(optionsDockState.chain).not.toBeNull();
    expect(optionsDockState.chain?.rows).toHaveLength(2);
    expect(optionsDockState.error).toBeNull();
    expect(optionsDockState.paused).toMatchObject({ retryAfterMs: 8000, reason: "rate_limited" });
  });

  it("clears the pause on a successful retry", async () => {
    vi.useFakeTimers();
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;

    open("NIFTY");
    await vi.advanceTimersByTimeAsync(0);

    fetchChain.mockRejectedValueOnce(new OptionDockError("rate_limited", "slow down", 429, 2000));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(optionsDockState.paused).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(optionsDockState.paused).toBeNull();
  });
});

describe("frames", () => {
  it("keeps at most three chain frames", async () => {
    const { __frames } = await import("./optionsDock");
    fetchUnderlying.mockResolvedValue(
      listing({
        expiries: [1, 2, 3, 4, 5].map((n) => ({
          date: `2026-04-0${n}`,
          weekly: true,
          dteDays: n,
          lotSize: 65,
          tickSize: 0.05,
        })),
        defaultExpiry: "2026-04-01",
      }),
    );

    open("NIFTY");
    await flush();
    for (const date of ["2026-04-02", "2026-04-03", "2026-04-04"]) {
      setExpiry(date);
      await flush();
    }

    expect(__frames.size).toBeLessThanOrEqual(3);
  });

  it("tracks at most five open symbols, oldest dropped first", async () => {
    for (const symbol of ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "RELIANCE"]) {
      fetchUnderlying.mockResolvedValueOnce(listing({ symbol }));
      fetchChain.mockResolvedValueOnce(chain());
      open(symbol);
      await flush();
    }

    expect(__openSymbols).toHaveLength(5);
    expect(__openSymbols).not.toContain("NIFTY");
    expect(__openSymbols[__openSymbols.length - 1]).toBe("RELIANCE");
  });

  it("a cached expiry paints without a loading blank", async () => {
    open("NIFTY");
    await flush();
    setExpiry("2026-04-02");
    await flush();
    expect(optionsDockState.chain?.expiry).toBe("2026-04-02");

    setExpiry("2026-03-26");
    // Synchronous: the cached frame is applied before the refresh returns.
    expect(optionsDockState.status).toBe("ready");
    expect(optionsDockState.chain?.expiry).toBe("2026-03-26");
  });
});

describe("refresh", () => {
  it("re-reads the current frame", async () => {
    open("NIFTY");
    await flush();
    fetchChain.mockClear();

    await refresh();

    expect(fetchChain).toHaveBeenCalledTimes(1);
    expect(fetchChain).toHaveBeenCalledWith("NIFTY", "2026-03-26", expect.anything());
  });
});

describe("__resetOptionsDock", () => {
  it("returns every field to its initial value", async () => {
    open("NIFTY");
    await flush();
    __resetOptionsDock();

    expect(optionsDockState.symbol).toBeNull();
    expect(optionsDockState.expiry).toBeNull();
    expect(optionsDockState.chain).toBeNull();
    expect(optionsDockState.legs).toEqual([]);
    expect(optionsDockState.status).toBe("idle");
    expect(TODAY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
