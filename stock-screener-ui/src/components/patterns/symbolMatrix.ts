import { selectLastN } from "./selectLastN";
import type { PatternHitDTO, PatternMatrixCell, PatternMatrixRow } from "@/types/chartPatterns";

export type MatrixCell = PatternMatrixCell;
export type { PatternMatrixRow };

const TF_LABELS: Record<string, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "10m": "10m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "2h": "2h",
  "3h": "3h",
  "4h": "4h",
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  "6M": "6M",
  "1Y": "1Y",
};

const TF_ORDER = ["1m", "3m", "5m", "10m", "15m", "30m", "1h", "2h", "3h", "4h", "1D", "1W", "1M", "6M", "1Y"];

export function formatTfLabel(tf: string): string {
  if (!tf) return "";
  const raw = tf.trim();
  const exact = TF_LABELS[raw];
  if (exact) return exact;
  if (/^\d+[mh]$/.test(raw)) return raw;
  return raw.toUpperCase();
}

// Canonical home is `./patternFormat`; re-exported so existing imports keep working.
export { formatMatrixPrice, formatMatrixPct } from "./patternFormat";

export function directionTone(
  direction: string | null | undefined,
): "success" | "error" | "dimmed" {
  const key = String(direction ?? "").toLowerCase();
  if (key === "bullish") return "success";
  if (key === "bearish") return "error";
  return "dimmed";
}

export function directionGlyph(direction: string | null | undefined): string {
  const key = String(direction ?? "").toLowerCase();
  if (key === "bullish") return "▲";
  if (key === "bearish") return "▼";
  return "◆";
}

function tfRank(tf: string): number {
  const exact = TF_ORDER.indexOf(tf);
  if (exact >= 0) return exact;
  const lower = tf.toLowerCase();
  const loose = TF_ORDER.findIndex((t) => t.toLowerCase() === lower);
  return loose >= 0 ? loose : TF_ORDER.length;
}

export function matrixTfOrder(timeframes: string[]): string[] {
  return [...timeframes].sort((a, b) => tfRank(a) - tfRank(b));
}

export function isFresherHit(a: PatternHitDTO, b: PatternHitDTO): boolean {
  const barsA = a.bars_ago ?? Number.POSITIVE_INFINITY;
  const barsB = b.bars_ago ?? Number.POSITIVE_INFINITY;
  if (barsA !== barsB) return barsA < barsB;
  const endA = a.end_date ?? "";
  const endB = b.end_date ?? "";
  if (endA !== endB) return endA > endB;
  return (a.id ?? 0) > (b.id ?? 0);
}

export function lastNHitsPerTimeframe(hits: PatternHitDTO[], n: number): PatternHitDTO[] {
  const byKey = new Map<string, PatternHitDTO[]>();
  for (const hit of hits) {
    const key = `${hit.symbol}|${hit.timeframe}`;
    const group = byKey.get(key);
    if (group) group.push(hit);
    else byKey.set(key, [hit]);
  }
  const indexOf = new Map<PatternHitDTO, number>();
  hits.forEach((hit, index) => indexOf.set(hit, index));
  const picked = [...byKey.values()]
    .map((group) => selectLastN(group, n))
    .filter((group) => group.length > 0);
  // Order rows by the hit that is actually displayed, not by the group's best
  // hit. Otherwise a symbol whose newest hit sits further from the trigger can
  // jump ahead of a closer one just because an older duplicate sorted earlier.
  picked.sort((a, b) => (indexOf.get(a[0]) ?? 0) - (indexOf.get(b[0]) ?? 0));
  return picked.flat();
}

export function latestHitPerTimeframe(hits: PatternHitDTO[]): PatternHitDTO[] {
  const byKey = new Map<string, PatternHitDTO>();
  const order: string[] = [];
  for (const hit of hits) {
    const key = `${hit.symbol}|${hit.timeframe}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, hit);
      order.push(key);
    } else if (isFresherHit(hit, prev)) {
      byKey.set(key, hit);
    }
  }
  return order.map((key) => byKey.get(key)).filter((hit): hit is PatternHitDTO => Boolean(hit));
}

export function mergeMatrixQuotes(
  rows: PatternMatrixRow[],
  hits: PatternHitDTO[],
): PatternMatrixRow[] {
  if (hits.length === 0) return rows;
  const quotes = new Map<
    string,
    { ltp: number | null; change: number | null; explicit: boolean }
  >();
  for (const hit of hits) {
    const prev = quotes.get(hit.symbol);
    const ltp = hit.last_close ?? hit.end_price ?? null;
    const explicit = hit.day_change_pct != null;
    const fallback = hit.start_price
      ? ((hit.end_price - hit.start_price) / hit.start_price) * 100
      : null;
    const change = hit.day_change_pct ?? fallback;
    quotes.set(hit.symbol, {
      ltp: prev?.ltp ?? ltp,
      change:
        hit.day_change_pct ??
        (prev?.explicit ? prev.change : (change ?? prev?.change ?? null)),
      explicit: explicit || (prev?.explicit ?? false),
    });
  }
  return rows.map((row) => {
    const quote = quotes.get(row.symbol);
    const best = row.best;
    const move =
      best?.start_price && Number.isFinite(best.start_price) && Number.isFinite(best.end_price)
        ? ((best.end_price - best.start_price) / best.start_price) * 100
        : null;
    return {
      ...row,
      ltp: quote?.ltp ?? row.ltp ?? best?.end_price ?? null,
      day_change_pct: quote?.change ?? row.day_change_pct ?? move,
    };
  });
}
