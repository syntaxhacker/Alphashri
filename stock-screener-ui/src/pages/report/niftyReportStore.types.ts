import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { PaperPosition } from "@/types/paperTrading";
import type {
  NiftyBurst,
  NiftyReport,
  NiftyReportMode,
  NiftyReplay,
  NiftySensex,
  NiftyTape,
} from "@/types/niftyReport";
import type { FlowLastFlip, OiPoint } from "./niftyFlowRead";
import type { MinutePremium, OiBurst } from "./niftyOiBursts";
import type { NiftyPnlPosition } from "./niftyPnlAttribution";
import type { PreMovePoint } from "./niftyPreMoveHistory";
import type { PreMoveScore } from "./niftyPreMove";
import type { ReplayReason } from "./NiftyReplayBar";
import type { ReplayCoverage } from "./niftyReplayCoverage";
import type { SetupRead } from "./niftySetup";
import type { SymbolMetrics } from "./symbolMetrics";
import type { TapeRange } from "./tapeRange";
import type { WallSnapshot } from "./NiftySqueezeRadar";
import type { ChartSize, ChartTimeframe } from "./NiftyChartPanel";
import type { DeskDockKey } from "./DeskDock";
import type { DeskChartTimeframe } from "@/hooks/useDeskHotkeys";
import type { BreadthPayload, NiftyBlast, WallsPayload } from "@/api/reportNifty";
import { buildPressure } from "./niftyPressure";

export type ReportSymbol = "NIFTY" | "SENSEX" | "RELIANCE";
export type ReportIndex = "nifty" | "sensex";
export type ChartView = "chart" | "depth";
/** The shell's top-level workspace. "monitor" is the chart-first landing view;
 *  "desk" swaps in the windowed report workspace. Independent of `DeskMode`,
 *  which still describes the old DESK / RESEARCH strip inside monitor. */
export type ReportView = "monitor" | "desk";
export type DeskMode = "desk" | "research";
export type SideTab = "chain" | "heatmap";
export type HeatMetric = "oi" | "volume" | "premium";

export type DeskOverlayKey =
  | "walls"
  | "desk"
  | "movers"
  | "plan"
  | "chart"
  | "iv"
  | "gex"
  | "gamma"
  | "visuals"
  | "oi"
  | "heat"
  | "flow"
  | "pressure"
  | "flowChart"
  | "chartFocus"
  | "futures"
  | "itm";

/** What the report chart visualises: live stream, pattern overlay, or the recorded replay frame. */
export type ChartSource = "live" | "patterns" | "offline";

export const NIFTY_DESK_MODE_KEY = "nifty.deskMode";
export const NIFTY_CHART_SOURCE_KEY = "nifty.chartSource";

export const SIDE_TAB_KEY = "nifty.sideTab";
export const CHART_SOURCE_VALUES: readonly ChartSource[] = ["live", "patterns", "offline"];
export const STALE_AFTER_MS = 90_000;
export const REPLAY_PLAY_MS = 700;
export const SENSEX_REQUEST_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 15_000;
export const GENERIC_POLL_MS = 15_000;
export const BREADTH_POLL_MS = 60_000;
export const BREADTH_FOCUS_GUARD_MS = 2_000;
export const CHAIN10S_POLL_MS = 10_000;
export const CHAIN10S_FOCUS_GUARD_MS = 2_000;
export const GENERIC_BURST_POLL_MS = 30_000;
export const SESSION_CLOSE_POLL_MS = 30_000;
export const REPLAY_FRAME_CACHE_MAX = 8;
export const STREAMED_BURST_MAX = 200;
export const WALL_HISTORY_WINDOW_MS = 180_000;
export const WALL_HISTORY_MAX = 60;
export const PREMOVE_ALERT_COOLDOWN_MS = 10 * 60_000;
export const PREMOVE_ALERT_TTL_MS = 180_000;
export const EOD_CHAIN10S_LIMIT = 2_000;
export const LIVE_CHAIN10S_LIMIT = 90;
export const REPLAY_PREMOVE_TAIL = 200;
export const REPLAY_PREMOVE_KEEP = 180;
export const ALERTS_TRAIL_WALK_MS = 1_000;

export interface NiftyReportStoreOptions {
  onOpenSymbol?: (symbol: string) => void;
}

export interface NiftyReportFreshness {
  updatedAtMs: () => number | null;
  nowMs: () => number;
  wsConnected: () => boolean;
  wsDownSinceMs: () => number | null;
  wsDownForMs: () => number;
  marketClosed: () => boolean;
  isStale: () => boolean;
  staleMins: () => number;
  nextUpdateAtMs: () => number | null;
  touchNow: () => void;
}

export interface NiftyReportSelection {
  symbol: () => ReportSymbol;
  index: () => ReportIndex;
  mode: () => NiftyReportMode;
  expiry: () => string;
  expiryOptions: () => string[];
  date: () => string;
  historyDates: () => string[];
  expiryData: () => { value: string; label: string }[];
  hasRecordedHistory: () => boolean;
  contextKey: () => string;
  setSymbol: (next: ReportSymbol) => void;
  setIndex: (next: ReportIndex) => void;
  setMode: (next: NiftyReportMode) => void;
  setExpiry: (next: string) => void;
  setDate: (next: string) => void;
  setExpiryOptions: (next: string[]) => void;
  setHistoryDates: (next: string[]) => void;
  setBooted: (next: boolean) => void;
  handleIndexChange: (value: string) => void;
  handleSymbolChange: (value: string | null) => void;
  handleModeChange: (value: string) => void;
  handleExpiryChange: (value: string | null) => void;
}

export interface NiftyReportData {
  report: () => NiftyReport | null;
  sensex: () => NiftySensex | null;
  sensexLoading: () => boolean;
  sensexError: () => string | null;
  tape: () => NiftyTape | null;
  bursts: () => OiBurst[] | null;
  streamedBursts: () => NiftyBurst[];
  paperPositions: () => PaperPosition[] | null;
  pnlPositions: () => NiftyPnlPosition[] | null;
  loading: () => boolean;
  error: () => string | null;
  booted: () => boolean;
  snapshotting: () => boolean;
  freshness: NiftyReportFreshness;
  metrics: () => SymbolMetrics | null;
  visibleStrikes: () => NiftyReport["strikes"];
  atmStrike: () => number | null;
  oiScale: () => { maxCeOiChange: number; maxPeOiChange: number };
  oiWalls: () => {
    calls: NiftyReport["walls"]["calls"];
    puts: NiftyReport["walls"]["puts"];
  };
  tapeRows: () => NiftyTape["rows"];
  derivedFlow: () => NiftyReport["flow_window"];
  flowReport: () => NiftyReport | null;
  pressure: () => ReturnType<typeof buildPressure>;
  setup: () => SetupRead;
  preMove: () => PreMoveScore;
  preMoveHistory: () => PreMovePoint[];
  scorePoints: () => OiPoint[];
  oiPoints: () => OiPoint[];
  breadth: () => BreadthPayload | null;
  intradayStart: () => string | null;
  tapeSpeed: () => { delta: number; ratio: number } | null;
  sessionContext: () => {
    byMinute: Map<string, "up" | "down" | null>;
    end: "up" | "down" | null;
    spotByMinute: Map<string, number>;
    premByMinute: Map<string, MinutePremium>;
  };
  effectiveBursts: () => OiBurst[];
  burstMap: () => Map<string, "call" | "put">;
  lastFlip: () => FlowLastFlip | null;
  flipAt: () => string | null;
  refresh: () => void;
  snapshot: () => Promise<void>;
  refreshPaperPositions: () => Promise<void>;
  pushStreamedBurst: (burst: NiftyBurst) => void;
}

export interface NiftyReportReplay {
  replay: () => NiftyReplay | null;
  index: () => number;
  playing: () => boolean;
  frameT: () => string | null;
  frameLabel: () => string | null;
  coverage: () => ReplayCoverage | null;
  reasons: () => ReplayReason[];
  holes: () => number;
  setIndex: (next: number) => void;
  setPlaying: (next: boolean) => void;
  scrub: (rawIndex: number) => void;
  togglePlay: () => void;
  breakAt: (at: string) => void;
}

export interface NiftyReportWalls {
  data: () => WallsPayload | null;
  syncing: () => boolean;
  history: () => WallSnapshot[];
  open: () => boolean;
  setOpen: (next: boolean) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export interface NiftyReportAlerts {
  trail: () => MarketAlert[];
  toasts: () => MarketAlert[];
  banners: () => MarketAlert[];
  dismissToast: (id: string) => void;
  dismissBanner: (id: string) => void;
  clearTrail: () => void;
  pushToast: (alert: MarketAlert) => void;
  criticalOnly: () => boolean;
  toggleCriticalOnly: () => void;
  criticalCount: () => number;
  displayedTrail: () => MarketAlert[];
  visibleBanners: () => MarketAlert[];
  bannerOverflow: () => number;
  soundMuted: () => boolean;
  toggleSound: () => void;
  preMoveAlert: () => PreMoveScore | null;
  clearPreMoveAlert: () => void;
  blast: () => NiftyBlast | null;
  dismissBlast: () => void;
  sessionKey: () => string;
  trailCursor: () => number | null;
  playTrail: () => void;
  stopTrail: () => void;
  setTrailCursor: (next: number | null) => void;
}

export interface NiftyReportUi {
  view: () => ChartView;
  setView: (next: ChartView) => void;
  handleViewChange: (value: string) => void;
  reportView: () => ReportView;
  setReportView: (next: ReportView) => void;
  handleReportViewChange: (value: string) => void;
  isWindowDesk: () => boolean;
  deskMode: () => DeskMode;
  isDesk: () => boolean;
  toggleDeskMode: () => void;
  handleDeskChange: (value: string) => void;
  sideTab: () => SideTab;
  setSideTab: (next: SideTab) => void;
  chartTf: () => ChartTimeframe;
  setChartTf: (next: ChartTimeframe) => void;
  handleChartTf: (next: DeskChartTimeframe) => void;
  chartSize: () => ChartSize;
  setChartSize: (next: ChartSize) => void;
  handleChartSize: (next: ChartSize) => void;
  expandRange: () => TapeRange;
  setExpandRange: (next: TapeRange) => void;
  heatMetric: () => HeatMetric;
  setHeatMetric: (next: HeatMetric) => void;
  detailOpen: () => boolean;
  toggleDetail: () => void;
  overlayOpen: (key: DeskOverlayKey) => boolean;
  setOverlayOpen: (key: DeskOverlayKey, next: boolean) => void;
  wallsOpen: () => boolean;
  setWallsOpen: (next: boolean) => void;
  deskOpen: () => boolean;
  setDeskOpen: (next: boolean) => void;
  moversOpen: () => boolean;
  setMoversOpen: (next: boolean) => void;
  planOpen: () => boolean;
  setPlanOpen: (next: boolean) => void;
  chartFull: () => boolean;
  setChartFull: (next: boolean) => void;
  ivOpen: () => boolean;
  setIvOpen: (next: boolean) => void;
  gexOpen: () => boolean;
  setGexOpen: (next: boolean) => void;
  gammaOpen: () => boolean;
  setGammaOpen: (next: boolean) => void;
  visualsOpen: () => boolean;
  setVisualsOpen: (next: boolean) => void;
  oiExpand: () => boolean;
  setOiExpand: (next: boolean) => void;
  heatExpand: () => boolean;
  setHeatExpand: (next: boolean) => void;
  flowExpand: () => boolean;
  setFlowExpand: (next: boolean) => void;
  pressureExpand: () => boolean;
  setPressureExpand: (next: boolean) => void;
  flowChartExpand: () => boolean;
  setFlowChartExpand: (next: boolean) => void;
  deskDockTab: () => DeskDockKey | null;
  setDeskDockTab: (next: DeskDockKey | null) => void;
  openPlanReasons: () => void;
  openAlertsDock: () => void;
  openChartFull: () => void;
  openVisuals: () => void;
  openMovers: () => void;
  closeMovers: () => void;
  openOiExpand: () => void;
  openSymbol: () => void;
  closeTopModal: () => void;
}

export interface NiftyReportStore {
  selection: NiftyReportSelection;
  data: NiftyReportData;
  replay: NiftyReportReplay;
  walls: NiftyReportWalls;
  alerts: NiftyReportAlerts;
  ui: NiftyReportUi;
}

export interface ReportStreamHandle {
  report: () => NiftyReport | null;
  tape: () => NiftyTape | null;
  sensex: () => NiftySensex | null;
  connected: () => boolean;
}

export interface BlastHandle {
  blast: () => NiftyBlast | null;
  dismiss: () => void;
}
