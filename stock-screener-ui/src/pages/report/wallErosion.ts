import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import { formatReportPoints } from "./reportFormat";
import {
  erosionArrow,
  flowLabel,
  flowTone,
  fmtNum,
  fmtOI,
  fmtPct,
  fmtPremChange,
  fmtRate,
  fmtTimeToBreak,
  fmtVolMult,
  statusTone,
} from "./niftyWallsFormat";

const DASH = "—";

/** Signed distance from spot for a row; falls back to strike − spot. */
function absDistance(row: WallsRow, spot: number): number | null {
  const raw = row.distance_pts;
  if (raw != null && Number.isFinite(raw)) return Math.abs(raw);
  if (Number.isFinite(row.strike) && Number.isFinite(spot)) {
    return Math.abs(row.strike - spot);
  }
  return null;
}

function nearestByAbsDistance(rows: WallsRow[], spot: number): WallsRow | null {
  let best: WallsRow | null = null;
  let bestAbs = Infinity;
  for (const row of rows) {
    if (!row) continue;
    const abs = absDistance(row, spot);
    if (abs == null) continue;
    if (abs < bestAbs) {
      bestAbs = abs;
      best = row;
    }
  }
  return best;
}

/** Raw finite fuel, 0 when absent — comparisons only, callers clamp for display. */
function fuelOfRow(row: WallsRow): number {
  const fuel = row.fuel_score;
  return typeof fuel === "number" && Number.isFinite(fuel) ? fuel : 0;
}

/**
 * The live wall on this side: a BREACHED row always outranks an ERODING one
 * (highest fuel wins within each class); ERODING needs fuel >= 60 so a slow
 * bleed doesn't hijack the board. Deliberately not filtered by side of spot —
 * a breached call can sit at/below spot.
 */
function activeWall(rows: WallsRow[] | undefined): WallsRow | null {
  if (!Array.isArray(rows)) return null;
  let breached: WallsRow | null = null;
  let eroding: WallsRow | null = null;
  for (const row of rows) {
    if (!row) continue;
    const fuel = fuelOfRow(row);
    if (row.status === "BREACHED") {
      if (!breached || fuel > fuelOfRow(breached)) breached = row;
    } else if (row.status === "ERODING" && fuel >= 60) {
      if (!eroding || fuel > fuelOfRow(eroding)) eroding = row;
    }
  }
  return breached ?? eroding;
}

/** Active wall wins when nearest is missing, when it BREACHed, or on fuel parity. */
function chooseWall(
  nearest: WallsRow | null,
  active: WallsRow | null,
): WallsRow | null {
  if (!active) return nearest;
  if (!nearest) return active;
  if (active.status === "BREACHED") return active;
  return fuelOfRow(active) >= fuelOfRow(nearest) ? active : nearest;
}

/**
 * Wall per side: prefer the backend's `nearest_call`/`nearest_put`; otherwise
 * pick the row whose |distance| is smallest, biasing calls to strikes at/above
 * spot and puts to strikes at/below it. When the side has an ACTIVE wall
 * (BREACHED, or ERODING with fuel >= 60) it overrides the nearest — an intact
 * wall above spot is not the event the tape is pricing. Call/put never
 * cross-select.
 */
export function pickNearestWalls(walls: WallsPayload | null): {
  call: WallsRow | null;
  put: WallsRow | null;
} {
  if (!walls) return { call: null, put: null };
  const spot = walls.spot;
  const nearestFor = (side: "CALL" | "PUT"): WallsRow | null => {
    const backend = side === "CALL" ? walls.nearest_call : walls.nearest_put;
    if (backend != null) return backend;
    const rows = side === "CALL" ? walls.calls : walls.puts;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const onSide = rows.filter(
      (r) =>
        Number.isFinite(r?.strike) &&
        Number.isFinite(spot) &&
        (side === "CALL" ? r.strike >= spot : r.strike <= spot),
    );
    return nearestByAbsDistance(onSide.length > 0 ? onSide : rows, spot);
  };
  const rowsFor = (side: "CALL" | "PUT") =>
    side === "CALL" ? walls.calls : walls.puts;
  return {
    call: chooseWall(nearestFor("CALL"), activeWall(rowsFor("CALL"))),
    put: chooseWall(nearestFor("PUT"), activeWall(rowsFor("PUT"))),
  };
}

/** Finite values only, for the sparkline; non-finite entries are dropped. */
export const sparkPoints = (values: number[]): number[] => {
  if (!Array.isArray(values)) return [];
  return values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
};

export type FuelTone = "positive" | "warning" | "negative" | "muted";

/**
 * Fuel is an urgency meter, not P&L — high scores mean "about to break".
 * ≥70 reads as pre-blast (warning), 45-69 as loaded (positive), anything
 * lower muted.
 */
export const fuelTone = (points: number): FuelTone => {
  if (!Number.isFinite(points)) return "muted";
  if (points >= 70) return "warning";
  if (points >= 45) return "positive";
  return "muted";
};

/** Short-gamma regime + an eroding/breached wall + high fuel = break imminent. */
export const isPreBlast = (
  row: WallsRow | null | undefined,
  regime: "LONG" | "SHORT" | null | undefined,
): boolean => {
  if (!row || regime !== "SHORT") return false;
  if (row.status !== "ERODING" && row.status !== "BREACHED") return false;
  const fuel = row.fuel_score;
  if (fuel == null || !Number.isFinite(fuel) || fuel < 60) return false;
  const vol = row.vol_mult;
  // vol_mult absent = no volume confirmation yet, but don't block on it.
  if (vol != null && Number.isFinite(vol) && vol < 1.2) return false;
  return true;
};

export interface WallErosionView {
  strikeText: string;
  distanceText: string;
  oiText: string;
  erosion30Text: string;
  rateText: string;
  volText: string;
  flowText: string;
  flowTone: "bull" | "bear" | "muted";
  statusText: string;
  statusTone: "positive" | "warning" | "negative" | "muted";
  arrow: "▲" | "▼" | "—";
  fuelScore: number;
  timeText: string;
  premText: string;
  spark: number[];
  breached: boolean;
}

const fuelScoreOf = (row: WallsRow | null): number => {
  const raw = row?.fuel_score;
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.min(100, Math.max(0, Math.round(raw)));
};

/** Everything a wall-erosion cell needs, dashed out for a null row. */
export function wallErosionView(
  row: WallsRow | null,
  side: "CALL" | "PUT",
): WallErosionView {
  return {
    strikeText: row && Number.isFinite(row.strike) ? fmtNum(row.strike, 0) : DASH,
    distanceText: formatReportPoints(row?.distance_pts),
    oiText: fmtOI(row?.oi),
    erosion30Text: fmtPct(row?.erosion_30m),
    rateText: fmtRate(row?.erosion_rate_30m),
    volText: fmtVolMult(row?.vol_mult),
    flowText: flowLabel(row?.flow),
    flowTone: flowTone(row?.flow),
    statusText: row?.status ?? DASH,
    statusTone: statusTone(row?.status),
    arrow: erosionArrow(side, row?.status),
    fuelScore: fuelScoreOf(row),
    timeText: fmtTimeToBreak(row?.time_to_break_min),
    premText: fmtPremChange(row?.prem_chg_5m),
    spark: sparkPoints(row?.oi_history ?? []),
    breached: row?.status === "BREACHED",
  };
}
