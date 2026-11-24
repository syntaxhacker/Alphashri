/**
 * Public facade for the index report store. The implementation is decomposed
 * into focused modules; this file only stabilises the import path.
 */
export {
  NIFTY_CHART_SOURCE_KEY,
  NIFTY_DESK_MODE_KEY,
  GENERIC_POLL_MS,
} from "./niftyReportStore.types";
export type {
  ChartSource,
  ChartView,
  DeskMode,
  DeskOverlayKey,
  HeatMetric,
  NiftyReportAlerts,
  NiftyReportData,
  NiftyReportFreshness,
  NiftyReportReplay,
  NiftyReportSelection,
  NiftyReportStore,
  NiftyReportStoreOptions,
  NiftyReportUi,
  NiftyReportWalls,
  ReportIndex,
  ReportSymbol,
  SideTab,
} from "./niftyReportStore.types";
export {
  persistChartSource,
  readChartSource,
} from "./niftyReportStore.helpers";
export {
  createNiftyReportStore,
  startNiftyReportEffects,
} from "./niftyReportStore.factory";
