import dayjs from "dayjs";
import type { PaperTrade } from "../../types/paperTrading";

export function getUniqueStrategies(trades: PaperTrade[]): { id: number; name: string }[] {
  const map = new Map<number, string>();
  for (const trade of trades) {
    if (trade.strategy_id && trade.strategy_name) {
      map.set(trade.strategy_id, trade.strategy_name);
    }
  }
  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  // IST midnight boundaries: interpret fromDate/toDate as Asia/Kolkata (UTC+05:30).
  const from = fromDate ? new Date(`${fromDate}T00:00:00+05:30`) : null;
  const to = toDate ? new Date(`${toDate}T23:59:59+05:30`) : null;
  const fromValid = from && !isNaN(from.getTime()) ? from : null;
  const toValid = to && !isNaN(to.getTime()) ? to : null;
  return trades.filter((t) => {
    if (!t.exit_time) return false;
    const tradeDate = new Date(t.exit_time);
    if (isNaN(tradeDate.getTime())) return false;
    if (fromValid && tradeDate < fromValid) return false;
    if (toValid && tradeDate > toValid) return false;
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
    if (!trade.exit_time || typeof trade.exit_time !== "string") continue;
    const split = trade.exit_time.split("T");
    if (!split[0] || !/^\d{4}-\d{2}-\d{2}$/.test(split[0])) continue;
    const d = new Date(trade.exit_time);
    if (isNaN(d.getTime())) continue;
    const date = split[0];
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
