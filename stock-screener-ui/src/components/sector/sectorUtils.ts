import type { SectorItem, StockMover } from "../../types/sector";

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
