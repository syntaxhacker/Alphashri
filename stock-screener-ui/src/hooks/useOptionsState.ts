import { createEffect, createMemo, onMount } from "solid-js";
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
  const version = useStoreSubscription(subscribe);

  // The store is a module singleton. Reading the subscription counter first is
  // what makes every getter/memo below re-run when it notifies.
  const readState = () => {
    version();
    return optionsState.getOptionsState();
  };

  onMount(() => {
    void optionsState.initOptionsState();
    void optionsState.fetchPositions();
  });

  // Track only the (underlying, expiry) pair. An effect that read the whole
  // store would re-enter itself: fetchChain notifies, which would re-run it.
  const selectionKey = createMemo(() => {
    const s = readState();
    return `${s.selectedUnderlying}|${s.selectedExpiry}`;
  });

  createEffect(() => {
    const [underlying, expiry] = selectionKey().split("|");
    if (underlying && expiry) void optionsState.fetchChain();
  });

  const filteredChain = createMemo(() => {
    version();
    return getFilteredChain();
  });
  const strikeMatrix = createMemo(() => {
    version();
    return getStrikeMatrix(filteredChain());
  });
  const availableExpiries = createMemo(() => {
    version();
    return getAvailableExpiries();
  });
  const availableUnderlyings = createMemo(() => {
    version();
    return getAvailableUnderlyingSymbols();
  });

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

  // Getters, not values: a Solid component body runs once, so a snapshot would
  // never show data that arrives after mount.
  return {
    get selectedUnderlying() {
      return readState().selectedUnderlying;
    },
    get selectedExpiry() {
      return readState().selectedExpiry;
    },
    get optionChain() {
      return readState().optionChain;
    },
    get positions() {
      return readState().positions;
    },
    get loading() {
      return readState().loading;
    },
    get error() {
      return readState().error;
    },
    get filters() {
      return readState().filters;
    },
    get spotPrice() {
      return readState().spotPrice;
    },
    get timestamp() {
      return readState().lastUpdated;
    },
    get summary() {
      return readState().summary;
    },
    get availableUnderlyings() {
      return availableUnderlyings();
    },
    get availableExpiries() {
      return availableExpiries();
    },
    get filteredChain() {
      return filteredChain();
    },
    get strikeMatrix() {
      return strikeMatrix();
    },
    setUnderlying: onSetUnderlying,
    setExpiry: onSetExpiry,
    setFilters: onSetFilters,
    fetchChain: () => optionsState.fetchChain(),
    refreshChain: () => optionsState.fetchChain(),
    onRowClick: onChainRowClick,
  };
}
