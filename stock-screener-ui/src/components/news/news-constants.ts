import { IconTrendingUp, IconTrendingDown, IconMinus } from "../common/Icons";

export const SOURCE_COLORS: Record<string, string> = {
  moneycontrol: "primary",
  economictimes: "warning",
  livemint: "info",
  financialexpress: "grape",
  business_standard: "info",
  cnbctv18: "error",
};

export const SENTIMENT_CONFIG: Record<string, { color: string; icon: typeof IconTrendingUp }> = {
  BULLISH: { color: "success", icon: IconTrendingUp },
  BEARISH: { color: "error", icon: IconTrendingDown },
  NEUTRAL: { color: "secondary", icon: IconMinus },
};

/** Source ids, labels and group keys all compare through this one normalizer. */
export function normalizeSourceName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
