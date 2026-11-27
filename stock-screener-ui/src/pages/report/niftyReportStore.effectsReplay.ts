import { createEffect, onCleanup } from "solid-js";

import {
  fetchBreadth,
  fetchChain10sSummary,
  fetchOptionsBursts,
  fetchOptionsChain10s,
} from "@/api/reportNifty";
import type { Chain10sSummaryPoint } from "@/api/reportNifty";
import type { OiBurst } from "./niftyOiBursts";
import { alertsMuted, flashAlertTitle, playAlertSound } from "./alertSound";
import {
  detectFlipChange,
  loadStoredFlip,
  saveStoredFlip,
  sessionTone,
} from "./niftyFlowRead";
import { appendPreMove } from "./niftyPreMoveHistory";
import { seedPreMoveHistory } from "./niftyPreMove";
import { resolveWallBoard } from "./niftyWallsFormat";
import { REPLAY_STUB_REPORT } from "./niftyReplay";
import {
  ALERTS_TRAIL_WALK_MS,
  BREADTH_FOCUS_GUARD_MS,
  BREADTH_POLL_MS,
  CHAIN10S_FOCUS_GUARD_MS,
  CHAIN10S_POLL_MS,
  EOD_CHAIN10S_LIMIT,
  GENERIC_BURST_POLL_MS,
  LIVE_CHAIN10S_LIMIT,
  PREMOVE_ALERT_COOLDOWN_MS,
  PREMOVE_ALERT_TTL_MS,
  REPLAY_PLAY_MS,
  WALL_HISTORY_MAX,
  WALL_HISTORY_WINDOW_MS,
} from "./niftyReportStore.types";
import type { StoreState } from "./niftyReportStore.state";
import type { StoreDerived } from "./niftyReportStore.derived";
import type { ReportHandlers } from "./niftyReportStore.reportHandlers";

export function createEffectsReplay(s: StoreState, d: StoreDerived, rh: ReportHandlers): void {
  const {
    mode,
    date,
    symbol,
    booted,
    report,
    replay,
    replayIndex,
    replayPlaying,
    oiPoints,
    preMoveAlert,
    setPreMoveAlert,
    setBreadth,
    setOiPoints,
    setBursts,
    setLastFlip,
    setLivePreMoveHistory,
    setWallHistory,
    setTrailCursor,
    setReplayPlaying,
    setReplayIndex,
    withBaseCandles,
    mut,
  } = s;
  const {
    derivedFlow,
    flipStorageKeyNow,
    preMove,
    alertTrail,
  } = d;
  const {
    applyReplayFrame,
    loadReplayFrame,
    prefetchNextReplayFrame,
    cancelReplayPrefetch,
  } = rh;

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
      mut.pendingScrub = { report: withBaseCandles(frame.report), sensex: frame.sensex };
      if (mut.scrubRaf !== null) return;
      mut.scrubRaf = window.requestAnimationFrame(() => {
        mut.scrubRaf = null;
        const queued = mut.pendingScrub;
        mut.pendingScrub = null;
        if (!queued) return;
        applyReplayFrame(queued.report, queued.sensex);
      });
      return;
    }
    const cached = mut.replayFrameCache.get(frame.t);
    if (cached) {
      applyReplayFrame(cached, null);
      prefetchNextReplayFrame(activeDate, nextFrame);
      return;
    }
    const frameRequestId = ++mut.replayFrameReq;
    void loadReplayFrame(activeDate, frame.t).then((loaded) => {
      if (frameRequestId !== mut.replayFrameReq || !loaded) return;
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
    const snapshots = [
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
      mut.armedStreak = 0;
      return;
    }
    mut.armedStreak += 1;
    if (mut.armedStreak !== 2) return;
    if (Date.now() - mut.lastPreMoveAlertAt < PREMOVE_ALERT_COOLDOWN_MS) return;
    mut.lastPreMoveAlertAt = Date.now();
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
    mut.flipWatch = null;
    setLastFlip(loadStoredFlip(key));
  });

  createEffect(() => {
    const flow = derivedFlow();
    if (!flow) return;
    const at = flow.as_of || new Date().toISOString();
    const next = detectFlipChange(
      mut.flipWatch,
      flow["5m"],
      flow["15m"],
      sessionTone(report()?.control?.verdict),
      at,
    );
    mut.flipWatch = next.state;
    if (next.flip) {
      setLastFlip(next.flip);
      saveStoredFlip(flipStorageKeyNow(), next.flip);
    }
  });

  createEffect(() => {
    const cursor = s.trailCursor();
    if (cursor === null) return;
    if (cursor < 0) {
      setTrailCursor(null);
      return;
    }
    const id = setTimeout(() => {
      const alert = alertTrail()[cursor];
      if (alert) s.oiAlertsHandle()?.pushToast(alert);
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
    mut.requestId += 1;
    mut.requestController?.abort();
    mut.sensexController?.abort();
    mut.requestController = null;
    mut.sensexController = null;
    if (mut.scrubRaf !== null) {
      window.cancelAnimationFrame(mut.scrubRaf);
      mut.scrubRaf = null;
    }
    mut.pendingScrub = null;
    cancelReplayPrefetch();
    mut.replayFrameInflight.clear();
  });
}
