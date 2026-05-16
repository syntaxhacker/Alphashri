import { createSubscriber } from "./createSubscriber";
import { fetchHolidays, fetchHolidayCheck } from "../api/holidays_api";
import type { MarketHoliday, HolidayCheck } from "../types/holidays";

const { subscribe, notify } = createSubscriber();

interface HolidayState {
  holidays: MarketHoliday[];
  tradingDates: Set<string>;
  clearingDates: Set<string>;
  loaded: boolean;
  loading: boolean;
}

const initialState: HolidayState = {
  holidays: [],
  tradingDates: new Set(),
  clearingDates: new Set(),
  loaded: false,
  loading: false,
};

let state: HolidayState = { ...initialState };

export function getHolidayState() {
  return state;
}

export function subscribeToHolidays(callback: () => void) {
  return subscribe(callback);
}

function update(partial: Partial<HolidayState>) {
  state = { ...state, ...partial };
  notify();
}

function indexHolidays(holidays: MarketHoliday[]) {
  const tradingDates = new Set<string>();
  const clearingDates = new Set<string>();
  for (const h of holidays) {
    if (h.type === "trading") tradingDates.add(h.date);
    else clearingDates.add(h.date);
  }
  return { tradingDates, clearingDates };
}

export async function loadHolidays(year?: number) {
  if (state.loading) return;
  update({ loading: true });
  try {
    const holidays = await fetchHolidays(year);
    const { tradingDates, clearingDates } = indexHolidays(holidays);
    update({ holidays, tradingDates, clearingDates, loaded: true, loading: false });
  } catch {
    update({ loading: false });
  }
}

export function isTradingHoliday(dateStr: string): boolean {
  if (state.tradingDates.has(dateStr)) return true;
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6;
}

export function isMarketClosedToday(): boolean {
  if (typeof window !== "undefined" && (window as any).__E2E_MOCK_MARKET_OPEN__) return false;
  const today = new Date().toISOString().split("T")[0];
  return isTradingHoliday(today);
}

export function isClearingHoliday(dateStr: string): boolean {
  return state.clearingDates.has(dateStr);
}

export async function checkDate(dateStr: string): Promise<HolidayCheck> {
  if (isTradingHoliday(dateStr)) {
    const h = state.holidays.find((h) => h.date === dateStr);
    return {
      date: dateStr,
      is_holiday: true,
      type: "trading",
      description: h?.description ?? null,
    };
  }
  if (isClearingHoliday(dateStr)) {
    const h = state.holidays.find((h) => h.date === dateStr);
    return {
      date: dateStr,
      is_holiday: true,
      type: "clearing",
      description: h?.description ?? null,
    };
  }
  try {
    return await fetchHolidayCheck(dateStr);
  } catch {
    return { date: dateStr, is_holiday: false, type: null, description: null };
  }
}

export function resetHolidays() {
  state = { ...initialState };
  notify();
}
