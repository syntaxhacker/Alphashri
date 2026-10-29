/**
 * Wall-migration over the NIFTY tape — pure builder.
 *
 * Groups per-minute tape rows into fixed clock buckets and, per bucket,
 * records the pin structure: top call wall (max CE OI), top put wall
 * (max PE OI), max pain, ATM strike and spot. The companion
 * `NiftyWallMigration.tsx` step-plots these five series so a migrating pin
 * (e.g. 23,500 → 23,000) reads at a glance.
 *
 * Row shape is declared locally on purpose: the tape carries an optional
 * per-strike `chain` map (`chain[strike] = [ce_ltp, pe_ltp, ce_oi, pe_oi,
 * ce_vol, pe_vol]`) alongside the scalar `walls` / `max_pain` / `atm_strike`
 * fields, and both snake_case and camelCase spellings are accepted.
 */

/** Minimal tape row — only the fields the migration needs. */
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
  /** `chain[strike] = [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]`. */
  chain?: Record<string, number[] | undefined> | null;
}

/** One clock bucket of pin structure. */
export interface WallMigrationBucket {
  /** `HH:MM` bucket start. */
  label: string;
  /** Minutes since midnight of the bucket start (`null` when unparseable). */
  startMin: number | null;
  /** Strike with the most CE OI in the bucket. */
  callWall: number | null;
  /** Strike with the most PE OI in the bucket. */
  putWall: number | null;
  maxPain: number | null;
  atm: number | null;
  spot: number | null;
}

/** Finite number or `null` — never `NaN`, never `Number("") === 0`. */
function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Minutes since midnight for a tape timestamp. Accepts IST ISO
 * (`2026-10-14T13:06:00+05:30`), bare clocks (`13:06`, `13:06:22`) and
 * falls back to `Date.parse`; unparseable → `null`.
 */
export function parseClockMinutes(t: string | null | undefined): number | null {
  const raw = String(t ?? "").trim();
  if (!raw) return null;
  const clock = /(\d{1,2}):(\d{2})/.exec(raw);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    if (Number.isFinite(h) && Number.isFinite(m) && h < 24 && m < 60) {
      return h * 60 + m;
    }
    return null;
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    return (
      d.getHours() * 60 + d.getMinutes()
    );
  }
  return null;
}

/** Floor a timestamp into its `bucketMin` bucket; `null` when unparseable. */
export function bucketStartMinutes(
  t: string | null | undefined,
  bucketMin: number,
): number | null {
  const mins = parseClockMinutes(t);
  if (mins === null) return null;
  const size = bucketMin > 0 ? bucketMin : 15;
  return Math.floor(mins / size) * size;
}

/** `HH:MM` label for a bucket start (`"—"` when unknown). */
export function bucketLabel(startMin: number | null): string {
  if (startMin === null || !Number.isFinite(startMin)) return "—";
  const h = Math.floor(startMin / 60);
  const m = startMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Chain leg indexes: `[ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]`. */
const CE_OI_IDX = 2;
const PE_OI_IDX = 3;

/**
 * Top walls from a per-strike chain: the strike with the most CE OI and the
 * strike with the most PE OI. Ties keep the first strike seen (insertion
 * order); non-finite strikes / OI are skipped. Empty or absent chain →
 * both `null` so the caller can fall back to the scalar `walls` field.
 */
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
    const ceOi = finiteOrNull(leg[CE_OI_IDX]);
    const peOi = finiteOrNull(leg[PE_OI_IDX]);
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

/** Scalar fallbacks from a row: walls / max pain / ATM / spot. */
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

/**
 * Bucket rows into `bucketMin`-minute clock buckets (default 15). Rows sort
 * ascending by timestamp; rows with unparseable timestamps collect into one
 * trailing `"—"` bucket in input order. Within a bucket the **last** finite
 * value wins per field, and walls prefer the chain-derived top (max OI)
 * from the last row carrying a non-empty chain, falling back to the scalar
 * `walls` field — so a missing chain never blanks a bucket that has walls.
 */
export function buildWallMigration(
  rows: WallMigrationRow[],
  opts?: { bucketMin?: number },
): WallMigrationBucket[] {
  const bucketMin = opts?.bucketMin && opts.bucketMin > 0 ? opts.bucketMin : 15;
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return [];

  const indexed = list.map((row, i) => ({ row, i }));
  indexed.sort((a, b) => {
    const ta = parseClockMinutes(a.row?.t);
    const tb = parseClockMinutes(b.row?.t);
    if (ta === null && tb === null) return a.i - b.i;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta === tb ? a.i - b.i : ta - tb;
  });

  const order: Array<number | null> = [];
  const groups = new Map<number | null, WallMigrationRow[]>();
  for (const { row } of indexed) {
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
