import { createSignal } from "solid-js";

import type { BreadthPayload } from "@/api/reportNifty";
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
import { alertsMuted } from "./alertSound";
import { parseIstTimestampMs } from "./niftyDataFreshness";
import type { FlipWatchState, FlowLastFlip, OiPoint } from "./niftyFlowRead";
import type { OiBurst } from "./niftyOiBursts";
import type { PreMovePoint } from "./niftyPreMoveHistory";
import type { PreMoveScore } from "./niftyPreMove";
import { createWallMoveState } from "./niftyWallMoves";
import type { WallMoveState } from "./niftyWallMoves";
import type { useReplayWalls } from "./useReplayWalls";
import type { useNiftyOiAlerts } from "./useNiftyOiAlerts";
import type { WallSnapshot } from "./NiftySqueezeRadar";
import type { ChartSize, ChartTimeframe } from "./NiftyChartPanel";
import type { DeskDockKey } from "./DeskDock";
import type { TapeRange } from "./tapeRange";
import { readStoredEnum } from "./niftyReportStore.helpers";
import {
  NIFTY_DESK_MODE_KEY,
  SIDE_TAB_KEY,
  STREAMED_BURST_MAX,
} from "./niftyReportStore.types";
import type {
  BlastHandle,
  ChartView,
  DeskMode,
  HeatMetric,
  NiftyReportStoreOptions,
  ReportIndex,
  ReportStreamHandle,
  ReportSymbol,
  SideTab,
} from "./niftyReportStore.types";

export function createStoreState(options: NiftyReportStoreOptions) {
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
  const [wallsHandle, setWallsHandle] = createSignal<ReturnType<typeof useReplayWalls> | null>(
    null,
  );
  const [oiAlertsHandle, setOiAlertsHandle] = createSignal<ReturnType<typeof useNiftyOiAlerts> | null>(
    null,
  );
  const [blastsHandle, setBlastsHandle] = createSignal<BlastHandle | null>(null);

  const mut = {
    // The live→EOD fallback is deliberate, but it must not be silent. Show one
    // actionable toast per failed live attempt, not one per polling retry.
    wasOpenAtMount: isDerivativesOpenIst(),
    holidayToday: false,
    autoEod: false,
    liveAuthToastShown: false,
    genericAutoEod: new Set<string>(),
    loadingInFlight: false,
    requestId: 0,
    requestController: null as AbortController | null,
    sensexController: null as AbortController | null,
    wallMoveState: createWallMoveState(),
    baseIntraday: [] as NonNullable<NiftyReport["intraday"]>,
    baseCandles: [] as NonNullable<NiftyReport["candles"]>,
    scrubRaf: null as number | null,
    replayFrameCache: new Map<string, NiftyReport>(),
    replayFrameInflight: new Map<string, Promise<NiftyReplayFrame | null>>(),
    replayPrefetchCancel: null as (() => void) | null,
    replayFrameReq: 0,
    pendingScrub: null as { report: NiftyReport; sensex: NiftySensex | null } | null,
    prevContext: "live:nearest",
    flipWatch: null as FlipWatchState | null,
    armedStreak: 0,
    lastPreMoveAlertAt: 0,
    started: false,
  };

  const touchNow = () => setNowMs(Date.now());

  const markUpdated = (source?: { as_of?: string | null; fetched_at?: string | null }) => {
    /*
     * "Updated" means data-through, not fetch time. Using `Date.now()` here
     * labelled a payload as current the instant it arrived, so a feed that had
     * stopped three hours ago still read "Updated <now>". The payload carries
     * its own stamps; fall back to the wall clock only when neither exists.
     */
    const dataMs =
      parseIstTimestampMs(source?.as_of ?? null) ??
      parseIstTimestampMs(source?.fetched_at ?? null);
    const now = Date.now();
    setUpdatedAtMs(dataMs ?? now);
    setNowMs(now);
  };

  const pushStreamedBurst = (burst: NiftyBurst) => {
    setStreamed((previous) =>
      previous.some((existing) => existing.id === burst.id)
        ? previous
        : [...previous, burst].slice(-STREAMED_BURST_MAX),
    );
  };

  const withBaseCandles = (next: NiftyReport): NiftyReport => {
    const hasIntraday = (next.intraday?.length ?? 0) > 0;
    const hasCandles = (next.candles?.length ?? 0) > 0;
    if (hasIntraday || hasCandles) return next;
    if (mut.baseIntraday.length === 0 && mut.baseCandles.length === 0) return next;
    return {
      ...next,
      ...(mut.baseIntraday.length > 0 ? { intraday: mut.baseIntraday } : {}),
      ...(mut.baseCandles.length > 0 ? { candles: mut.baseCandles } : {}),
    };
  };

  return {
    options,
    symbol,
    setSymbol,
    index,
    setIndex,
    mode,
    setMode,
    expiry,
    setExpiry,
    expiryOptions,
    setExpiryOptions,
    date,
    setDate,
    historyDates,
    setHistoryDates,
    booted,
    setBooted,
    report,
    setReport,
    sensex,
    setSensex,
    sensexLoading,
    setSensexLoading,
    sensexError,
    setSensexError,
    tape,
    setTape,
    bursts,
    setBursts,
    streamed,
    setStreamed,
    paperPositions,
    setPaperPositions,
    loading,
    setLoading,
    error,
    setError,
    snapshotting,
    setSnapshotting,
    updatedAtMs,
    setUpdatedAtMs,
    nowMs,
    setNowMs,
    wsDownSinceMs,
    setWsDownSinceMs,
    replay,
    setReplay,
    replayIndex,
    setReplayIndex,
    replayPlaying,
    setReplayPlaying,
    oiPoints,
    setOiPoints,
    breadth,
    setBreadth,
    preMoveAlert,
    setPreMoveAlert,
    livePreMoveHistory,
    setLivePreMoveHistory,
    wallHistory,
    setWallHistory,
    lastFlip,
    setLastFlip,
    trailCursor,
    setTrailCursor,
    view,
    setView,
    deskMode,
    setDeskModeValue,
    sideTab,
    setSideTabValue,
    chartTf,
    setChartTf,
    chartSize,
    setChartSize,
    expandRange,
    setExpandRange,
    heatMetric,
    setHeatMetric,
    detailOpen,
    setDetailOpen,
    deskDockTab,
    setDeskDockTab,
    planOpen,
    setPlanOpen,
    moversOpen,
    setMoversOpen,
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
    wallsOpen,
    setWallsOpen,
    deskOpen,
    setDeskOpen,
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
    criticalOnly,
    setCriticalOnly,
    soundMuted,
    setSoundMuted,
    streamHandle,
    setStreamHandle,
    wallsHandle,
    setWallsHandle,
    oiAlertsHandle,
    setOiAlertsHandle,
    blastsHandle,
    setBlastsHandle,
    mut,
    touchNow,
    markUpdated,
    pushStreamedBurst,
    withBaseCandles,
  };
}

export type StoreState = ReturnType<typeof createStoreState>;
