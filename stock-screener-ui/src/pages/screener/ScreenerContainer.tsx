import { createSignal } from "solid-js";
import { ScreenerPage, DEFAULT_DASHBOARD_UNIVERSE } from "../../components/screener/ScreenerPage";
import { useScreenerState } from "../../hooks/useScreenerState";
import { useSearchParams } from "@solidjs/router";

export function ScreenerContainer() {
  const [searchParams] = useSearchParams();
  const raw = searchParams.screener;
  const rawScreener = Array.isArray(raw) ? raw[0] : raw;
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

  const totalStocks = () => (approachingStocks ?? []).length + (touchedStocks ?? []).length;
  const [universe, setUniverse] = createSignal(DEFAULT_DASHBOARD_UNIVERSE);

  return (
    <ScreenerPage
      screenerOptions={screenerOptions}
      activeScreener={activeScreener}
      onScreenerChange={onScreenerChange}
      onConfigScreenerSelect={onConfigScreenerSelect}
      title={`${(screenerOptions ?? []).find((s) => s.id === activeScreener)?.label || "Screener"} | Alphashri`}
      status={
        isLoading && totalStocks() === 0
          ? "Loading..."
          : `${totalStocks()} stocks${isLoading ? " • Updating..." : ""}`
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
      universe={universe()}
      onUniverseChange={setUniverse}
    />
  );
}
