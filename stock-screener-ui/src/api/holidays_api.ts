import type { MarketHoliday, HolidayCheck } from "../types/holidays";
import { apiGet } from "./utils";

const HOLIDAYS_BASE = "/api/holidays";

export async function fetchHolidays(
  year?: number,
  type?: "trading" | "clearing",
  fromDate?: string,
  toDate?: string,
): Promise<MarketHoliday[]> {
  const params: Record<string, string | number | boolean> = {};
  if (year) params.year = year;
  if (type) params.type = type;
  if (fromDate) params.from_date = fromDate;
  if (toDate) params.to_date = toDate;
  const res = await apiGet<{ holidays: MarketHoliday[] }>(HOLIDAYS_BASE, params);
  return res.holidays;
}

export async function fetchHolidayCheck(dateStr: string): Promise<HolidayCheck> {
  return apiGet<HolidayCheck>(`${HOLIDAYS_BASE}/check`, { date: dateStr });
}

export async function fetchTradingDates(fromDate: string, toDate: string): Promise<string[]> {
  const res = await apiGet<{ trading_dates: string[] }>(`${HOLIDAYS_BASE}/trading-dates`, {
    from_date: fromDate,
    to_date: toDate,
  });
  return res.trading_dates;
}
