import {
  POSITIVE,
  NEGATIVE,
  MARKER_TP,
  MARKER_SL,
  MARKER_EOD,
  EXIT_DEFAULT,
} from "../config/colors";

export function formatCurrency(amount: number | undefined | null, precision: number = 0): string {
  if (amount === undefined || amount === null || isNaN(amount)) return "0";
  return `₹${amount.toFixed(precision)}`;
}

export function formatCurrencyIN(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) return "0";
  return amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return "0";
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (absValue >= 10000000) {
    return `${sign}${(absValue / 10000000).toFixed(1)}Cr`;
  } else if (absValue >= 100000) {
    return `${sign}${(absValue / 100000).toFixed(1)}L`;
  } else if (absValue >= 1000) {
    return `${sign}${(absValue / 1000).toFixed(1)}K`;
  }
  return `${sign}${absValue.toFixed(0)}`;
}

export function formatCurrencyCompact(amount: number | undefined | null): string {
  return `₹${formatNumber(amount ?? 0)}`;
}

export function formatPnl(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}₹${(value / 1000).toFixed(1)}K`;
}

export function formatSignedPnl(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}₹${formatNumber(value)}`;
}

export function formatPercentage(
  value: number,
  precision: number = 2,
  showSign: boolean = true,
): string {
  const sign = showSign && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(precision)}%`;
}

// ============================================
// Date/Time Formatting
// ============================================

function extractDateTimeParts(isoStr: string) {
  const parts = isoStr.split("T");
  const datePart = parts[0];
  const timePart = parts[1]
    ?.replace("Z", "")
    .replace(/\+00:00/g, "")
    .replace(/\+05:30/g, "")
    .substring(0, 5);
  return { datePart, timePart };
}

function parseDateParts(isoStr: string): { d: number; m: number; timePart: string } | null {
  const { datePart, timePart } = extractDateTimeParts(isoStr);
  if (!datePart) return null;
  const [_year, month, day] = datePart.split("-");
  return { d: parseInt(day), m: parseInt(month) - 1, timePart };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Format date to human readable: "12th Thu Jan 2025 10:30"
 */
export function formatDateTimeHuman(isoStr: string): string {
  if (!isoStr) return "-";
  try {
    const parsed = parseDateParts(isoStr);
    if (!parsed) return "-";
    const { d, m, timePart } = parsed;
    const date = new Date(new Date().getFullYear(), m, d);
    const dayName = DAYS[date.getDay()];
    const monthName = MONTHS[m];
    return `${d}${getOrdinalSuffix(d)} ${dayName} ${monthName} ${timePart || ""}`;
  } catch {
    return "-";
  }
}

/**
 * Format date compact: "12th Jan 10:30"
 */
export function formatDateTimeCompact(isoStr: string): string {
  if (!isoStr) return "-";
  try {
    const parsed = parseDateParts(isoStr);
    if (!parsed) return "-";
    const { d, m, timePart } = parsed;
    return `${d}${getOrdinalSuffix(d)} ${MONTHS[m]} ${timePart || ""}`;
  } catch {
    return "-";
  }
}

/**
 * Format date for trade display: "24 Feb 2026, 10:38:36"
 */
export function formatTradeTime(isoStr: string): string {
  if (!isoStr) return "-";

  try {
    const date = new Date(isoStr);

    const day = date.getDate();
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds}`;
  } catch {
    return "-";
  }
}

/**
 * Format duration in minutes to human readable: "2h 30m" or "45m"
 */
export function formatDuration(minutes: number): string {
  if (!minutes || minutes < 0) return "0m";

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.)
 */
export function getOrdinalSuffix(n: number): string {
  if (n === 1 || n === 21 || n === 31) return "st";
  if (n === 2 || n === 22) return "nd";
  if (n === 3 || n === 23) return "rd";
  return "th";
}

// ============================================
// Class/Style Helpers
// ============================================

/**
 * Get CSS class for positive/negative values
 */
export function getPnLClass(value: number): "positive" | "negative" | "" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}

/**
 * Get color for P&L value
 */
export function getPnLColor(value: number): string {
  if (value >= 0) return POSITIVE;
  return NEGATIVE;
}

export function getExitReasonColor(reason: string): string {
  switch (reason) {
    case "TP":
      return MARKER_TP;
    case "SL":
      return MARKER_SL;
    case "EOD":
      return MARKER_EOD;
    default:
      return EXIT_DEFAULT;
  }
}

// ============================================
// Sort Helpers
// ============================================

/**
 * Render sort indicator arrow
 */
export function renderSortIndicator(
  column: string,
  sortColumn: string,
  sortDirection: "asc" | "desc",
): string {
  if (column !== sortColumn) return "";
  return sortDirection === "asc" ? " ▲" : " ▼";
}

/**
 * Get sort direction when clicking a column
 */
export function getNextSortDirection(
  currentColumn: string,
  clickedColumn: string,
  currentDirection: "asc" | "desc",
): "asc" | "desc" {
  if (currentColumn !== clickedColumn) {
    return "desc"; // Default to descending for new column
  }
  return currentDirection === "asc" ? "desc" : "asc";
}

export function sortByField<T>(
  items: T[],
  field: keyof T | ((item: T) => string | number | null | undefined),
  direction: "asc" | "desc",
): T[] {
  const sorted = [...items];
  const accessor = typeof field === "function" ? field : (item: T) => item[field];
  const dir = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    const aVal = accessor(a);
    const bVal = accessor(b);

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    if (typeof aVal === "string" && typeof bVal === "string") {
      return dir * aVal.localeCompare(bVal);
    }

    return dir * ((aVal as number) - (bVal as number));
  });

  return sorted;
}

// ============================================
// Time Normalization (for chart candle matching)
// ============================================

/**
 * Normalize time string for matching
 * Strips timezone info and returns consistent format for matching.
 * All times are in IST.
 */
export function normalizeTime(time: string): string {
  if (!time) return "";

  // Handle date-only format (YYYY-MM-DD) - for daily candles
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) {
    return time;
  }

  // Strip timezone suffixes and return YYYY-MM-DDTHH:MM format
  return time
    .replace(/\+00:00$/, "")
    .replace(/\+05:30$/, "")
    .replace(/Z$/, "")
    .substring(0, 16);
}

// ============================================
// Duration Formatting
// ============================================

export function formatElapsed(entryTime: string | null | undefined): string {
  if (!entryTime) return "-";
  try {
    const entry = new Date(entryTime);
    const now = new Date();
    const diffMs = now.getTime() - entry.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    return formatDuration(Math.max(0, diffMins));
  } catch {
    return "-";
  }
}

// ============================================
// Time-Only Formatting
// ============================================

export function formatTimeOnly(isoStr: string): string {
  if (!isoStr) return "-";
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateHeader(date: string): string {
  const dateObj = new Date(date);
  return dateObj.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

// ============================================
// Mantine Color Helpers (for table cells)
// ============================================

export function getPnLTextColor(value: number): "green" | "red" {
  return value >= 0 ? "green" : "red";
}

export function getValueColor(value: number | null | undefined): "green" | "red" | undefined {
  if (value === null || value === undefined) return undefined;
  if (isNaN(value)) return undefined;
  if (value > 0) return "green";
  if (value < 0) return "red";
  return undefined;
}

export function getWinRateColor(value: number): string {
  if (value >= 50) return "green";
  if (value >= 40) return "dimmed";
  return "red";
}

export function getScoreColor(score: number): string {
  if (score >= 80) return "green";
  if (score >= 60) return "lime";
  if (score >= 40) return "yellow";
  if (score >= 20) return "orange";
  return "red";
}

// ============================================
// Domain Utilities
// ============================================

export function formatExitReason(reason: string): string {
  const reasons: Record<string, string> = {
    target: "Target",
    stop_loss: "Stop Loss",
    signal: "Signal",
    manual: "Manual",
    timeout: "Timeout",
  };
  return reasons[reason] || reason;
}

export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "success":
      return "green";
    case "error":
      return "red";
    case "pending":
      return "yellow";
    default:
      return "gray";
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

export function getStrategyTypeFromName(name: string | undefined | null): string | null {
  if (!name) return null;
  const upper = name.toUpperCase();
  if (upper.includes("ORB")) return "ORB";
  if (upper.includes("S/R BREAKOUT") || upper.includes("SR BREAKOUT")) return "SR_BREAKOUT";
  if (upper.includes("EMA CROSS")) return "EMA_CROSS";
  if (upper.includes("52W")) return "52W_CHASER";
  return null;
}

export function parseTimeToHHMM(isoTime: string): string {
  if (isoTime.includes("T")) return isoTime.split("T")[1].substring(0, 5);
  if (isoTime.includes(" ")) return isoTime.split(" ")[1].substring(0, 5);
  return isoTime.substring(0, 5);
}
