/** The OI-burst module is decomposed across focused niftyOiBursts.* helpers.
 *  This file is the stable import surface for the report store and its specs. */
export {
  OI_BURST_WINDOW,
  OI_BURST_MIN_ABS,
  OI_BURST_WARMUP,
  OI_BURST_TIERS,
  OI_SIGNAL_RISK_BUDGET,
  OI_SIGNAL_SL_PCT,
  OI_SIGNAL_TP_PCT,
  OI_SIGNAL_MIN_PREMIUM,
  NIFTY_LOT_SIZE,
  TREND_EMA_SPAN,
  SPENT_FUEL_STATES,
  FUEL_STATE_LABEL,
  OI_SIGNAL_STALE_PCT,
} from "./niftyOiBursts.types";
export type {
  MinuteDoi,
  OiStructure,
  OiBurst,
  OiSignal,
  OiFlowKind,
  OiFuelState,
  OiEntryFreshness,
  OiDirectionSource,
  OiDirection,
  MinutePremium,
  DetectOptions,
} from "./niftyOiBursts.types";
export { burstTimeLabel } from "./niftyOiBursts.format";
export {
  isWallEventType,
  isNonTradeAlertType,
  sessionTrend,
  atmPremiumChange,
  spotMinutesBefore,
  premiumChangeBefore,
  computeMinuteDoi,
} from "./niftyOiBursts.normalize";
export { severityForScore, detectOiBursts, sortAlertsCriticalFirst, dropConflictingSides } from "./niftyOiBursts.detect";
export {
  fuelStateFromFlow,
  resolveFuelState,
  coveringDirection,
  isSpentFuel,
  entryFreshness,
  inferFlowFromPremium,
  resolveOiDirection,
  deriveOiSignal,
} from "./niftyOiBursts.signal";
export { burstToAlert, criticalBannerText } from "./niftyOiBursts.alerts";
