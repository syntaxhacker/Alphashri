import { batch } from "solid-js";

import { setAlertsMuted } from "./alertSound";
import type { DeskChartTimeframe } from "@/hooks/useDeskHotkeys";
import type { ChartSize } from "./NiftyChartPanel";
import type {
  DeskOverlayKey,
  ReportIndex,
  ReportSymbol,
  SideTab,
} from "./niftyReportStore.types";
import type { StoreState } from "./niftyReportStore.state";
import type { StoreDerived } from "./niftyReportStore.derived";

export function createUiHandlers(s: StoreState, d: StoreDerived) {
  const {
    options,
    setIndex,
    setMode,
    setDate,
    setExpiry,
    setView,
    setDeskModeValue,
    setSideTabValue,
    setChartTf,
    setChartSize,
    setDetailOpen,
    setDeskDockTab,
    setPlanOpen,
    setMoversOpen,
    setChartFull,
    setIvOpen,
    setGexOpen,
    setGammaOpen,
    setVisualsOpen,
    setWallsOpen,
    setOiExpand,
    setHeatExpand,
    setFlowExpand,
    setPressureExpand,
    setFlowChartExpand,
    setCriticalOnly,
    setSoundMuted,
    setTrailCursor,
    symbol,
    soundMuted,
    visualsOpen,
    gexOpen,
    gammaOpen,
    ivOpen,
    chartFull,
    planOpen,
    moversOpen,
    wallsOpen,
    deskOpen,
    oiExpand,
    heatExpand,
    flowExpand,
    pressureExpand,
    flowChartExpand,
    mut,
  } = s;
  const { alertTrail } = d;

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
    // The load effect runs when the selection signals change. Cancel the old
    // request first and group the writes, or the effect starts the new load
    // and this handler immediately aborts that controller — leaving the page
    // on the empty state until the user presses Refresh. This is exactly what
    // happened after selecting SENSEX while the previous load was in flight.
    mut.requestId += 1;
    mut.requestController?.abort();
    mut.requestController = null;
    mut.loadingInFlight = false;
    s.setLoading(false);
    mut.sensexController?.abort();
    mut.sensexController = null;
    mut.replayFrameCache.clear();
    mut.baseIntraday = [];
    mut.baseCandles = [];
    batch(() => {
      s.setSymbol(next);
      setMode("live");
      setDate("");
      setExpiry("nearest");
      setIndex("nifty");
      s.setReport(null);
      s.setTape(null);
      s.setBursts(null);
      setWallsOpen(false);
      s.setOiPoints([]);
      s.setHistoryDates([]);
      s.setStreamed([]);
      s.setSensex(null);
      s.setReplay(null);
      s.setReplayIndex(0);
      s.setReplayPlaying(false);
      s.setError(null);
    });
  };

  const handleModeChange = (value: string) => {
    mut.autoEod = false;
    if (value !== "eod") mut.liveAuthToastShown = false;
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
    desk: [deskOpen, s.setDeskOpen],
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

  return {
    handleIndexChange,
    handleSymbolChange,
    handleModeChange,
    handleExpiryChange,
    handleViewChange,
    toggleDeskMode,
    handleDeskChange,
    handleChartTf,
    handleChartSize,
    setSideTab,
    toggleDetail,
    toggleCriticalOnly,
    openPlanReasons,
    openAlertsDock,
    openChartFull,
    openVisuals,
    openMovers,
    closeMovers,
    openOiExpand,
    openWalls,
    closeWalls,
    openSymbol,
    closeTopModal,
    overlayAccessors,
    toggleSound,
    playTrail,
    stopTrail,
  };
}

export type UiHandlers = ReturnType<typeof createUiHandlers>;
