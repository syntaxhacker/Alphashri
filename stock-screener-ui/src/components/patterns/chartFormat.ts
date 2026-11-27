
import type { ChartMarket } from "@/utils/chart/time";
import { formatCurrency } from "@/utils/ui-helpers";
import { currencyFor, type CurrencyCode } from "@/config/currency";

export function chartCurrency(market?: ChartMarket): CurrencyCode {
  return market === "usa" ? "USD" : "INR";
}

export function formatChartPrice(value: number | null | undefined, market?: ChartMarket): string {
  return value == null ? "—" : formatCurrency(value, 2, chartCurrency(market));
}

export function chartPriceLocale(market?: ChartMarket): string {
  return currencyFor(chartCurrency(market)).grouping;
}
