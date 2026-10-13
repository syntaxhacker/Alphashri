import type { AlertSeverity, MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { NiftyTapeRow } from "@/types/niftyReport";

/**
 * Nifty OI-burst detection — pure, client-side, no store.
 *
 * The tape's `call_doi`/`put_doi` are CUMULATIVE from the day's first row, so a
 * burst is the FIRST DIFFERENCE between consecutive minutes, not the headline
 * number:
 *     dCall(i) = call_doi(i) − call_doi(i−1)
 *     dPut(i)  = put_doi(i)  − put_doi(i−1)
 *
 * A minute is "unusual" when its |d| dwarfs the trailing typical |d| for the
 * same side. The baseline is a robust MEDIAN (not mean) over the previous
 * window of minutes, so a single earlier burst can't hide the next one.
 * Everything is scored per side, so a big call burst and a big put burst in
 * the same minute are two separate events.
 */

/** Trailing minutes used for the per-side baseline. */
export const OI_BURST_WINDOW = 10;
/** Absolute floor (contracts) — kills pre-open / thin-book noise. */
export const OI_BURST_MIN_ABS = 2_000;
/** Minimum prior minutes before scoring starts (no baseline = no alert). */
export const OI_BURST_WARMUP = 3;
/** score = |d| ÷ baseline → severity. */
export const OI_BURST_TIERS: Record<AlertSeverity, number> = {
  watch: 3,
  alert: 5,
  critical: 8,
  info: Infinity,
};

export interface MinuteDoi {
  t: string;
  /** OI contracts added this minute (can be negative = unwinding). */
  dCall: number;
  dPut: number;
  /** Cumulative-from-open ΔOI at this minute. */
  callDoi: number;
  putDoi: number;
  spot: number;
  callTick: number;
  putTick: number;
}

export interface OiBurst {
  id: string;
  side: "call" | "put";
  t: string;
  /** Contracts added this minute (signed). */
  delta: number;
  /** Trailing median |delta| used to score it. */
  baseline: number;
  score: number;
  severity: AlertSeverity;
  /** Cumulative-from-open ΔOI for that side. */
  cumDoi: number;
  spot: number;
  /** That side's traded volume this minute. */
  tickVol: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Chronological per-minute ΔOI series; the first row is the baseline, not a delta. */
export function computeMinuteDoi(rows: NiftyTapeRow[]): MinuteDoi[] {
  const asc = [...(rows ?? [])].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const out: MinuteDoi[] = [];
  for (let i = 1; i < asc.length; i++) {
    const p = asc[i - 1];
    const c = asc[i];
    if (!p || !c) continue;
    out.push({
      t: c.t,
      dCall: (c.call_doi ?? 0) - (p.call_doi ?? 0),
      dPut: (c.put_doi ?? 0) - (p.put_doi ?? 0),
      callDoi: c.call_doi ?? 0,
      putDoi: c.put_doi ?? 0,
      spot: c.spot ?? 0,
      callTick: c.call_tick ?? 0,
      putTick: c.put_tick ?? 0,
    });
  }
  return out;
}

export function severityForScore(score: number): AlertSeverity {
  if (score >= OI_BURST_TIERS.critical) return "critical";
  if (score >= OI_BURST_TIERS.alert) return "alert";
  if (score >= OI_BURST_TIERS.watch) return "watch";
  return "info";
}

export interface DetectOptions {
  window?: number;
  minAbs?: number;
  warmup?: number;
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
        const baseline = Math.max(1, median(s.hist.slice(-window)));
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

/** IST HH:MM for a tape timestamp (ISO or bare HH:MM). */
export function burstTimeLabel(t: string): string {
  if (!t) return "--:--";
  if (t.includes("T")) {
    const time = t.split("T")[1] ?? "";
    return time.slice(0, 5) || "--:--";
  }
  return t.slice(0, 5);
}

function compact(v: number): string {
  const sign = v < 0 ? "-" : "+";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

/** Map a detected burst onto the shared alert shape for the in-app toast/log. */
export function burstToAlert(burst: OiBurst): MarketAlert {
  const sideLabel = burst.side === "call" ? "Call" : "Put";
  const tone = burst.delta >= 0 ? "up" : "down";
  return {
    id: burst.id,
    kind: "oi_burst",
    severity: burst.severity,
    symbol: "NIFTY",
    title: `${sideLabel} OI burst ${compact(burst.delta)} in 1 min`,
    detail: `${burst.score.toFixed(1)}× the trailing typical minute · ${burstTimeLabel(burst.t)} IST`,
    metrics: [
      { label: "ΔOI", value: compact(burst.delta), tone },
      { label: "CUM", value: compact(burst.cumDoi), tone: burst.cumDoi >= 0 ? "up" : "down" },
      { label: "TICK", value: compact(burst.tickVol) },
      { label: "SPOT", value: burst.spot.toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
    ],
    ts: Date.parse(burst.t) || Date.now(),
    source: `Nifty tape · ${burst.score.toFixed(1)}× baseline`,
    href: "/report/nifty",
  };
}
