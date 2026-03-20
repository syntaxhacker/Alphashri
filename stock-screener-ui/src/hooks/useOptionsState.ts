import { useState, useEffect, useMemo, useCallback } from "react";
import * as optionsState from "../state/optionsStore";
import {
  subscribe,
  getAvailableExpiries,
  getFilteredChain,
  getStrikeMatrix,
  getAvailableUnderlyingSymbols,
} from "../state/optionsStore";
import { getMoneyness } from "../utils/options";
import type { OptionContract } from "../api/upstoxOptions";

export interface OptionsFilters {
  strikeRange: [number, number];
  optionType: "CE" | "PE" | "BOTH";
  moneyness: "ITM" | "OTM" | "ALL";
  sortBy: string;
  sortOrder: "asc" | "desc";
}

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

  filtered.sort((a, b) => {
    const multiplier = filters.sortOrder === "asc" ? 1 : -1;
    const aVal = (a as any)[filters.sortBy];
    const bVal = (b as any)[filters.sortBy];
    return (aVal - bVal) * multiplier;
  });

  return filtered;
}

export function buildStrikeMatrix(
  chain: OptionContract[],
): Array<{ strike: number; ce: OptionContract | null; pe: OptionContract | null }> {
  const strikes = new Map<number, { ce: OptionContract | null; pe: OptionContract | null }>();

  for (const contract of chain) {
    const existing = strikes.get(contract.strike_price) || { ce: null, pe: null };
    if (contract.instrument_type === "CE") {
      existing.ce = contract;
    } else {
      existing.pe = contract;
    }
    strikes.set(contract.strike_price, existing);
  }

  return Array.from(strikes.entries())
    .map(([strike, data]) => ({ strike, ...data }))
    .sort((a, b) => a.strike - b.strike);
}

export function useOptionsState() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    void optionsState.initOptionsState();
  }, []);

  const state = optionsState.getOptionsState();

  useEffect(() => {
    if (state.selectedUnderlying && state.selectedExpiry) {
      void optionsState.fetchChain();
    }
  }, [state.selectedUnderlying, state.selectedExpiry]);

  useEffect(() => {
    void optionsState.fetchPositions();
  }, []);

  const filteredChain = useMemo(
    () => getFilteredChain(),
    [state.optionChain, state.filters, state.spotPrice],
  );
  const strikeMatrix = useMemo(() => getStrikeMatrix(), [filteredChain]);
  const availableExpiries = useMemo(() => getAvailableExpiries(), [state.expiries]);
  const availableUnderlyings = useMemo(() => getAvailableUnderlyingSymbols(), [state.underlyings]);

  const onSetUnderlying = useCallback((underlying: string) => {
    optionsState.setUnderlying(underlying);
  }, []);

  const onSetExpiry = useCallback(
    (expiry: string) => {
      optionsState.setExpiry(expiry);
      if (state.selectedUnderlying) {
        void optionsState.fetchChain();
      }
    },
    [state.selectedUnderlying],
  );

  const onSetFilters = useCallback((newFilters: Partial<typeof state.filters>) => {
    optionsState.setFilters(newFilters);
  }, []);

  const onChainRowClick = useCallback((contract: any) => {
    console.log("Row clicked:", contract);
  }, []);

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
    availableUnderlyings,
    availableExpiries,
    filteredChain,
    strikeMatrix,
    setUnderlying: onSetUnderlying,
    setExpiry: onSetExpiry,
    setFilters: onSetFilters,
    fetchChain: () => optionsState.fetchChain(),
    refreshChain: () => optionsState.fetchChain(),
    onRowClick: onChainRowClick,
  };
}
