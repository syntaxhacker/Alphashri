/**
 * Market-aware price formatting for the pattern chart chain.
 *
 * An earlier `formatPrice` helper predated US charts and always quoted in INR,
 * so a US symbol rendered `₹352.25`. The market is already available on
 * `PatternChartBody`; this module resolves it through the shared currency
 * registry so symbols and digit grouping come from one source.
 */

import type { ChartMarket } from "@/utils/chart/time";
import { formatCurrency } from "@/utils/ui-helpers";
import { currencyFor, type CurrencyCode } from "@/config/currency";

/** Chart market → currency code, resolved without a second symbol table. */
export function chartCurrency(market?: ChartMarket): CurrencyCode {
  return market === "usa" ? "USD" : "INR";
}

/** `352.25` → `$352.25` (US) / `₹352.25` (India); null/undefined → "—". */
export function formatChartPrice(value: number | null | undefined, market?: ChartMarket): string {
  return value == null ? "—" : formatCurrency(value, 2, chartCurrency(market));
}

/** Locale for the price axis / crosshair so thousands grouping matches the market. */
export function chartPriceLocale(market?: ChartMarket): string {
  return currencyFor(chartCurrency(market)).grouping;
}
