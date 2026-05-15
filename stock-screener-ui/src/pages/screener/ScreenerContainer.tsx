import { ScreenerPage } from "../../components/screener/ScreenerPage";
import { useScreenerState } from "../../hooks/useScreenerState";
import { useSearchParams } from "react-router-dom";

export function ScreenerContainer() {
  const [searchParams] = useSearchParams();
  const rawScreener = searchParams.get("screener");
  const urlScreener = rawScreener?.includes(":")
    ? rawScreener.split(":").pop()
    : rawScreener || undefined;

  const {
    approachingStocks,
    touchedStocks,
    screenerOptions,
    activeScreener,
    isLoading,
    error,
    warning,
    autoRefreshSeconds,
    provider,
    mode,
    onRefresh,
    onAutoRefreshChange,
    onProviderChange,
    onModeChange,
    onScreenerChange,
    onConfigScreenerSelect,
    onSymbolClick,
    onSymbolHover,
  } = useScreenerState(urlScreener);

  return (
    <ScreenerPage
      screenerOptions={screenerOptions}
      activeScreener={activeScreener}
      onScreenerChange={onScreenerChange}
      onConfigScreenerSelect={onConfigScreenerSelect}
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
      warning={warning}
    />
  );
}
