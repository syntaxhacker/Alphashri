import { createStoreState } from "./niftyReportStore.state";
import type { StoreState } from "./niftyReportStore.state";
import { createDerived } from "./niftyReportStore.derived";
import type { StoreDerived } from "./niftyReportStore.derived";
import { createReportHandlers } from "./niftyReportStore.reportHandlers";
import type { ReportHandlers } from "./niftyReportStore.reportHandlers";
import { createUiHandlers } from "./niftyReportStore.uiHandlers";
import type { UiHandlers } from "./niftyReportStore.uiHandlers";
import { createEffectsCore } from "./niftyReportStore.effectsCore";
import { createEffectsReplay } from "./niftyReportStore.effectsReplay";
import type {
  NiftyReportStore,
  NiftyReportStoreOptions,
} from "./niftyReportStore.types";

function buildStoreObject(
  s: StoreState,
  d: StoreDerived,
  rh: ReportHandlers,
  uh: UiHandlers,
): NiftyReportStore {
  const store: NiftyReportStore = {
    selection: {
      symbol: s.symbol,
      index: s.index,
      mode: s.mode,
      expiry: s.expiry,
      expiryOptions: s.expiryOptions,
      date: s.date,
      historyDates: s.historyDates,
      expiryData: d.expiryData,
      hasRecordedHistory: d.hasRecordedHistory,
      contextKey: d.contextKey,
      setSymbol: s.setSymbol,
      setIndex: s.setIndex,
      setMode: s.setMode,
      setExpiry: s.setExpiry,
      setDate: s.setDate,
      setExpiryOptions: s.setExpiryOptions,
      setHistoryDates: s.setHistoryDates,
      setBooted: s.setBooted,
      handleIndexChange: uh.handleIndexChange,
      handleSymbolChange: uh.handleSymbolChange,
      handleModeChange: uh.handleModeChange,
      handleExpiryChange: uh.handleExpiryChange,
    },
    data: {
      report: s.report,
      sensex: s.sensex,
      sensexLoading: s.sensexLoading,
      sensexError: s.sensexError,
      tape: s.tape,
      bursts: s.bursts,
      streamedBursts: s.streamed,
      paperPositions: s.paperPositions,
      pnlPositions: d.pnlPositions,
      loading: s.loading,
      error: s.error,
      booted: s.booted,
      snapshotting: s.snapshotting,
      freshness: {
        updatedAtMs: s.updatedAtMs,
        nowMs: s.nowMs,
        wsConnected: d.wsConnected,
        wsDownSinceMs: s.wsDownSinceMs,
        wsDownForMs: d.wsDownForMs,
        marketClosed: d.marketClosed,
        isStale: d.isStale,
        staleMins: d.staleMins,
        nextUpdateAtMs: () => null,
        touchNow: s.touchNow,
      },
      metrics: d.metrics,
      visibleStrikes: d.visibleStrikes,
      atmStrike: d.atmStrike,
      oiScale: d.oiScale,
      oiWalls: d.oiWalls,
      tapeRows: d.tapeRows,
      derivedFlow: d.derivedFlow,
      flowReport: d.flowReport,
      pressure: d.pressure,
      setup: d.setup,
      preMove: d.preMove,
      preMoveHistory: d.preMoveHistory,
      scorePoints: d.scorePoints,
      oiPoints: s.oiPoints,
      breadth: s.breadth,
      intradayStart: d.intradayStart,
      tapeSpeed: d.tapeSpeed,
      sessionContext: d.sessionContext,
      effectiveBursts: d.effectiveBursts,
      burstMap: d.burstMap,
      lastFlip: s.lastFlip,
      flipAt: () => s.lastFlip()?.at ?? null,
      refresh: rh.refresh,
      snapshot: rh.snapshot,
      refreshPaperPositions: rh.refreshPaperPositions,
      pushStreamedBurst: s.pushStreamedBurst,
    },
    replay: {
      replay: s.replay,
      index: s.replayIndex,
      playing: s.replayPlaying,
      frameT: d.replayFrameT,
      frameLabel: d.replayFrameLabel,
      coverage: d.replayCoverage,
      reasons: d.replayReasons,
      holes: d.replayHoles,
      setIndex: s.setReplayIndex,
      setPlaying: s.setReplayPlaying,
      scrub: rh.scrubReplay,
      togglePlay: rh.toggleReplayPlay,
      breakAt: rh.breakReplayAt,
    },
    walls: {
      data: d.wallsData,
      syncing: d.wallsSyncing,
      history: s.wallHistory,
      open: s.wallsOpen,
      setOpen: s.setWallsOpen,
      openDrawer: uh.openWalls,
      closeDrawer: uh.closeWalls,
    },
    alerts: {
      trail: d.alertTrail,
      toasts: d.alertToasts,
      banners: d.alertBanners,
      dismissToast: (id) => s.oiAlertsHandle()?.dismissToast(id),
      dismissBanner: (id) => s.oiAlertsHandle()?.dismissBanner(id),
      clearTrail: () => s.oiAlertsHandle()?.clearTrail(),
      pushToast: (alert) => s.oiAlertsHandle()?.pushToast(alert),
      criticalOnly: s.criticalOnly,
      toggleCriticalOnly: uh.toggleCriticalOnly,
      criticalCount: d.criticalCount,
      displayedTrail: d.displayedTrail,
      visibleBanners: d.visibleBanners,
      bannerOverflow: d.bannerOverflow,
      soundMuted: s.soundMuted,
      toggleSound: uh.toggleSound,
      preMoveAlert: s.preMoveAlert,
      clearPreMoveAlert: () => s.setPreMoveAlert(null),
      blast: () => s.blastsHandle()?.blast() ?? null,
      dismissBlast: () => s.blastsHandle()?.dismiss(),
      sessionKey: d.alertsSessionKey,
      trailCursor: s.trailCursor,
      playTrail: uh.playTrail,
      stopTrail: uh.stopTrail,
      setTrailCursor: s.setTrailCursor,
    },
    ui: {
      view: s.view,
      setView: s.setView,
      handleViewChange: uh.handleViewChange,
      deskMode: s.deskMode,
      isDesk: d.isDesk,
      toggleDeskMode: uh.toggleDeskMode,
      handleDeskChange: uh.handleDeskChange,
      sideTab: s.sideTab,
      setSideTab: uh.setSideTab,
      chartTf: s.chartTf,
      setChartTf: s.setChartTf,
      handleChartTf: uh.handleChartTf,
      chartSize: s.chartSize,
      setChartSize: s.setChartSize,
      handleChartSize: uh.handleChartSize,
      expandRange: s.expandRange,
      setExpandRange: s.setExpandRange,
      heatMetric: s.heatMetric,
      setHeatMetric: s.setHeatMetric,
      detailOpen: s.detailOpen,
      toggleDetail: uh.toggleDetail,
      overlayOpen: (key) => uh.overlayAccessors[key][0](),
      setOverlayOpen: (key, next) => uh.overlayAccessors[key][1](next),
      wallsOpen: s.wallsOpen,
      setWallsOpen: s.setWallsOpen,
      deskOpen: s.deskOpen,
      setDeskOpen: s.setDeskOpen,
      moversOpen: s.moversOpen,
      setMoversOpen: s.setMoversOpen,
      planOpen: s.planOpen,
      setPlanOpen: s.setPlanOpen,
      chartFull: s.chartFull,
      setChartFull: s.setChartFull,
      ivOpen: s.ivOpen,
      setIvOpen: s.setIvOpen,
      gexOpen: s.gexOpen,
      setGexOpen: s.setGexOpen,
      gammaOpen: s.gammaOpen,
      setGammaOpen: s.setGammaOpen,
      visualsOpen: s.visualsOpen,
      setVisualsOpen: s.setVisualsOpen,
      oiExpand: s.oiExpand,
      setOiExpand: s.setOiExpand,
      heatExpand: s.heatExpand,
      setHeatExpand: s.setHeatExpand,
      flowExpand: s.flowExpand,
      setFlowExpand: s.setFlowExpand,
      pressureExpand: s.pressureExpand,
      setPressureExpand: s.setPressureExpand,
      flowChartExpand: s.flowChartExpand,
      setFlowChartExpand: s.setFlowChartExpand,
      deskDockTab: s.deskDockTab,
      setDeskDockTab: s.setDeskDockTab,
      openPlanReasons: uh.openPlanReasons,
      openAlertsDock: uh.openAlertsDock,
      openChartFull: uh.openChartFull,
      openVisuals: uh.openVisuals,
      openMovers: uh.openMovers,
      closeMovers: uh.closeMovers,
      openOiExpand: uh.openOiExpand,
      openSymbol: uh.openSymbol,
      closeTopModal: uh.closeTopModal,
    },
  };
  return store;
}

function buildNiftyReportStore(options: NiftyReportStoreOptions): {
  store: NiftyReportStore;
  start: () => void;
} {
  const state = createStoreState(options);
  const derived = createDerived(state);
  const reportHandlers = createReportHandlers(state);
  const uiHandlers = createUiHandlers(state, derived);
  const store = buildStoreObject(state, derived, reportHandlers, uiHandlers);
  const start = () => {
    if (state.mut.started) return;
    state.mut.started = true;
    createEffectsCore(state, derived, reportHandlers, uiHandlers);
    createEffectsReplay(state, derived, reportHandlers);
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
