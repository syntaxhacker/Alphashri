import { ScreenerPage } from "../components/screener";
import { useScreenerState } from "../hooks/useScreenerState";

export function ScreenerContainer() {
  const {
    approachingStocks,
    touchedStocks,
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
    onSymbolClick,
    onSymbolHover,
  } = useScreenerState();

  return (
    <ScreenerPage
      screenerOptions={screenerOptions}
      activeScreener={activeScreener}
      onScreenerChange={onScreenerChange}
      title={`${(screenerOptions ?? []).find((s) => s.id === activeScreener)?.label || "Screener"} | Alphashri`}
      status={
        isLoading
          ? "Loading..."
          : `${(approachingStocks ?? []).length + (touchedStocks ?? []).length} stocks`
      }
      isLoading={isLoading}
      autoRefreshSeconds={autoRefreshSeconds}
      provider={provider}
      mode={mode}
      onRefresh={onRefresh}
      onAutoRefreshChange={onAutoRefreshChange}
      onProviderChange={onProviderChange}
      onModeChange={onModeChange}
      approachingStocks={approachingStocks}
      touchedStocks={touchedStocks}
      onSymbolClick={onSymbolClick}
      onSymbolHover={onSymbolHover}
      error={error}
    />
  );
}
