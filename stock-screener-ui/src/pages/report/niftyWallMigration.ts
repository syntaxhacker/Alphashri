
import { clockMinutes, minutesToHhmm } from "./tapeRange";
import { chainLeg } from "./chainTuple";
import { sortTapeRows } from "./tapeOrder";

export interface WallMigrationRow {
  t: string;
  spot?: number | null;
  atm_strike?: number | null;
  atmStrike?: number | null;
  max_pain?: number | null;
  maxPain?: number | null;
  walls?: {
    call?: number | null;
    put?: number | null;
    calls?: number | null;
    puts?: number | null;
  } | null;
  chain?: Record<string, number[] | undefined> | null;
}

export interface WallMigrationBucket {
  label: string;
  startMin: number | null;
  callWall: number | null;
  putWall: number | null;
  maxPain: number | null;
  atm: number | null;
  spot: number | null;
}

function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export { clockMinutes as parseClockMinutes } from "./tapeRange";

export function bucketStartMinutes(
  t: string | null | undefined,
  bucketMin: number,
): number | null {
  const mins = clockMinutes(t);
  if (mins === null) return null;
  const size = bucketMin > 0 ? bucketMin : 15;
  return Math.floor(mins / size) * size;
}

export function bucketLabel(startMin: number | null): string {
  if (startMin === null || !Number.isFinite(startMin)) return "—";
  return minutesToHhmm(startMin);
}

export function topWallsFromChain(
  chain: WallMigrationRow["chain"],
): { call: number | null; put: number | null } {
  if (!chain || typeof chain !== "object") return { call: null, put: null };
  let call: number | null = null;
  let put: number | null = null;
  let bestCeOi = -Infinity;
  let bestPeOi = -Infinity;
  for (const [key, leg] of Object.entries(chain)) {
    const strike = Number(key);
    if (!Number.isFinite(strike) || !Array.isArray(leg)) continue;
    const { ceOi, peOi } = chainLeg(chain, strike);
    if (ceOi !== null && ceOi > bestCeOi) {
      bestCeOi = ceOi;
      call = strike;
    }
    if (peOi !== null && peOi > bestPeOi) {
      bestPeOi = peOi;
      put = strike;
    }
  }
  return { call, put };
}

export function rowScalars(row: WallMigrationRow): {
  callWall: number | null;
  putWall: number | null;
  maxPain: number | null;
  atm: number | null;
  spot: number | null;
} {
  const walls = row?.walls ?? null;
  return {
    callWall:
      finiteOrNull(walls?.call) ?? finiteOrNull(walls?.calls),
    putWall: finiteOrNull(walls?.put) ?? finiteOrNull(walls?.puts),
    maxPain: finiteOrNull(row?.max_pain) ?? finiteOrNull(row?.maxPain),
    atm: finiteOrNull(row?.atm_strike) ?? finiteOrNull(row?.atmStrike),
    spot: finiteOrNull(row?.spot),
  };
}

export function buildWallMigration(
  rows: WallMigrationRow[],
  opts?: { bucketMin?: number },
): WallMigrationBucket[] {
  const { bucketMin, ordered } = sortTapeRows(rows, 15, opts);
  if (ordered.length === 0) return [];

  const order: Array<number | null> = [];
  const groups = new Map<number | null, WallMigrationRow[]>();
  for (const row of ordered) {
    const start = bucketStartMinutes(row?.t, bucketMin);
    if (!groups.has(start)) {
      groups.set(start, []);
      order.push(start);
    }
    (groups.get(start) as WallMigrationRow[]).push(row);
  }

  return order.map((start) => {
    const bucketRows = groups.get(start) ?? [];
    let callWall: number | null = null;
    let putWall: number | null = null;
    let chainCall: number | null = null;
    let chainPut: number | null = null;
    let maxPain: number | null = null;
    let atm: number | null = null;
    let spot: number | null = null;
    for (const row of bucketRows) {
      const s = rowScalars(row);
      if (s.callWall !== null) callWall = s.callWall;
      if (s.putWall !== null) putWall = s.putWall;
      if (s.maxPain !== null) maxPain = s.maxPain;
      if (s.atm !== null) atm = s.atm;
      if (s.spot !== null) spot = s.spot;
      const tops = topWallsFromChain(row?.chain);
      if (tops.call !== null) chainCall = tops.call;
      if (tops.put !== null) chainPut = tops.put;
    }
    return {
      label: bucketLabel(start),
      startMin: start,
      callWall: chainCall ?? callWall,
      putWall: chainPut ?? putWall,
      maxPain,
      atm,
      spot,
    };
  });
}
