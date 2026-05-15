import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOptionsState,
  subscribe,
  setExpiry,
  setFilters,
  resetFilters,
  getFilteredChain,
  getStrikeMatrix,
  getAvailableExpiries,
  getAvailableUnderlyingSymbols,
  getUnderlyingInfo,
} from "./optionsStore";
import type { OptionContract, Expiry, Underlying } from "../api/upstoxOptions";

vi.mock("../api/upstoxOptions", () => ({
  getOptionChain: vi.fn(),
  getUnderlyings: vi.fn(),
  getExpiries: vi.fn(),
  getSpotPrice: vi.fn(),
  getPositions: vi.fn(),
}));

function createMockContract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    instrument_key: "key-1",
    trading_symbol: "NIFTY24000CE",
    strike_price: 24000,
    expiry: "2025-02-27",
    instrument_type: "CE",
    lot_size: 25,
    tick_size: 0.05,
    weekly: true,
    ...overrides,
  };
}

function createMockExpiry(date: string): Expiry {
  return { date, weekly: true, days_to_expiry: 30 };
}

function createMockUnderlying(symbol: string): Underlying {
  return { symbol, name: symbol, instrument_key: `key-${symbol}`, lot_size: 25, tick_size: 0.05 };
}

function resetStoreState() {
  const state = getOptionsState();
  (state as any).optionChain = [];
  (state as any).spotPrice = null;
  (state as any).expiries = [];
  (state as any).underlyings = [];
  (state as any).filters = {
    strikeRange: [0, 1000000],
    optionType: "BOTH",
    moneyness: "ALL",
    sortBy: "strike_price",
    sortOrder: "asc",
  };
}

describe("optionsStore initial state", () => {
  beforeEach(() => {
    resetStoreState();
  });

  it("has correct initial state", () => {
    const state = getOptionsState();
    expect(state.selectedUnderlying).toBe("");
    expect(state.selectedExpiry).toBe("");
    expect(state.optionChain).toEqual([]);
    expect(state.positions).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.filters.optionType).toBe("BOTH");
    expect(state.filters.moneyness).toBe("ALL");
    expect(state.filters.strikeRange).toEqual([0, 1000000]);
    expect(state.filters.sortBy).toBe("strike_price");
    expect(state.filters.sortOrder).toBe("asc");
    expect(state.spotPrice).toBeNull();
    expect(state.underlyings).toEqual([]);
    expect(state.expiries).toEqual([]);
  });
});

describe("subscribe", () => {
  it("returns unsubscribe function", () => {
    const unsub = subscribe(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });
});

describe("setExpiry", () => {
  beforeEach(() => {
    resetStoreState();
  });

  it("updates selectedExpiry", () => {
    setExpiry("2025-02-27");
    expect(getOptionsState().selectedExpiry).toBe("2025-02-27");
  });
});

describe("setFilters", () => {
  beforeEach(() => {
    resetStoreState();
  });

  it("merges partial filters", () => {
    setFilters({ optionType: "CE" });
    const state = getOptionsState();
    expect(state.filters.optionType).toBe("CE");
    expect(state.filters.moneyness).toBe("ALL");
  });

  it("sets strikeRange", () => {
    setFilters({ strikeRange: [23000, 25000] });
    expect(getOptionsState().filters.strikeRange).toEqual([23000, 25000]);
  });

  it("sets moneyness filter", () => {
    setFilters({ moneyness: "ITM" });
    expect(getOptionsState().filters.moneyness).toBe("ITM");
  });

  it("sets sort order", () => {
    setFilters({ sortOrder: "desc" });
    expect(getOptionsState().filters.sortOrder).toBe("desc");
  });
});

describe("resetFilters", () => {
  beforeEach(() => {
    resetStoreState();
  });

  it("resets filters to defaults", () => {
    setFilters({ optionType: "CE", moneyness: "ITM", strikeRange: [100, 200] });
    resetFilters();
    const state = getOptionsState();
    expect(state.filters.optionType).toBe("BOTH");
    expect(state.filters.moneyness).toBe("ALL");
    expect(state.filters.strikeRange).toEqual([0, 1000000]);
    expect(state.filters.sortOrder).toBe("asc");
  });
});

describe("getFilteredChain", () => {
  beforeEach(() => {
    resetStoreState();
  });
  afterEach(() => {
    resetStoreState();
  });

  it("returns empty array when no contracts", () => {
    expect(getFilteredChain()).toEqual([]);
  });

  it("filters by strike range", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({ strike_price: 23000 }),
      createMockContract({ strike_price: 24000 }),
      createMockContract({ strike_price: 25000 }),
    ];
    (state as any).spotPrice = 24000;
    setFilters({ strikeRange: [23500, 24500] });

    const result = getFilteredChain();
    expect(result).toHaveLength(1);
    expect(result[0].strike_price).toBe(24000);
  });

  it("filters by option type CE", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({
        strike_price: 24000,
        instrument_type: "CE",
        trading_symbol: "NIFTY24000CE",
      }),
      createMockContract({
        strike_price: 24000,
        instrument_type: "PE",
        trading_symbol: "NIFTY24000PE",
      }),
    ];
    setFilters({ optionType: "CE" });

    const result = getFilteredChain();
    expect(result).toHaveLength(1);
    expect(result[0].instrument_type).toBe("CE");
  });

  it("filters by option type PE", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({
        strike_price: 24000,
        instrument_type: "CE",
        trading_symbol: "NIFTY24000CE",
      }),
      createMockContract({
        strike_price: 24000,
        instrument_type: "PE",
        trading_symbol: "NIFTY24000PE",
      }),
    ];
    setFilters({ optionType: "PE" });

    const result = getFilteredChain();
    expect(result).toHaveLength(1);
    expect(result[0].instrument_type).toBe("PE");
  });

  it("filters by moneyness ITM for CE", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({
        strike_price: 23900,
        instrument_type: "CE",
        trading_symbol: "NIFTY23900CE",
      }),
      createMockContract({
        strike_price: 24000,
        instrument_type: "CE",
        trading_symbol: "NIFTY24000CE",
      }),
      createMockContract({
        strike_price: 24100,
        instrument_type: "CE",
        trading_symbol: "NIFTY24100CE",
      }),
    ];
    (state as any).spotPrice = 24000;
    setFilters({ moneyness: "ITM" });

    const result = getFilteredChain();
    expect(result).toHaveLength(1);
    expect(result[0].strike_price).toBe(23900);
  });

  it("does not filter by moneyness when spotPrice is null", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({
        strike_price: 23900,
        instrument_type: "CE",
        trading_symbol: "NIFTY23900CE",
      }),
      createMockContract({
        strike_price: 24100,
        instrument_type: "CE",
        trading_symbol: "NIFTY24100CE",
      }),
    ];
    (state as any).spotPrice = null;
    setFilters({ moneyness: "ITM" });

    const result = getFilteredChain();
    expect(result).toHaveLength(2);
  });

  it("sorts ascending by strike_price", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({ strike_price: 25000 }),
      createMockContract({ strike_price: 23000 }),
      createMockContract({ strike_price: 24000 }),
    ];
    setFilters({ sortBy: "strike_price", sortOrder: "asc" });

    const result = getFilteredChain();
    expect(result.map((c) => c.strike_price)).toEqual([23000, 24000, 25000]);
  });

  it("sorts descending by strike_price", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({ strike_price: 23000 }),
      createMockContract({ strike_price: 25000 }),
      createMockContract({ strike_price: 24000 }),
    ];
    setFilters({ sortBy: "strike_price", sortOrder: "desc" });

    const result = getFilteredChain();
    expect(result.map((c) => c.strike_price)).toEqual([25000, 24000, 23000]);
  });

  it("applies all filters together", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({
        strike_price: 23900,
        instrument_type: "CE",
        trading_symbol: "NIFTY23900CE",
      }),
      createMockContract({
        strike_price: 24000,
        instrument_type: "CE",
        trading_symbol: "NIFTY24000CE",
      }),
      createMockContract({
        strike_price: 24100,
        instrument_type: "CE",
        trading_symbol: "NIFTY24100CE",
      }),
      createMockContract({
        strike_price: 23900,
        instrument_type: "PE",
        trading_symbol: "NIFTY23900PE",
      }),
    ];
    (state as any).spotPrice = 24000;
    setFilters({ optionType: "CE", moneyness: "ITM", strikeRange: [0, 100000] });

    const result = getFilteredChain();
    expect(result).toHaveLength(1);
    expect(result[0].strike_price).toBe(23900);
  });
});

describe("getStrikeMatrix", () => {
  beforeEach(() => {
    resetStoreState();
  });
  afterEach(() => {
    resetStoreState();
  });

  it("returns empty array when no contracts", () => {
    expect(getStrikeMatrix()).toEqual([]);
  });

  it("groups CE and PE by strike price", () => {
    const state = getOptionsState();
    const ce = createMockContract({
      strike_price: 24000,
      instrument_type: "CE",
      trading_symbol: "NIFTY24000CE",
    });
    const pe = createMockContract({
      strike_price: 24000,
      instrument_type: "PE",
      trading_symbol: "NIFTY24000PE",
    });
    (state as any).optionChain = [ce, pe];

    const matrix = getStrikeMatrix();
    expect(matrix).toHaveLength(1);
    expect(matrix[0].strike).toBe(24000);
    expect(matrix[0].ce).toEqual(ce);
    expect(matrix[0].pe).toEqual(pe);
  });

  it("handles CE-only strike", () => {
    const state = getOptionsState();
    const ce = createMockContract({
      strike_price: 24000,
      instrument_type: "CE",
      trading_symbol: "NIFTY24000CE",
    });
    (state as any).optionChain = [ce];

    const matrix = getStrikeMatrix();
    expect(matrix).toHaveLength(1);
    expect(matrix[0].ce).toEqual(ce);
    expect(matrix[0].pe).toBeNull();
  });

  it("handles PE-only strike", () => {
    const state = getOptionsState();
    const pe = createMockContract({
      strike_price: 24000,
      instrument_type: "PE",
      trading_symbol: "NIFTY24000PE",
    });
    (state as any).optionChain = [pe];

    const matrix = getStrikeMatrix();
    expect(matrix).toHaveLength(1);
    expect(matrix[0].ce).toBeNull();
    expect(matrix[0].pe).toEqual(pe);
  });

  it("sorts by strike price ascending", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({ strike_price: 25000, instrument_type: "CE" }),
      createMockContract({ strike_price: 23000, instrument_type: "CE" }),
      createMockContract({ strike_price: 24000, instrument_type: "CE" }),
    ];

    const matrix = getStrikeMatrix();
    expect(matrix.map((m) => m.strike)).toEqual([23000, 24000, 25000]);
  });

  it("handles multiple strikes with mixed types", () => {
    const state = getOptionsState();
    (state as any).optionChain = [
      createMockContract({
        strike_price: 24000,
        instrument_type: "CE",
        trading_symbol: "NIFTY24000CE",
      }),
      createMockContract({
        strike_price: 25000,
        instrument_type: "PE",
        trading_symbol: "NIFTY25000PE",
      }),
      createMockContract({
        strike_price: 25000,
        instrument_type: "CE",
        trading_symbol: "NIFTY25000CE",
      }),
      createMockContract({
        strike_price: 24000,
        instrument_type: "PE",
        trading_symbol: "NIFTY24000PE",
      }),
    ];

    const matrix = getStrikeMatrix();
    expect(matrix).toHaveLength(2);
    expect(matrix[0].strike).toBe(24000);
    expect(matrix[1].strike).toBe(25000);
    expect(matrix[0].ce?.instrument_type).toBe("CE");
    expect(matrix[0].pe?.instrument_type).toBe("PE");
  });
});

describe("getAvailableExpiries", () => {
  beforeEach(() => {
    resetStoreState();
  });
  afterEach(() => {
    resetStoreState();
  });

  it("returns empty array when no expiries", () => {
    expect(getAvailableExpiries()).toEqual([]);
  });

  it("returns expiry dates", () => {
    const state = getOptionsState();
    (state as any).expiries = [createMockExpiry("2025-02-27"), createMockExpiry("2025-03-06")];

    const result = getAvailableExpiries();
    expect(result).toEqual(["2025-02-27", "2025-03-06"]);
  });
});

describe("getAvailableUnderlyingSymbols", () => {
  beforeEach(() => {
    resetStoreState();
  });
  afterEach(() => {
    resetStoreState();
  });

  it("returns empty array when no underlyings", () => {
    expect(getAvailableUnderlyingSymbols()).toEqual([]);
  });

  it("returns underlying symbols", () => {
    const state = getOptionsState();
    (state as any).underlyings = [createMockUnderlying("NIFTY"), createMockUnderlying("BANKNIFTY")];

    expect(getAvailableUnderlyingSymbols()).toEqual(["NIFTY", "BANKNIFTY"]);
  });
});

describe("getUnderlyingInfo", () => {
  beforeEach(() => {
    resetStoreState();
  });
  afterEach(() => {
    resetStoreState();
  });

  it("returns undefined when not found", () => {
    expect(getUnderlyingInfo("UNKNOWN")).toBeUndefined();
  });

  it("returns underlying info for matching symbol", () => {
    const state = getOptionsState();
    const underlying = createMockUnderlying("NIFTY");
    (state as any).underlyings = [underlying];

    expect(getUnderlyingInfo("NIFTY")).toEqual(underlying);
  });
});
