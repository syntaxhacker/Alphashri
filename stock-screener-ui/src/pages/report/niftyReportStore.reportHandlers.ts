import { batch } from "solid-js";

import {
  fetchNiftyBursts,
  fetchNiftyReplay,
  fetchNiftyReplayFrame,
  fetchNiftyReplayMeta,
  fetchNiftyTape,
  fetchNiftyByDate,
  fetchLiveNifty,
  fetchOptionsBursts,
  fetchOptionsLive,
  fetchOptionsLiveCandles,
  fetchOptionsReplay,
  fetchOptionsReplayFrame,
  fetchOptionsReplayMeta,
  fetchOptionsSnapshot,
  fetchOptionsTape,
  snapshotNifty,
  fetchNiftyReplayDates,
} from "@/api/reportNifty";
import { fetchPositions } from "@/api/paperTrading";
import type {
  NiftyReport,
  NiftyReplay,
  NiftyReplayFrame,
  NiftySensex,
} from "@/types/niftyReport";
import type { OiBurst } from "./niftyOiBursts";
import { showError } from "@/ui/notifications";
import { REPLAY_STUB_REPORT, replayFromMeta } from "./niftyReplay";
import {
  fetchSensexWithinTimeout,
  isAuthFailure,
  isTimeoutError,
  messageOf,
} from "./niftyReportStore.helpers";
import { REPLAY_FRAME_CACHE_MAX } from "./niftyReportStore.types";
import type { StoreState } from "./niftyReportStore.state";

export function createReportHandlers(s: StoreState) {
  const {
    symbol,
    mode,
    expiry,
    date,
    setReport,
    setSensex,
    setSensexLoading,
    setSensexError,
    setTape,
    setBursts,
    setStreamed,
    setPaperPositions,
    setLoading,
    setError,
    setSnapshotting,
    setReplay,
    setReplayIndex,
    setReplayPlaying,
    setOiPoints,
    setWallHistory,
    setLivePreMoveHistory,
    setPreMoveAlert,
    mut,
    markUpdated,
    withBaseCandles,
  } = s;

  const refreshPaperPositions = async () => {
    try {
      const list = await fetchPositions();
      setPaperPositions(list ?? []);
    } catch {
      setPaperPositions((previous) => previous ?? []);
    }
  };

  const cacheReplayFrame = (minute: string, next: NiftyReport) => {
    mut.replayFrameCache.set(minute, next);
    if (mut.replayFrameCache.size > REPLAY_FRAME_CACHE_MAX) {
      const oldest = mut.replayFrameCache.keys().next().value;
      if (oldest) mut.replayFrameCache.delete(oldest);
    }
  };

  const loadReplayFrame = (dateKey: string, minute: string): Promise<NiftyReplayFrame | null> => {
    const activeSymbol = symbol();
    const inflightKey = `${activeSymbol}|${dateKey}|${minute}`;
    const pending = mut.replayFrameInflight.get(inflightKey);
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
      .catch((error) => {
        // A failed frame is indistinguishable from "no frame" to the caller,
        // which leaves the previous frame on screen under a new playhead.
        // Keep the fail-soft behaviour, but never swallow the failure silently.
        console.warn("[report] replay frame failed to load", inflightKey, error);
        return null;
      });
    mut.replayFrameInflight.set(inflightKey, request);
    void request.finally(() => {
      if (mut.replayFrameInflight.get(inflightKey) === request) {
        mut.replayFrameInflight.delete(inflightKey);
      }
    });
    return request;
  };

  const cancelReplayPrefetch = () => {
    mut.replayPrefetchCancel?.();
    mut.replayPrefetchCancel = null;
  };

  const prefetchNextReplayFrame = (dateKey: string, next: NiftyReplayFrame | undefined) => {
    cancelReplayPrefetch();
    if (!next || !next.t || next.report !== REPLAY_STUB_REPORT) return;
    if (mut.replayFrameCache.has(next.t)) return;
    const minute = next.t;
    const run = () => {
      mut.replayPrefetchCancel = null;
      void loadReplayFrame(dateKey, minute);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(run, { timeout: 1_000 });
      mut.replayPrefetchCancel = () => idleWindow.cancelIdleCallback?.(handle);
      return;
    }
    const handle = window.setTimeout(run, 150);
    mut.replayPrefetchCancel = () => window.clearTimeout(handle);
  };

  const applyReplayFrame = (next: NiftyReport, nextSensex: NiftySensex | null) => {
    setReport(withBaseCandles(next));
    setSensex(nextSensex);
  };

  const load = async () => {
    if (mut.loadingInFlight) return;
    const currentRequestId = mut.requestId + 1;
    mut.requestId = currentRequestId;
    const controller = new AbortController();
    mut.requestController = controller;
    mut.loadingInFlight = true;
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
        if (currentRequestId !== mut.requestId || controller.signal.aborted) return;
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
        mut.baseIntraday = nextReport.intraday ?? [];
        mut.baseCandles = nextReport.candles ?? [];
        // One refresh = one derived-graph pass; unbatched, each signal write re-runs it.
        batch(() => {
          setReport(nextReport);
          if (tapeData) setTape(tapeData);
          setBursts(burstData as OiBurst[]);
          setReplay(replayData && replayData.snapshots.length > 0 ? replayData : null);
          setReplayIndex(0);
          setReplayPlaying(false);
          setSensex(null);
          setSensexError(null);
          setSensexLoading(false);
          markUpdated({
            as_of: nextReport.market?.as_of ?? null,
            fetched_at: nextReport.fetchedAt ?? null,
          });
        });
        if (activeMode === "live" && (!nextReport.intraday || nextReport.intraday.length === 0)) {
          void fetchOptionsLiveCandles(activeSymbol, undefined, controller.signal)
            .then((withCandles) => {
              if (currentRequestId !== mut.requestId) return;
              const intraday = withCandles.intraday;
              if (!intraday || intraday.length === 0) return;
              mut.baseIntraday = intraday;
              if (withCandles.candles?.length) mut.baseCandles = withCandles.candles;
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
      if (currentRequestId !== mut.requestId) return;
      const firstReplayFrame = replayData?.snapshots[0] ?? null;
      const nextNiftyReport =
        firstReplayFrame && firstReplayFrame.report !== REPLAY_STUB_REPORT
          ? firstReplayFrame.report
          : data;
      mut.baseIntraday =
        (data.intraday?.length ?? 0) > 0
          ? (data.intraday as typeof mut.baseIntraday)
          : nextNiftyReport.intraday ?? [];
      mut.baseCandles =
        (data.candles?.length ?? 0) > 0
          ? (data.candles as typeof mut.baseCandles)
          : nextNiftyReport.candles ?? [];
      if (activeMode === "live") mut.liveAuthToastShown = false;
      batch(() => {
        setReport(nextNiftyReport);
        if (activeMode === "live") {
          mut.sensexController?.abort();
          const nextSensexController = new AbortController();
          mut.sensexController = nextSensexController;
          setSensexLoading(true);
          setSensexError(null);
          void fetchSensexWithinTimeout(nextSensexController)
            .then((sensexData) => {
              if (currentRequestId === mut.requestId && !nextSensexController.signal.aborted) {
                setSensex(sensexData);
              }
            })
            .catch((sensexFetchError) => {
              const timedOut = isTimeoutError(sensexFetchError);
              if (currentRequestId !== mut.requestId) return;
              if (nextSensexController.signal.aborted && !timedOut) return;
              setSensex(null);
              setSensexError(messageOf(sensexFetchError, "Sensex data unavailable"));
            })
            .finally(() => {
              if (currentRequestId === mut.requestId) setSensexLoading(false);
            });
        } else {
          mut.sensexController?.abort();
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
        markUpdated({
          as_of: nextNiftyReport.market?.as_of ?? null,
          fetched_at: (nextNiftyReport as { fetchedAt?: string | null }).fetchedAt ?? null,
        });
      });
    } catch (loadError) {
      if (currentRequestId !== mut.requestId || controller.signal.aborted) return;
      s.setNowMs(Date.now());
      const message = messageOf(loadError, "Failed to load Nifty report");
      if (activeMode === "live" && isAuthFailure(message)) {
        if (!mut.liveAuthToastShown) {
          mut.liveAuthToastShown = true;
          const brokerToken = /upstox|broker|access token not configured/i.test(message);
          showError(
            "Live NIFTY unavailable",
            brokerToken
              ? "Live NIFTY unavailable: the Upstox token is missing or expired. Reconnect in Settings → Brokers to resume live data."
              : `Live NIFTY unavailable: ${message}`,
          );
        }
        try {
          const dates = await fetchNiftyReplayDates(controller.signal);
          if (dates.length > 0) {
            mut.autoEod = true;
            mut.wasOpenAtMount = false;
            s.setMode("eod");
            s.setDate(dates[0]);
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
      if (currentRequestId === mut.requestId) {
        mut.requestController = null;
        mut.loadingInFlight = false;
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
    const current = s.replay();
    if (!current) return;
    const clamped = Math.max(0, Math.min(current.snapshots.length - 1, Math.floor(rawIndex)));
    setReplayPlaying(false);
    setReplayIndex(clamped);
  };

  const toggleReplayPlay = () => {
    const current = s.replay();
    if (s.replayPlaying()) {
      if (mut.scrubRaf !== null) {
        window.cancelAnimationFrame(mut.scrubRaf);
        mut.scrubRaf = null;
      }
      mut.pendingScrub = null;
      setReplayPlaying(false);
      return;
    }
    if (current && s.replayIndex() >= current.snapshots.length - 1) {
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
    const current = s.replay();
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
    mut.requestId += 1;
    mut.requestController?.abort();
    mut.requestController = null;
    mut.loadingInFlight = false;
    setLoading(false);
    setReport(null);
    setSensex(null);
    mut.sensexController?.abort();
    mut.sensexController = null;
    setSensexLoading(false);
    setSensexError(null);
    setTape(null);
    setBursts(null);
    setStreamed([]);
    mut.replayFrameCache.clear();
    mut.replayFrameReq += 1;
    setOiPoints([]);
    setWallHistory([]);
    setLivePreMoveHistory([]);
    setPreMoveAlert(null);
    if (mut.scrubRaf !== null) {
      window.cancelAnimationFrame(mut.scrubRaf);
      mut.scrubRaf = null;
    }
    mut.pendingScrub = null;
    cancelReplayPrefetch();
    setReplay(null);
    setReplayIndex(0);
    setReplayPlaying(false);
    setError(null);
  };

  return {
    refreshPaperPositions,
    cacheReplayFrame,
    loadReplayFrame,
    cancelReplayPrefetch,
    prefetchNextReplayFrame,
    applyReplayFrame,
    load,
    refresh,
    snapshot,
    scrubReplay,
    toggleReplayPlay,
    breakReplayAt,
    resetContext,
  };
}

export type ReportHandlers = ReturnType<typeof createReportHandlers>;
