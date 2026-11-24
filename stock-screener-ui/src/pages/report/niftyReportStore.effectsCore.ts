import { batch, createEffect, createMemo, createRoot, onCleanup } from "solid-js";

import {
  fetchNiftyExpiries,
  fetchNiftyReplayDates,
  fetchOptionsBursts,
  fetchOptionsExpiries,
  fetchOptionsLive,
  fetchOptionsReplayDates,
  fetchOptionsTape,
} from "@/api/reportNifty";
import { fetchPositions } from "@/api/paperTrading";
import { fetchHolidayCheck } from "@/api/holidays_api";
import { isDerivativesOpenIst } from "@/utils/marketClock";
import type { NiftyReport } from "@/types/niftyReport";
import type { OiBurst } from "./niftyOiBursts";
import { usePolling } from "@/hooks/usePolling";
import { useDeskHotkeys } from "@/hooks/useDeskHotkeys";
import { flashAlertTitle } from "./alertSound";
import { useNiftyBlasts } from "./useNiftyBlasts";
import { useNiftyOiAlerts } from "./useNiftyOiAlerts";
import { useNiftyReportStream, useNiftyBurstStream } from "./niftyStreamSolid";
import { useReplayWalls } from "./useReplayWalls";
import { nextWallMoveState, wallMoveTitle } from "./niftyWallMoves";
import { isAuthFailure, messageOf, persist, replayDatesFor } from "./niftyReportStore.helpers";
import {
  GENERIC_POLL_MS,
  NIFTY_DESK_MODE_KEY,
  REQUEST_TIMEOUT_MS,
  SESSION_CLOSE_POLL_MS,
  SIDE_TAB_KEY,
  STALE_AFTER_MS,
} from "./niftyReportStore.types";
import type { StoreState } from "./niftyReportStore.state";
import type { StoreDerived } from "./niftyReportStore.derived";
import type { ReportHandlers } from "./niftyReportStore.reportHandlers";
import type { UiHandlers } from "./niftyReportStore.uiHandlers";

export function createEffectsCore(s: StoreState, d: StoreDerived, rh: ReportHandlers, uh: UiHandlers): void {
  const {
    symbol,
    expiry,
    mode,
    date,
    report,
    replay,
    replayIndex,
    booted,
    setBooted,
    wallsOpen,
    setWallsHandle,
    setOiAlertsHandle,
    setBlastsHandle,
    setStreamHandle,
    deskMode,
    sideTab,
    setPaperPositions,
    setExpiryOptions,
    setHistoryDates,
    setWsDownSinceMs,
    setLoading,
    setError,
    markUpdated,
    touchNow,
    mut,
  } = s;
  const {
    effectiveBursts,
    alertsSessionKey,
    wallsData,
    contextKey,
    wsConnected,
    marketClosed,
  } = d;
  const { resetContext, load } = rh;
  const {
    toggleDeskMode,
    openChartFull,
    openPlanReasons,
    openVisuals,
    closeTopModal,
    handleChartTf,
  } = uh;

  setWallsHandle(
    useReplayWalls({
      enabled: () => (mode() === "live" ? Boolean(report()) : Boolean(replay())),
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
      () => s.tape() != null,
      () => mode() === "live",
      alertsSessionKey,
    ),
  );

  setBlastsHandle(useNiftyBlasts(() => booted() && mode() === "live" && symbol() === "NIFTY"));

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
      if (!mut.autoEod) return;
      if (!isDerivativesOpenIst() || mut.holidayToday) return;
      mut.autoEod = false;
      s.setMode("live");
      s.setDate("");
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
      mut.wallMoveState,
      context,
      board?.calls?.[0]?.strike ?? null,
      board?.puts?.[0]?.strike ?? null,
      mode() === "live",
    );
    mut.wallMoveState = next.state;
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
        mut.holidayToday = isHoliday;
        if (alive && (isHoliday || !isDerivativesOpenIst()) && dates.length > 0) {
          mut.autoEod = true;
          mut.wasOpenAtMount = false;
          batch(() => {
            s.setMode("eod");
            s.setDate(dates[0]);
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
    if (!mut.wasOpenAtMount) return;
    const controller = new AbortController();
    const id = window.setInterval(() => {
      if (isDerivativesOpenIst()) return;
      mut.wasOpenAtMount = false;
      void replayDatesFor(activeSymbol, controller.signal).then((dates) => {
        if (dates.length > 0) {
          mut.autoEod = true;
          batch(() => {
            s.setMode("eod");
            s.setDate(dates[0]);
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
    const dates = s.historyDates();
    if (dates.length === 0) return;
    if (isDerivativesOpenIst() && !mut.holidayToday) return;
    if (mut.genericAutoEod.has(activeSymbol)) return;
    mut.genericAutoEod.add(activeSymbol);
    mut.autoEod = true;
    batch(() => {
      s.setMode("eod");
      s.setDate(dates[0]);
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
      // A slow initial load can still be in flight when the first poll tick
      // fires (both use a 15s budget). Skip this tick and re-arm instead of
      // launching a second live/tape/bursts triple against the same request.
      if (mut.loadingInFlight) {
        pollTimer = window.setTimeout(runPoll, GENERIC_POLL_MS);
        return;
      }
      const currentRequestId = mut.requestId + 1;
      mut.requestId = currentRequestId;
      const controller = new AbortController();
      mut.requestController = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        mut.loadingInFlight = true;
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
        if (!alive || currentRequestId !== mut.requestId || controller.signal.aborted) return;
        if (!optionsReport) {
          throw new Error(`No ${activeSymbol} option-chain report available.`);
        }
        if (optionsReport.intraday?.length) mut.baseIntraday = optionsReport.intraday;
        if (optionsReport.candles?.length) mut.baseCandles = optionsReport.candles;
        // The 15s chain poll is deliberately candle-free. Keep the last
        // candle series instead of replacing it with ``intraday: []`` and
        // letting the chart fall back to sparse 10s chain spot points.
        const nextReport: NiftyReport = {
          ...optionsReport,
          ...(optionsReport.intraday?.length
            ? {}
            : mut.baseIntraday.length
              ? { intraday: mut.baseIntraday }
              : {}),
          ...(optionsReport.candles?.length
            ? {}
            : mut.baseCandles.length
              ? { candles: mut.baseCandles }
              : {}),
        };
        batch(() => {
          s.setReport(nextReport);
          if (tapeData) s.setTape(tapeData);
          s.setBursts(burstData as OiBurst[]);
          s.setSensex(null);
          s.setSensexError(null);
          s.setSensexLoading(false);
          markUpdated({
            as_of: optionsReport.market?.as_of ?? null,
            fetched_at: (optionsReport as { fetchedAt?: string | null }).fetchedAt ?? null,
          });
        });
      } catch (pollError) {
        if (!alive || currentRequestId !== mut.requestId || controller.signal.aborted) return;
        s.setNowMs(Date.now());
        const message = messageOf(pollError, `Failed to load ${activeSymbol} report`);
        if (isAuthFailure(message)) {
          try {
            const dates = await fetchOptionsReplayDates(activeSymbol, controller.signal);
            if (dates.length > 0) {
              mut.autoEod = true;
              mut.wasOpenAtMount = false;
              batch(() => {
                s.setMode("eod");
                s.setDate(dates[0]);
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
        if (currentRequestId === mut.requestId) {
          mut.requestController = null;
          mut.loadingInFlight = false;
          setLoading(false);
        }
      }
      if (alive) pollTimer = window.setTimeout(runPoll, GENERIC_POLL_MS);
    };
    pollTimer = window.setTimeout(runPoll, GENERIC_POLL_MS);
    onCleanup(() => {
      alive = false;
      if (pollTimer) window.clearTimeout(pollTimer);
      mut.requestController?.abort();
      mut.requestController = null;
      mut.loadingInFlight = false;
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
    if (mut.prevContext === key) return;
    mut.prevContext = key;
    resetContext();
  });

  const loadKey = createMemo(() => `${symbol()}|${mode()}|${expiry()}|${date()}|${booted()}`);

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
      setStreamHandle(
        useNiftyReportStream({
          expiry: expiryArg,
          enabled: true,
        }),
      );
      return disposeRoot;
    });
    onCleanup(() => {
      disposeStream();
      setStreamHandle(null);
    });
  });

  createEffect(() => {
    const pushed = s.streamHandle()?.report() ?? null;
    if (symbol() !== "NIFTY") return;
    if (!pushed) return;
    s.setReport(pushed);
    markUpdated({
      as_of: pushed.market?.as_of ?? null,
      fetched_at: (pushed as { fetchedAt?: string | null }).fetchedAt ?? null,
    });
  });

  createEffect(() => {
    const pushed = s.streamHandle()?.tape() ?? null;
    if (symbol() !== "NIFTY") return;
    if (!pushed) return;
    s.setTape(pushed);
    // A tape frame's own newest row is its data-through time.
    const newestRow = [...(pushed.rows ?? [])].reverse().find((row) => row?.t);
    markUpdated({ as_of: newestRow?.t ?? null });
  });

  createEffect(() => {
    const pushed = s.streamHandle()?.sensex() ?? null;
    if (symbol() !== "NIFTY") return;
    if (!pushed) return;
    s.setSensex(pushed);
    s.setSensexError(null);
    markUpdated({
      as_of: pushed.market?.as_of ?? null,
      fetched_at: (pushed as { fetchedAt?: string | null }).fetchedAt ?? null,
    });
  });

  useNiftyBurstStream(
    (burst) => s.pushStreamedBurst(burst),
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
    const since = s.wsDownSinceMs();
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
}
