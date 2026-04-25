import { describe, expect, test } from "vitest";
import { computeStats, computePcrColor } from "./ChainSummary";
import type { StrikeRow, Summary } from "./ChainSummary";

const makeStrike = (strike: number, ceOI: number, peOI: number): StrikeRow => ({
  strike,
  ce: { market_data: { oi: ceOI } },
  pe: { market_data: { oi: peOI } },
});

const makeEmptyStrike = (strike: number): StrikeRow => ({
  strike,
  ce: {},
  pe: {},
});

const zeroSummary: Summary = {
  pcr: 0,
  max_pain: 0,
  expected_move: null,
  total_ce_oi: 0,
  total_pe_oi: 0,
};

const defaultSummary: Summary = { ...zeroSummary, pcr: 1.0 };

describe("ChainSummary computation", () => {
  describe("PCR calculation", () => {
    test("returns pcr from summary when available", () => {
      const matrix = [makeStrike(100, 5000, 10000)];
      const summary: Summary = {
        pcr: 1.5,
        max_pain: 100,
        expected_move: null,
        total_ce_oi: 5000,
        total_pe_oi: 10000,
      };
      expect(computeStats(matrix, summary).pcr).toBe(1.5);
    });

    test("returns 0 when no summary is provided", () => {
      expect(computeStats([], undefined).pcr).toBe(0);
    });

    test("handles pcr of exactly 1.0", () => {
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 1000,
        total_pe_oi: 1000,
      };
      expect(computeStats([], summary).pcr).toBe(1.0);
    });

    test("handles very high pcr", () => {
      const summary: Summary = {
        pcr: 5.0,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 100,
        total_pe_oi: 500,
      };
      expect(computeStats([], summary).pcr).toBe(5.0);
    });
  });

  describe("PCR color logic", () => {
    test("returns green when pcr > 1.2", () => {
      expect(computePcrColor(1.3)).toBe("green");
      expect(computePcrColor(2.0)).toBe("green");
      expect(computePcrColor(100)).toBe("green");
    });

    test("returns red when pcr < 0.7", () => {
      expect(computePcrColor(0.5)).toBe("red");
      expect(computePcrColor(0.0)).toBe("red");
      expect(computePcrColor(0.69)).toBe("red");
    });

    test("returns blue when pcr is between 0.7 and 1.2", () => {
      expect(computePcrColor(0.7)).toBe("blue");
      expect(computePcrColor(1.0)).toBe("blue");
      expect(computePcrColor(1.2)).toBe("blue");
    });
  });

  describe("max pain finding", () => {
    test("returns max_pain from summary", () => {
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 24500,
        expected_move: null,
        total_ce_oi: 0,
        total_pe_oi: 0,
      };
      expect(computeStats([], summary).maxPain).toBe(24500);
    });

    test("returns 0 when no summary", () => {
      expect(computeStats([], undefined).maxPain).toBe(0);
    });

    test("handles max_pain of 0", () => {
      expect(computeStats([], zeroSummary).maxPain).toBe(0);
    });
  });

  describe("resistance strike detection", () => {
    test("finds strike with highest CE OI", () => {
      const matrix = [
        makeStrike(24000, 1000, 500),
        makeStrike(24500, 5000, 200),
        makeStrike(25000, 3000, 800),
      ];
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 9000,
        total_pe_oi: 1500,
      };
      expect(computeStats(matrix, summary).resistanceStrike).toBe(24500);
    });

    test("returns 0 when all CE OI values are 0", () => {
      const matrix = [makeStrike(24000, 0, 500), makeStrike(24500, 0, 200)];
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 0,
        total_pe_oi: 700,
      };
      expect(computeStats(matrix, summary).resistanceStrike).toBe(0);
    });

    test("picks first strike when multiple have equal max CE OI", () => {
      const matrix = [makeStrike(24000, 5000, 0), makeStrike(24500, 5000, 0)];
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 10000,
        total_pe_oi: 0,
      };
      expect(computeStats(matrix, summary).resistanceStrike).toBe(24000);
    });
  });

  describe("support strike detection", () => {
    test("finds strike with highest PE OI", () => {
      const matrix = [
        makeStrike(24000, 1000, 200),
        makeStrike(24500, 500, 6000),
        makeStrike(25000, 3000, 1000),
      ];
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 4500,
        total_pe_oi: 7200,
      };
      expect(computeStats(matrix, summary).supportStrike).toBe(24500);
    });

    test("returns 0 when all PE OI values are 0", () => {
      const matrix = [makeStrike(24000, 500, 0), makeStrike(24500, 200, 0)];
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 700,
        total_pe_oi: 0,
      };
      expect(computeStats(matrix, summary).supportStrike).toBe(0);
    });

    test("picks first strike when multiple have equal max PE OI", () => {
      const matrix = [makeStrike(24000, 0, 5000), makeStrike(24500, 0, 5000)];
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 0,
        total_pe_oi: 10000,
      };
      expect(computeStats(matrix, summary).supportStrike).toBe(24000);
    });
  });

  describe.each([
    { side: "ce", field: "resistanceStrike" as const },
    { side: "pe", field: "supportStrike" as const },
  ])("$side edge cases", ({ side, field }) => {
    test(`returns 0 when ${side} has no market_data`, () => {
      const matrix = [makeEmptyStrike(24000), makeEmptyStrike(24500)];
      expect(computeStats(matrix, zeroSummary)[field]).toBe(0);
    });

    test("returns 0 when strike matrix is empty", () => {
      expect(computeStats([], defaultSummary)[field]).toBe(0);
    });
  });

  describe("expected move", () => {
    test("returns expected_move from summary", () => {
      const expectedMove = { lower: 23500, upper: 25000, range: 750 };
      const summary: Summary = {
        pcr: 1.0,
        max_pain: 24500,
        expected_move: expectedMove,
        total_ce_oi: 0,
        total_pe_oi: 0,
      };
      expect(computeStats([], summary).expectedMove).toEqual(expectedMove);
    });

    test("returns null when expected_move is not in summary", () => {
      expect(computeStats([], defaultSummary).expectedMove).toBeNull();
    });

    test("returns null when no summary is provided", () => {
      expect(computeStats([], undefined).expectedMove).toBeNull();
    });
  });

  describe("total OI values", () => {
    test("returns total_ce_oi and total_pe_oi from summary", () => {
      const summary: Summary = {
        pcr: 1.5,
        max_pain: 0,
        expected_move: null,
        total_ce_oi: 150000,
        total_pe_oi: 225000,
      };
      const stats = computeStats([], summary);
      expect(stats.totalCE_OI).toBe(150000);
      expect(stats.totalPE_OI).toBe(225000);
    });

    test("returns 0 for both when no summary", () => {
      const stats = computeStats([], undefined);
      expect(stats.totalCE_OI).toBe(0);
      expect(stats.totalPE_OI).toBe(0);
    });
  });

  describe("fallback without summary", () => {
    test("returns all zeros when summary is undefined", () => {
      const stats = computeStats([makeStrike(24000, 5000, 3000)], undefined);
      expect(stats.pcr).toBe(0);
      expect(stats.maxPain).toBe(0);
      expect(stats.expectedMove).toBeNull();
      expect(stats.totalCE_OI).toBe(0);
      expect(stats.totalPE_OI).toBe(0);
      expect(stats.resistanceStrike).toBe(0);
      expect(stats.supportStrike).toBe(0);
    });
  });
});
