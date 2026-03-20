import { describe, expect, it } from "vitest";
import { applyChainFilters, buildStrikeMatrix } from "./useOptionsState";
import type { OptionContract, OptionsFilters } from "./useOptionsState";

function makeContract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    instrument_key: "key",
    trading_symbol: "NIFTY24000CE",
    strike_price: 24000,
    expiry: "2026-03-26",
    instrument_type: "CE",
    ...overrides,
  };
}

const defaultFilters: OptionsFilters = {
  strikeRange: [0, 1000000],
  optionType: "BOTH",
  moneyness: "ALL",
  sortBy: "strike_price",
  sortOrder: "asc",
};

describe("applyChainFilters", () => {
  const chain: OptionContract[] = [
    makeContract({ strike_price: 24000, instrument_type: "CE", trading_symbol: "NIFTY24000CE" }),
    makeContract({ strike_price: 24500, instrument_type: "CE", trading_symbol: "NIFTY24500CE" }),
    makeContract({ strike_price: 24000, instrument_type: "PE", trading_symbol: "NIFTY24000PE" }),
    makeContract({ strike_price: 23500, instrument_type: "PE", trading_symbol: "NIFTY23500PE" }),
  ];

  it("returns all contracts with default filters", () => {
    const result = applyChainFilters(chain, defaultFilters, null);
    expect(result).toHaveLength(4);
  });

  it("filters by strike range", () => {
    const filters: OptionsFilters = { ...defaultFilters, strikeRange: [23800, 24100] };
    const result = applyChainFilters(chain, filters, null);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.strike_price >= 23800 && c.strike_price <= 24100)).toBe(true);
  });

  it("filters by option type CE only", () => {
    const filters: OptionsFilters = { ...defaultFilters, optionType: "CE" };
    const result = applyChainFilters(chain, filters, null);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.instrument_type === "CE")).toBe(true);
  });

  it("filters by option type PE only", () => {
    const filters: OptionsFilters = { ...defaultFilters, optionType: "PE" };
    const result = applyChainFilters(chain, filters, null);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.instrument_type === "PE")).toBe(true);
  });

  it("sorts ascending by strike_price", () => {
    const unsorted = [
      makeContract({ strike_price: 24500 }),
      makeContract({ strike_price: 23000 }),
      makeContract({ strike_price: 24000 }),
    ];
    const result = applyChainFilters(unsorted, defaultFilters, null);
    expect(result.map((c) => c.strike_price)).toEqual([23000, 24000, 24500]);
  });

  it("sorts descending by strike_price", () => {
    const filters: OptionsFilters = { ...defaultFilters, sortOrder: "desc" };
    const unsorted = [
      makeContract({ strike_price: 24500 }),
      makeContract({ strike_price: 23000 }),
      makeContract({ strike_price: 24000 }),
    ];
    const result = applyChainFilters(unsorted, filters, null);
    expect(result.map((c) => c.strike_price)).toEqual([24500, 24000, 23000]);
  });

  it("returns empty array for empty chain", () => {
    const result = applyChainFilters([], defaultFilters, null);
    expect(result).toEqual([]);
  });

  it("filters by moneyness ITM for CE when spot is provided", () => {
    const ceChain = [
      makeContract({ strike_price: 23900, instrument_type: "CE" }),
      makeContract({ strike_price: 24000, instrument_type: "CE" }),
      makeContract({ strike_price: 24100, instrument_type: "CE" }),
    ];
    const filters: OptionsFilters = { ...defaultFilters, moneyness: "ITM" };
    const result = applyChainFilters(ceChain, filters, 24000);
    expect(result).toHaveLength(1);
    expect(result[0].strike_price).toBe(23900);
  });

  it("filters by moneyness OTM for PE when spot is provided", () => {
    const peChain = [
      makeContract({ strike_price: 23900, instrument_type: "PE" }),
      makeContract({ strike_price: 24000, instrument_type: "PE" }),
      makeContract({ strike_price: 24100, instrument_type: "PE" }),
    ];
    const filters: OptionsFilters = { ...defaultFilters, moneyness: "OTM" };
    const result = applyChainFilters(peChain, filters, 24000);
    expect(result).toHaveLength(1);
    expect(result[0].strike_price).toBe(23900);
  });

  it("does not filter by moneyness when spotPrice is null", () => {
    const ceChain = [
      makeContract({ strike_price: 23900, instrument_type: "CE" }),
      makeContract({ strike_price: 24100, instrument_type: "CE" }),
    ];
    const filters: OptionsFilters = { ...defaultFilters, moneyness: "ITM" };
    const result = applyChainFilters(ceChain, filters, null);
    expect(result).toHaveLength(2);
  });

  it("applies all filters together", () => {
    const mixed = [
      makeContract({ strike_price: 23900, instrument_type: "CE" }),
      makeContract({ strike_price: 23900, instrument_type: "PE" }),
      makeContract({ strike_price: 24000, instrument_type: "CE" }),
      makeContract({ strike_price: 24100, instrument_type: "CE" }),
    ];
    const filters: OptionsFilters = {
      ...defaultFilters,
      strikeRange: [23800, 24100],
      optionType: "CE",
      moneyness: "ITM",
    };
    const result = applyChainFilters(mixed, filters, 24000);
    expect(result).toHaveLength(1);
    expect(result[0].strike_price).toBe(23900);
    expect(result[0].instrument_type).toBe("CE");
  });
});

describe("buildStrikeMatrix", () => {
  it("pairs CE and PE contracts at the same strike", () => {
    const chain: OptionContract[] = [
      makeContract({ strike_price: 24000, instrument_type: "CE" }),
      makeContract({ strike_price: 24000, instrument_type: "PE" }),
    ];
    const matrix = buildStrikeMatrix(chain);
    expect(matrix).toHaveLength(1);
    expect(matrix[0].strike).toBe(24000);
    expect(matrix[0].ce?.instrument_type).toBe("CE");
    expect(matrix[0].pe?.instrument_type).toBe("PE");
  });

  it("sets null for missing CE or PE", () => {
    const chain: OptionContract[] = [makeContract({ strike_price: 24000, instrument_type: "CE" })];
    const matrix = buildStrikeMatrix(chain);
    expect(matrix).toHaveLength(1);
    expect(matrix[0].ce).not.toBeNull();
    expect(matrix[0].pe).toBeNull();
  });

  it("sorts by strike price ascending", () => {
    const chain: OptionContract[] = [
      makeContract({ strike_price: 24500, instrument_type: "CE" }),
      makeContract({ strike_price: 23000, instrument_type: "CE" }),
      makeContract({ strike_price: 24000, instrument_type: "PE" }),
    ];
    const matrix = buildStrikeMatrix(chain);
    expect(matrix.map((r) => r.strike)).toEqual([23000, 24000, 24500]);
  });

  it("returns empty array for empty chain", () => {
    expect(buildStrikeMatrix([])).toEqual([]);
  });

  it("handles multiple strikes with mixed CE/PE", () => {
    const chain: OptionContract[] = [
      makeContract({ strike_price: 24000, instrument_type: "CE" }),
      makeContract({ strike_price: 24500, instrument_type: "PE" }),
      makeContract({ strike_price: 24000, instrument_type: "PE" }),
      makeContract({ strike_price: 23500, instrument_type: "CE" }),
      makeContract({ strike_price: 24500, instrument_type: "CE" }),
    ];
    const matrix = buildStrikeMatrix(chain);
    expect(matrix).toHaveLength(3);
    expect(matrix.map((r) => r.strike)).toEqual([23500, 24000, 24500]);
    expect(matrix[0].ce).not.toBeNull();
    expect(matrix[0].pe).toBeNull();
    expect(matrix[1].ce).not.toBeNull();
    expect(matrix[1].pe).not.toBeNull();
    expect(matrix[2].ce).not.toBeNull();
    expect(matrix[2].pe).not.toBeNull();
  });
});
