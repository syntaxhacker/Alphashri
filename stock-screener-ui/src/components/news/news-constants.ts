import { IconTrendingUp, IconTrendingDown, IconMinus } from "@tabler/icons-react";

export const SOURCE_COLORS: Record<string, string> = {
  moneycontrol: "blue",
  economictimes: "orange",
  livemint: "teal",
  financialexpress: "grape",
  business_standard: "cyan",
  cnbctv18: "red",
};

export const SENTIMENT_CONFIG: Record<string, { color: string; icon: typeof IconTrendingUp }> = {
  BULLISH: { color: "green", icon: IconTrendingUp },
  BEARISH: { color: "red", icon: IconTrendingDown },
  NEUTRAL: { color: "gray", icon: IconMinus },
};
