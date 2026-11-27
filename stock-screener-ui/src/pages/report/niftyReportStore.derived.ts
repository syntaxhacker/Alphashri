import { createMemo } from "solid-js";

import type { NiftyReport, NiftyTape } from "@/types/niftyReport";
import type { WallsPayload } from "@/api/reportNifty";
import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import { flowWindowFromTape, flipStorageKey } from "./niftyFlowRead";
import type { OiPoint } from "./niftyFlowRead";
import {
  burstTimeLabel,
  isNonTradeAlertType,
  premiumChangeBefore,
  spotMinutesBefore,
  TREND_EMA_SPAN,
} from "./niftyOiBursts";
import type { MinutePremium, OiBurst } from "./niftyOiBursts";
import { paperToPnlLeg } from "./niftyPositions";
import type { NiftyPnlPosition } from "./niftyPnlAttribution";
import type { PreMovePoint } from "./niftyPreMoveHistory";
import type { PreMoveScore } from "./niftyPreMove";
import { scorePreMove, seedPreMoveHistory } from "./niftyPreMove";
import { buildPressure } from "./niftyPressure";
import { buildReplaySegments, countReplayHoles, toReplayReasons } from "./NiftyReplayBar";
import type { ReplayReason } from "./NiftyReplayBar";
import { computeReplayCoverage } from "./niftyReplayCoverage";
import type { ReplayCoverage } from "./niftyReplayCoverage";
import { setupRadar } from "./niftySetup";
import type { SetupRead } from "./niftySetup";
import { symbolMetrics } from "./symbolMetrics";
import type { SymbolMetrics } from "./symbolMetrics";
import { REPLAY_PREMOVE_KEEP, REPLAY_PREMOVE_TAIL, STALE_AFTER_MS } from "./niftyReportStore.types";
import type { StoreState } from "./niftyReportStore.state";

export function createDerived(s: StoreState) {
  const {
    symbol,
    mode,
    date,
    expiry,
    expiryOptions,
    historyDates,
    report,
    tape,
    bursts,
    streamed,
    oiPoints,
    livePreMoveHistory,
    replay,
    replayIndex,
    paperPositions,
    streamHandle,
    wallsHandle,
    oiAlertsHandle,
    wsDownSinceMs,
    nowMs,
    deskMode,
    criticalOnly,
  } = s;

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

  return {
    isDesk,
    contextKey,
    expiryData,
    hasRecordedHistory,
    marketClosed,
    wsConnected,
    wsDownForMs,
    isStale,
    staleMins,
    metrics,
    visibleStrikes,
    atmStrike,
    oiScale,
    oiWalls,
    replayFrameT,
    replayFrameLabel,
    tapeRows,
    derivedFlow,
    flowReport,
    intradayStart,
    tapeSpeed,
    pressure,
    setup,
    replayCutMs,
    scorePoints,
    preMove,
    preMoveHistory,
    detectedBursts,
    sessionContext,
    effectiveBursts,
    burstMap,
    flipStorageKeyNow,
    replayCoverage,
    replayReasons,
    replayHoles,
    pnlPositions,
    alertsSessionKey,
    alertTrail,
    alertToasts,
    alertBanners,
    criticalCount,
    displayedTrail,
    visibleBanners,
    bannerOverflow,
    wallsData,
    wallsSyncing,
  };
}

export type StoreDerived = ReturnType<typeof createDerived>;
