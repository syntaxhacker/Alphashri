import type { Stock } from "../../../types";
import { getTrendingColumns } from "./trending";
import { getBuyerInterestColumns } from "./buyerInterest";
import { getMarketOpenGapColumns } from "./marketOpenGap";
import { getRsiReversalColumns } from "./rsiReversal";
import { getNiftyMoversColumns } from "./niftyMovers";
import { getHighMomentumColumns } from "./highMomentum";
import { getNear52wBreakoutColumns } from "./near52wBreakout";
import { getTouched52wColumns } from "./touched52wHigh";
import { get52wHighColumns } from "./52wHigh";
import { getUndervaluedColumns } from "./undervalued";

export interface FormattedCell {
  value: string;
  className?: string;
}

export interface ColumnDef<T = Stock> {
  key: string;
  label: string;
  type?: "string" | "number" | "badge";
  width?: number;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  format?: (value: any, row: T) => React.ReactNode | FormattedCell;
}

export function getColumnsForScreener(
  screenerId: string,
  section?: "approaching" | "touched",
): ColumnDef[] {
  const id = screenerId.startsWith("builtin:") ? screenerId.slice(8) : screenerId;
  switch (id) {
    case "trending":
      return getTrendingColumns();
    case "52w_high":
      return get52wHighColumns(section ?? "approaching");
    case "near_52w_breakout":
      return getNear52wBreakoutColumns();
    case "touched_52w_high":
      return getTouched52wColumns();
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
    case "undervalued":
      return getUndervaluedColumns();
    default:
      return getTrendingColumns();
  }
}
