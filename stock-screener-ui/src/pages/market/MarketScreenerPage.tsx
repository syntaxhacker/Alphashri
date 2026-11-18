import { normalizeMarketView } from "../../components/market/MarketMapView";
import {
  MarketScreenerPanel,
  type MarketScreenerPanelProps,
} from "../../components/market/MarketScreenerPanel";

/**
 * The shell parses `?view=` against its own (older) vocabulary, so this route
 * re-reads the raw param: `vis` is new and the legacy `map` id must still open
 * the same view. The legacy spelling is only ever read, never written back.
 */
function urlView(): ReturnType<typeof normalizeMarketView> | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("view");
  return raw ? normalizeMarketView(raw) : undefined;
}

/** Route target for the Market tab in the Screener page (`/screener/market`). */
export function MarketScreenerPage(props: MarketScreenerPanelProps = {}) {
  // The URL is authoritative; the shell's `initialView` covers direct renders
  // and callers that pass a view without touching the address bar.
  const initialView = urlView() ?? normalizeMarketView(props.initialView);
  return <MarketScreenerPanel {...props} initialView={initialView} />;
}
