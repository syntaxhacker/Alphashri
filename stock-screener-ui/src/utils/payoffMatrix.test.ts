import { describe, expect, test } from "vitest";
import {
  buildPayoffMatrix,
  buildPayoffTable,
  hasTimeValue,
  type MatrixLeg,
  type PayoffMatrixInput,
} from "./payoffMatrix";

const AS_OF = "2026-11-23";
const EXPIRIES = ["2026-12-18", "2027-03-19"];

const leg = (
  action: MatrixLeg["action"],
  opt: MatrixLeg["opt"],
  strike: number,
  premium: number,
  qty = 100,
): MatrixLeg => ({ action, opt, strike, premium, qty });

type TableInput = PayoffMatrixInput & { strikeCount?: number; dteSteps?: number[]; asOf?: string };

const base = (over: Partial<TableInput>): PayoffMatrixInput => ({
  legs: [],
  spot: 100,
  expiries: EXPIRIES,
  asOf: AS_OF,
  ...over,
});

const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

interface StructureCase {
  name: string;
  legs: MatrixLeg[];
  spot: number;
  strikes: number[];
  /** Hand-summed expiry P&L — never calls payoffAt or buildPayoffMatrix. */
  expected: (s: number) => number;
  netDebit: number;
  breakevens: number[];
  maxProfit: number | null;
  maxLoss: number | null;
  spotRowIndex: number;
}

const CASES: StructureCase[] = [
  {
    name: "bull call spread",
    legs: [leg("BUY", "CE", 100, 6), leg("SELL", "CE", 110, 3)],
    spot: 105,
    strikes: [90, 100, 103, 110, 120],
    expected: (s) => 100 * (Math.max(0, s - 100) - 6) - 100 * (Math.max(0, s - 110) - 3),
    netDebit: 300,
    breakevens: [103],
    maxProfit: 700,
    maxLoss: -300,
    spotRowIndex: 2,
  },
  {
    name: "iron condor",
    legs: [
      leg("SELL", "PE", 90, 3),
      leg("BUY", "PE", 80, 1),
      leg("SELL", "CE", 110, 4),
      leg("BUY", "CE", 120, 1),
    ],
    spot: 100,
    strikes: [80, 85, 90, 100, 110, 115, 120, 130],
    expected: (s) =>
      -100 * (Math.max(0, 90 - s) - 3) +
      100 * (Math.max(0, 80 - s) - 1) -
      100 * (Math.max(0, s - 110) - 4) +
      100 * (Math.max(0, s - 120) - 1),
    netDebit: -500,
    breakevens: [85, 115],
    maxProfit: 500,
    maxLoss: -500,
    spotRowIndex: 3,
  },
];

describe("buildPayoffMatrix — expiry intrinsic, KPIs and layout", () => {
  test.each(CASES)("$name: net debit, breakevens and bounded tails", (c) => {
    const m = buildPayoffMatrix(base({ legs: c.legs, spot: c.spot, strikes: c.strikes }));
    expect(m.kpis.netDebit).toBeCloseTo(c.netDebit, 6);
    expect(m.kpis.breakevens).toEqual(c.breakevens);
    expect(m.kpis.maxProfit).toBe(c.maxProfit);
    expect(m.kpis.maxLoss).toBe(c.maxLoss);
  });

  test.each(CASES)("$name: every cell's intrinsic equals the hand-summed expiry P&L", (c) => {
    const m = buildPayoffMatrix(base({ legs: c.legs, spot: c.spot, strikes: c.strikes }));
    expect(m.cells).toHaveLength(c.strikes.length);
    for (let r = 0; r < c.strikes.length; r++) {
      // No IV ⇒ time value is unavailable and pnl IS the intrinsic.
      for (let col = 0; col < EXPIRIES.length; col++) {
        const cell = m.cells[r][col];
        expect(cell.timeValue).toBeNull();
        expect(cell.priced).toBe(true);
        expect(cell.basis).toBe("intrinsic-only");
        expect(cell.intrinsic).toBeCloseTo(c.expected(c.strikes[r]), 6);
        expect(cell.pnl!).toBeCloseTo(c.expected(c.strikes[r]), 6);
      }
    }
  });

  test.each(CASES)("$name: rows follow strikes, columns follow expiries", (c) => {
    const m = buildPayoffMatrix(base({ legs: c.legs, spot: c.spot, strikes: c.strikes }));
    expect(m.strikes).toEqual(c.strikes);
    expect(m.expiries).toEqual(EXPIRIES);
    for (const row of m.cells) expect(row).toHaveLength(EXPIRIES.length);
    expect(m.spotRowIndex).toBe(c.spotRowIndex);
  });

  test("unbounded tails are null, not a truncated number", () => {
    const long = buildPayoffMatrix(base({ legs: [leg("BUY", "CE", 100, 5)], strikes: [100] }));
    expect(long.kpis.maxProfit).toBeNull();
    expect(long.kpis.maxLoss).toBeCloseTo(-500, 6);
    expect(long.kpis.breakevens).toEqual([105]);

    const short = buildPayoffMatrix(base({ legs: [leg("SELL", "CE", 100, 5)], strikes: [100] }));
    expect(short.kpis.maxProfit).toBeCloseTo(500, 6);
    expect(short.kpis.maxLoss).toBeNull();
  });

  test("spotPct is the move of each row from spot", () => {
    const m = buildPayoffMatrix(base({ legs: [leg("BUY", "CE", 100, 5)], strikes: [90, 100, 110] }));
    expect(m.cells[0][0].spotPct).toBeCloseTo(-10, 6);
    expect(m.cells[1][0].spotPct).toBeCloseTo(0, 6);
    expect(m.cells[2][0].spotPct).toBeCloseTo(10, 6);
  });
});

describe("buildPayoffMatrix — time value and DTE", () => {
  test("IV present: time value is 0 at expiry and grows with DTE", () => {
    const expiries = ["2026-11-23", "2026-11-30", "2026-12-23"];
    const m = buildPayoffMatrix(
      base({
        legs: [leg("BUY", "CE", 100, 5, 1)],
        strikes: [100],
        expiries,
        iv: 0.2,
        rate: 0.065,
      }),
    );
    const tvs = m.cells[0].map((c) => c.timeValue);
    expect(tvs[0]).toBe(0);
    expect(tvs[1]).toBeGreaterThan(0);
    expect(tvs[2]).toBeGreaterThan(tvs[1]!);
    for (const cell of m.cells[0]) {
      expect(cell.priced).toBe(true);
      expect(cell.basis).toBe("intrinsic+time");
      expect(cell.pnl!).toBeCloseTo(cell.intrinsic + (cell.timeValue ?? 0), 5);
    }
    // Expiry intrinsic is -₹5 (the premium paid) at spot == strike.
    expect(m.cells[0][0].intrinsic).toBeCloseTo(-5, 6);
  });

  test("IV present: POP is finite; IV absent: POP and time value are null", () => {
    const withIv = buildPayoffMatrix(
      base({ legs: [leg("BUY", "CE", 100, 5)], strikes: [100], iv: 0.2 }),
    );
    expect(withIv.kpis.pop).not.toBeNull();
    expect(withIv.kpis.pop!).toBeGreaterThanOrEqual(0);
    expect(withIv.kpis.pop!).toBeLessThanOrEqual(1);

    const noIv = buildPayoffMatrix(
      base({ legs: [leg("BUY", "CE", 100, 5)], strikes: [100], iv: null }),
    );
    expect(noIv.kpis.pop).toBeNull();
    expect(noIv.cells[0][0].timeValue).toBeNull();
    // An IV gap is not a price gap: the cell is still priced off intrinsic.
    expect(noIv.cells[0][0].priced).toBe(true);
    expect(noIv.cells[0][0].basis).toBe("intrinsic-only");
    expect(noIv.cells[0][0].pnl).not.toBeNull();
  });
});

describe("buildPayoffMatrix — priced cells survive a missing IV", () => {
  const spread = [leg("BUY", "CE", 100, 6), leg("SELL", "CE", 110, 3)];
  const SPREAD_STRIKES = [90, 100, 103, 110, 120];
  // Hand-summed expiry P&L for the bull call spread — never calls payoffAt.
  const spreadPnl = (s: number): number =>
    100 * (Math.max(0, s - 100) - 6) - 100 * (Math.max(0, s - 110) - 3);

  test("iv=null: every cell with a valid spot is priced and intrinsic-only", () => {
    const m = buildPayoffMatrix(
      base({ legs: spread, spot: 105, strikes: SPREAD_STRIKES, iv: null }),
    );
    const cells = m.cells.flat();
    expect(cells.length).toBe(SPREAD_STRIKES.length * EXPIRIES.length);
    for (const cell of cells) {
      expect(cell.priced).toBe(true);
      expect(cell.basis).toBe("intrinsic-only");
      expect(cell.timeValue).toBeNull();
      expect(cell.pnl).not.toBeNull();
      expect(Number.isFinite(cell.pnl!)).toBe(true);
    }
  });

  test("iv=null: bull call spread P&L is plausible and non-zero away from breakeven", () => {
    const m = buildPayoffMatrix(
      base({ legs: spread, spot: 105, strikes: SPREAD_STRIKES, iv: null }),
    );
    m.strikes.forEach((strike, row) => {
      expect(m.cells[row][0].pnl!).toBeCloseTo(spreadPnl(strike), 6);
    });
    // Loss at/below the lower strike, profit above the upper strike, flat at breakeven.
    expect(m.cells[0][0].pnl).toBeCloseTo(-300, 6);
    expect(m.cells[1][0].pnl).toBeCloseTo(-300, 6);
    expect(m.cells[2][0].pnl).toBeCloseTo(0, 6);
    expect(m.cells[3][0].pnl).toBeCloseTo(700, 6);
    expect(m.cells[4][0].pnl).toBeCloseTo(700, 6);
    expect(m.cells.flat().filter((c) => c.pnl !== 0).length).toBeGreaterThan(0);
  });

  test("iv present: priced cells use the intrinsic+time basis", () => {
    const m = buildPayoffMatrix(
      base({ legs: spread, spot: 105, strikes: SPREAD_STRIKES, iv: 0.2 }),
    );
    for (const cell of m.cells.flat()) {
      expect(cell.priced).toBe(true);
      expect(cell.basis).toBe("intrinsic+time");
      expect(Number.isFinite(cell.pnl!)).toBe(true);
      expect(cell.pnl!).toBeCloseTo(cell.intrinsic + (cell.timeValue ?? 0), 5);
    }
  });
});

describe("buildPayoffMatrix — genuinely unpriceable cells", () => {
  test("no spot: cells exist but are unpriced with null pnl", () => {
    for (const badSpot of [0, Number.NaN]) {
      const m = buildPayoffMatrix(
        base({
          legs: [leg("BUY", "CE", 100, 5)],
          spot: badSpot,
          strikes: [100, 110],
        }),
      );
      const cells = m.cells.flat();
      expect(cells.length).toBeGreaterThan(0);
      expect(m.spotRowIndex).toBeNull();
      for (const cell of cells) {
        expect(cell.priced).toBe(false);
        expect(cell.pnl).toBeNull();
      }
    }
  });

  test("no legs: no priced cell is emitted", () => {
    const m = buildPayoffMatrix(base({ legs: [], spot: 100, strikes: [100, 110] }));
    expect(m.cells).toEqual([]);
    expect(m.cells.flat().some((cell) => cell.priced)).toBe(false);
  });

  test("invalid strikes are dropped from the grid, never emitted as cells", () => {
    const m = buildPayoffMatrix(
      base({ legs: [leg("BUY", "CE", 100, 5)], strikes: [NaN, 0, Infinity, 100] }),
    );
    expect(m.strikes).toEqual([100]);
    for (const cell of m.cells.flat()) expect(cell.pnl).not.toBeNull();
  });
});

describe("hasTimeValue — the priced vs excluded boundary", () => {
  test("zero at expiry is a real quote; null and non-finite are not", () => {
    expect(hasTimeValue({ timeValue: 0 })).toBe(true);
    expect(hasTimeValue({ timeValue: -12.5 })).toBe(true);
    expect(hasTimeValue({ timeValue: null })).toBe(false);
    expect(hasTimeValue({ timeValue: Number.NaN })).toBe(false);
    expect(hasTimeValue({})).toBe(false);
    expect(hasTimeValue(null)).toBe(false);
  });
});

describe("buildPayoffMatrix — grid, sanitisation and immutability", () => {
  test("derived grid: leg strikes + spot ± rangePct on the inferred tick", () => {
    const m = buildPayoffMatrix(
      base({ legs: [leg("BUY", "CE", 100, 6), leg("SELL", "CE", 110, 3)], spot: 105 }),
    );
    expect(m.strikes).toEqual([90, 100, 110, 120]);
    expect(m.spotRowIndex).toBe(1);
  });

  test("grid never exceeds 41 rows even with a sub-tick leg spacing", () => {
    const m = buildPayoffMatrix(
      base({
        legs: [leg("BUY", "CE", 100, 6), leg("SELL", "CE", 100.1, 3)],
        spot: 100.05,
      }),
    );
    expect(m.strikes.length).toBeGreaterThan(0);
    expect(m.strikes.length).toBeLessThanOrEqual(41);
  });

  test("explicit strikes are filtered, deduped and sorted; non-finite strikes dropped", () => {
    const m = buildPayoffMatrix(
      base({ legs: [leg("BUY", "CE", 100, 5)], strikes: [110, 0, NaN, 100, Infinity, -10, 100] }),
    );
    expect(m.strikes).toEqual([100, 110]);
  });

  test("empty legs return a well-formed empty matrix with no NaN", () => {
    const m = buildPayoffMatrix(base({ legs: [], strikes: [90, 100, 110] }));
    expect(m.strikes).toEqual([]);
    expect(m.cells).toEqual([]);
    expect(m.expiries).toEqual(EXPIRIES);
    expect(m.spotRowIndex).toBeNull();
    expect(m.kpis).toEqual({
      netDebit: 0,
      maxProfit: null,
      maxLoss: null,
      breakevens: [],
      pop: null,
    });
  });

  test("inputs are frozen and never mutated", () => {
    const input = deepFreeze(
      base({
        legs: [leg("BUY", "CE", 100, 6), leg("SELL", "CE", 110, 3)],
        strikes: [100, 103, 110],
        iv: 0.2,
      }),
    );
    const snapshot = JSON.stringify(input);
    const m = buildPayoffMatrix(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(m.strikes).not.toBe(input.strikes);
    expect(m.cells).not.toBe(input.legs);
    expect(m.cells[0]).not.toBe(m.cells[1]);
  });

  test("output contains only finite numbers (no NaN/Infinity)", () => {
    const m = buildPayoffMatrix(
      base({
        legs: [leg("BUY", "CE", Number.NaN, 5), leg("SELL", "PE", 100, Number.NaN)],
        strikes: [NaN, 100],
        spot: Number.NaN,
        iv: 0.2,
      }),
    );
    const numbers = [
      ...m.strikes,
      ...m.kpis.breakevens,
      m.kpis.netDebit,
      ...(m.cells.flat().flatMap((c) => [c.pnl ?? 0, c.intrinsic, c.spotPct])),
      ...m.cells.flat().map((c) => c.timeValue ?? 0),
      m.kpis.pop ?? 0,
      m.kpis.maxProfit ?? 0,
      m.kpis.maxLoss ?? 0,
    ];
    for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
  });
});

// ── buildPayoffTable: dense strike × dated-expiry payoff grid ───────────────

const TABLE_CASES: StructureCase[] = CASES;

const weekday = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
const month = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });

describe("buildPayoffTable — dense grid layout", () => {
  test.each(TABLE_CASES)("$name: default counts, ascending order and cells shape", (c) => {
    const t = buildPayoffTable(base({ legs: c.legs, spot: c.spot, iv: 0.2 }));
    expect(t.strikes.length).toBeGreaterThanOrEqual(15);
    expect(t.strikes.length).toBeLessThanOrEqual(31);
    expect(t.expiries.length).toBeGreaterThanOrEqual(16);
    expect(t.expiries.length).toBeLessThanOrEqual(20);
    const prices = t.strikes.map((s) => s.strike);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    const dtes = t.expiries.map((e) => e.dte);
    expect(dtes).toEqual([...dtes].sort((a, b) => a - b));
    expect(dtes[0]).toBe(0);
    expect(dtes).toContain(1);
    expect(dtes).toContain(7);
    expect(t.cells).toHaveLength(t.strikes.length);
    for (const row of t.cells) expect(row).toHaveLength(t.expiries.length);
  });

  test("strikeCount and dteSteps are honoured and sanitised", () => {
    const t = buildPayoffTable(
      base({
        legs: [leg("BUY", "CE", 100, 6)],
        strikeCount: 15,
        dteSteps: [0, 5, 10, 2, 5, -1, Number.NaN] as number[],
      }),
    );
    expect(t.strikes).toHaveLength(15);
    expect(t.expiries.map((e) => e.dte)).toEqual([0, 2, 5, 10]);
    // Out-of-range counts are clamped to [15, 31].
    expect(
      buildPayoffTable(base({ legs: [leg("BUY", "CE", 100, 6)], strikeCount: 999 })).strikes,
    ).toHaveLength(31);
    expect(
      buildPayoffTable(base({ legs: [leg("BUY", "CE", 100, 6)], strikeCount: 1 })).strikes,
    ).toHaveLength(15);
  });

  test.each(TABLE_CASES)("$name: one ATM row at spot, spotPct and labels", (c) => {
    const t = buildPayoffTable(base({ legs: c.legs, spot: c.spot, iv: 0.2 }));
    expect(t.spot).toBeCloseTo(c.spot, 6);
    const atm = t.strikes.filter((s) => s.isAtm);
    expect(atm).toHaveLength(1);
    expect(atm[0].strike).toBeCloseTo(c.spot, 6);
    expect(atm[0].spotPct).toBeCloseTo(0, 6);
    for (const s of t.strikes) {
      expect(s.spotPct).toBeCloseTo(((s.strike - c.spot) / c.spot) * 100, 4);
      expect(s.tickLabel).toBe(String(Number(s.strike.toFixed(2))));
    }
  });

  test("expiry columns derive dates, weekday labels and month from asOf", () => {
    const t = buildPayoffTable(base({ legs: [leg("BUY", "CE", 100, 6)], spot: 100 }));
    for (const e of t.expiries) {
      const ms = Date.parse(`${AS_OF}T00:00:00Z`) + e.dte * 86400000;
      const iso = new Date(ms).toISOString().slice(0, 10);
      expect(e.date).toBe(iso);
      expect(e.label).toBe(`${Number(iso.slice(8, 10))} ${weekday(iso)}`);
      expect(e.month).toBe(`${month(iso)} ${iso.slice(0, 4)}`);
    }
    expect(t.expiries[0].label).toBe("23 Mon");
  });
});

describe("buildPayoffTable — cells reuse the matrix payoff logic", () => {
  test.each(TABLE_CASES)("$name: expiry (dte=0) cells equal buildPayoffMatrix", (c) => {
    const tableInput = base({ legs: c.legs, spot: c.spot, iv: 0.2 });
    const t = buildPayoffTable(tableInput);
    const m = buildPayoffMatrix({
      ...tableInput,
      strikes: t.strikes.map((s) => s.strike),
      expiries: t.expiries.map((e) => e.date),
    });
    expect(m.cells).toHaveLength(t.cells.length);
    for (let r = 0; r < t.strikes.length; r++) {
      for (let col = 0; col < t.expiries.length; col++) {
        expect(t.cells[r][col].pnl).toBeCloseTo(m.cells[r][col].pnl!, 6);
        expect(t.cells[r][col].priced).toBe(m.cells[r][col].priced);
        expect(t.cells[r][col].basis).toBe(m.cells[r][col].basis);
      }
    }
    // The first column is the expiry payoff (T=0 → no time value).
    for (let r = 0; r < t.strikes.length; r++) {
      expect(t.cells[r][0].pnl).toBeCloseTo(c.expected(t.strikes[r].strike), 6);
    }
  });

  test("iv=null: intrinsic-only priced cells, never null when spot/legs valid", () => {
    const t = buildPayoffTable(
      base({ legs: [leg("BUY", "CE", 100, 6), leg("SELL", "CE", 110, 3)], spot: 105, iv: null }),
    );
    for (const row of t.cells) {
      for (const cell of row) {
        expect(cell.priced).toBe(true);
        expect(cell.basis).toBe("intrinsic-only");
        expect(cell.pnl).not.toBeNull();
        expect(Number.isFinite(cell.pnl!)).toBe(true);
      }
    }
  });

  test("iv present: cells use intrinsic+time and stay finite across DTE", () => {
    const t = buildPayoffTable(
      base({ legs: [leg("BUY", "CE", 100, 6), leg("SELL", "CE", 110, 3)], spot: 105, iv: 0.25 }),
    );
    for (const row of t.cells) {
      for (const cell of row) {
        expect(cell.priced).toBe(true);
        expect(cell.basis).toBe("intrinsic+time");
        expect(Number.isFinite(cell.pnl!)).toBe(true);
      }
    }
    expect(t.kpis.pop).not.toBeNull();
    expect(t.kpis.netDebit).toBeCloseTo(300, 6);
    expect(t.kpis.maxProfit).toBe(700);
    expect(t.kpis.maxLoss).toBe(-300);
    expect(t.kpis.breakevens).toEqual([103]);
  });
});

describe("buildPayoffTable — strike-level payoff is evaluated at each row's strike", () => {
  const SPREAD: MatrixLeg[] = [
    leg("BUY", "CE", 1420, 12.5, 75),
    leg("SELL", "CE", 1470, 8, 75),
  ];
  const EXACT_STRIKES = [1400, 1420, 1450, 1470, 1500];
  /** Hand-summed expiry payoff — never calls payoffAt or either builder. */
  const spreadPnl = (s: number): number =>
    75 * (Math.max(s - 1420, 0) - 12.5) - 75 * (Math.max(s - 1470, 0) - 8);

  test("T=0, no IV: each row equals the hand-computed payoff at that row's strike", () => {
    const t = buildPayoffTable(
      base({
        legs: SPREAD,
        spot: 1423,
        strikes: EXACT_STRIKES,
        dteSteps: [0],
        asOf: "2026-11-23",
        iv: null,
      }),
    );
    expect(t.strikes.map((s) => s.strike)).toEqual(EXACT_STRIKES);
    expect(t.expiries[0].dte).toBe(0);
    EXACT_STRIKES.forEach((strike, row) => {
      const cell = t.cells[row][0];
      expect(cell.priced).toBe(true);
      expect(cell.basis).toBe("intrinsic-only");
      expect(cell.pnl).toBeCloseTo(spreadPnl(strike), 6);
    });
    expect(t.cells[0][0].pnl).toBeCloseTo(-337.5, 6);
    expect(t.cells[1][0].pnl).toBeCloseTo(-337.5, 6);
    expect(t.cells[2][0].pnl).toBeCloseTo(1912.5, 6);
    expect(t.cells[3][0].pnl).toBeCloseTo(3412.5, 6);
    expect(t.cells[4][0].pnl).toBeCloseTo(3412.5, 6);
    expect(new Set(t.cells.map((row) => row[0].pnl)).size).toBeGreaterThan(1);
  });

  test("the dense grid never collapses every cell to the same loss", () => {
    const t = buildPayoffTable(base({ legs: SPREAD, spot: 1423, iv: null }));
    for (const col of [0, 5, t.expiries.length - 1]) {
      const values = new Set(t.cells.map((row) => row[col].pnl));
      expect(values.size).toBeGreaterThan(1);
    }
    expect(t.cells[0][0].pnl).toBeCloseTo(-337.5, 6);
  });
});

describe("buildPayoffTable — unpriceable inputs, purity and finiteness", () => {
  test("invalid spot leaves cells unpriced with null pnl", () => {
    for (const badSpot of [0, Number.NaN, Infinity]) {
      const t = buildPayoffTable(
        base({ legs: [leg("BUY", "CE", 100, 5)], spot: badSpot }),
      );
      expect(t.cells.length).toBeGreaterThan(0);
      for (const cell of t.cells.flat()) {
        expect(cell.priced).toBe(false);
        expect(cell.pnl).toBeNull();
      }
    }
  });

  test("no legs emits a full grid of null, unpriced cells", () => {
    const t = buildPayoffTable(base({ legs: [], spot: 100 }));
    expect(t.cells).toHaveLength(t.strikes.length);
    for (const row of t.cells) {
      expect(row).toHaveLength(t.expiries.length);
      for (const cell of row) {
        expect(cell.priced).toBe(false);
        expect(cell.pnl).toBeNull();
      }
    }
  });

  test("inputs are frozen and never mutated; outputs are independent", () => {
    const input = deepFreeze(
      base({
        legs: [leg("BUY", "CE", 100, 6), leg("SELL", "CE", 110, 3)],
        strikeCount: 21,
        dteSteps: [0, 1, 7, 30] as number[],
        iv: 0.2,
      }),
    );
    const snapshot = JSON.stringify(input);
    const t = buildPayoffTable(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(t.strikes).not.toBe(input.strikes);
    expect(t.cells[0]).not.toBe(t.cells[1]);
  });

  test("every emitted number is finite (no NaN/Infinity) even with junk inputs", () => {
    const t = buildPayoffTable(
      base({
        legs: [leg("BUY", "CE", Number.NaN, 5), leg("SELL", "PE", 100, Infinity)],
        spot: Number.NaN,
        iv: Number.NaN,
        dteSteps: [0, Number.NaN, Infinity] as number[],
      }),
    );
    const numbers = [
      t.spot,
      ...t.strikes.flatMap((s) => [s.strike, s.spotPct]),
      ...t.expiries.map((e) => e.dte),
      ...t.cells.flat().map((c) => c.pnl ?? 0),
      t.kpis.netDebit,
      t.kpis.pop ?? 0,
      t.kpis.maxProfit ?? 0,
      t.kpis.maxLoss ?? 0,
      ...t.kpis.breakevens,
    ];
    for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
  });
});
