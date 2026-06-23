/** Shared timeframe parsing utilities for chart and ORB calculations */

const TF_TO_MINUTES: Record<string, number> = {
  '1min': 1,
  '5min': 5,
  '15min': 15,
  '30min': 30,
  '1hour': 60,
  '2hour': 120,
  '4hour': 240,
  '12hour': 720,
  '1day': 1440,
};

export function parseTimeframeMinutes(tf: string): number {
  return TF_TO_MINUTES[tf] ?? 5;
}

export function calculateOrCandleCount(orMinutes: number, tfMinutes: number): number {
  return Math.max(1, Math.floor(orMinutes / tfMinutes));
}
