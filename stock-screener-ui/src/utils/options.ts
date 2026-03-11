/**
 * Options-specific utility functions
 */

/**
 * Available underlying instruments for options trading
 */
export function getAvailableUnderlyings(): string[] {
  return ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
}

/**
 * Get available expiry dates for an instrument
 */
export function getExpiryDates(instrumentKey: string): string[] {
  const today = new Date();
  const expiries: string[] = [];

  // Weekly expiries (Thursday)
  for (let i = 0; i < 4; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + ((i * 7 + 4 - today.getDay() + 7) % 7));
    expiries.push(date.toISOString().split("T")[0]);
  }

  // Monthly expiries (last Thursday)
  for (let i = 0; i < 3; i++) {
    const date = new Date(today.getFullYear(), today.getMonth() + i + 1, 0);
    const day = date.getDay();
    const lastThursday = date.getDate() - ((day + 3) % 7);
    date.setDate(lastThursday);
    expiries.push(date.toISOString().split("T")[0]);
  }

  return [...new Set(expiries)].sort();
}

/**
 * Format large numbers with K/M suffix
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return num.toString();
}

/**
 * Determine moneyness of an option strike relative to spot price
 */
export function getMoneyness(
  strike: number,
  spot: number,
  type: "CE" | "PE",
): "ITM" | "OTM" | "ATM" {
  const threshold = 0.1; // 0.1% tolerance for ATM
  const diffPct = ((strike - spot) / spot) * 100;

  if (Math.abs(diffPct) <= threshold) {
    return "ATM";
  }

  if (type === "CE") {
    return strike < spot ? "ITM" : "OTM";
  } else {
    return strike > spot ? "ITM" : "OTM";
  }
}

/**
 * Check if an option contract is a weekly expiry
 */
export function isWeekly(contract: { expiry: string; weekly: boolean }): boolean {
  return contract.weekly;
}

/**
 * Calculate total OI change (CE + PE) for a strike
 */
export function calculateTotalOiChange(ceOi: number, peOi: number): number {
  return ceOi + peOi;
}

/**
 * Parse option symbol to extract components
 */
export function parseOptionSymbol(symbol: string): {
  underlying: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE";
} | null {
  const match = symbol.match(/^([A-Z]+)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/);
  if (!match) return null;

  const [, underlying, expiry, strikeStr, type] = match;
  return {
    underlying,
    expiry,
    strike: parseInt(strikeStr, 10),
    type: type as "CE" | "PE",
  };
}

/**
 * Format expiry date to display
 */
export function formatExpiryDisplay(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
