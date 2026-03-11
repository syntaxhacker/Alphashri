import { useEffect, useMemo } from "react";
import { ScreenerPage } from "../components/screener";
import { useScreenerState } from "../hooks/useScreenerState";

export function ScreenerContainer() {
  const {
    stocks,
    touchedSymbols,
    filters,
    sectors,
    screenerOptions,
    activeScreener,
    isLoading,
    error,
    autoRefreshSeconds,
    provider,
    mode,
    onRefresh,
    onAutoRefreshChange,
    onProviderChange,
    onModeChange,
    onScreenerChange,
    onFilterChange,
    onResetFilters,
    onSymbolClick,
    onSymbolHover,
  } = useScreenerState();

  return (
    <ScreenerPage
      screenerOptions={screenerOptions}
      activeScreener={activeScreener}
      onScreenerChange={onScreenerChange}
      title={`${screenerOptions.find((s) => s.id === activeScreener)?.label || "Screener"} | Alphashri`}
      status={isLoading ? "Loading..." : `${stocks.length} stocks`}
      isLoading={isLoading}
      autoRefreshSeconds={autoRefreshSeconds}
      provider={provider}
      mode={mode}
      onRefresh={onRefresh}
      onAutoRefreshChange={onAutoRefreshChange}
      onProviderChange={onProviderChange}
      onModeChange={onModeChange}
      filters={filters}
      sectors={sectors}
      onFilterChange={onFilterChange}
      onResetFilters={onResetFilters}
      stocks={stocks}
      touchedSymbols={touchedSymbols}
      onSymbolClick={onSymbolClick}
      onSymbolHover={onSymbolHover}
      error={error}
    />
  );
}
