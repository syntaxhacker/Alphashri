import { createEffect, createMemo } from "solid-js";
import * as optionsState from "../state/optionsStore";
import {
  subscribe,
  getAvailableExpiries,
  getFilteredChain,
  getStrikeMatrix,
  getAvailableUnderlyingSymbols,
} from "../state/optionsStore";
import { getMoneyness } from "../utils/options";
import { useStoreSubscription } from "./useStoreSubscription";
import type { OptionContract } from "../api/upstoxOptions";
import type { OptionsFilters } from "../state/optionsStore";
export type { OptionsFilters };

export function applyChainFilters(
  chain: OptionContract[],
  filters: OptionsFilters,
  spotPrice: number | null,
): OptionContract[] {
  let filtered = chain.filter(
    (c) => c.strike_price >= filters.strikeRange[0] && c.strike_price <= filters.strikeRange[1],
  );

  if (filters.optionType !== "BOTH") {
    filtered = filtered.filter((c) => c.instrument_type === filters.optionType);
  }

  if (filters.moneyness !== "ALL" && spotPrice) {
    filtered = filtered.filter(
      (c) =>
        getMoneyness(c.strike_price, spotPrice, c.instrument_type as "CE" | "PE") ===
        filters.moneyness,
    );
  }

  return sortChain(filtered, filters);
}

function sortChain(chain: OptionContract[], filters: OptionsFilters): OptionContract[] {
  const sorted = [...chain];
  sorted.sort((a, b) => {
    const multiplier = filters.sortOrder === "asc" ? 1 : -1;
    const aVal = (a as any)[filters.sortBy];
    const bVal = (b as any)[filters.sortBy];
    return (aVal - bVal) * multiplier;
  });
  return sorted;
}

export function buildStrikeMatrix(
  chain: OptionContract[],
): Array<{ strike: number; ce: OptionContract | null; pe: OptionContract | null }> {
  return getStrikeMatrix(chain);
}

export function useOptionsState() {
  useStoreSubscription(subscribe);

  // The store is a module singleton, read through the subscription above.
  const state = optionsState.getOptionsState();

  createEffect(() => {
    void optionsState.initOptionsState();
  });

  createEffect(() => {
    if (state.selectedUnderlying && state.selectedExpiry) {
      void optionsState.fetchChain();
    }
  });

  createEffect(() => {
    void optionsState.fetchPositions();
  });

  const filteredChain = createMemo(() => getFilteredChain());
  const strikeMatrix = createMemo(() => getStrikeMatrix(filteredChain()));
  const availableExpiries = createMemo(() => getAvailableExpiries());
  const availableUnderlyings = createMemo(() => getAvailableUnderlyingSymbols());

  const onSetUnderlying = (underlying: string) => {
    optionsState.setUnderlying(underlying);
  };

  const onSetExpiry = (expiry: string) => {
    // The [selectedUnderlying, selectedExpiry] effect owns the chain fetch;
    // calling it here too produced two identical requests per expiry click.
    optionsState.setExpiry(expiry);
  };

  const onSetFilters = (newFilters: Partial<OptionsFilters>) => {
    optionsState.setFilters(newFilters);
  };

  const onChainRowClick = (contract: OptionContract) => {
    console.log("Row clicked:", contract);
  };

  return {
    selectedUnderlying: state.selectedUnderlying,
    selectedExpiry: state.selectedExpiry,
    optionChain: state.optionChain,
    positions: state.positions,
    loading: state.loading,
    error: state.error,
    filters: state.filters,
    spotPrice: state.spotPrice,
    timestamp: state.lastUpdated,
    summary: state.summary,
    availableUnderlyings: availableUnderlyings(),
    availableExpiries: availableExpiries(),
    filteredChain: filteredChain(),
    strikeMatrix: strikeMatrix(),
    setUnderlying: onSetUnderlying,
    setExpiry: onSetExpiry,
    setFilters: onSetFilters,
    fetchChain: () => optionsState.fetchChain(),
    refreshChain: () => optionsState.fetchChain(),
    onRowClick: onChainRowClick,
  };
}
