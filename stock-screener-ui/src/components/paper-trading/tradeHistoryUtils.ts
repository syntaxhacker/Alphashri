import dayjs from "dayjs";
import type { PaperTrade } from "../../types/paperTrading";

export function getUniqueStrategies(trades: PaperTrade[]): string[] {
  const strategies = new Set<string>();
  for (const trade of trades) {
    if (trade.strategy_name) strategies.add(trade.strategy_name);
  }
  return Array.from(strategies).sort();
}

export function getUniqueBots(trades: PaperTrade[]): Array<{ id: string; name: string }> {
  const botsMap = new Map<string, string>();
  for (const trade of trades) {
    if (trade.bot_id && trade.bot_name) botsMap.set(trade.bot_id, trade.bot_name);
  }
  return Array.from(botsMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterByRange(
  trades: PaperTrade[],
  fromDate: string | null,
  toDate: string | null,
): PaperTrade[] {
  const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
  const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
  return trades.filter((t) => {
    const tradeDate = new Date(t.exit_time);
    if (from && tradeDate < from) return false;
    if (to && tradeDate > to) return false;
    return true;
  });
}

export function groupTradesByDate(
  trades: PaperTrade[],
  sortColumn?: string | null,
  sortDirection?: "asc" | "desc",
): Record<string, PaperTrade[]> {
  const groups: Record<string, PaperTrade[]> = {};
  const dir = sortDirection || "desc";
  const sorted = sortColumn
    ? [...trades].sort((a, b) => {
        const aVal = a[sortColumn as keyof PaperTrade];
        const bVal = b[sortColumn as keyof PaperTrade];
        if (typeof aVal === "number" && typeof bVal === "number")
          return dir === "asc" ? aVal - bVal : bVal - aVal;
        return dir === "asc"
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      })
    : [...trades];
  for (const trade of sorted) {
    const date = trade.exit_time.split("T")[0];
    if (!groups[date]) groups[date] = [];
    groups[date].push(trade);
  }
  if (!sortColumn) {
    for (const date of Object.keys(groups)) {
      groups[date].sort((a, b) => b.exit_time.localeCompare(a.exit_time));
    }
  }
  return groups;
}

export function getPeriodFromDateRange(fromDate: string | null, toDate: string | null): string {
  if (!fromDate && !toDate) return "all";
  const todayStr = dayjs().format("YYYY-MM-DD");
  if (fromDate === todayStr && toDate === todayStr) return "today";
  const weekAgoStr = dayjs().subtract(7, "day").format("YYYY-MM-DD");
  if (fromDate === weekAgoStr && !toDate) return "week";
  const monthAgoStr = dayjs().subtract(1, "month").format("YYYY-MM-DD");
  if (fromDate === monthAgoStr && !toDate) return "month";
  const yearAgoStr = dayjs().subtract(1, "year").format("YYYY-MM-DD");
  if (fromDate === yearAgoStr && !toDate) return "year";
  if (fromDate) {
    if (dayjs(fromDate).isAfter(dayjs().subtract(7, "day").subtract(1, "second"))) return "week";
    if (dayjs(fromDate).isAfter(dayjs().subtract(1, "month").subtract(1, "second"))) return "month";
    if (dayjs(fromDate).isAfter(dayjs().subtract(1, "year").subtract(1, "second"))) return "year";
  }
  return "all";
}
