import type { Stock } from "../../../types";
import { getTrendingColumns } from "./trending";
import { getBuyerInterestColumns } from "./buyerInterest";
import { getMarketOpenGapColumns } from "./marketOpenGap";
import { getRsiReversalColumns } from "./rsiReversal";
import { getNiftyMoversColumns } from "./niftyMovers";
import { getHighMomentumColumns } from "./highMomentum";

export interface FormattedCell {
  value: string;
  className?: string;
}

export interface ColumnDef {
  key: string;
  label: string;
  type: "string" | "number" | "badge";
  sortable?: boolean;
  format?: (value: any, stock: Stock) => React.ReactNode | FormattedCell;
}

export function getColumnsForScreener(screenerId: string): ColumnDef[] {
  switch (screenerId) {
    case "trending":
      return getTrendingColumns();
    case "buyer_interest_enhanced":
      return getBuyerInterestColumns();
    case "market_open_gap":
      return getMarketOpenGapColumns();
    case "rsi_reversal":
      return getRsiReversalColumns();
    case "nifty_movers":
      return getNiftyMoversColumns();
    case "high_momentum":
      return getHighMomentumColumns();
    default:
      return getTrendingColumns();
  }
}
