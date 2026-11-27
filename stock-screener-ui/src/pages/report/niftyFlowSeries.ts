
export interface FlowSeriesTapeRow {
  t: string;
  call_doi?: number | null;
  put_doi?: number | null;
  net?: number | null;
  net_pct?: number | null;
  net_gex?: number | null;
  gex_degraded?: boolean;
}

export type GexRegime = "long" | "short" | null;

import { safeNumNull } from "@/utils/reportParsers";
import { ascTapeByTime } from "./tapeRange";

export interface FlowSeriesPoint {
  t: string;
  net: number;
  gex: number | null;
  regime: GexRegime;
}

export interface FlowSeries {
  points: FlowSeriesPoint[];
  min: number;
  max: number;
  flips: string[];
  shortShare: number;
}

export function buildFlowSeries(rows: FlowSeriesTapeRow[]): FlowSeries {
  const asc = ascTapeByTime(rows);

  const points: FlowSeriesPoint[] = [];
  for (const row of asc) {
    const call = safeNumNull(row.call_doi);
    const put = safeNumNull(row.put_doi);
    const value =
      call !== null || put !== null
        ? (call ?? 0) - (put ?? 0)
        : safeNumNull(row.net_pct) ?? safeNumNull(row.net);
    if (value === null) continue;
    const gex = row.gex_degraded ? null : safeNumNull(row.net_gex);
    const regime: GexRegime = gex === null ? null : gex < 0 ? "short" : "long";
    points.push({ t: row.t.slice(11, 16), net: value, gex, regime });
  }
  const base = points.length ? points[0].net : 0;
  for (const p of points) p.net -= base;

  const values = points.map((p) => p.net);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);

  const flips: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].regime;
    const b = points[i].regime;
    if (a !== null && b !== null && a !== b) flips.push(points[i].t);
  }
  const withRegime = points.filter((p) => p.regime !== null);
  const shortShare = withRegime.length
    ? withRegime.filter((p) => p.regime === "short").length / withRegime.length
    : 0;

  return { points, min, max, flips, shortShare };
}
