import {
  MarketScreenerPanel,
  type MarketScreenerPanelProps,
} from "../../components/market/MarketScreenerPanel";

/** Route target for the Market tab in the Screener page (`/screener/market`). */
export function MarketScreenerPage(props: MarketScreenerPanelProps) {
  return <MarketScreenerPanel {...props} />;
}
