// edgeAnalytics — pure aggregations behind the Edge AI panel. All grouping is
// timezone-aware (IST) and returns labelled buckets ready to render as bars.
import type { Trade } from "../../types/backtest";

export interface EdgeBucket {
  key: string;
  label: string;
  count: number;
  wins: number;
  netPnl: number;
}

export const winRate = (b: EdgeBucket): number => (b.count > 0 ? (b.wins / b.count) * 100 : 0);

/** First bucket with the highest net P&L (only if positive). */
export function bestBucket(buckets: EdgeBucket[]): EdgeBucket | null {
  const positive = buckets.filter((b) => b.netPnl > 0);
  return positive.length ? positive.reduce((a, b) => (b.netPnl > a.netPnl ? b : a)) : null;
}

/** Bucket with the lowest net P&L (only if negative). */
export function worstBucket(buckets: EdgeBucket[]): EdgeBucket | null {
  const negative = buckets.filter((b) => b.netPnl < 0);
  return negative.length ? negative.reduce((a, b) => (b.netPnl < a.netPnl ? b : a)) : null;
}

interface Ordered {
  key: string;
  label: string;
  order: number;
}

export function bucketBy(
  trades: Trade[],
  keyFn: (t: Trade) => Ordered | null,
  sortByNet = false,
): EdgeBucket[] {
  const map = new Map<string, EdgeBucket & { order: number }>();
  for (const t of trades) {
    const k = keyFn(t);
    if (!k) continue;
    let b = map.get(k.key);
    if (!b) {
      b = { key: k.key, label: k.label, count: 0, wins: 0, netPnl: 0, order: k.order };
      map.set(k.key, b);
    }
    b.count += 1;
    b.netPnl += t.net_pnl;
    if (t.net_pnl > 0) b.wins += 1;
  }
  const list = [...map.values()];
  list.sort(sortByNet ? (a, b) => b.netPnl - a.netPnl : (a, b) => a.order - b.order);
  return list.map(({ order: _order, ...rest }) => rest);
}

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" });

function toDate(s: string | undefined): Date | null {
  if (!s) return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : `${iso}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function entryHour(t: Trade): number | null {
  const d = toDate(t.entry_time);
  if (!d) return null;
  const h = Number(hourFmt.format(d));
  if (!Number.isFinite(h)) return null;
  return h === 24 ? 0 : h;
}

const DAY_ORDER: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function entryWeekday(t: Trade): string | null {
  const d = toDate(t.entry_time);
  return d ? dayFmt.format(d) : null;
}

export function sideEdge(trades: Trade[]): EdgeBucket[] {
  return bucketBy(trades, (t) => {
    const side = ((t as unknown as { side?: string }).side || "LONG").toUpperCase();
    return { key: side, label: side === "SHORT" ? "Short" : "Long", order: side === "SHORT" ? 1 : 0 };
  });
}

export function hourEdge(trades: Trade[]): EdgeBucket[] {
  return bucketBy(trades, (t) => {
    const h = entryHour(t);
    if (h == null) return null;
    const hh = String(h).padStart(2, "0");
    const next = String((h + 1) % 24).padStart(2, "0");
    return { key: hh, label: `${hh}–${next}`, order: h };
  });
}

export function weekdayEdge(trades: Trade[]): EdgeBucket[] {
  return bucketBy(trades, (t) => {
    const day = entryWeekday(t);
    if (!day) return null;
    return { key: day, label: day, order: DAY_ORDER[day] ?? 9 };
  });
}

const HOLD_BUCKETS: { key: string; label: string; max: number; order: number }[] = [
  { key: "lt15", label: "<15m", max: 15, order: 0 },
  { key: "15to60", label: "15–60m", max: 60, order: 1 },
  { key: "1to4h", label: "1–4h", max: 240, order: 2 },
  { key: "gt4h", label: ">4h", max: Infinity, order: 3 },
];

export function holdEdge(trades: Trade[]): EdgeBucket[] {
  return bucketBy(trades, (t) => {
    const mins = t.hold_duration_minutes;
    if (mins == null) return null;
    const b = HOLD_BUCKETS.find((x) => mins < x.max) ?? HOLD_BUCKETS[HOLD_BUCKETS.length - 1];
    return { key: b.key, label: b.label, order: b.order };
  });
}

export function exitReasonEdge(trades: Trade[]): EdgeBucket[] {
  return bucketBy(
    trades,
    (t) => {
      const reason = t.exit_reason || "EOD";
      return { key: reason, label: reason, order: 0 };
    },
    true,
  );
}
