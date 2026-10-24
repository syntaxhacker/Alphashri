/** Pure layout maths for the US report (kept out of components so it is testable). */
import type { UsRow, UsStrike } from "../../../types/usReport";

export interface LadderRow extends UsStrike {
  isCallWall: boolean;
  isPutWall: boolean;
  isMaxPain: boolean;
  /** The strike equals the live spot. */
  isSpot: boolean;
  /** Synthetic separator row (only when no listed strike equals spot). */
  isMarker: boolean;
}

export interface Ladder {
  rows: LadderRow[];
  maxOi: number;
  /** Wider than the ladder window: walls/pain outside it are pinned in anyway. */
  windowPct: number;
}

const SPOT_ROW = 0;

function nearestByActivity(strikes: UsStrike[], spot: number, limit: number): UsStrike[] {
  const ranked = [...strikes].sort((a, b) => {
    const da = Math.abs(a.k - spot);
    const db = Math.abs(b.k - spot);
    if (da !== db) return da - db;
    return b.c_oi + b.p_oi - (a.c_oi + a.p_oi);
  });
  return ranked.slice(0, limit);
}

/** Trim a full chain to a dense terminal ladder around spot, walls included. */
export function buildLadder(row: UsRow, maxRows = 26): Ladder {
  const spot = row.spot;
  const windowPct = 0.025;
  const inWindow = row.strikes.filter((s) => Math.abs(s.k / spot - 1) <= windowPct);
  const picked = new Map<number, UsStrike>();
  for (const s of nearestByActivity(inWindow.length ? inWindow : row.strikes, spot, maxRows)) {
    picked.set(s.k, s);
  }
  // Always keep the levels the tape exists to explain.
  for (const k of [row.call_wall, row.put_wall, row.max_pain]) {
    if (!Number.isFinite(k)) continue;
    if (Math.abs(k / spot - 1) > 0.06) continue;
    const s = row.strikes.find((x) => x.k === k);
    if (s) picked.set(s.k, s);
  }

  const rows: LadderRow[] = [...picked.values()]
    .sort((a, b) => b.k - a.k)
    .map((s) => ({
      ...s,
      isCallWall: s.k === row.call_wall,
      isPutWall: s.k === row.put_wall,
      isMaxPain: s.k === row.max_pain,
      isSpot: s.k === spot,
      isMarker: false,
    }));

  if (!rows.some((r) => r.isSpot)) {
    rows.push({
      k: spot,
      c_oi: SPOT_ROW,
      c_vol: 0,
      p_oi: SPOT_ROW,
      p_vol: 0,
      g: 0,
      isCallWall: false,
      isPutWall: false,
      isMaxPain: false,
      isSpot: true,
      isMarker: true,
    });
    rows.sort((a, b) => b.k - a.k);
  }

  const maxOi = rows.reduce((m, r) => Math.max(m, r.c_oi, r.p_oi), 1);
  return { rows, maxOi, windowPct };
}

export interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * 1-minute tape rows → candles. Rows written before the 10 s sampler landed
 * carry ``o=h=l=c``; those become close-to-close bodies so the chart still
 * reads as candles instead of a row of dashes.
 */
export function toBars(frames: UsRow[], bucketMin = 1): Candle[] {
  if (!frames.length) return [];
  const raw: Candle[] = frames.map((f, i) => {
    const c = f.c ?? f.spot;
    const prev = i ? (frames[i - 1].c ?? frames[i - 1].spot) : (f.o ?? c);
    const flat = f.h != null && f.l != null && f.h === f.l && (f.o ?? c) === c;
    const o = flat ? prev : (f.o ?? prev);
    return {
      t: f.t,
      o,
      c,
      h: flat ? Math.max(o, c) : (f.h ?? Math.max(o, c)),
      l: flat ? Math.min(o, c) : (f.l ?? Math.min(o, c)),
    };
  });
  if (bucketMin <= 1) return raw;

  const bucketMs = bucketMin * 60_000;
  const out: Candle[] = [];
  let key: number | null = null;
  for (const b of raw) {
    const k = Math.floor(new Date(b.t).getTime() / bucketMs);
    if (out.length && k === key) {
      const last = out[out.length - 1];
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
    } else {
      out.push({ ...b });
      key = k;
    }
  }
  return out;
}

export interface ChartGeometry {
  width: number;
  height: number;
  min: number;
  max: number;
  cursorX: number;
}

const W = 1000;
const H = 260;

/**
 * Scale to the traded candles, plus any wall the caller wants inside the frame
 * (near walls should be visible; far ones get an edge tag instead).
 */
export function buildChart(bars: Candle[], cursor: number, include: number[] = []): ChartGeometry | null {
  if (!bars.length) return null;
  const lo = Math.min(...bars.map((b) => b.l), ...include);
  const hi = Math.max(...bars.map((b) => b.h), ...include);
  const pad = (hi - lo) * 0.06 || Math.max(1, hi * 0.0005);
  return {
    width: W,
    height: H,
    min: lo - pad,
    max: hi + pad,
    cursorX: bars.length === 1 ? 0 : (Math.max(0, Math.min(cursor, bars.length - 1)) / (bars.length - 1)) * W,
  };
}

export function niceTicks(min: number, max: number, n = 4): number[] {
  return Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return Math.round(v).toLocaleString("en-US");
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });
}
