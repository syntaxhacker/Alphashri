import { iqrOutliers } from "./distribution";
import { seasonality } from "./seasonality";
import { finite, meanOf, modalOf, rowsOf, stdOf } from "./shared";
import { supplyDemand } from "./supplyDemand";
import type { AgriEdaPoint, EdaSummary, SeasonalityBucket } from "./types";

/**
 * One-line EDA summary: trend is the first-to-last modal change, volatility is
 * the modal coefficient of variation, best/worst are the seasonality months
 * with the highest/lowest average. All numbers are finite or `null`.
 */
export function summariseEda(series: AgriEdaPoint[] | null | undefined): EdaSummary {
  const values: number[] = [];
  for (const point of rowsOf(series)) {
    const value = modalOf(point);
    if (value != null) values.push(value);
  }
  const first = values[0];
  const last = values[values.length - 1];
  const mean = values.length > 0 ? meanOf(values) : null;
  const volatility = mean != null ? stdOf(values, mean) : null;

  const seasonal = seasonality(series).months;
  let best: SeasonalityBucket | null = null;
  let worst: SeasonalityBucket | null = null;
  for (const bucket of seasonal) {
    if (best == null || bucket.avg > best.avg) best = bucket;
    if (worst == null || bucket.avg < worst.avg) worst = bucket;
  }

  return {
    trendPct: first != null && last != null && first !== 0 ? finite(((last - first) / first) * 100) : null,
    volatilityPct: mean != null && volatility != null && mean !== 0 ? finite((volatility / mean) * 100) : null,
    bestMonth: best?.month ?? null,
    worstMonth: worst?.month ?? null,
    arrivalsCorrelation: supplyDemand(series).pearson,
    outlierCount: iqrOutliers(series).length,
  };
}
