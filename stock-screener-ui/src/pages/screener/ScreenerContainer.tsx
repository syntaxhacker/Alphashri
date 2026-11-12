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

  // Held as an object, never destructured: its fields are getters over the
  // live store, and destructuring would pin the first snapshot.
  const screener = useScreenerState(urlScreener);

  const totalStocks = () =>
    (screener.approachingStocks ?? []).length + (screener.touchedStocks ?? []).length;
  const [universe, setUniverse] = createSignal(DEFAULT_DASHBOARD_UNIVERSE);

  return (
    <ScreenerPage
      screenerOptions={screener.screenerOptions}
      activeScreener={screener.activeScreener}
      onScreenerChange={screener.onScreenerChange}
      onConfigScreenerSelect={screener.onConfigScreenerSelect}
      title={`${(screener.screenerOptions ?? []).find((s) => s.id === screener.activeScreener)?.label || "Screener"} | Alphashri`}
      status={
        screener.isLoading && totalStocks() === 0
          ? "Loading..."
          : `${totalStocks()} stocks${screener.isLoading ? " • Updating..." : ""}`
      }
      isLoading={screener.isLoading}
      autoRefreshSeconds={screener.autoRefreshSeconds}
      provider={screener.provider}
      mode={screener.mode}
      onRefresh={screener.onRefresh}
      onAutoRefreshChange={screener.onAutoRefreshChange}
      onProviderChange={screener.onProviderChange}
      onModeChange={screener.onModeChange}
      approachingStocks={screener.approachingStocks}
      touchedStocks={screener.touchedStocks}
      onSymbolClick={screener.onSymbolClick}
      onSymbolHover={screener.onSymbolHover}
      error={screener.error}
      warning={screener.warning}
      universe={universe()}
      onUniverseChange={setUniverse}
    />
  );
}