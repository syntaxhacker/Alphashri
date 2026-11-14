// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  REPORT_DASH,
  REPORT_MINUS,
  formatReportCompact,
  formatReportFixed,
  formatReportNum,
  formatReportPct,
} from "./reportFormat";
import { dist, fmtNum, fmtSignedOI } from "./niftyWallsFormat";
import { fmtVerdictChange } from "./NiftyVerdictStrip";

/**
 * Parity pin for the report's shared number formatters.
 *
 * Every row is byte-identical between the canonical `reportFormat` helper and
 * the thin aliases that replaced the per-panel copies (`fmtNum`,
 * `fmtSignedOI`, `dist`, `fmtVerdictChange`). If a panel's legacy output ever
 * changes, this test is the place to update both sides together.
 *
 * Value table: `0, 1, 999, 1_000, 1_500, 1_000_000, -1_500, -1_000_000,
 * 12.345, null, undefined, NaN`.
 */
const VALUES: Array<number | null | undefined> = [
  0,
  1,
  999,
  1_000,
  1_500,
  1_000_000,
  -1_500,
  -1_000_000,
  12.345,
  null,
  undefined,
  NaN,
];

const DASH = REPORT_DASH;
const MINUS = REPORT_MINUS;

function pin<O>(
  label: string,
  fn: (v: number | null | undefined, opts?: O) => string,
  opts: O | undefined,
  expected: Array<string | null>,
): void {
  test(label, () => {
    VALUES.forEach((v, i) => {
      expect(fn(v, opts)).toBe(expected[i]);
    });
  });
}

describe("reportFormat parity — shared number formatters", () => {
  // --- formatReportNum (the `fmtNum` alias path: digits forced to an int) ---
  pin(
    "formatReportNum(v, { digits: 0, minDigits: 0 }) — Indian grouping, no sign",
    formatReportNum,
    { digits: 0, minDigits: 0 },
    [
      "0", // 0
      "1", // 1
      "999", // 999
      "1,000", // 1_000
      "1,500", // 1_500
      "10,00,000", // 1_000_000 (en-IN lakh grouping)
      "-1,500", // -1_500
      "-10,00,000", // -1_000_000
      "12", // 12.345 → 0 dp
      DASH, // null
      DASH, // undefined
      DASH, // NaN
    ],
  );

  pin(
    "fmtNum(v) == formatReportNum(v, { digits: 0, minDigits: 0 })",
    fmtNum,
    undefined,
    [
      "0",
      "1",
      "999",
      "1,000",
      "1,500",
      "10,00,000",
      "-1,500",
      "-10,00,000",
      "12",
      DASH,
      DASH,
      DASH,
    ],
  );

  // --- formatReportCompact — M / K / plain tiers ---
  pin(
    "formatReportCompact(v, { sign: 'nonzero', minus: '−', thousands: 0, millions: 2, grouped: false })",
    formatReportCompact,
    { sign: "nonzero", minus: MINUS, thousands: 0, millions: 2, grouped: false },
    [
      "0", // 0
      "+1", // 1
      "+999", // 999
      "+1K", // 1_000
      "+2K", // 1_500 → 1.5K rounds to 2K
      "+1.00M", // 1_000_000
      MINUS + "2K", // -1_500
      MINUS + "1.00M", // -1_000_000
      "+12", // 12.345
      DASH, // null
      DASH, // undefined
      DASH, // NaN
    ],
  );

  pin(
    "fmtSignedOI(v) == formatReportCompact(v, { sign: 'nonzero', minus: '−', thousands: 0, millions: 2, grouped: false })",
    fmtSignedOI,
    undefined,
    [
      "0",
      "+1",
      "+999",
      "+1K",
      "+2K",
      "+1.00M",
      MINUS + "2K",
      MINUS + "1.00M",
      "+12",
      DASH,
      DASH,
      DASH,
    ],
  );

  // --- formatReportCompact — "always" sign, 1 dp K tier (the compactOi path) ---
  pin(
    "formatReportCompact(v, { sign: 'always', minus: '−', thousands: 1, grouped: false })",
    formatReportCompact,
    { sign: "always", minus: MINUS, thousands: 1, grouped: false },
    [
      "+0", // 0
      "+1", // 1
      "+999", // 999
      "+1.0K", // 1_000
      "+1.5K", // 1_500
      "+1.00M", // 1_000_000
      MINUS + "1.5K", // -1_500
      MINUS + "1.00M", // -1_000_000
      "+12", // 12.345
      DASH, // null
      DASH, // undefined
      DASH, // NaN
    ],
  );

  // --- formatReportPct — the `dist` alias path (no grouping) ---
  pin(
    "formatReportPct(v, { digits: 2, sign: 'nonzero' })",
    formatReportPct,
    { digits: 2, sign: "nonzero" },
    [
      "0.00%", // 0
      "+1.00%", // 1
      "+999.00%", // 999
      "+1000.00%", // 1_000 (toFixed — no grouping)
      "+1500.00%", // 1_500
      "+1000000.00%", // 1_000_000
      "-1500.00%", // -1_500
      "-1000000.00%", // -1_000_000
      "+12.35%", // 12.345
      DASH, // null
      DASH, // undefined
      DASH, // NaN
    ],
  );

  pin(
    "dist(v) == formatReportPct(v, { digits: 2, sign: 'nonzero' })",
    dist,
    undefined,
    [
      "0.00%",
      "+1.00%",
      "+999.00%",
      "+1000.00%",
      "+1500.00%",
      "+1000000.00%",
      "-1500.00%",
      "-1000000.00%",
      "+12.35%",
      DASH,
      DASH,
      DASH,
    ],
  );

  // --- formatReportFixed — the `fmtVerdictChange` alias path ---
  pin(
    "formatReportFixed(v, { digits: 2, sign: 'nonzero', minus: '-' })",
    formatReportFixed,
    { digits: 2, sign: "nonzero", minus: "-" },
    [
      "0.00", // 0
      "+1.00", // 1
      "+999.00", // 999
      "+1000.00", // 1_000
      "+1500.00", // 1_500
      "+1000000.00", // 1_000_000
      "-1500.00", // -1_500
      "-1000000.00", // -1_000_000
      "+12.35", // 12.345
      DASH, // null
      DASH, // undefined
      DASH, // NaN
    ],
  );

  pin(
    "fmtVerdictChange(v) == formatReportFixed(v, { digits: 2, sign: 'nonzero', minus: '-' })",
    fmtVerdictChange,
    undefined,
    [
      "0.00",
      "+1.00",
      "+999.00",
      "+1000.00",
      "+1500.00",
      "+1000000.00",
      "-1500.00",
      "-1000000.00",
      "+12.35",
      DASH,
      DASH,
      DASH,
    ],
  );
});
