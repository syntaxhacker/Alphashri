// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  REPORT_DASH,
  REPORT_MINUS,
  formatReportClock,
  formatReportCompact,
  formatReportFixed,
  formatReportNum,
  formatReportOiCr,
  formatReportPct,
  formatReportPoints,
  formatReportRatio,
} from "./reportFormat";

/**
 * These expectations are the legacy per-panel formatters, verbatim. The
 * panels that now call into `reportFormat` must print byte-identical strings,
 * so each case below names the helper it replaced.
 */
describe("reportFormat — legacy parity", () => {
  test("formatReportNum matches the per-panel Indian-grouped formatters", () => {
    // NiftyTapeTable.formatTapePrice
    expect(formatReportNum(25750.5, { digits: 2 })).toBe("25,750.5");
    expect(formatReportNum(25750.567, { digits: 2 })).toBe("25,750.57");
    expect(formatReportNum(null)).toBe(REPORT_DASH);
    expect(formatReportNum(undefined)).toBe(REPORT_DASH);
    expect(formatReportNum(NaN)).toBe(REPORT_DASH);
    // deskPlan.fmtDeskNum
    expect(formatReportNum(22700, { digits: 0, minDigits: 0 })).toBe("22,700");
    expect(formatReportNum(22700.5, { digits: 2, minDigits: 2 })).toBe("22,700.50");
    // NiftyDeltaPositioning.fmtFlipStrike — bare toLocaleString, so 3 decimals max
    expect(formatReportNum(25750.256)).toBe("25,750.256");
    // niftyOiHeatmap.fmtStrike / niftyIntel.fmtIntelInt round first
    expect(formatReportNum(25750.6, { round: true })).toBe("25,751");
  });

  test("formatReportSigned matches the per-panel signed formatters", () => {
    // NiftyTapeTable.formatTapeSigned
    expect(formatReportNum(12, { digits: 2, sign: "always" })).toBe("+12");
    expect(formatReportNum(-8, { digits: 2, sign: "always" })).toBe("-8");
    expect(formatReportNum(0, { digits: 2, sign: "always" })).toBe("+0");
    // niftyIntel.fmtIntelSigned — Unicode minus, no sign on zero
    expect(formatReportNum(3201, { sign: "nonzero", minus: REPORT_MINUS })).toBe("+3,201");
    expect(formatReportNum(-1149, { sign: "nonzero", minus: REPORT_MINUS })).toBe("−1,149");
    expect(formatReportNum(0, { sign: "nonzero", minus: REPORT_MINUS })).toBe("0");
    // NiftyDeltaPositioning.fmtCr — rounds, "0" for a value that rounds to zero
    expect(formatReportNum(53185, { sign: "nonzero", round: true })).toBe("+53,185");
    expect(formatReportNum(-50185, { sign: "nonzero", round: true })).toBe("-50,185");
    expect(formatReportNum(0.4, { sign: "nonzero", round: true })).toBe("0");
  });

  test("formatReportPct matches the per-panel percent formatters", () => {
    // NiftyTapeTable.formatTapePct
    expect(formatReportPct(2.35, { digits: 2, sign: "always" })).toBe("+2.35%");
    expect(formatReportPct(-2.35, { digits: 2, sign: "always" })).toBe("-2.35%");
    expect(formatReportPct(null)).toBe(REPORT_DASH);
    // NiftyUnusualVolume.formatUnusualShare — unsigned
    expect(formatReportPct(47.44, { digits: 1 })).toBe("47.4%");
    // valueColumns.fmtPct — "+" only when positive
    expect(formatReportPct(1.2, { digits: 1, sign: "nonzero" })).toBe("+1.2%");
    expect(formatReportPct(-1.2, { digits: 1, sign: "nonzero" })).toBe("-1.2%");
    expect(formatReportPct(0, { digits: 1, sign: "nonzero" })).toBe("0.0%");
  });

  test("formatReportRatio matches the per-panel ratio formatters", () => {
    // NiftyTapeTable.formatTapeRatio / niftyIntel.fmtIntelPcr
    expect(formatReportRatio(1.235)).toBe("1.24");
    expect(formatReportRatio(null)).toBe(REPORT_DASH);
  });

  test("formatReportCompact matches the per-panel compact formatters", () => {
    // NiftyTapeTable.formatTapeCompact — signed, 2dp on both tiers
    expect(formatReportCompact(170160000, { sign: "always" })).toBe("+170.16M");
    expect(formatReportCompact(5530000, { sign: "always" })).toBe("+5.53M");
    expect(formatReportCompact(-1200000, { sign: "always" })).toBe("-1.20M");
    expect(formatReportCompact(850, { sign: "always" })).toBe("+850");
    expect(formatReportCompact(null, { sign: "always" })).toBe(REPORT_DASH);
    // NiftyUnusualVolume.formatUnusualCompact — unsigned, rounded plain tier
    expect(formatReportCompact(1250000, { round: true })).toBe("1.25M");
    expect(formatReportCompact(850000, { round: true })).toBe("850.00K");
    expect(formatReportCompact(912.4, { round: true })).toBe("912");
    // NiftyOiHeatmap.compactOi — Unicode minus, 1dp on the K tier
    expect(
      formatReportCompact(1230000, { sign: "always", minus: REPORT_MINUS, thousands: 1 }),
    ).toBe("+1.23M");
    expect(
      formatReportCompact(-5500, { sign: "always", minus: REPORT_MINUS, thousands: 1 }),
    ).toBe("−5.5K");
    expect(
      formatReportCompact(912.4, { sign: "always", minus: REPORT_MINUS, grouped: false }),
    ).toBe("+912");
  });

  test("formatReportOiCr matches deskPlan.fmtDeskOi", () => {
    expect(formatReportOiCr(25000000)).toBe("2.50 Cr");
    expect(formatReportOiCr(2500000)).toBe("25.00 L");
    expect(formatReportOiCr(1234)).toBe("1,234");
    expect(formatReportOiCr(0, { dashOnNonPositive: true })).toBe(REPORT_DASH);
    expect(formatReportOiCr(-5, { dashOnNonPositive: true })).toBe(REPORT_DASH);
    expect(formatReportOiCr(null)).toBe(REPORT_DASH);
  });

  test("formatReportOiCr matches NiftyDepthMap.formatOiCompact", () => {
    const depth = { lakh: 1, space: false, thousands: true, grouped: false };
    expect(formatReportOiCr(25000000, depth)).toBe("2.50 Cr");
    expect(formatReportOiCr(2500000, depth)).toBe("25.0L");
    expect(formatReportOiCr(5000, depth)).toBe("5.0k");
    expect(formatReportOiCr(500, depth)).toBe("500");
    expect(formatReportOiCr(-250000, depth)).toBe("-2.5L");
  });

  test("formatReportClock matches the legacy IST clock helpers", () => {
    expect(formatReportClock(NaN)).toBe(REPORT_DASH);
    // 2026-01-01T00:00:00Z → 05:30 IST
    expect(formatReportClock(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe("05:30:00");
  });

  test("formatReportPoints matches the distance-from-spot labels", () => {
    expect(formatReportPoints(50)).toBe("+50 pts");
    expect(formatReportPoints(-120)).toBe("-120 pts");
    expect(formatReportPoints(null)).toBe(REPORT_DASH);
  });

  test("formatReportFixed exposes the ungrouped fixed-decimal path", () => {
    expect(formatReportFixed(1.5, { digits: 2, suffix: "x" })).toBe("1.50x");
  });
});
