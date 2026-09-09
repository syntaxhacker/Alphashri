import { IconTrendingUp, IconTrendingDown, IconMinus } from "@tabler/icons-react";

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
