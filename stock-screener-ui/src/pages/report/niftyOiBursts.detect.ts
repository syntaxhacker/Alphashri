import type { AlertSeverity } from "@/components/notifications/MarketAlertCard";
import type { NiftyTapeRow } from "@/types/niftyReport";
import {
  OI_BURST_MIN_ABS,
  OI_BURST_TIERS,
  OI_BURST_WARMUP,
  OI_BURST_WINDOW,
} from "./niftyOiBursts.types";
import type { DetectOptions, OiBurst } from "./niftyOiBursts.types";
import { computeMinuteDoi, isNonTradeAlertType, median } from "./niftyOiBursts.normalize";
import { burstTimeLabel } from "./niftyOiBursts.format";
import { resolveOiDirection } from "./niftyOiBursts.signal";

export function severityForScore(score: number): AlertSeverity {
  if (score >= OI_BURST_TIERS.critical) return "critical";
  if (score >= OI_BURST_TIERS.alert) return "alert";
  if (score >= OI_BURST_TIERS.watch) return "watch";
  return "info";
}

/**
 * Bursts across the whole series, one entry per (minute, side). Ordered by
 * minute ascending so callers can take the tail as "most recent".
 */
export function detectOiBursts(rows: NiftyTapeRow[], opts: DetectOptions = {}): OiBurst[] {
  const window = opts.window ?? OI_BURST_WINDOW;
  const minAbs = opts.minAbs ?? OI_BURST_MIN_ABS;
  const warmup = opts.warmup ?? OI_BURST_WARMUP;

  const series = computeMinuteDoi(rows);
  const callHist: number[] = [];
  const putHist: number[] = [];
  const out: OiBurst[] = [];

  for (const m of series) {
    const sides: Array<{ side: "call" | "put"; d: number; hist: number[]; cum: number; tick: number }> = [
      { side: "call", d: m.dCall, hist: callHist, cum: m.callDoi, tick: m.callTick },
      { side: "put", d: m.dPut, hist: putHist, cum: m.putDoi, tick: m.putTick },
    ];

    for (const s of sides) {
      const abs = Math.abs(s.d);
      if (s.hist.length >= warmup) {
        // Baseline is floored at the absolute minimum so a near-zero median
        // on a quiet tape can't inflate every later move into a "burst".
        const baseline = Math.max(minAbs, median(s.hist.slice(-window)));
        const score = abs / baseline;
        if (abs >= minAbs && score >= OI_BURST_TIERS.watch) {
          out.push({
            id: `${m.t}-${s.side}`,
            side: s.side,
            t: m.t,
            delta: s.d,
            baseline,
            score,
            severity: severityForScore(score),
            cumDoi: s.cum,
            spot: m.spot,
            tickVol: s.tick,
          });
        }
      }
    }

    callHist.push(Math.abs(m.dCall));
    putHist.push(Math.abs(m.dPut));
  }

  return out;
}

export function sortAlertsCriticalFirst<T extends { severity: AlertSeverity }>(
  alerts: T[],
): T[] {
  return alerts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const xr = x.a.severity === "critical" ? 0 : 1;
      const yr = y.a.severity === "critical" ? 0 : 1;
      return xr - yr || x.i - y.i;
    })
    .map(({ a }) => a);
}

/**
 * Two-sided writer builds are a pin, not a trade.
 *
 * 2026-10-29 09:19: call OI +3.6M and put OI +2.2M at 22,700 in the same
 * minute. The per-side plans are opposite (call writers -> fade with puts,
 * put writers -> floor holds, buy calls). Emitting both is a contradiction;
 * drop every burst in a minute whose per-side plans disagree.
 */
export function dropConflictingSides(bursts: OiBurst[]): OiBurst[] {
  const byMinute = new Map<string, OiBurst[]>();
  for (const b of bursts) {
    // Wall geometry and stale-data warnings are not per-side trade plans, so
    // they must never be counted as a two-sided pin (a call wall test + a put
    // wall test in the same minute used to cancel both rows).
    if (isNonTradeAlertType(b.type)) continue;
    const key = burstTimeLabel(b.t);
    const group = byMinute.get(key);
    if (group) group.push(b);
    else byMinute.set(key, [b]);
  }
  const drop = new Set<string>();
  for (const group of byMinute.values()) {
    if (group.length < 2) continue;
    const legs = new Set(
      group
        .map((b) => resolveOiDirection(b)?.leg)
        .filter((l): l is "CE" | "PE" => l === "CE" || l === "PE"),
    );
    if (legs.size > 1) {
      for (const b of group) drop.add(b.id);
    }
  }
  return drop.size === 0 ? bursts : bursts.filter((b) => !drop.has(b.id));
}
