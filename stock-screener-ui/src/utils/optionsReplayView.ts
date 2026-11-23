import type { OptionReplayResult, ReplayFrame } from "../types/optionsPaper";

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A payload can arrive out of order; pick by timestamp, never by array position. */
export function frameAtOrBefore(
  frames: readonly ReplayFrame[],
  asOf: string,
): ReplayFrame | null {
  let found: ReplayFrame | null = null;
  for (const frame of frames) {
    if (frame.t > asOf) continue;
    if (found === null || frame.t > found.t) found = frame;
  }
  return found;
}

export function sliceFramesAt(
  frames: readonly ReplayFrame[],
  asOf: string | null,
): ReplayFrame[] {
  const eligible = asOf ? frames.filter((frame) => frame.t <= asOf) : [...frames];
  return eligible.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

export interface OptionsReplayView {
  frames: ReplayFrame[];
  current: ReplayFrame | null;
  total: number;
  gross: number;
  unrealized: number;
  realized: number;
  maxDrawdown: number;
  priced: boolean;
  coverageFrames: number;
}

function drawdown(frames: readonly ReplayFrame[]): number {
  let peak = 0;
  let worst = 0;
  for (const frame of frames) {
    const pnl = finite(frame.equity);
    peak = Math.max(peak, pnl);
    worst = Math.max(worst, peak - pnl);
  }
  return worst;
}

/**
 * Everything visible at a playhead is sliced from the precomputed frames.
 * A frame after the playhead is never read — including its P&L and marks.
 */
export function optionsReplayViewAt(
  result: OptionReplayResult | null,
  asOf: string | null,
): OptionsReplayView {
  if (!result) {
    return {
      frames: [],
      current: null,
      total: 0,
      gross: 0,
      unrealized: 0,
      realized: 0,
      maxDrawdown: 0,
      priced: false,
      coverageFrames: 0,
    };
  }
  const frames = sliceFramesAt(result.frames, asOf);
  const current = frames.at(-1) ?? null;
  return {
    frames,
    current,
    total: finite(current?.netPnl),
    gross: finite(current?.grossPnl),
    // A committed replay position stays open until expiry, so all movement at
    // the playhead is unrealized. Realized P&L only exists after an exit.
    realized: 0,
    unrealized: finite(current?.netPnl),
    maxDrawdown: drawdown(frames),
    priced: current?.priced ?? false,
    coverageFrames: frames.length,
  };
}

export function replayPath(result: OptionReplayResult | null): Array<{ t: string; pnl: number }> {
  if (!result) return [];
  return result.frames.map((frame) => ({ t: frame.t, pnl: finite(frame.netPnl) }));
}

/** Linear interpolation on the payoff curve; clamps outside the plotted band. */
export function payoffAtSpot(result: OptionReplayResult | null, spot: number): number | null {
  if (!result || !Number.isFinite(spot)) return null;
  const xs = result.payoff.spots;
  const ys = result.payoff.expiry;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) points.push({ x: xs[i], y: ys[i] });
  }
  if (points.length === 0) return null;
  points.sort((a, b) => a.x - b.x);
  const last = points.length - 1;
  if (spot <= points[0].x) return points[0].y;
  if (spot >= points[last].x) return points[last].y;
  let low = 0;
  while (low + 1 < points.length && points[low + 1].x < spot) low += 1;
  const span = points[low + 1].x - points[low].x;
  if (!(span > 0)) return points[low].y;
  return points[low].y + ((spot - points[low].x) / span) * (points[low + 1].y - points[low].y);
}
