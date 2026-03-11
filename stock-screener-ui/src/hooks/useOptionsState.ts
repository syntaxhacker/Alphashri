import { useState, useEffect, useMemo, useCallback } from "react";
import * as optionsState from "../state/optionsStore";
import {
  subscribe,
  getAvailableExpiries,
  getFilteredChain,
  getStrikeMatrix,
  getAvailableUnderlyingSymbols,
} from "../state/optionsStore";

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
