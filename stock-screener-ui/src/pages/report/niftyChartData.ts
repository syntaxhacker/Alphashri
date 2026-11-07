/**
 * The Nifty chart's pure data-selection logic — which session the candles
 * belong to, which source backs the chart, and where a replay playhead
 * stops the series.
 *
 * Split out of `NiftyChartPanel.tsx` so the panel only carries the component
 * and the selection rules can be unit-tested on their own. Nothing here
 * touches React: every function is a plain derivation of the report the
 * caller already has.
 */

import type { CandleLike } from "./niftyCandles";
import type {
  NiftyIntradayCandle,
  NiftyReport,
  NiftyTapeRow,
} from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

/** A tape row carries at least a timestamp and a spot. */
export type TapeSpotPoint = Pick<NiftyTapeRow, "t" | "spot">;

/** A 10-second chain snapshot carries at least a timestamp and a spot. */
export type SpotPoint = { t: string; spot?: number | null };

/**
 * The chart's session date: the report's own `date`, falling back to the
 * exchange session gate's `market.session_date` (a live generic report can
 * carry a candle series from the previous completed session while the tape
 * already belongs to today). `""` when neither is present — `isOnSession`
 * treats that as "no session pinned", i.e. everything passes.
 */
export function sessionDateOf(
  report: Pick<NiftyReport, "date" | "market">,
): string {
  return report.date || report.market?.session_date || "";
}

/** True when `time` belongs to `sessionDate` — or when no session is pinned. */
export function isOnSession(time: string, sessionDate: string): boolean {
  return !sessionDate || time.startsWith(sessionDate);
}

/**
 * Last-resort spot path — NOT true OHLC. It folds consecutive 1-minute
 * tape spots into bars where `high`/`low` never exceed the body (each bar
 * spans open→close only), so the chart draws a continuous line with no
 * wicks. Kept only for when the 10-second chain feed is absent; prefer
 * `candlesFromSpotPoints` whenever the 10 s snapshots are available. Rows
 * whose spot is not a finite positive number are skipped — and they do not
 * advance `prev`, so the next valid bar opens on the last valid spot.
 * Volume is always 0 (the tape carries no volume). Rows outside
 * `sessionDate` are dropped.
 */
export function candlesFromTape(
  rows: readonly TapeSpotPoint[],
  sessionDate: string,
): ReplayCandle[] {
  let prev: number | null = null;
  return rows
    .filter((row) => isOnSession(row.t, sessionDate))
    .map((row) => {
      const spot = Number(row.spot);
      if (!Number.isFinite(spot) || spot <= 0) return null;
      const open = prev ?? spot;
      const close = spot;
      prev = spot;
      return {
        time: row.t,
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
        volume: 0,
      };
    })
    .filter((c): c is ReplayCandle => c !== null);
}

/**
 * Internal carrier for the spot-derived bars: they carry `volume: 0` (the
 * chain feed has no volume) but the declared return type is
 * `NiftyIntradayCandle` — `resampleCandles` normalises a missing volume to
 * 0 downstream, so hiding it here keeps one candle shape across sources.
 */
interface SpotCandle extends NiftyIntradayCandle {
  volume: number;
}

/**
 * Build true 1-minute OHLC from the 10-second chain snapshots (6 points a
 * minute during a session): the minute's `open` is the first spot, `close`
 * the last, `high`/`low` the extremes — so wicks exist. Points are filtered
 * to `sessionDate`, non-finite / non-positive spots are dropped, and the
 * rest are sorted by `t` before grouping by minute key (`t.slice(0, 16)`),
 * so out-of-order input still forms one bar per minute. A single-point
 * minute is allowed (open = close = high = low); a minute with no valid
 * point produces no candle. Timestamps are emitted as `${minuteKey}:00`.
 */
export function candlesFromSpotPoints(
  points: readonly SpotPoint[],
  sessionDate: string,
): NiftyIntradayCandle[] {
  const valid = (points ?? [])
    .filter((p) => typeof p?.t === "string" && p.t.length >= 16)
    .filter((p) => isOnSession(p.t, sessionDate))
    .map((p) => {
      const spot = Number(p.spot);
      return Number.isFinite(spot) && spot > 0 ? { t: p.t, spot } : null;
    })
    .filter((p): p is { t: string; spot: number } => p !== null)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const out: SpotCandle[] = [];
  let curKey: string | null = null;
  let open = 0;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let close = 0;
  const flush = () => {
    if (curKey === null) return;
    out.push({ time: `${curKey}:00`, open, high, low, close, volume: 0 });
  };
  for (const p of valid) {
    const key = p.t.slice(0, 16);
    if (key !== curKey) {
      flush();
      curKey = key;
      open = p.spot;
      high = p.spot;
      low = p.spot;
      close = p.spot;
    } else {
      if (p.spot > high) high = p.spot;
      if (p.spot < low) low = p.spot;
      close = p.spot;
    }
  }
  flush();
  return out;
}

/** Minute key shared by candle sources (`YYYY-MM-DDTHH:MM`). */
function minuteKey(time: string): string {
  return time.slice(0, 16);
}

/**
 * Merge same-frequency candle sources by minute, first source wins.
 *
 * Winner-takes-all was the candle-loss bug: the 10-second chain feed only
 * carries the newest ~15 minutes, so a fresh-but-short spot series could
 * replace a full morning of intraday candles. Merge instead, in priority
 * order (intraday > spot-derived > tape), and let a duplicate minute keep the
 * higher-quality source. EOD candles are not merged here: they are 15-minute
 * bars and must stay a fallback for when no 1-minute source exists.
 */
export function mergeCandleSeries(
  sources: readonly (readonly CandleLike[])[],
): CandleLike[] {
  const byMinute = new Map<string, CandleLike>();
  for (const source of sources) {
    for (const candle of source) {
      if (!candle || typeof candle.time !== "string") continue;
      const key = minuteKey(candle.time);
      if (!byMinute.has(key)) byMinute.set(key, candle);
    }
  }
  return [...byMinute.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * The chart's base candle series: the 1-minute intraday candles when
 * present, else the EOD candles, else the caller-supplied fallback candles
 * (spot-derived 1-minute OHLC when available, else the tape-derived bars) —
 * each scoped to `sessionDate`. A source whose rows all fall outside the
 * session is skipped entirely, so a previous day's series can never be
 * mixed with today's tape.
 */
export function selectBaseCandles(
  report: Pick<NiftyReport, "intraday" | "candles">,
  tapeCandles: readonly CandleLike[],
  sessionDate: string,
): CandleLike[] {
  const intraday = (report.intraday ?? []).filter((c) =>
    isOnSession(c.time, sessionDate),
  );
  if (intraday.length > 0) return intraday;
  const candles = (report.candles ?? []).filter((c) =>
    isOnSession(c.time, sessionDate),
  );
  if (candles.length > 0) return candles;
  return [...tapeCandles];
}

/**
 * Stop the series at the replay playhead so the chart cannot show candles
 * from the future. Rows whose `time` sorts after `asOf` (ISO strings compare
 * lexicographically) are dropped; when `asOf` is absent the input is
 * returned untouched.
 */
export function clipToAsOf<T extends { time: string }>(
  candles: readonly T[],
  asOf?: string | null,
): T[] {
  if (!asOf) return [...candles];
  const limitMs = Date.parse(asOf);
  if (!Number.isFinite(limitMs)) {
    // Last-resort lexical compare for non-ISO fixtures.
    return candles.filter((candle) => candle.time <= asOf);
  }
  // Compare minute buckets, not raw strings: `09:17:00+05:30` and
  // `09:17:00.123+05:30` are the same bar, and offset formatting must not
  // silently drop the playhead candle.
  const limitMinute = Math.floor(limitMs / 60_000);
  return candles.filter((candle) => {
    const ms = Date.parse(candle.time);
    return Number.isFinite(ms) ? Math.floor(ms / 60_000) <= limitMinute : candle.time <= asOf;
  });
}

/**
 * Pick the freshest candle source among the report's intraday, candles, and
 * spot-derived candles. Tape-derived candles are used only when ALL other
 * sources are empty.
 *
 * The winner is the source whose **last candle's timestamp** is the most
 * recent (after session filtering). This prevents a stale REST snapshot from
 * beating newer 10-second chain spots.
 *
 * Spot candles are only considered a valid candidate when they have >= 2
 * minutes of data (for true OHLC with wicks). With fewer than 2 minutes,
 * we fall back to tape candles (which provide body-only bars).
 *
 * Tiebreaker: when timestamps are equal, prefer intraday > candles > spots
 * (original source priority).
 */
export function pickFreshestCandles(
  report: Pick<NiftyReport, "intraday" | "candles">,
  spotCandles: readonly NiftyIntradayCandle[],
  tapeCandles: readonly CandleLike[],
  sessionDate: string,
): CandleLike[] {
  const sessionIntraday = (report.intraday ?? []).filter((c) =>
    isOnSession(c.time, sessionDate),
  );
  const sessionCandles = (report.candles ?? []).filter((c) =>
    isOnSession(c.time, sessionDate),
  );
  const sessionTape = tapeCandles.filter((c) => isOnSession(c.time, sessionDate));

  // All three 1-minute sources are complementary, not alternatives. Merge
  // them by minute so a fresh but short spot series cannot discard the
  // morning's intraday history (and tape can fill a spot/feed hole).
  const merged = mergeCandleSeries([
    sessionIntraday,
    spotCandles,
    sessionTape,
  ]);
  if (merged.length > 0) return merged;

  // EOD candles are 15-minute bars: only use them when there is no 1-minute
  // source at all. Mixing them into a 1m chart would invent off-grid bars.
  if (sessionCandles.length > 0) return sessionCandles;
  return [];
}