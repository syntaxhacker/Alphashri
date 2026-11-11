/**
 * Cumulative OI flow + dealer-gamma regime per minute — pure, no React.
 *
 * `net`/`net_pct` on the tape is cumulative from the session start, so the line
 * is a running positioning score, not a per-minute print: price rising while
 * the line stalls or falls is absorption (someone is selling the move).
 *
 * `net_gex` signs the BOOK net-gamma regime per minute (negative = short gamma,
 * hedging chases the move). It is the book total, not the spot-relative read the
gamma strip shows; both are labelled so they cannot be confused. Regime flips
are the moments the tape changes
 * character, so they are returned separately for markers.
 */

export interface FlowSeriesTapeRow {
  t: string;
  /** Cumulative change-in-OI from the session start (contracts). */
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
  /** HH:MM. */
  t: string;
  /** Cumulative flow (net_pct when present, else net). */
  net: number;
  /** Per-minute net dealer gamma (Cr/pt), null when the block was absent. */
  gex: number | null;
  regime: GexRegime;
}

export interface FlowSeries {
  points: FlowSeriesPoint[];
  /** Min/max of `net`, with 0 always included so the zero line is drawable. */
  min: number;
  max: number;
  /** HH:MM labels where the gamma regime flipped. */
  flips: string[];
  /** Share of minutes in short gamma (0..1). */
  shortShare: number;
}

export function buildFlowSeries(rows: FlowSeriesTapeRow[]): FlowSeries {
  const asc = ascTapeByTime(rows);

  const points: FlowSeriesPoint[] = [];
  for (const row of asc) {
    // Cumulative OI flow: call ΔOI − put ΔOI (positive = call side building).
    // The tape's net/net_pct are not written by the recorder, so this is the
    // only per-minute source that actually exists.
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
  // Zero-base the line at the session's first minute so it reads as drift.
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
