import { Page, expect } from "@playwright/test";

export interface CandleData {
  time: string;
  date?: string;
  time_str?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GenerateCandlesOptions {
  date?: string;
  times?: string[];
  volatility?: number;
  volumeRange?: [number, number];
}

const DEFAULT_15M_TIMES = [
  "09:15",
  "09:30",
  "09:45",
  "10:00",
  "10:15",
  "10:30",
  "10:45",
  "11:00",
  "11:15",
  "11:30",
];

function buildFullDayTimes(): string[] {
  const times: string[] = [];
  for (let h = 9; h <= 15; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 9 && m === 0) continue;
      if (h === 15 && m > 30) break;
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return times;
}

export function generateCandles(
  count: number = 10,
  base: number = 2500,
  options: GenerateCandlesOptions = {},
): CandleData[] {
  const {
    date = "2026-03-02",
    times = DEFAULT_15M_TIMES,
    volatility = 50,
    volumeRange = [50000, 150000],
  } = options;

  const candles: CandleData[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.random() * volatility - volatility / 2;
    candles.push({
      time: `${date}T${times[i % times.length]}`,
      date,
      time_str: times[i % times.length],
      open: +o.toFixed(2),
      high: +(o + 10 + Math.random() * 10).toFixed(2),
      low: +(o - 10 - Math.random() * 10).toFixed(2),
      close: +(o + Math.random() * 20 - 10).toFixed(2),
      volume: Math.floor(volumeRange[0] + Math.random() * (volumeRange[1] - volumeRange[0])),
    });
  }
  return candles;
}

export function generateFullDayCandles(
  count: number = 20,
  base: number = 3750,
  options: Omit<GenerateCandlesOptions, "times"> & { date?: string } = {},
): CandleData[] {
  return generateCandles(count, base, { ...options, times: buildFullDayTimes() });
}

export async function expectChartVisible(page: Page, timeout: number = 10000) {
  await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout });
}

export async function gotoChart(page: Page, symbol: string, options?: { waitUntil?: string }) {
  await page.goto(`/chart/${symbol}`, options as any);
}

export function createOrbZone(
  date: string,
  orHigh: number,
  orLow: number,
  orEndTime: string = "09:45",
) {
  return {
    date,
    date_raw: date,
    or_high: orHigh,
    or_low: orLow,
    or_end_time: orEndTime,
  };
}

export function createPivotLevels(
  date: string,
  pp: number,
  r1: number,
  s1: number,
  r2: number,
  s2: number,
) {
  return {
    date,
    date_raw: date,
    pp,
    r1,
    s1,
    r2,
    s2,
  };
}
