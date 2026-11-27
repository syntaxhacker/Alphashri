// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderSolidHook } from "../test-utils/solidRenderHook";
import { fetchPositions, getOptionsState, setFilters } from "../state/optionsStore";
import { useOptionsState } from "./useOptionsState";
import type { OptionContract } from "../api/upstoxOptions";

vi.mock("../api/upstoxOptions", () => ({
  getOptionChain: vi.fn(async () => ({ chain: [], spot: 0, timestamp: "t", summary: undefined })),
  getUnderlyings: vi.fn(async () => []),
  getExpiries: vi.fn(async () => []),
  getSpotPrice: vi.fn(async () => ({ spot: 0 })),
  getPositions: vi.fn(async () => ({ positions: [] })),
}));

/** 120 strikes x CE/PE = 240 contracts; the filtered array is length 240. */
const STRIKES = 120;
const CHAIN_LENGTH = STRIKES * 2;
const UNRELATED_CHANGES = 6;

function makeChain(): OptionContract[] {
  const chain: OptionContract[] = [];
  for (let i = 0; i < STRIKES; i += 1) {
    const strike = 20000 + i * 50;
    chain.push({
      instrument_key: `ce-${i}`,
      trading_symbol: `NIFTY${strike}CE`,
      strike_price: strike,
      expiry: "2026-03-26",
      instrument_type: "CE",
    });
    chain.push({
      instrument_key: `pe-${i}`,
      trading_symbol: `NIFTY${strike}PE`,
      strike_price: strike,
      expiry: "2026-03-26",
      instrument_type: "PE",
    });
  }
  return chain;
}

function resetStore(): void {
  const state = getOptionsState() as any;
  state.optionChain = makeChain();
  state.spotPrice = null;
  state.expiries = [];
  state.underlyings = [];
  state.selectedUnderlying = "";
  state.selectedExpiry = "";
  state.loading = false;
  state.error = null;
  state.positions = [];
  state.filters = {
    strikeRange: [0, 1000000],
    optionType: "BOTH",
    moneyness: "ALL",
    sortBy: "strike_price",
    sortOrder: "asc",
  };
}

describe("useOptionsState derivation scope", () => {
  let sortSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetStore();
    sortSpy = vi.spyOn(Array.prototype, "sort");
  });

  afterEach(() => {
    sortSpy.mockRestore();
    resetStore();
  });

  /** Counts sorts of the full filtered chain (the strike-matrix sort is length STRIKES). */
  function chainSorts(): number {
    return sortSpy.mock.contexts.filter(
      (ctx) => Array.isArray(ctx) && ctx.length === CHAIN_LENGTH,
    ).length;
  }

  it("does not rebuild the chain derivation on unrelated loading/positions notifications", async () => {
    const { result, unmount } = renderSolidHook(() => useOptionsState());
    // Flush onMount's initOptionsState/fetchPositions before measuring.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.filteredChain).toHaveLength(CHAIN_LENGTH);
    const baseline = chainSorts();

    for (let i = 0; i < UNRELATED_CHANGES; i += 1) {
      await fetchPositions();
      // Memos are lazy: read to flush any invalidation before the next change.
      void result.current.filteredChain;
    }

    // A positions/loading notification is not a chain input: the filter+sort
    // must not run once per unrelated change.
    expect(chainSorts() - baseline).toBe(0);
    expect(result.current.filteredChain).toHaveLength(CHAIN_LENGTH);
    unmount();
  });

  it("still rebuilds the chain derivation when a relevant field changes", async () => {
    const { result, unmount } = renderSolidHook(() => useOptionsState());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.filteredChain).toHaveLength(CHAIN_LENGTH);
    expect(result.current.filteredChain[0].strike_price).toBe(20000);
    const baseline = chainSorts();

    // sortOrder keeps every contract in the filtered array (length 240), so
    // the chain sort remains identifiable by its array length.
    setFilters({ sortOrder: "desc" });
    void result.current.filteredChain;

    // A relevant change must still rebuild the chain (the unrelated-change
    // test above is the strict structural assertion).
    expect(chainSorts() - baseline).toBeGreaterThanOrEqual(1);
    expect(result.current.filteredChain).toHaveLength(CHAIN_LENGTH);
    expect(result.current.filteredChain[0].strike_price).toBe(20000 + (STRIKES - 1) * 50);
    unmount();
  });
});
