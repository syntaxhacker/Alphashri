import type { WallsFlow, WallsPayload, WallsRow } from "@/api/reportNifty";

/** Pure reads behind the Index Report pressure desk. Keeping the classification
 *  and the 30m indexing here lets the component stay a renderer. */

export type PressureSide = "CALL" | "PUT";
export type PressureQuadrant = "NE" | "SE" | "NW" | "SW";
export type ConfidenceLevel = "high" | "med" | "low";

export interface PressureWall {
  key: string;
  side: PressureSide;
  strike: number;
  row: WallsRow;
  /** 30m OI change in percent, or null when the window is missing. */
  oiPct: number | null;
  /** 30m premium change in percent, or null when the window is missing. */
  premPct: number | null;
  quadrant: PressureQuadrant | null;
}

export interface PressureConfidence {
  level: ConfidenceLevel;
  text: string;
}

export const wallKey = (side: PressureSide, strike: number): string =>
  `${side}-${strike}`;

export const wallLabel = (side: PressureSide, strike: number): string =>
  `${strike.toLocaleString("en-IN")} ${side === "CALL" ? "CE" : "PE"}`;

const pct = (value: number | null | undefined): number | null =>
  value == null || !Number.isFinite(value) ? null : value * 100;

export function quadrantOf(
  oiPct: number | null | undefined,
  premPct: number | null | undefined,
): PressureQuadrant | null {
  if (
    oiPct == null ||
    premPct == null ||
    !Number.isFinite(oiPct) ||
    !Number.isFinite(premPct)
  ) {
    return null;
  }
  if (oiPct >= 0) return premPct >= 0 ? "NE" : "SE";
  return premPct >= 0 ? "NW" : "SW";
}

export function flowQuadrant(flow: WallsFlow | null | undefined): PressureQuadrant | null {
  switch (flow) {
    case "LONG_BUILD":
      return "NE";
    case "WRITERS_ADDING":
      return "SE";
    case "WRITERS_COVERING":
      return "NW";
    case "LONG_UNWIND":
      return "SW";
    default:
      return null;
  }
}

export function toPressureWall(side: PressureSide, row: WallsRow): PressureWall {
  const oiPct = pct(row.erosion_30m);
  const premPct = pct(row.prem_chg_30m);
  return {
    key: wallKey(side, row.strike),
    side,
    strike: row.strike,
    row,
    oiPct,
    premPct,
    quadrant: quadrantOf(oiPct, premPct) ?? flowQuadrant(row.flow),
  };
}

/** Calls and puts in payload order. The plane takes the first three of each. */
export function combineWalls(payload: WallsPayload): PressureWall[] {
  return [
    ...(payload.calls ?? []).map((row) => toPressureWall("CALL", row)),
    ...(payload.puts ?? []).map((row) => toPressureWall("PUT", row)),
  ];
}

/** Six dots is the point where the leader-label gutter stops being readable. */
export function planeWalls(payload: WallsPayload): PressureWall[] {
  return [
    ...(payload.calls ?? []).slice(0, 3).map((row) => toPressureWall("CALL", row)),
    ...(payload.puts ?? []).slice(0, 3).map((row) => toPressureWall("PUT", row)),
  ];
}

export function confidenceOf(row: WallsRow): PressureConfidence {
  const windows = [
    { label: "5m", q: quadrantOf(pct(row.erosion_5m), pct(row.prem_chg_5m)) },
    { label: "15m", q: quadrantOf(pct(row.erosion_15m), pct(row.prem_chg_15m)) },
    { label: "30m", q: quadrantOf(pct(row.erosion_30m), pct(row.prem_chg_30m)) },
  ].filter((entry) => entry.q != null);

  if (windows.length === 0) {
    return { level: "low", text: "no window read" };
  }
  if (windows.length === 1) {
    return { level: "low", text: `${windows[0].label} only` };
  }

  const unique = new Set(windows.map((entry) => entry.q));
  const labels = windows.map((entry) => entry.label).join("/");
  if (unique.size === 1) {
    return {
      level: windows.length >= 3 ? "high" : "med",
      text: `${labels} agree`,
    };
  }
  if (unique.size === 2) {
    return {
      level: "med",
      text: `${windows[0].label} vs ${windows[windows.length - 1].label} mixed`,
    };
  }
  return { level: "low", text: "5/15/30 conflict" };
}

export function sentenceFor(quadrant: PressureQuadrant | null): string {
  switch (quadrant) {
    case "NE":
      return "Buyers are adding: OI building, premium up.";
    case "SE":
      return "Sellers are adding: OI building, premium down.";
    case "NW":
      return "Sellers are covering: OI falling, premium up.";
    case "SW":
      return "Buyers are unwinding: OI falling, premium down.";
    default:
      return "Flow is not classified for this wall.";
  }
}

export function isShortGamma(spot: number, flip: number | null | undefined): boolean {
  return flip != null && Number.isFinite(flip) && spot < flip;
}

export function whyRead(
  row: WallsRow,
  spot: number,
  flip: number | null | undefined,
): string {
  const status = row.status ?? "STABLE";
  if (status === "BREACHED") {
    return "Wall is broken; the level flips to support/resistance.";
  }
  const quadrant =
    quadrantOf(pct(row.erosion_30m), pct(row.prem_chg_30m)) ??
    flowQuadrant(row.flow);
  const short = isShortGamma(spot, flip);
  switch (quadrant) {
    case "NW":
      return short
        ? "Short gamma: covering can accelerate upside through the wall."
        : "Covering is bid; watch for a squeeze into the wall.";
    case "SE":
      return "Writers are adding; a break needs real absorption.";
    case "NE":
      return "Buyers are adding; the move has participation.";
    case "SW":
      return "Buyers are unwinding; the bid is leaving.";
    default:
      return status === "ERODING"
        ? "Wall is eroding; watch for a break."
        : status === "BUILDING"
          ? "Writers are defending; a break needs absorption."
          : "No edge until OI or premium moves.";
  }
}

export function pathRead(row: WallsRow): string {
  const oi = row.erosion_30m;
  const prem = row.prem_chg_30m;
  if (oi == null || prem == null) return "30m path unavailable";
  if (oi < 0 && prem > 0) return "premium bid while OI falls — covering";
  if (oi > 0 && prem < 0) return "OI builds while premium falls — writing";
  if (oi > 0) return "OI and premium build — new longs";
  return "OI and premium fall — longs unwinding";
}

/** Index a series to 100 at its first finite value and carry gaps forward. */
export function normalizeHistory(
  values: ReadonlyArray<number | null | undefined>,
): (number | null)[] {
  let baseline: number | null = null;
  let last: number | null = null;
  return values.map((value) => {
    if (value != null && Number.isFinite(value) && value > 0) {
      if (baseline == null) baseline = value;
      last = value;
    }
    if (baseline == null || last == null) return null;
    return (last / baseline) * 100;
  });
}

export function nearestWall(
  walls: ReadonlyArray<PressureWall>,
  spot: number,
): PressureWall | null {
  let best: PressureWall | null = null;
  let bestDistance = Infinity;
  for (const wall of walls) {
    const distance = Math.abs(wall.strike - spot);
    if (distance < bestDistance) {
      best = wall;
      bestDistance = distance;
    }
  }
  return best;
}

export function largestMoves(walls: ReadonlyArray<PressureWall>): {
  oi: PressureWall | null;
  premium: PressureWall | null;
} {
  let oi: PressureWall | null = null;
  let premium: PressureWall | null = null;
  for (const wall of walls) {
    const oiMove = Math.abs(wall.oiPct ?? 0);
    const premMove = Math.abs(wall.premPct ?? 0);
    if (!oi || oiMove > Math.abs(oi.oiPct ?? 0)) oi = wall;
    if (!premium || premMove > Math.abs(premium.premPct ?? 0)) premium = wall;
  }
  return { oi, premium };
}

export function flowText(flow: WallsFlow | null | undefined): string {
  switch (flow) {
    case "WRITERS_COVERING":
      return "sellers covering";
    case "LONG_BUILD":
      return "buyers building";
    case "WRITERS_ADDING":
      return "sellers building";
    case "LONG_UNWIND":
      return "buyers unwinding";
    default:
      return "flow unread";
  }
}

/** Headline flow on the desk is the 30m phase-plane read, not the backend's
 *  5m token — mixing horizons made the sentence and the label disagree. */
export function quadrantFlowText(quadrant: PressureQuadrant | null): string {
  switch (quadrant) {
    case "NE":
      return "buyers building";
    case "SE":
      return "sellers building";
    case "NW":
      return "sellers covering";
    case "SW":
      return "buyers unwinding";
    default:
      return "flow unread";
  }
}
