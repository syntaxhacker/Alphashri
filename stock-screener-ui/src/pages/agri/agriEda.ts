/**
 * Pure, deterministic EDA statistics for the daily agri modal-price series.
 * No DOM, network, clock, or external stats dependency — plain TS + Math only.
 * Every non-finite input (null / undefined / NaN / ±Infinity) is treated as
 * missing, and every numeric output is finite or `null`.
 *
 * Public barrel: implementation lives in `./eda/*`; re-exports preserve the
 * original import surface for every consumer.
 */

export { CHANGE_WINDOWS } from "./eda/constants";
export type {
  AgriEdaComparePoint,
  AgriEdaCompareSeries,
  AgriEdaPoint,
  ChangeAnchor,
  ChangeMatrix,
  ChangeMatrixOptions,
  ChangeWindow,
  EdaSummary,
  GroupPulseRow,
  HeatmapMonth,
  HeatmapRow,
  MonthlyBox,
  OutlierPoint,
  RealizedVolatilityResult,
  RollingPoint,
  SeasonalityBucket,
  SeasonalityResult,
  SupplyDemandPoint,
  SupplyDemandResult,
} from "./eda/types";

export { changeMatrix, groupPulse } from "./eda/change";
export { iqrOutliers, monthlyBox, pricePercentile } from "./eda/distribution";
export { monthlyHeatmap, seasonality } from "./eda/seasonality";
export { realizedVolatility, rollingStats } from "./eda/rolling";
export { supplyDemand } from "./eda/supplyDemand";
export { summariseEda } from "./eda/summary";
