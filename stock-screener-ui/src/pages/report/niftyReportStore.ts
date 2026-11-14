import {
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
} from "solid-js";

import {
  fetchBreadth,
  fetchChain10sSummary,
  fetchLiveNifty,
  fetchLiveSensex,
  fetchNiftyBursts,
  fetchNiftyByDate,
  fetchNiftyExpiries,
  fetchNiftyReplay,
  fetchNiftyReplayDates,
  fetchNiftyReplayFrame,
  fetchNiftyReplayMeta,
  fetchNiftyTape,
  fetchOptionsBursts,
  fetchOptionsChain10s,
  fetchOptionsExpiries,
  fetchOptionsLive,
  fetchOptionsLiveCandles,
  fetchOptionsReplay,
  fetchOptionsReplayDates,
  fetchOptionsReplayFrame,
  fetchOptionsReplayMeta,
  fetchOptionsSnapshot,
  fetchOptionsTape,
  snapshotNifty,
} from "@/api/reportNifty";
import type {
  BreadthPayload,
  Chain10sSummaryPoint,
  NiftyBlast,
  NiftyReplayMeta,
  WallsPayload,
} from "@/api/reportNifty";
import { fetchPositions } from "@/api/paperTrading";
import { fetchHolidayCheck } from "@/api/holidays_api";
import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { PaperPosition } from "@/types/paperTrading";
import type {
  NiftyBurst,
  NiftyReport,
  NiftyReportMode,
  NiftyReplay,
  NiftyReplayFrame,
  NiftySensex,
  NiftyTape,
} from "@/types/niftyReport";
import { isDerivativesOpenIst } from "@/utils/marketClock";
import { usePolling } from "@/hooks/usePolling";
import { useDeskHotkeys } from "@/hooks/useDeskHotkeys";
import type { DeskChartTimeframe } from "@/hooks/useDeskHotkeys";
import { alertsMuted, flashAlertTitle, playAlertSound, setAlertsMuted } from "./alertSound";
import { buildFlowSeries } from "./niftyFlowSeries";
import {
  detectFlipChange,
  detectFlowFlip,
  flipStorageKey,
  flowWindowFromTape,
  loadStoredFlip,
  saveStoredFlip,
  sessionTone,
} from "./niftyFlowRead";
import type { FlipWatchState, FlowLastFlip, OiPoint } from "./niftyFlowRead";
import {
  TREND_EMA_SPAN,
  burstTimeLabel,
  isNonTradeAlertType,
  premiumChangeBefore,
  spotMinutesBefore,
} from "./niftyOiBursts";
import type { MinutePremium, OiBurst } from "./niftyOiBursts";
import { paperToPnlLeg } from "./niftyPositions";
import type { NiftyPnlPosition } from "./niftyPnlAttribution";
import { appendPreMove } from "./niftyPreMoveHistory";
import type { PreMovePoint } from "./niftyPreMoveHistory";
import { scorePreMove, seedPreMoveHistory } from "./niftyPreMove";
import type { PreMoveScore } from "./niftyPreMove";
import { buildPressure } from "./niftyPressure";
import { buildReplaySegments, countReplayHoles, toReplayReasons } from "./NiftyReplayBar";
import type { ReplayReason } from "./NiftyReplayBar";
import { computeReplayCoverage } from "./niftyReplayCoverage";
import type { ReplayCoverage } from "./niftyReplayCoverage";
import { setupRadar } from "./niftySetup";
import type { SetupRead } from "./niftySetup";
import { createWallMoveState, nextWallMoveState, wallMoveTitle } from "./niftyWallMoves";
import type { WallMoveState } from "./niftyWallMoves";
import { resolveWallBoard } from "./niftyWallsFormat";
import { symbolMetrics } from "./symbolMetrics";
import type { SymbolMetrics } from "./symbolMetrics";
import type { TapeRange } from "./tapeRange";
import { useNiftyBlasts } from "./useNiftyBlasts";
import { useNiftyOiAlerts } from "./useNiftyOiAlerts";
import { useNiftyReportStream, useNiftyBurstStream } from "./niftyStreamSolid";
import { useReplayWalls } from "./useReplayWalls";
import type { WallSnapshot } from "./NiftySqueezeRadar";
import type { ChartSize, ChartTimeframe } from "./NiftyChartPanel";
import type { DeskDockKey } from "./DeskDock";

export type ReportSymbol = "NIFTY" | "SENSEX" | "RELIANCE";
export type ReportIndex = "nifty" | "sensex";
export type ChartView = "chart" | "depth";
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
  | "flowChart";

export const NIFTY_DESK_MODE_KEY = "nifty.deskMode";

const SIDE_TAB_KEY = "nifty.sideTab";
const REPLAY_STUB_REPORT = Object.freeze({}) as unknown as NiftyReport;
const STALE_AFTER_MS = 90_000;
const REPLAY_PLAY_MS = 700;
const SENSEX_REQUEST_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const GENERIC_POLL_MS = 15_000;
const BREADTH_POLL_MS = 60_000;
const BREADTH_FOCUS_GUARD_MS = 2_000;
const CHAIN10S_POLL_MS = 10_000;
const CHAIN10S_FOCUS_GUARD_MS = 2_000;
const GENERIC_BURST_POLL_MS = 30_000;
const SESSION_CLOSE_POLL_MS = 30_000;
const REPLAY_FRAME_CACHE_MAX = 8;
const STREAMED_BURST_MAX = 200;
const WALL_HISTORY_WINDOW_MS = 180_000;
const WALL_HISTORY_MAX = 60;
const PREMOVE_ALERT_COOLDOWN_MS = 10 * 60_000;
const PREMOVE_ALERT_TTL_MS = 180_000;
const EOD_CHAIN10S_LIMIT = 2_000;
const LIVE_CHAIN10S_LIMIT = 90;
const REPLAY_PREMOVE_TAIL = 200;
const REPLAY_PREMOVE_KEEP = 180;
const ALERTS_TRAIL_WALK_MS = 1_000;

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
  flowSeries: () => ReturnType<typeof buildFlowSeries>;
  sessionContext: () => {
    byMinute: Map<string, "up" | "down" | null>;
    end: "up" | "down" | null;
    spotByMinute: Map<string, number>;
    premByMinute: Map<string, MinutePremium>;
  };
  effectiveBursts: () => OiBurst[];
  burstMap: () => Map<string, "call" | "put">;
  lastFlip: () => FlowLastFlip | null;
  currentFlip: () => ReturnType<typeof detectFlowFlip>;
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
  burstById: () => Map<string, OiBurst>;
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

interface ReportStreamHandle {
  report: () => NiftyReport | null;
  tape: () => NiftyTape | null;
  sensex: () => NiftySensex | null;
  connected: () => boolean;
}

interface BlastHandle {
  blast: () => NiftyBlast | null;
  dismiss: () => void;
}

function readStoredEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function replayDatesFor(symbol: ReportSymbol, signal?: AbortSignal): Promise<string[]> {
  return symbol === "NIFTY" ? fetchNiftyReplayDates(signal) : fetchOptionsReplayDates(symbol, signal);
}

function replayFromMeta(meta: NiftyReplayMeta): NiftyReplay {
  return {
    date: meta.date,
    count: meta.frames.length,
    interval_sec: meta.interval_sec,
    gap_reasons: meta.gap_reasons,
    snapshots: meta.frames.map((frame) => ({
      t: frame.t,
      fetched_at: "",
      report: REPLAY_STUB_REPORT,
      sensex: null,
    })),
  };
}

async function fetchSensexWithinTimeout(controller: AbortController): Promise<NiftySensex> {
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SENSEX_REQUEST_TIMEOUT_MS);
  try {
    return await fetchLiveSensex(controller.signal);
  } catch (fetchError) {
    if (timedOut) {
      const timeoutError = new Error("Sensex data request timed out");
      timeoutError.name = "SensexTimeoutError";
      throw timeoutError;
    }
    throw fetchError;
  } finally {
    window.clearTimeout(timer);
  }
}

function isTimeoutError(value: unknown): boolean {
  return value instanceof Error && value.name === "SensexTimeoutError";
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

function isAuthFailure(message: string): boolean {
  return /401|token|unauthor|expired/i.test(message);
}

function buildNiftyReportStore(options: NiftyReportStoreOptions): {
  store: NiftyReportStore;
  start: () => void;
} {
  const [symbol, setSymbol] = createSignal<ReportSymbol>("NIFTY");
  const [index, setIndex] = createSignal<ReportIndex>("nifty");
  const [mode, setMode] = createSignal<NiftyReportMode>("live");
  const [expiry, setExpiry] = createSignal<string>("nearest");
  const [expiryOptions, setExpiryOptions] = createSignal<string[]>([]);
  const [date, setDate] = createSignal<string>("");
  const [historyDates, setHistoryDates] = createSignal<string[]>([]);
  const [booted, setBooted] = createSignal(false);

  const [report, setReport] = createSignal<NiftyReport | null>(null);
  const [sensex, setSensex] = createSignal<NiftySensex | null>(null);
  const [sensexLoading, setSensexLoading] = createSignal(false);
  const [sensexError, setSensexError] = createSignal<string | null>(null);
  const [tape, setTape] = createSignal<NiftyTape | null>(null);
  const [bursts, setBursts] = createSignal<OiBurst[] | null>(null);
  const [streamed, setStreamed] = createSignal<NiftyBurst[]>([]);
  const [paperPositions, setPaperPositions] = createSignal<PaperPosition[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [snapshotting, setSnapshotting] = createSignal(false);
  const [updatedAtMs, setUpdatedAtMs] = createSignal<number | null>(null);
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [wsDownSinceMs, setWsDownSinceMs] = createSignal<number | null>(null);
  const [replay, setReplay] = createSignal<NiftyReplay | null>(null);
  const [replayIndex, setReplayIndex] = createSignal(0);
  const [replayPlaying, setReplayPlaying] = createSignal(false);
  const [oiPoints, setOiPoints] = createSignal<OiPoint[]>([]);
  const [breadth, setBreadth] = createSignal<BreadthPayload | null>(null);
  const [preMoveAlert, setPreMoveAlert] = createSignal<PreMoveScore | null>(null);
  const [livePreMoveHistory, setLivePreMoveHistory] = createSignal<PreMovePoint[]>([]);
  const [wallHistory, setWallHistory] = createSignal<WallSnapshot[]>([]);
  const [lastFlip, setLastFlip] = createSignal<FlowLastFlip | null>(null);
  const [trailCursor, setTrailCursor] = createSignal<number | null>(null);

  const [view, setView] = createSignal<ChartView>("chart");
  const [deskMode, setDeskModeValue] = createSignal<DeskMode>(
    readStoredEnum<DeskMode>(NIFTY_DESK_MODE_KEY, ["desk", "research"], "desk"),
  );
  const [sideTab, setSideTabValue] = createSignal<SideTab>(
    readStoredEnum<SideTab>(SIDE_TAB_KEY, ["chain", "heatmap"], "chain"),
  );
  const [chartTf, setChartTf] = createSignal<ChartTimeframe>("1m");
  const [chartSize, setChartSize] = createSignal<ChartSize>("fill");
  const [expandRange, setExpandRange] = createSignal<TapeRange>(1);
  const [heatMetric, setHeatMetric] = createSignal<HeatMetric>("oi");
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [deskDockTab, setDeskDockTab] = createSignal<DeskDockKey | null>(null);
  const [planOpen, setPlanOpen] = createSignal(false);
  const [moversOpen, setMoversOpen] = createSignal(false);
  const [chartFull, setChartFull] = createSignal(false);
  const [ivOpen, setIvOpen] = createSignal(false);
  const [gexOpen, setGexOpen] = createSignal(false);
  const [gammaOpen, setGammaOpen] = createSignal(false);
  const [visualsOpen, setVisualsOpen] = createSignal(false);
  const [wallsOpen, setWallsOpen] = createSignal(false);
  const [deskOpen, setDeskOpen] = createSignal(false);
  const [oiExpand, setOiExpand] = createSignal(false);
  const [heatExpand, setHeatExpand] = createSignal(false);
  const [flowExpand, setFlowExpand] = createSignal(false);
  const [pressureExpand, setPressureExpand] = createSignal(false);
  const [flowChartExpand, setFlowChartExpand] = createSignal(false);

  const [criticalOnly, setCriticalOnly] = createSignal(false);
  const [soundMuted, setSoundMuted] = createSignal(alertsMuted());

  const [streamHandle, setStreamHandle] = createSignal<ReportStreamHandle | null>(null);
  const [wallsHandle, setWallsHandle] = createSignal<ReturnType<typeof useReplayWalls> | null>(null);
  const [oiAlertsHandle, setOiAlertsHandle] = createSignal<ReturnType<typeof useNiftyOiAlerts> | null>(
    null,
  );
  const [blastsHandle, setBlastsHandle] = createSignal<BlastHandle | null>(null);

  let wasOpenAtMount = isDerivativesOpenIst();
  let holidayToday = false;
  let autoEod = false;
  const genericAutoEod = new Set<string>();
  let loadingInFlight = false;
  let requestId = 0;
  let requestController: AbortController | null = null;
  let sensexController: AbortController | null = null;
  let wallMoveState: WallMoveState = createWallMoveState();
  let baseIntraday: NonNullable<NiftyReport["intraday"]> = [];
  let baseCandles: NonNullable<NiftyReport["candles"]> = [];
  let scrubRaf: number | null = null;
  const replayFrameCache = new Map<string, NiftyReport>();
  const replayFrameInflight = new Map<string, Promise<NiftyReplayFrame | null>>();
  let replayPrefetchCancel: (() => void) | null = null;
  let replayFrameReq = 0;
  let pendingScrub: { report: NiftyReport; sensex: NiftySensex | null } | null = null;
  let prevContext = "live:nearest";
  let flipWatch: FlipWatchState | null = null;
  let armedStreak = 0;
  let lastPreMoveAlertAt = 0;
  let started = false;

  const isDesk = createMemo(() => deskMode() === "desk");
  const contextKey = createMemo(() => (mode() === "eod" ? `eod:${date()}` : `live:${expiry()}`));

  const expiryData = createMemo(() => [
    { value: "nearest", label: "Nearest expiry" },
    ...expiryOptions().map((value) => ({ value, label: value })),
  ]);

  const hasRecordedHistory = createMemo(() => symbol() === "NIFTY" || historyDates().length > 0);

  const marketClosed = createMemo(() => report()?.market?.is_open === false);
  const wsConnected = createMemo(() => streamHandle()?.connected() ?? false);
  const wsDownForMs = createMemo(() => {
    const since = wsDownSinceMs();
    return since === null ? 0 : nowMs() - since;
  });
  const isStale = createMemo(
    () =>
      mode() === "live" &&
      !marketClosed() &&
      !wsConnected() &&
      wsDownSinceMs() !== null &&
      wsDownForMs() > STALE_AFTER_MS,
  );
  const staleMins = createMemo(() => Math.max(1, Math.floor(wsDownForMs() / 60_000)));

  const metrics = createMemo<SymbolMetrics | null>(() => {
    const current = report();
    return current ? symbolMetrics(current) : null;
  });

  const visibleStrikes = createMemo<NiftyReport["strikes"]>(() => {
    const current = report();
    if (!current || !Array.isArray(current.strikes)) return [];
    const windowPts = metrics()?.atmWindowPts ?? 750;
    return current.strikes.filter(
      (strike) => Math.abs(strike.strike - current.spot) <= windowPts,
    );
  });

  const atmStrike = createMemo<number | null>(() => {
    const current = report();
    if (!current || !Array.isArray(current.strikes) || current.strikes.length === 0) return null;
    if (!Number.isFinite(current.spot)) return null;
    let best = current.strikes[0].strike;
    let bestDistance = Math.abs(best - current.spot);
    for (let i = 1; i < current.strikes.length; i++) {
      const strike = current.strikes[i].strike;
      const distance = Math.abs(strike - current.spot);
      if (distance < bestDistance || (distance === bestDistance && strike < best)) {
        best = strike;
        bestDistance = distance;
      }
    }
    return best;
  });

  const oiScale = createMemo(() => {
    let maxCeOiChange = 0;
    let maxPeOiChange = 0;
    for (const strike of visibleStrikes()) {
      const ce = Math.abs(strike.ce.oiChange ?? 0);
      const pe = Math.abs(strike.pe.oiChange ?? 0);
      if (ce > maxCeOiChange) maxCeOiChange = ce;
      if (pe > maxPeOiChange) maxPeOiChange = pe;
    }
    return { maxCeOiChange, maxPeOiChange };
  });

  const oiWalls = createMemo(() => ({
    calls: (report()?.wallsNear?.calls ?? report()?.walls?.calls ?? []).slice(0, 1),
    puts: (report()?.wallsNear?.puts ?? report()?.walls?.puts ?? []).slice(0, 1),
  }));

  const replayFrameT = createMemo<string | null>(() => {
    const current = replay();
    const at = replayIndex();
    if (!current || at >= current.snapshots.length) return null;
    return current.snapshots[at].t;
  });

  const replayFrameLabel = createMemo<string | null>(() => {
    const at = replayFrameT();
    return at ? burstTimeLabel(at) : null;
  });

  const tapeRows = createMemo<NiftyTape["rows"]>(() => {
    const rows = tape()?.rows ?? [];
    const label = replayFrameLabel();
    if (!label) return rows;
    return rows.filter((row) => burstTimeLabel(row.t) <= label);
  });

  const derivedFlow = createMemo<NiftyReport["flow_window"]>(() => {
    const server = report()?.flow_window;
    return server ?? flowWindowFromTape(tapeRows());
  });

  const flowReport = createMemo<NiftyReport | null>(() => {
    const current = report();
    return current ? { ...current, flow_window: derivedFlow() } : current;
  });

  const intradayStart = createMemo<string | null>(() => {
    const current = report();
    return current?.intraday?.[0]?.time ?? current?.candles?.[0]?.time ?? tapeRows()[0]?.t ?? null;
  });

  const tapeSpeed = createMemo<{ delta: number; ratio: number } | null>(() => {
    const spots = tapeRows()
      .map((row) => row.spot)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (spots.length < 7) return null;
    const last = spots[spots.length - 1];
    const reference = spots[Math.max(0, spots.length - 6)];
    const moves = spots
      .slice(1)
      .map((value, i) => Math.abs(value - spots[i]))
      .sort((a, b) => a - b);
    const median = moves[Math.floor(moves.length / 2)] || 1;
    const delta = last - reference;
    return { delta, ratio: Math.abs(delta) / Math.max(1, median * 5) };
  });

  const flowSeries = createMemo(() => buildFlowSeries(tapeRows()));
  const pressure = createMemo(() => buildPressure(tapeRows()));

  const setup = createMemo<SetupRead>(() => {
    const current = report();
    const symbolMetricsValue = metrics();
    if (!symbolMetricsValue) return { gates: [], score: 0, state: "QUIET" as const };
    return setupRadar({
      rows: tapeRows(),
      spot: current?.spot,
      wallsNear: current?.wallsNear,
      walls: current?.walls,
      strikes: current?.strikes,
      pressure: pressure(),
      gex: current?.gex,
      pivots: current?.pivots,
      prevDay: current?.pivots?.prev,
      metrics: symbolMetricsValue,
    });
  });

  const replayCutMs = createMemo<number | null>(() => {
    const at = replayFrameT();
    if (!at) return null;
    const parsed = Date.parse(at);
    return Number.isFinite(parsed) ? parsed : null;
  });

  const scorePoints = createMemo<OiPoint[]>(() => {
    const cut = replayCutMs();
    const points = oiPoints();
    if (cut === null) return points;
    return points.filter((point) => {
      const at = Date.parse(point.t);
      return Number.isFinite(at) && at <= cut;
    });
  });

  const preMove = createMemo<PreMoveScore>(() =>
    scorePreMove({
      points: scorePoints(),
      rows: tapeRows(),
      pressure: pressure(),
      regime: report()?.regime ?? null,
    }),
  );

  const preMoveHistory = createMemo<PreMovePoint[]>(() => {
    if (mode() === "live") return livePreMoveHistory();
    return seedPreMoveHistory(scorePoints().slice(-REPLAY_PREMOVE_TAIL)).slice(-REPLAY_PREMOVE_KEEP);
  });

  const detectedBursts = createMemo<OiBurst[]>(() => bursts() ?? []);

  const sessionContext = createMemo(() => {
    const rows = tapeRows();
    const ascending = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const byMinute = new Map<string, "up" | "down" | null>();
    const spotByMinute = new Map<string, number>();
    const premByMinute = new Map<string, MinutePremium>();
    const alpha = 2 / (TREND_EMA_SPAN + 1);
    let ema: number | null = null;
    let last = 0;
    for (const row of ascending) {
      if (!Number.isFinite(row.spot) || row.spot === 0) continue;
      ema = ema === null ? row.spot : alpha * row.spot + (1 - alpha) * ema;
      last = row.spot;
      const key = burstTimeLabel(row.t);
      byMinute.set(key, last > ema ? "up" : last < ema ? "down" : null);
      spotByMinute.set(key, row.spot);
      if (row.atm_ce_ltp != null || row.atm_pe_ltp != null || row.atm_strike != null) {
        premByMinute.set(key, {
          strike: row.atm_strike ?? null,
          ce: row.atm_ce_ltp ?? null,
          pe: row.atm_pe_ltp ?? null,
        });
      }
    }
    const end: "up" | "down" | null =
      ema === null ? null : last > ema ? "up" : last < ema ? "down" : null;
    return { byMinute, end, spotByMinute, premByMinute };
  });

  const effectiveBursts = createMemo<OiBurst[]>(() => {
    const byId = new Map<string, OiBurst>();
    for (const burst of detectedBursts()) byId.set(burst.id, burst);
    for (const burst of streamed()) if (!byId.has(burst.id)) byId.set(burst.id, burst as OiBurst);
    const label = replayFrameLabel();
    const merged = label
      ? [...byId.values()].filter((burst) => burstTimeLabel(burst.t) <= label)
      : [...byId.values()];
    const context = sessionContext();
    if (context.byMinute.size === 0) return merged;
    return merged.map((burst) => {
      const key = burstTimeLabel(burst.t);
      const trend = burst.trend ?? context.byMinute.get(key) ?? context.end;
      let trend5m = burst.trend5m ?? null;
      if (trend5m === null) {
        const current = context.spotByMinute.get(key);
        const before = spotMinutesBefore(context.spotByMinute, key, 5);
        if (current !== undefined && before !== null && current !== before) {
          trend5m = current > before ? "up" : "down";
        }
      }
      let premChg = burst.premChg ?? null;
      if (premChg === null) {
        premChg = premiumChangeBefore(context.premByMinute, key, burst.side);
      }
      return {
        ...burst,
        trend,
        ...(trend5m !== null ? { trend5m } : {}),
        ...(premChg !== null ? { premChg } : {}),
      };
    });
  });

  const burstMap = createMemo(() => {
    const map = new Map<string, "call" | "put">();
    for (const burst of effectiveBursts()) {
      if (isNonTradeAlertType(burst.type)) continue;
      map.set(burst.t, burst.side);
    }
    return map;
  });

  const burstById = createMemo(() => {
    const map = new Map<string, OiBurst>();
    for (const burst of effectiveBursts()) map.set(burst.id, burst);
    return map;
  });

  const currentFlip = createMemo(() =>
    detectFlowFlip(
      derivedFlow()?.["5m"],
      derivedFlow()?.["15m"],
      sessionTone(report()?.control?.verdict),
    ),
  );

  const flipStorageKeyNow = createMemo(() =>
    flipStorageKey(symbol(), mode(), date() || report()?.date || "live"),
  );

  const replayCoverage = createMemo<ReplayCoverage | null>(() => {
    const current = replay();
    return current ? computeReplayCoverage(current.snapshots) : null;
  });
  const replayReasons = createMemo<ReplayReason[]>(() => toReplayReasons(replay()?.gap_reasons));
  const replayHoles = createMemo(() =>
    countReplayHoles(buildReplaySegments(replay(), replayCoverage())),
  );

  const pnlPositions = createMemo<NiftyPnlPosition[] | null>(() => {
    const positions = paperPositions();
    return positions ? positions.flatMap(paperToPnlLeg) : null;
  });

  const alertsSessionKey = createMemo(() => {
    const label = replayFrameLabel();
    return label ? `${symbol()}:${contextKey()}@${label}` : `${symbol()}:${contextKey()}`;
  });

  const alertTrail = createMemo<MarketAlert[]>(() => oiAlertsHandle()?.trail() ?? []);
  const alertToasts = createMemo<MarketAlert[]>(() => oiAlertsHandle()?.toasts() ?? []);
  const alertBanners = createMemo<MarketAlert[]>(() => oiAlertsHandle()?.banners() ?? []);
  const criticalCount = createMemo(
    () => alertTrail().filter((alert) => alert.severity === "critical").length,
  );
  const displayedTrail = createMemo(() => {
    const base = criticalOnly()
      ? alertTrail().filter((alert) => alert.severity === "critical")
      : alertTrail();
    return [...base].sort((a, b) => b.ts - a.ts);
  });
  const visibleBanners = createMemo(() => (isDesk() ? alertBanners().slice(0, 1) : alertBanners()));
  const bannerOverflow = createMemo(() => alertBanners().length - visibleBanners().length);

  const wallsData = createMemo<WallsPayload | null>(() => wallsHandle()?.walls() ?? null);
  const wallsSyncing = createMemo(() => wallsHandle()?.syncing() ?? false);

  const touchNow = () => setNowMs(Date.now());

  const markUpdated = () => {
    const now = Date.now();
    setUpdatedAtMs(now);
    setNowMs(now);
  };

  const pushStreamedBurst = (burst: NiftyBurst) => {
    setStreamed((previous) =>
      previous.some((existing) => existing.id === burst.id)
        ? previous
        : [...previous, burst].slice(-STREAMED_BURST_MAX),
    );
  };

  const refreshPaperPositions = async () => {
    try {
      const list = await fetchPositions();
      setPaperPositions(list ?? []);
    } catch {
      setPaperPositions((previous) => previous ?? []);
    }
  };

  const cacheReplayFrame = (minute: string, next: NiftyReport) => {
    replayFrameCache.set(minute, next);
    if (replayFrameCache.size > REPLAY_FRAME_CACHE_MAX) {
      const oldest = replayFrameCache.keys().next().value;
      if (oldest) replayFrameCache.delete(oldest);
    }
  };

  const loadReplayFrame = (dateKey: string, minute: string): Promise<NiftyReplayFrame | null> => {
    const activeSymbol = symbol();
    const inflightKey = `${activeSymbol}|${dateKey}|${minute}`;
    const pending = replayFrameInflight.get(inflightKey);
    if (pending) return pending;
    const request = (
      activeSymbol === "NIFTY"
        ? fetchNiftyReplayFrame(dateKey, minute)
        : fetchOptionsReplayFrame(activeSymbol, dateKey, minute)
    )
      .then((loaded) => {
        if (loaded) cacheReplayFrame(minute, loaded.report);
        return loaded;
      })
      .catch(() => null);
    replayFrameInflight.set(inflightKey, request);
    void request.finally(() => {
      if (replayFrameInflight.get(inflightKey) === request) replayFrameInflight.delete(inflightKey);
    });
    return request;
  };

  const cancelReplayPrefetch = () => {
    replayPrefetchCancel?.();
    replayPrefetchCancel = null;
  };

  const prefetchNextReplayFrame = (dateKey: string, next: NiftyReplayFrame | undefined) => {
    cancelReplayPrefetch();
    if (!next || !next.t || next.report !== REPLAY_STUB_REPORT) return;
    if (replayFrameCache.has(next.t)) return;
    const minute = next.t;
    const run = () => {
      replayPrefetchCancel = null;
      void loadReplayFrame(dateKey, minute);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(run, { timeout: 1_000 });
      replayPrefetchCancel = () => idleWindow.cancelIdleCallback?.(handle);
      return;
    }
    const handle = window.setTimeout(run, 150);
    replayPrefetchCancel = () => window.clearTimeout(handle);
  };

  const withBaseCandles = (next: NiftyReport): NiftyReport => {
    const hasIntraday = (next.intraday?.length ?? 0) > 0;
    const hasCandles = (next.candles?.length ?? 0) > 0;
    if (hasIntraday || hasCandles) return next;
    if (baseIntraday.length === 0 && baseCandles.length === 0) return next;
    return {
      ...next,
      ...(baseIntraday.length > 0 ? { intraday: baseIntraday } : {}),
      ...(baseCandles.length > 0 ? { candles: baseCandles } : {}),
    };
  };

  const applyReplayFrame = (next: NiftyReport, nextSensex: NiftySensex | null) => {
    setReport(withBaseCandles(next));
    setSensex(nextSensex);
  };

  const load = async () => {
    if (loadingInFlight) return;
    const currentRequestId = requestId + 1;
    requestId = currentRequestId;
    const controller = new AbortController();
    requestController = controller;
    loadingInFlight = true;
    setLoading(true);
    setError(null);
    const activeSymbol = symbol();
    const activeMode = mode();
    const activeExpiry = expiry();
    const activeDate = date();
    try {
      if (activeSymbol !== "NIFTY") {
        const tapeDate = activeMode === "eod" ? activeDate || undefined : undefined;
        const genericReplay =
          activeMode === "eod" && activeDate
            ? fetchOptionsReplayMeta(activeSymbol, activeDate, controller.signal)
                .then((meta): Promise<NiftyReplay | null> | NiftyReplay | null =>
                  meta && meta.frames.length > 0
                    ? replayFromMeta(meta)
                    : fetchOptionsReplay(activeSymbol, activeDate, controller.signal),
                )
                .catch(() => null)
            : Promise.resolve(null);
        const [optionsReport, tapeData, burstData, replayData] = await Promise.all([
          activeMode === "live"
            ? fetchOptionsLive(
                activeSymbol,
                activeExpiry === "nearest" ? undefined : activeExpiry,
                controller.signal,
              )
            : fetchOptionsSnapshot(activeSymbol, activeDate, controller.signal),
          fetchOptionsTape(activeSymbol, tapeDate, controller.signal),
          fetchOptionsBursts(activeSymbol, tapeDate, controller.signal),
          genericReplay,
        ]);
        if (currentRequestId !== requestId || controller.signal.aborted) return;
        const firstFrame = replayData?.snapshots[0] ?? null;
        const nextReport =
          optionsReport ??
          (firstFrame && firstFrame.report !== REPLAY_STUB_REPORT ? firstFrame.report : null);
        if (!nextReport) {
          throw new Error(
            activeMode === "eod"
              ? `No ${activeSymbol} snapshot recorded for ${activeDate}.`
              : `No ${activeSymbol} option-chain report available.`,
          );
        }
        baseIntraday = nextReport.intraday ?? [];
        baseCandles = nextReport.candles ?? [];
        setReport(nextReport);
        if (tapeData) setTape(tapeData);
        setBursts(burstData as OiBurst[]);
        setReplay(replayData && replayData.snapshots.length > 0 ? replayData : null);
        setReplayIndex(0);
        setReplayPlaying(false);
        setSensex(null);
        setSensexError(null);
        setSensexLoading(false);
        markUpdated();
        if (activeMode === "live" && (!nextReport.intraday || nextReport.intraday.length === 0)) {
          void fetchOptionsLiveCandles(activeSymbol, undefined, controller.signal)
            .then((withCandles) => {
              if (currentRequestId !== requestId) return;
              const intraday = withCandles.intraday;
              if (!intraday || intraday.length === 0) return;
              setReport((previous) =>
                previous
                  ? {
                      ...previous,
                      intraday,
                      ...(withCandles.ohlc ? { ohlc: withCandles.ohlc } : {}),
                      ...(withCandles.emas ? { emas: withCandles.emas } : {}),
                      ...(withCandles.control ? { control: withCandles.control } : {}),
                      ...(withCandles.regime ? { regime: withCandles.regime } : {}),
                      ...(withCandles.strength ? { strength: withCandles.strength } : {}),
                    }
                  : previous,
              );
            })
            .catch(() => undefined);
        }
        return;
      }

      const replayPromise =
        activeMode === "eod" && activeDate
          ? fetchNiftyReplayMeta(activeDate, controller.signal)
              .then((meta): Promise<NiftyReplay | null> | NiftyReplay | null =>
                meta && meta.frames.length > 0
                  ? replayFromMeta(meta)
                  : fetchNiftyReplay(activeDate, controller.signal).catch(() => null),
              )
              .catch(() => null)
          : Promise.resolve(null);
      const [data, tapeData, burstData, replayData] = await Promise.all([
        activeMode === "live"
          ? fetchLiveNifty(
              activeExpiry === "nearest" ? undefined : activeExpiry,
              controller.signal,
            )
          : fetchNiftyByDate(activeDate, controller.signal),
        fetchNiftyTape(
          activeMode === "eod" ? activeDate || undefined : undefined,
          controller.signal,
        ).catch(() => null),
        fetchNiftyBursts(
          activeMode === "eod" ? activeDate || undefined : undefined,
          controller.signal,
        ),
        replayPromise,
      ]);
      if (currentRequestId !== requestId) return;
      const firstReplayFrame = replayData?.snapshots[0] ?? null;
      const nextNiftyReport =
        firstReplayFrame && firstReplayFrame.report !== REPLAY_STUB_REPORT
          ? firstReplayFrame.report
          : data;
      baseIntraday =
        (data.intraday?.length ?? 0) > 0 ? (data.intraday as typeof baseIntraday) : nextNiftyReport.intraday ?? [];
      baseCandles =
        (data.candles?.length ?? 0) > 0 ? (data.candles as typeof baseCandles) : nextNiftyReport.candles ?? [];
      setReport(nextNiftyReport);
      if (activeMode === "live") {
        sensexController?.abort();
        const nextSensexController = new AbortController();
        sensexController = nextSensexController;
        setSensexLoading(true);
        setSensexError(null);
        void fetchSensexWithinTimeout(nextSensexController)
          .then((sensexData) => {
            if (currentRequestId === requestId && !nextSensexController.signal.aborted) {
              setSensex(sensexData);
            }
          })
          .catch((sensexFetchError) => {
            const timedOut = isTimeoutError(sensexFetchError);
            if (currentRequestId !== requestId) return;
            if (nextSensexController.signal.aborted && !timedOut) return;
            setSensex(null);
            setSensexError(messageOf(sensexFetchError, "Sensex data unavailable"));
          })
          .finally(() => {
            if (currentRequestId === requestId) setSensexLoading(false);
          });
      } else {
        sensexController?.abort();
        setSensex(null);
        setSensexLoading(false);
        setSensexError(null);
      }
      if (activeMode === "eod" && activeDate) {
        if (replayData && replayData.snapshots.length > 0) {
          setReplay(replayData);
          setReplayIndex(0);
          setReplayPlaying(false);
          setSensex(null);
        } else {
          setReplay(null);
          setReplayIndex(0);
          setReplayPlaying(false);
        }
      }
      if (tapeData) setTape(tapeData);
      setBursts(burstData as OiBurst[]);
      markUpdated();
    } catch (loadError) {
      if (currentRequestId !== requestId || controller.signal.aborted) return;
      setNowMs(Date.now());
      const message = messageOf(loadError, "Failed to load Nifty report");
      if (activeMode === "live" && isAuthFailure(message)) {
        try {
          const dates = await fetchNiftyReplayDates(controller.signal);
          if (dates.length > 0) {
            autoEod = true;
            wasOpenAtMount = false;
            setMode("eod");
            setDate(dates[0]);
            setError(null);
            return;
          }
        } catch {
          setError(message);
          return;
        }
      }
      setError(message);
    } finally {
      if (currentRequestId === requestId) {
        requestController = null;
        loadingInFlight = false;
        setLoading(false);
      }
    }
  };

  const refresh = () => {
    void load();
  };

  const snapshot = async () => {
    if (mode() === "eod" || symbol() !== "NIFTY") return;
    setSnapshotting(true);
    setError(null);
    try {
      const activeExpiry = expiry();
      const data = await snapshotNifty(
        undefined,
        activeExpiry === "nearest" ? undefined : activeExpiry,
      );
      setReport(data);
    } catch (snapshotError) {
      setError(messageOf(snapshotError, "Snapshot failed"));
    } finally {
      setSnapshotting(false);
    }
  };

  const scrubReplay = (rawIndex: number) => {
    const current = replay();
    if (!current) return;
    const clamped = Math.max(0, Math.min(current.snapshots.length - 1, Math.floor(rawIndex)));
    setReplayPlaying(false);
    setReplayIndex(clamped);
  };

  const toggleReplayPlay = () => {
    const current = replay();
    if (replayPlaying()) {
      if (scrubRaf !== null) {
        window.cancelAnimationFrame(scrubRaf);
        scrubRaf = null;
      }
      pendingScrub = null;
      setReplayPlaying(false);
      return;
    }
    if (current && replayIndex() >= current.snapshots.length - 1) {
      const first = current.snapshots[0];
      setReplayIndex(0);
      if (first && first.report !== REPLAY_STUB_REPORT) {
        applyReplayFrame(first.report, first.sensex ?? null);
      }
      setReplayPlaying(true);
      return;
    }
    setReplayPlaying(true);
  };

  const breakReplayAt = (at: string) => {
    const current = replay();
    if (!current) return;
    const target = at.slice(11, 19);
    const nextIndex = current.snapshots.findIndex(
      (snapshot) => String(snapshot.t).slice(11, 19) >= target,
    );
    if (nextIndex < 0) return;
    setReplayPlaying(false);
    setReplayIndex(nextIndex);
  };

  const resetContext = () => {
    requestId += 1;
    requestController?.abort();
    requestController = null;
    loadingInFlight = false;
    setLoading(false);
    setReport(null);
    setSensex(null);
    sensexController?.abort();
    sensexController = null;
    setSensexLoading(false);
    setSensexError(null);
    setTape(null);
    setBursts(null);
    setStreamed([]);
    replayFrameCache.clear();
    replayFrameReq += 1;
    setOiPoints([]);
    setWallHistory([]);
    setLivePreMoveHistory([]);
    setPreMoveAlert(null);
    if (scrubRaf !== null) {
      window.cancelAnimationFrame(scrubRaf);
      scrubRaf = null;
    }
    pendingScrub = null;
    cancelReplayPrefetch();
    setReplay(null);
    setReplayIndex(0);
    setReplayPlaying(false);
    setError(null);
  };

  const handleIndexChange = (value: string) => {
    const next: ReportIndex = value === "sensex" ? "sensex" : "nifty";
    setIndex(next);
    if (next === "sensex") {
      setMode("live");
      setView("chart");
    }
  };

  const handleSymbolChange = (value: string | null) => {
    const next: ReportSymbol = value === "SENSEX" || value === "RELIANCE" ? value : "NIFTY";
    setSymbol(next);
    setMode("live");
    setDate("");
    setExpiry("nearest");
    replayFrameCache.clear();
    setIndex("nifty");
    requestId += 1;
    requestController?.abort();
    requestController = null;
    loadingInFlight = false;
    setLoading(false);
    sensexController?.abort();
    sensexController = null;
    setReport(null);
    setTape(null);
    setBursts(null);
    setWallsOpen(false);
    setOiPoints([]);
    setHistoryDates([]);
    setStreamed([]);
    setSensex(null);
    setReplay(null);
    setReplayIndex(0);
    setReplayPlaying(false);
    baseIntraday = [];
    baseCandles = [];
    setError(null);
  };

  const handleModeChange = (value: string) => {
    autoEod = false;
    setMode(value === "eod" ? "eod" : "live");
  };

  const handleExpiryChange = (value: string | null) => {
    setExpiry(value ?? "nearest");
  };

  const handleViewChange = (value: string) => {
    setView(value === "depth" ? "depth" : "chart");
  };

  const toggleDeskMode = () => setDeskModeValue((value) => (value === "desk" ? "research" : "desk"));
  const handleDeskChange = (value: string) =>
    setDeskModeValue(value === "research" ? "research" : "desk");
  const handleChartTf = (next: DeskChartTimeframe) => setChartTf(next);
  const handleChartSize = (next: ChartSize) => setChartSize(next);
  const setSideTab = (next: SideTab) => setSideTabValue(next);
  const toggleDetail = () => setDetailOpen((value) => !value);
  const toggleCriticalOnly = () => setCriticalOnly((value) => !value);
  const openPlanReasons = () => setPlanOpen(true);
  const openAlertsDock = () => setDeskDockTab("alerts");
  const openChartFull = () => setChartFull(true);
  const openVisuals = () => setVisualsOpen(true);
  const openMovers = () => setMoversOpen(true);
  const closeMovers = () => setMoversOpen(false);
  const openOiExpand = () => setOiExpand(true);
  const openWalls = () => setWallsOpen(true);
  const closeWalls = () => setWallsOpen(false);
  const openSymbol = () => options.onOpenSymbol?.(symbol());

  const closeTopModal = () => {
    if (visualsOpen()) setVisualsOpen(false);
    else if (gexOpen()) setGexOpen(false);
    else if (gammaOpen()) setGammaOpen(false);
    else if (ivOpen()) setIvOpen(false);
    else if (chartFull()) setChartFull(false);
    else if (planOpen()) setPlanOpen(false);
    else if (moversOpen()) setMoversOpen(false);
  };

  const overlayAccessors: Record<DeskOverlayKey, [() => boolean, (next: boolean) => void]> = {
    walls: [wallsOpen, setWallsOpen],
    desk: [deskOpen, setDeskOpen],
    movers: [moversOpen, setMoversOpen],
    plan: [planOpen, setPlanOpen],
    chart: [chartFull, setChartFull],
    iv: [ivOpen, setIvOpen],
    gex: [gexOpen, setGexOpen],
    gamma: [gammaOpen, setGammaOpen],
    visuals: [visualsOpen, setVisualsOpen],
    oi: [oiExpand, setOiExpand],
    heat: [heatExpand, setHeatExpand],
    flow: [flowExpand, setFlowExpand],
    pressure: [pressureExpand, setPressureExpand],
    flowChart: [flowChartExpand, setFlowChartExpand],
  };

  const toggleSound = () => {
    const next = !soundMuted();
    setSoundMuted(next);
    setAlertsMuted(next);
  };

  const playTrail = () => setTrailCursor(alertTrail().length - 1);
  const stopTrail = () => setTrailCursor(null);

  const store: NiftyReportStore = {
    selection: {
      symbol,
      index,
      mode,
      expiry,
      expiryOptions,
      date,
      historyDates,
      expiryData,
      hasRecordedHistory,
      contextKey,
      setSymbol,
      setIndex,
      setMode,
      setExpiry,
      setDate,
      setExpiryOptions,
      setHistoryDates,
      setBooted,
      handleIndexChange,
      handleSymbolChange,
      handleModeChange,
      handleExpiryChange,
    },
    data: {
      report,
      sensex,
      sensexLoading,
      sensexError,
      tape,
      bursts,
      streamedBursts: streamed,
      paperPositions,
      pnlPositions,
      loading,
      error,
      booted,
      snapshotting,
      freshness: {
        updatedAtMs,
        nowMs,
        wsConnected,
        wsDownSinceMs,
        wsDownForMs,
        marketClosed,
        isStale,
        staleMins,
        nextUpdateAtMs: () => null,
        touchNow,
      },
      metrics,
      visibleStrikes,
      atmStrike,
      oiScale,
      oiWalls,
      tapeRows,
      derivedFlow,
      flowReport,
      pressure,
      setup,
      preMove,
      preMoveHistory,
      scorePoints,
      oiPoints,
      breadth,
      intradayStart,
      tapeSpeed,
      flowSeries,
      sessionContext,
      effectiveBursts,
      burstMap,
      lastFlip,
      currentFlip,
      flipAt: () => lastFlip()?.at ?? null,
      refresh,
      snapshot,
      refreshPaperPositions,
      pushStreamedBurst,
    },
    replay: {
      replay,
      index: replayIndex,
      playing: replayPlaying,
      frameT: replayFrameT,
      frameLabel: replayFrameLabel,
      coverage: replayCoverage,
      reasons: replayReasons,
      holes: replayHoles,
      setIndex: setReplayIndex,
      setPlaying: setReplayPlaying,
      scrub: scrubReplay,
      togglePlay: toggleReplayPlay,
      breakAt: breakReplayAt,
    },
    walls: {
      data: wallsData,
      syncing: wallsSyncing,
      history: wallHistory,
      open: wallsOpen,
      setOpen: setWallsOpen,
      openDrawer: openWalls,
      closeDrawer: closeWalls,
    },
    alerts: {
      trail: alertTrail,
      toasts: alertToasts,
      banners: alertBanners,
      dismissToast: (id) => oiAlertsHandle()?.dismissToast(id),
      dismissBanner: (id) => oiAlertsHandle()?.dismissBanner(id),
      clearTrail: () => oiAlertsHandle()?.clearTrail(),
      pushToast: (alert) => oiAlertsHandle()?.pushToast(alert),
      criticalOnly,
      toggleCriticalOnly,
      criticalCount,
      burstById,
      displayedTrail,
      visibleBanners,
      bannerOverflow,
      soundMuted,
      toggleSound,
      preMoveAlert,
      clearPreMoveAlert: () => setPreMoveAlert(null),
      blast: () => blastsHandle()?.blast() ?? null,
      dismissBlast: () => blastsHandle()?.dismiss(),
      sessionKey: alertsSessionKey,
      trailCursor,
      playTrail,
      stopTrail,
      setTrailCursor,
    },
    ui: {
      view,
      setView,
      handleViewChange,
      deskMode,
      isDesk,
      toggleDeskMode,
      handleDeskChange,
      sideTab,
      setSideTab,
      chartTf,
      setChartTf,
      handleChartTf,
      chartSize,
      setChartSize,
      handleChartSize,
      expandRange,
      setExpandRange,
      heatMetric,
      setHeatMetric,
      detailOpen,
      toggleDetail,
      overlayOpen: (key) => overlayAccessors[key][0](),
      setOverlayOpen: (key, next) => overlayAccessors[key][1](next),
      wallsOpen,
      setWallsOpen,
      deskOpen,
      setDeskOpen,
      moversOpen,
      setMoversOpen,
      planOpen,
      setPlanOpen,
      chartFull,
      setChartFull,
      ivOpen,
      setIvOpen,
      gexOpen,
      setGexOpen,
      gammaOpen,
      setGammaOpen,
      visualsOpen,
      setVisualsOpen,
      oiExpand,
      setOiExpand,
      heatExpand,
      setHeatExpand,
      flowExpand,
      setFlowExpand,
      pressureExpand,
      setPressureExpand,
      flowChartExpand,
      setFlowChartExpand,
      deskDockTab,
      setDeskDockTab,
      openPlanReasons,
      openAlertsDock,
      openChartFull,
      openVisuals,
      openMovers,
      closeMovers,
      openOiExpand,
      openSymbol,
      closeTopModal,
    },
  };

  const start = () => {
    if (started) return;
    started = true;

    setWallsHandle(
      useReplayWalls({
        enabled: () =>
          mode() === "live" ? Boolean(report()) : Boolean(replay()),
        symbol,
        date: () => (mode() === "eod" ? date() || undefined : undefined),
        at: () => {
          const current = replay();
          return mode() === "eod" && current ? current.snapshots[replayIndex()]?.t : undefined;
        },
        includeMap: wallsOpen,
        live: mode() === "live",
        liveTick: () => (mode() === "live" ? report() : null),
        throttleMs: mode() === "live" ? 4_000 : 150,
      }),
    );

    setOiAlertsHandle(
      useNiftyOiAlerts(
        effectiveBursts,
        () => report()?.strikes ?? [],
        () => report()?.spot ?? 0,
        () => tape() != null,
        () => mode() === "live",
        alertsSessionKey,
      ),
    );

    setBlastsHandle(
      useNiftyBlasts(() => booted() && mode() === "live" && symbol() === "NIFTY"),
    );

    useDeskHotkeys({
      onToggleDesk: toggleDeskMode,
      onChartFullscreen: openChartFull,
      onExpandHovered: openPlanReasons,
      onVisualsGrid: openVisuals,
      onClose: closeTopModal,
      onTimeframe: handleChartTf,
    });

    usePolling(
      () => {
        if (!autoEod) return;
        if (!isDerivativesOpenIst() || holidayToday) return;
        autoEod = false;
        setMode("live");
        setDate("");
      },
      SESSION_CLOSE_POLL_MS,
      { skipIfRunning: false },
    );

    createEffect(() => {
      persist(SIDE_TAB_KEY, sideTab());
    });

    createEffect(() => {
      persist(NIFTY_DESK_MODE_KEY, deskMode());
    });

    let positionsBooted = false;
    createEffect(() => {
      if (positionsBooted) return;
      positionsBooted = true;
      let alive = true;
      fetchPositions()
        .then((list) => {
          if (alive) setPaperPositions(list ?? []);
        })
        .catch(() => {
          if (alive) setPaperPositions((previous) => previous ?? []);
        });
      onCleanup(() => {
        alive = false;
      });
    });

    createEffect(() => {
      const board = wallsData();
      const context = `${symbol()}|${expiry()}|${mode()}|${date()}`;
      const next = nextWallMoveState(
        wallMoveState,
        context,
        board?.calls?.[0]?.strike ?? null,
        board?.puts?.[0]?.strike ?? null,
        mode() === "live",
      );
      wallMoveState = next.state;
      for (const move of next.moves) flashAlertTitle(wallMoveTitle(move));
    });

    let bootstrapDone = false;
    createEffect(() => {
      if (bootstrapDone) return;
      bootstrapDone = true;
      let alive = true;
      void (async () => {
        try {
          const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
          const [rawDates, holiday] = await Promise.all([
            fetchNiftyReplayDates(),
            fetchHolidayCheck(today).catch(() => null),
          ]);
          const dates = Array.isArray(rawDates) ? rawDates : [];
          const isHoliday = Boolean(holiday?.is_holiday);
          holidayToday = isHoliday;
          if (alive && (isHoliday || !isDerivativesOpenIst()) && dates.length > 0) {
            autoEod = true;
            wasOpenAtMount = false;
            batch(() => {
              setMode("eod");
              setDate(dates[0]);
            });
          }
        } catch {
          return;
        } finally {
          if (alive) setBooted(true);
        }
      })();
      onCleanup(() => {
        alive = false;
      });
    });

    createEffect(() => {
      const activeSymbol = symbol();
      if (!wasOpenAtMount) return;
      const controller = new AbortController();
      const id = window.setInterval(() => {
        if (isDerivativesOpenIst()) return;
        wasOpenAtMount = false;
        void replayDatesFor(activeSymbol, controller.signal).then((dates) => {
          if (dates.length > 0) {
            autoEod = true;
            batch(() => {
              setMode("eod");
              setDate(dates[0]);
            });
          }
        });
      }, SESSION_CLOSE_POLL_MS);
      onCleanup(() => {
        window.clearInterval(id);
        controller.abort();
      });
    });

    createEffect(() => {
      const activeSymbol = symbol();
      if (activeSymbol === "NIFTY" || mode() !== "live") return;
      const dates = historyDates();
      if (dates.length === 0) return;
      if (isDerivativesOpenIst() && !holidayToday) return;
      if (genericAutoEod.has(activeSymbol)) return;
      genericAutoEod.add(activeSymbol);
      autoEod = true;
      batch(() => {
        setMode("eod");
        setDate(dates[0]);
      });
    });

    createEffect(() => {
      const activeSymbol = symbol();
      const activeMode = mode();
      const activeExpiry = expiry();
      const isBooted = booted();
      if (activeSymbol === "NIFTY" || activeMode !== "live" || !isBooted) return;
      let alive = true;
      let pollTimer: number | null = null;
      const runPoll = async () => {
        if (!alive) return;
        const currentRequestId = requestId + 1;
        requestId = currentRequestId;
        const controller = new AbortController();
        requestController = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          loadingInFlight = true;
          setLoading(true);
          setError(null);
          const [optionsReport, tapeData, burstData] = await Promise.all([
            fetchOptionsLive(
              activeSymbol,
              activeExpiry === "nearest" ? undefined : activeExpiry,
              controller.signal,
            ),
            fetchOptionsTape(activeSymbol, undefined, controller.signal),
            fetchOptionsBursts(activeSymbol, undefined, controller.signal),
          ]);
          if (!alive || currentRequestId !== requestId || controller.signal.aborted) return;
          if (!optionsReport) {
            throw new Error(`No ${activeSymbol} option-chain report available.`);
          }
          baseIntraday = optionsReport.intraday ?? [];
          baseCandles = optionsReport.candles ?? [];
          setReport(optionsReport);
          if (tapeData) setTape(tapeData);
          setBursts(burstData as OiBurst[]);
          setSensex(null);
          setSensexError(null);
          setSensexLoading(false);
          markUpdated();
        } catch (pollError) {
          if (!alive || currentRequestId !== requestId || controller.signal.aborted) return;
          setNowMs(Date.now());
          const message = messageOf(pollError, `Failed to load ${activeSymbol} report`);
          if (isAuthFailure(message)) {
            try {
              const dates = await fetchOptionsReplayDates(activeSymbol, controller.signal);
              if (dates.length > 0) {
                autoEod = true;
                wasOpenAtMount = false;
                batch(() => {
                  setMode("eod");
                  setDate(dates[0]);
                });
                setError(null);
                return;
              }
            } catch {
              setError(message);
              return;
            }
          }
          setError(message);
        } finally {
          window.clearTimeout(timeoutId);
          if (currentRequestId === requestId) {
            requestController = null;
            loadingInFlight = false;
            setLoading(false);
          }
        }
        if (alive) pollTimer = window.setTimeout(runPoll, GENERIC_POLL_MS);
      };
      pollTimer = window.setTimeout(runPoll, GENERIC_POLL_MS);
      onCleanup(() => {
        alive = false;
        if (pollTimer) window.clearTimeout(pollTimer);
        requestController?.abort();
        requestController = null;
        loadingInFlight = false;
        setLoading(false);
      });
    });

    createEffect(() => {
      const activeSymbol = symbol();
      let active = true;
      const controller = new AbortController();
      setExpiryOptions([]);
      const request =
        activeSymbol === "NIFTY"
          ? fetchNiftyExpiries(controller.signal).then((list) => list.map((entry) => entry.date))
          : fetchOptionsExpiries(activeSymbol, controller.signal);
      request
        .then((list) => {
          if (active) setExpiryOptions(list);
        })
        .catch(() => undefined);
      onCleanup(() => {
        active = false;
        controller.abort();
      });
    });

    createEffect(() => {
      const activeSymbol = symbol();
      if (activeSymbol === "NIFTY") {
        setHistoryDates([]);
        return;
      }
      let alive = true;
      const controller = new AbortController();
      void fetchOptionsReplayDates(activeSymbol, controller.signal)
        .then((dates) => {
          if (alive) setHistoryDates(dates);
        })
        .catch(() => undefined);
      onCleanup(() => {
        alive = false;
        controller.abort();
      });
    });

    createEffect(() => {
      const key = contextKey();
      if (prevContext === key) return;
      prevContext = key;
      resetContext();
    });

    const loadKey = createMemo(
      () => `${symbol()}|${mode()}|${expiry()}|${date()}|${booted()}`,
    );

    createEffect(() => {
      loadKey();
      if (!booted()) return;
      const activeMode = mode();
      if (activeMode === "live" || (activeMode === "eod" && date())) {
        void load();
      }
    });

    createEffect(() => {
      const active = booted() && mode() === "live" && symbol() === "NIFTY";
      const expiryArg = expiry() === "nearest" ? undefined : expiry();
      if (!active) {
        setStreamHandle(null);
        return;
      }
      const disposeStream = createRoot((disposeRoot) => {
        setStreamHandle(useNiftyReportStream({ expiry: expiryArg, enabled: true }));
        return disposeRoot;
      });
      onCleanup(() => {
        disposeStream();
        setStreamHandle(null);
      });
    });

    createEffect(() => {
      const pushed = streamHandle()?.report() ?? null;
      if (symbol() !== "NIFTY") return;
      if (!pushed) return;
      setReport(pushed);
      setUpdatedAtMs(Date.now());
    });

    createEffect(() => {
      const pushed = streamHandle()?.tape() ?? null;
      if (symbol() !== "NIFTY") return;
      if (!pushed) return;
      setTape(pushed);
      setUpdatedAtMs(Date.now());
    });

    createEffect(() => {
      const pushed = streamHandle()?.sensex() ?? null;
      if (symbol() !== "NIFTY") return;
      if (!pushed) return;
      setSensex(pushed);
      setSensexError(null);
      setUpdatedAtMs(Date.now());
    });

    useNiftyBurstStream(
      (burst) => pushStreamedBurst(burst),
      () => booted() && mode() === "live" && symbol() === "NIFTY",
    );

    createEffect(() => {
      const connected = wsConnected();
      if (mode() !== "live" || marketClosed() || connected) {
        setWsDownSinceMs(null);
        return;
      }
      setWsDownSinceMs((previous) => previous ?? Date.now());
    });

    createEffect(() => {
      const connected = wsConnected();
      const since = wsDownSinceMs();
      if (mode() !== "live" || marketClosed() || connected || since === null) return;
      const remaining = since + STALE_AFTER_MS - Date.now();
      if (remaining <= 0) {
        touchNow();
        return;
      }
      const id = setTimeout(() => touchNow(), remaining + 250);
      onCleanup(() => clearTimeout(id));
    });

    createEffect(() => {
      const onVisibility = () => touchNow();
      document.addEventListener("visibilitychange", onVisibility);
      onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));
    });

    createEffect(() => {
      const activeMode = mode();
      const activeDate = date();
      const current = replay();
      const at = replayIndex();
      if (activeMode !== "eod" || !activeDate || !current) return;
      const frame = current.snapshots[at];
      if (!frame || !frame.t) return;
      const nextFrame = current.snapshots[at + 1];
      if (frame.report !== REPLAY_STUB_REPORT) {
        pendingScrub = { report: withBaseCandles(frame.report), sensex: frame.sensex };
        if (scrubRaf !== null) return;
        scrubRaf = window.requestAnimationFrame(() => {
          scrubRaf = null;
          const queued = pendingScrub;
          pendingScrub = null;
          if (!queued) return;
          applyReplayFrame(queued.report, queued.sensex);
        });
        return;
      }
      const cached = replayFrameCache.get(frame.t);
      if (cached) {
        applyReplayFrame(cached, null);
        prefetchNextReplayFrame(activeDate, nextFrame);
        return;
      }
      const frameRequestId = ++replayFrameReq;
      void loadReplayFrame(activeDate, frame.t).then((loaded) => {
        if (frameRequestId !== replayFrameReq || !loaded) return;
        applyReplayFrame(loaded.report, loaded.sensex);
        prefetchNextReplayFrame(activeDate, nextFrame);
      });
    });

    createEffect(() => {
      if (mode() !== "live") return;
      let alive = true;
      let lastLoadAt = 0;
      const controller = new AbortController();
      const run = () => {
        if (document.hidden) return;
        const now = Date.now();
        if (now - lastLoadAt < BREADTH_FOCUS_GUARD_MS) return;
        lastLoadAt = now;
        fetchBreadth(controller.signal)
          .then((payload) => {
            if (alive) setBreadth(payload);
          })
          .catch(() => undefined);
      };
      run();
      const id = window.setInterval(run, BREADTH_POLL_MS);
      const onVisibility = () => {
        if (!document.hidden) run();
      };
      document.addEventListener("visibilitychange", onVisibility);
      onCleanup(() => {
        alive = false;
        window.clearInterval(id);
        controller.abort();
        document.removeEventListener("visibilitychange", onVisibility);
      });
    });

    createEffect(() => {
      if (!booted()) return;
      const activeMode = mode();
      const activeDate = date();
      const activeSymbol = symbol();
      let alive = true;
      let lastLoadAt = 0;
      const controller = new AbortController();
      const run = () => {
        if (!alive) return;
        if (activeMode === "live" && document.hidden) return;
        const now = Date.now();
        if (activeMode === "live" && now - lastLoadAt < CHAIN10S_FOCUS_GUARD_MS) return;
        lastLoadAt = now;
        const limit = activeMode === "eod" ? EOD_CHAIN10S_LIMIT : LIVE_CHAIN10S_LIMIT;
        const dateKey = activeMode === "eod" ? activeDate || undefined : undefined;
        const request =
          activeSymbol === "NIFTY"
            ? fetchChain10sSummary(dateKey, limit, controller.signal)
            : fetchOptionsChain10s(activeSymbol, dateKey, limit, controller.signal);
        request
          .then((rows: Chain10sSummaryPoint[]) => {
            if (!alive || !rows.length) return;
            setOiPoints(
              rows.map((row) => ({
                t: row.t,
                ce: row.ce_oi,
                pe: row.pe_oi,
                spot: row.spot ?? null,
                cePrem: row.ce_prem ?? null,
                pePrem: row.pe_prem ?? null,
              })),
            );
          })
          .catch(() => undefined);
      };
      run();
      if (activeMode === "eod") {
        onCleanup(() => {
          alive = false;
          controller.abort();
        });
        return;
      }
      const id = window.setInterval(run, CHAIN10S_POLL_MS);
      const onVisibility = () => {
        if (!document.hidden) run();
      };
      document.addEventListener("visibilitychange", onVisibility);
      onCleanup(() => {
        alive = false;
        window.clearInterval(id);
        controller.abort();
        document.removeEventListener("visibilitychange", onVisibility);
      });
    });

    createEffect(() => {
      const activeSymbol = symbol();
      if (activeSymbol === "NIFTY" || mode() !== "live") return;
      let alive = true;
      const controller = new AbortController();
      const id = window.setInterval(() => {
        void fetchOptionsBursts(activeSymbol, undefined, controller.signal).then((rows) => {
          if (alive && rows.length > 0) setBursts(rows as OiBurst[]);
        });
      }, GENERIC_BURST_POLL_MS);
      onCleanup(() => {
        alive = false;
        window.clearInterval(id);
        controller.abort();
      });
    });

    createEffect(() => {
      const current = report();
      if (mode() !== "live" || !current) return;
      const at = Date.now();
      const board = resolveWallBoard(current.wallsNear, current.walls);
      if (!board) return;
      const snapshots: WallSnapshot[] = [
        ...(board.calls ?? []).map((wall) => ({
          t: at,
          side: "ce" as const,
          strike: wall.strike,
          oi: wall.oi,
        })),
        ...(board.puts ?? []).map((wall) => ({
          t: at,
          side: "pe" as const,
          strike: wall.strike,
          oi: wall.oi,
        })),
      ];
      setWallHistory((history) =>
        [
          ...history.filter((snapshot) => at - snapshot.t < WALL_HISTORY_WINDOW_MS),
          ...snapshots,
        ].slice(-WALL_HISTORY_MAX),
      );
    });

    createEffect(() => {
      const score = preMove();
      if (mode() !== "live") return;
      if (score.state !== "armed") {
        armedStreak = 0;
        return;
      }
      armedStreak += 1;
      if (armedStreak !== 2) return;
      if (Date.now() - lastPreMoveAlertAt < PREMOVE_ALERT_COOLDOWN_MS) return;
      lastPreMoveAlertAt = Date.now();
      setPreMoveAlert(score);
      if (!alertsMuted()) {
        playAlertSound("alert");
        flashAlertTitle(
          `SETUP ARMING ${score.score}/${score.max} — ${score.reasons.slice(0, 3).join(" · ")}`,
        );
      }
    });

    createEffect(() => {
      if (mode() !== "live") return;
      const points = oiPoints();
      const last = points[points.length - 1];
      if (!last) return;
      const at = Date.parse(last.t);
      if (!Number.isFinite(at)) return;
      const score = preMove();
      setLivePreMoveHistory((history) => {
        if (history.length === 0 && points.length >= 12) return seedPreMoveHistory(points);
        return appendPreMove(history, {
          t: at,
          score: score.score,
          spot: last.spot ?? null,
          comps: score.components
            .filter((component) => component.points > 0)
            .map((component) => component.key),
        });
      });
    });

    createEffect(() => {
      if (!preMoveAlert()) return;
      const id = window.setTimeout(() => setPreMoveAlert(null), PREMOVE_ALERT_TTL_MS);
      onCleanup(() => window.clearTimeout(id));
    });

    createEffect(() => {
      const key = flipStorageKeyNow();
      flipWatch = null;
      setLastFlip(loadStoredFlip(key));
    });

    createEffect(() => {
      const flow = derivedFlow();
      if (!flow) return;
      const at = flow.as_of || new Date().toISOString();
      const next = detectFlipChange(
        flipWatch,
        flow["5m"],
        flow["15m"],
        sessionTone(report()?.control?.verdict),
        at,
      );
      flipWatch = next.state;
      if (next.flip) {
        setLastFlip(next.flip);
        saveStoredFlip(flipStorageKeyNow(), next.flip);
      }
    });

    createEffect(() => {
      const cursor = trailCursor();
      if (cursor === null) return;
      if (cursor < 0) {
        setTrailCursor(null);
        return;
      }
      const id = setTimeout(() => {
        const alert = alertTrail()[cursor];
        if (alert) oiAlertsHandle()?.pushToast(alert);
        setTrailCursor(cursor - 1);
      }, ALERTS_TRAIL_WALK_MS);
      onCleanup(() => clearTimeout(id));
    });

    createEffect(() => {
      const playing = replayPlaying();
      const current = replay();
      const at = replayIndex();
      if (!playing || !current) return;
      if (at >= current.snapshots.length - 1) {
        setReplayPlaying(false);
        return;
      }
      const next = at + 1;
      const id = window.setInterval(() => {
        const frame = current.snapshots[next];
        if (!frame) {
          setReplayPlaying(false);
          return;
        }
        setReplayIndex(next);
        if (frame.report !== REPLAY_STUB_REPORT) {
          applyReplayFrame(frame.report, frame.sensex ?? null);
        }
      }, REPLAY_PLAY_MS);
      onCleanup(() => window.clearInterval(id));
    });

    onCleanup(() => {
      requestId += 1;
      requestController?.abort();
      sensexController?.abort();
      requestController = null;
      sensexController = null;
      if (scrubRaf !== null) {
        window.cancelAnimationFrame(scrubRaf);
        scrubRaf = null;
      }
      pendingScrub = null;
      cancelReplayPrefetch();
      replayFrameInflight.clear();
    });
  };

  return { store, start };
}

const storeStarters = new WeakMap<NiftyReportStore, () => void>();

export function createNiftyReportStore(options: NiftyReportStoreOptions = {}): NiftyReportStore {
  const built = buildNiftyReportStore(options);
  storeStarters.set(built.store, built.start);
  return built.store;
}

export function startNiftyReportEffects(store: NiftyReportStore): void {
  const start = storeStarters.get(store);
  if (!start) {
    throw new Error(
      "startNiftyReportEffects requires a store created by createNiftyReportStore",
    );
  }
  start();
}
