/**
 * Candle hygiene for the Nifty chart.
 *
 * The intraday feed can arrive with holes (a dropped poll, a backend restart)
 * and occasionally with a poisoned bar whose `close` is `0`/`NaN`. A single bad
 * bar is enough to blow up the price scale (a 0.00 low next to a 23,000 high
 * compresses the whole session into one pixel row), and a missing minute is
 * enough to make a "trend" line jump across the hole.
 *
 * `fillCandleGaps` is the pure repair pass, run BEFORE `resampleCandles`:
 *   1. drop every candle whose close is not a finite positive number,
 *   2. repair non-finite open/high/low from the close (never emit NaN),
 *   3. insert a flat bar (`O=H=L=C=tape spot`, volume 0) for every missing
 *      minute between the first and last valid candle of the same day,
 *   4. never bridge a day/context change — a gap wider than one session is a
 *      new context, not a missing minute.
 *
 * It never invents a price: a minute is only filled when the tape has a
 * positive spot for it. Everything else is left as a hole.
 */

import type { NiftyIntradayCandle } from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

export type CandleLike = NiftyIntradayCandle | ReplayCandle;

/** Minimal tape shape needed to source a missing minute's spot. */
export interface CandleTapePoint {
  t: string;
  spot: number;
}

export interface FillCandleGapsOptions {
  /** Per-minute tape rows used as the spot source for missing minutes. */
  tape?: CandleTapePoint[] | null;
  /**
   * Largest gap (minutes) that is treated as a feed hole. Anything wider is a
   * context break (lunch-less NSE session is 375 min; a next-day gap is huge).
   */
  maxGapMinutes?: number;
}

/** One NSE session, 09:15 → 15:30 inclusive. */
export const MAX_FILL_GAP_MINUTES = 375;

interface CandleClock {
  day: string;
  minutes: number;
  offset: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse a candle timestamp (ISO with/without offset). Mirrors `niftyChartMath`. */
function parseCandleClock(time: string): CandleClock | null {
  const m =
    /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?/.exec(
      time,
    );
  if (!m) return null;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (hh > 23 || mm > 59) return null;
  return { day: m[1], minutes: hh * 60 + mm, offset: m[4] ?? "" };
}

/** Parse a tape timestamp: full ISO, or a bare `HH:MM[:SS]` clock. */
function parseTapeClock(t: string): { day: string | null; minutes: number } | null {
  const full = parseCandleClock(t);
  if (full) return { day: full.day, minutes: full.minutes };
  const bare = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(t);
  if (!bare) return null;
  const hh = Number(bare[1]);
  const mm = Number(bare[2]);
  if (hh > 23 || mm > 59) return null;
  return { day: null, minutes: hh * 60 + mm };
}

function stamp(clock: CandleClock): string {
  return `${clock.day}T${pad2(Math.floor(clock.minutes / 60))}:${pad2(
    clock.minutes % 60,
  )}:00${clock.offset}`;
}

function positive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Per-minute tape spot for `day`. Bare `HH:MM` rows apply to every day. */
function tapeSpotByMinute(
  tape: CandleTapePoint[] | null | undefined,
  day: string,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of tape ?? []) {
    if (!row || typeof row.t !== "string") continue;
    if (!positive(row.spot)) continue;
    const clock = parseTapeClock(row.t);
    if (!clock) continue;
    if (clock.day !== null && clock.day !== day) continue;
    // Later rows win: the backend feed is ascending and a re-write of the same
    // minute is the more recent value.
    out.set(clock.minutes, row.spot);
  }
  return out;
}

/**
 * Drop poisoned bars, repair NaN OHLC, and fill missing minutes from the tape.
 * The result is ascending, one bar per minute, flat where it was filled.
 */
export function fillCandleGaps(
  candles: CandleLike[] | null | undefined,
  opts: FillCandleGapsOptions = {},
): ReplayCandle[] {
  const maxGap = opts.maxGapMinutes ?? MAX_FILL_GAP_MINUTES;
  const byMinute = new Map<string, { clock: CandleClock; candle: ReplayCandle }>();

  for (const c of candles ?? []) {
    if (!c || typeof c.time !== "string") continue;
    const close = Number(c.close);
    if (!Number.isFinite(close) || close <= 0) continue;
    const clock = parseCandleClock(c.time);
    if (!clock) continue;

    const open = positive(c.open) ? c.open : close;
    const high = Math.max(positive(c.high) ? c.high : close, open, close);
    const low = Math.min(positive(c.low) ? c.low : close, open, close);
    const volume = Number((c as ReplayCandle).volume ?? 0);
    const key = `${clock.day}:${clock.minutes}`;
    byMinute.set(key, {
      clock,
      candle: {
        time: stamp(clock),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
      },
    });
  }

  const sorted = [...byMinute.values()].sort(
    (a, b) =>
      a.clock.day.localeCompare(b.clock.day) ||
      a.clock.minutes - b.clock.minutes,
  );
  if (sorted.length === 0) return [];

  const out: ReplayCandle[] = [];
  const tapeCache = new Map<string, Map<number, number>>();

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;

    if (prev && prev.clock.day === cur.clock.day) {
      const gap = cur.clock.minutes - prev.clock.minutes;
      // A missing minute is a hole; a multi-hour leap is a new context.
      if (gap > 1 && gap <= maxGap) {
        let spots = tapeCache.get(cur.clock.day);
        if (!spots) {
          spots = tapeSpotByMinute(opts.tape, cur.clock.day);
          tapeCache.set(cur.clock.day, spots);
        }
        for (let m = prev.clock.minutes + 1; m < cur.clock.minutes; m++) {
          const spot = spots.get(m);
          if (!positive(spot)) continue;
          out.push({
            time: stamp({ day: cur.clock.day, minutes: m, offset: cur.clock.offset }),
            open: spot,
            high: spot,
            low: spot,
            close: spot,
            volume: 0,
          });
        }
      }
    }

    out.push(cur.candle);
  }

  return out;
}
