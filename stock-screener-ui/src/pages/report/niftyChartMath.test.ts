import { describe, expect, test } from "vitest";
import type { NiftyReport } from "@/types/niftyReport";
import { buildMarkLines } from "./niftyChartMath";

function report(overrides: Partial<NiftyReport> = {}): NiftyReport {
  return {
    spot: 22_740,
    maxPain: 22_700,
    pivots: {
      type: "classic",
      pp: 22_897,
      r1: 23_157,
      r2: 23_316,
      r3: 23_500,
      s1: 22_738,
      s2: 22_478,
      s3: 22_300,
      prev: null,
    },
    walls: {
      calls: [{ strike: 23_000, oi: 9_000 }],
      puts: [{ strike: 22_500, oi: 8_000 }],
    },
    intraday: [
      {
        time: "2026-10-21T09:15:00+05:30",
        open: 22_760,
        high: 22_780,
        low: 22_703,
        close: 22_740,
      },
    ],
    ...overrides,
  } as unknown as NiftyReport;
}

const labels = (rep: NiftyReport) =>
  buildMarkLines(rep).map((line) => line.label.formatter);

describe("buildMarkLines gutter number format", () => {
  test("max pain and put wall print Indian-grouped whole points", () => {
    const out = labels(report());
    expect(out).toContain("MP 22,700");
    expect(out).toContain("PW 22,500");
    expect(out).not.toContain("MP 22700");
    expect(out).not.toContain("PW 22500");
  });

  test("call walls and pivots keep the same grouping (one format per gutter)", () => {
    const out = labels(report());
    expect(out).toContain("CW 23,000");
    expect(out).toContain("PP 22,897");
    expect(out).toContain("S1 22,738");
    expect(out).not.toContain("CW 23000");
  });

  test("near walls are labelled NEAR CW / NEAR PW; max walls stay CW / PW", () => {
    const out = labels(
      report({
        walls: {
          calls: [{ strike: 24_000, oi: 12_000 }],
          puts: [{ strike: 22_000, oi: 11_000 }],
        },
        wallsNear: {
          calls: [{ strike: 23_900, oi: 9_000 }],
          puts: [{ strike: 22_600, oi: 8_000 }],
        },
      }),
    );
    expect(out).toContain("CW 24,000");
    expect(out).toContain("PW 22,000");
    expect(out).toContain("NEAR CW 23,900");
    expect(out).toContain("NEAR PW 22,600");
  });

  test("a near wall on the max wall's strike is drawn once, as the max wall", () => {
    const out = labels(
      report({
        walls: { calls: [{ strike: 24_000, oi: 12_000 }], puts: [] },
        wallsNear: { calls: [{ strike: 24_000, oi: 9_000 }], puts: [] },
      }),
    );
    expect(out).toContain("CW 24,000");
    expect(out.some((l) => l.startsWith("NEAR CW"))).toBe(false);
  });
});

describe("buildMarkLines wall side classification", () => {
  function sensexReport(overrides: Partial<NiftyReport> = {}): NiftyReport {
    return {
      spot: 79_153,
      maxPain: 79_200,
      walls: {
        calls: [
          { strike: 79_500, oi: 7_080_000 },
          { strike: 79_000, oi: 5_830_000 },
        ],
        puts: [
          { strike: 78_800, oi: 6_000_000 },
          { strike: 79_300, oi: 4_000_000 },
        ],
      },
      intraday: [
        { time: "2026-10-21T09:15:00+05:30", open: 79_100, high: 79_200, low: 79_050, close: 79_153 },
      ],
      ...overrides,
    } as unknown as NiftyReport;
  }

  test("primary CW is highest-OI call ABOVE spot; below-spot call labelled CW↓", () => {
    const out = labels(sensexReport());
    expect(out).toContain("CW 79,500");
    expect(out).toContain("CW↓ 79,000");
    expect(out).toContain("PW 78,800");
    expect(out).toContain("PW↑ 79,300");
  });

  test("primary CW above spot has includeInScale true when within sane cap", () => {
    const lines = buildMarkLines(sensexReport());
    const cw79500 = lines.find((l) => l.label.formatter === "CW 79,500");
    expect(cw79500?.includeInScale).toBe(true);
  });

  test("only-below calls → primary labelled CW (BELOW)", () => {
    const out = labels(
      sensexReport({
        walls: {
          calls: [
            { strike: 79_000, oi: 7_000_000 },
            { strike: 78_500, oi: 5_000_000 },
          ],
          puts: [],
        },
      }),
    );
    expect(out).toContain("CW (BELOW) 79,000");
    expect(out).toContain("CW↓ 78,500");
  });

  test("only-above puts → primary labelled PW (ABOVE)", () => {
    const out = labels(
      sensexReport({
        walls: {
          calls: [],
          puts: [
            { strike: 79_500, oi: 7_000_000 },
            { strike: 79_800, oi: 5_000_000 },
          ],
        },
      }),
    );
    expect(out).toContain("PW (ABOVE) 79,500");
    expect(out).toContain("PW↑ 79,800");
  });

  test("mirror puts: primary PW is highest-OI put BELOW spot; above-spot put labelled PW↑", () => {
    const out = labels(sensexReport());
    expect(out).toContain("PW 78,800");
    expect(out).toContain("PW↑ 79,300");
  });
});
