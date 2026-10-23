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

export interface ChartGeometry {
  width: number;
  height: number;
  spot: string;
  putWall: string;
  callWall: string;
  maxPain: string;
  cursorX: number;
  min: number;
  max: number;
}

const W = 1000;
const H = 260;

/** SVG polylines (no scaling distortion: viewBox is fixed 1000x260). */
export function buildChart(frames: UsRow[], cursor: number): ChartGeometry | null {
  if (!frames.length) return null;

  // Keep the y-range tight around the traded spot. A call wall 5% away would
  // otherwise flatten the entire session into the bottom 2% of the chart; far
  // levels stay in the legend and get an edge marker instead.
  const spots = frames.map((f) => f.spot);
  const mid = spots.reduce((a, b) => a + b, 0) / spots.length;
  const near = (v: number) => Math.abs(v / mid - 1) <= 0.025;
  const vals = [...spots];
  for (const f of frames) {
    if (f.h != null) vals.push(f.h);
    if (f.l != null) vals.push(f.l);
    for (const v of [f.call_wall, f.put_wall, f.max_pain]) {
      if (near(v)) vals.push(v);
    }
  }

  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || mid * 0.002;
  const min = lo - pad;
  const max = hi + pad;

  const x = (i: number) => (frames.length === 1 ? 0 : (i / (frames.length - 1)) * W);
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const line = (get: (f: UsRow) => number) =>
    frames.map((f, i) => `${x(i).toFixed(1)},${y(get(f)).toFixed(1)}`).join(" ");

  return {
    width: W,
    height: H,
    spot: line((f) => f.spot),
    putWall: line((f) => f.put_wall),
    callWall: line((f) => f.call_wall),
    maxPain: line((f) => f.max_pain),
    cursorX: x(Math.max(0, Math.min(cursor, frames.length - 1))),
    min,
    max,
  };
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
