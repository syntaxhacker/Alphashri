import type { SectorItem, StockMover } from "../../types/sector";

/**
 * Sector change/return formatter.
 *
 * `(-0.001).toFixed(1)` is `"-0.0"`, which the old shared helper printed as
 * `-0.0%` on a flat row. Sector rows treat a value that rounds to zero as
 * exactly zero: no leading minus and no leading plus (`0.0%`).
 */
/** Backend mover strings arrive preformatted (e.g. `TCS(-0.0%)`). */
export function normalizePercentText(raw: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?%$/.exec(raw.trim());
  if (!match) return raw;
  const decimals = match[3]?.length ?? 0;
  const value = Number(`${match[1]}${match[2]}${match[3] ? `.${match[3]}` : ""}`);
  if (!Number.isFinite(value)) return raw;
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) || rounded === 0
    ? `${(0).toFixed(decimals)}%`
    : raw;
}

export function formatSectorPercentage(
  value: number | null | undefined,
  precision: number = 2,
  showSign: boolean = true,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(precision));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const sign = showSign && normalized > 0 ? "+" : "";
  return `${sign}${normalized.toFixed(precision)}%`;
}

/**
 * Native anchors activate on Enter, not Space. The sector's decorated-symbol
 * chart links use Space for parity with the dock buttons and every other
 * keyboard-activatable surface, so translate Space to a real anchor click.
 */
export function clickOnSpace(event: KeyboardEvent): void {
  if (event.key !== " " && event.key !== "Spacebar") return;
  event.preventDefault();
  const target = event.currentTarget;
  if (target instanceof HTMLElement) target.click();
}

export interface SectorAlert {
  timestamp: string;
  sector: string;
  direction: "SURGING" | "DROPPING";
  delta: number;
}

export interface InternalStockMover extends StockMover {
  prev_change: number;
  delta: number;
}

export function detectSectorAlerts(
  sectors: SectorItem[],
  prevData: Record<string, number>,
): SectorAlert[] {
  const alerts: SectorAlert[] = [];
  sectors.forEach((item) => {
    const prevChange = prevData[item.sector];
    if (prevChange !== undefined) {
      const delta = item.avg_change - prevChange;
      if (Math.abs(delta) >= 0.3) {
        alerts.push({
          timestamp: new Date().toLocaleTimeString(),
          sector: item.sector,
          direction: delta > 0 ? "SURGING" : "DROPPING",
          delta,
        });
      }
    }
  });
  return alerts;
}

export function detectIntervalMovers(
  movers: StockMover[],
  prevData: Record<string, number>,
): InternalStockMover[] {
  const results: InternalStockMover[] = [];
  movers.forEach((item) => {
    const prevChange = prevData[item.symbol];
    if (prevChange !== undefined) {
      const delta = item.change - prevChange;
      if (Math.abs(delta) >= 0.3) {
        results.push({ ...item, prev_change: prevChange, delta });
      }
    }
  });
  return results.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function buildTreemapData(sectors: SectorItem[]) {
  return [...sectors]
    .map((sector) => ({
      name: sector.sector,
      value: Math.max(Math.abs(sector.avg_change), 0.01),
      avgChange: sector.avg_change,
      stockCount: sector.stock_count,
      advances: sector.advances,
      declines: sector.declines,
      avgRsi: sector.avg_rsi,
      avgAdx: sector.avg_adx,
      topMovers: sector.top_movers,
    }))
    .sort((a, b) => Math.abs(b.avgChange) - Math.abs(a.avgChange) || b.value - a.value);
}
