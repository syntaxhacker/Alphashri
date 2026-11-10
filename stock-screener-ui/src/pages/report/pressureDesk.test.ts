import { describe, expect, it } from "vitest";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import {
  combineWalls,
  confidenceOf,
  flowQuadrant,
  flowText,
  quadrantFlowText,
  isShortGamma,
  largestMoves,
  nearestWall,
  normalizeHistory,
  pathRead,
  quadrantOf,
  sentenceFor,
  toPressureWall,
  wallKey,
  wallLabel,
  whyRead,
} from "./pressureDesk";

const row = (overrides: Partial<WallsRow> = {}): WallsRow => ({
  strike: 25000,
  oi: 4_000_000,
  erosion_5m: -0.006,
  erosion_15m: -0.012,
  erosion_30m: -0.015,
  prem_chg_5m: 0.044,
  prem_chg_15m: 0.104,
  prem_chg_30m: 0.104,
  status: "STABLE",
  flow: "WRITERS_COVERING",
  fuel_score: 44,
  ...overrides,
});

const payload = (): WallsPayload =>
  ({
    symbol: "NIFTY",
    date: "2026-11-09",
    spot: 24928.55,
    flip: 25700,
    calls: [
      row({ strike: 26000, oi: 5_950_000 }),
      row({ strike: 25500, oi: 4_450_000 }),
      row({ strike: 25000 }),
    ],
    puts: [
      row({ strike: 24000, oi: 4_540_000 }),
      row({ strike: 23000, oi: 4_220_000 }),
    ],
  }) as WallsPayload;

describe("pressureDesk", () => {
  it("maps the four OI/premium quadrants", () => {
    expect(quadrantOf(1, 1)).toBe("NE");
    expect(quadrantOf(1, -1)).toBe("SE");
    expect(quadrantOf(-1, 1)).toBe("NW");
    expect(quadrantOf(-1, -1)).toBe("SW");
    expect(quadrantOf(null, 1)).toBeNull();
  });

  it("maps backend flow tokens and falls back to a label", () => {
    expect(flowQuadrant("LONG_BUILD")).toBe("NE");
    expect(flowQuadrant("WRITERS_ADDING")).toBe("SE");
    expect(flowQuadrant("WRITERS_COVERING")).toBe("NW");
    expect(flowQuadrant("LONG_UNWIND")).toBe("SW");
    expect(flowQuadrant("UNKNOWN")).toBeNull();
    expect(flowText("WRITERS_COVERING")).toBe("sellers covering");
    expect(flowText("UNKNOWN")).toBe("flow unread");
    expect(quadrantFlowText("NW")).toBe("sellers covering");
    expect(quadrantFlowText(null)).toBe("flow unread");
  });

  it("turns a row into a pressure wall with percent units", () => {
    const wall = toPressureWall("CALL", row());
    expect(wall.key).toBe("CALL-25000");
    expect(wall.oiPct).toBeCloseTo(-1.5);
    expect(wall.premPct).toBeCloseTo(10.4);
    expect(wall.quadrant).toBe("NW");
    expect(wallKey("PUT", 24000)).toBe("PUT-24000");
    expect(wallLabel("PUT", 24000)).toBe("24,000 PE");
  });

  it("reads confidence from the available windows", () => {
    expect(confidenceOf(row()).level).toBe("high");
    expect(confidenceOf(row()).text).toBe("5m/15m/30m agree");
    expect(
      confidenceOf(
        row({
          erosion_5m: 0.006,
          prem_chg_5m: 0.04,
          erosion_15m: -0.012,
          prem_chg_15m: 0.1,
        }),
      ),
    ).toMatchObject({ level: "med", text: "5m vs 30m mixed" });
    expect(
      confidenceOf(
        row({
          erosion_5m: 0.006,
          prem_chg_5m: 0.04,
          erosion_15m: 0.012,
          prem_chg_15m: -0.1,
          erosion_30m: -0.015,
          prem_chg_30m: 0.1,
        }),
      ),
    ).toMatchObject({ level: "low", text: "5/15/30 conflict" });
    expect(confidenceOf(row({ erosion_5m: null }))).toMatchObject({
      level: "med",
      text: "15m/30m agree",
    });
  });

  it("explains the sentence and the consequence", () => {
    expect(sentenceFor("NW")).toContain("covering");
    expect(whyRead(row(), 24928, 25700)).toContain("Short gamma");
    expect(whyRead(row(), 24928, 24000)).toContain("squeeze");
    expect(isShortGamma(24928, 25700)).toBe(true);
    expect(isShortGamma(24928, 24000)).toBe(false);
  });

  it("reads the 30m path and carries history gaps", () => {
    expect(pathRead(row())).toBe("premium bid while OI falls — covering");
    const carried = normalizeHistory([100, 110, null, 121]);
    expect(carried[0]).toBe(100);
    expect(carried[1]).toBeCloseTo(110);
    expect(carried[2]).toBeCloseTo(110);
    expect(carried[3]).toBeCloseTo(121);
    expect(normalizeHistory([null, 100, 101])).toEqual([null, 100, 101]);
    expect(normalizeHistory([null, null])).toEqual([null, null]);
  });

  it("combines walls and finds the nearest/largest moves", () => {
    const walls = combineWalls(payload());
    expect(walls).toHaveLength(5);
    expect(walls[0].side).toBe("CALL");
    expect(walls[3].side).toBe("PUT");
    expect(nearestWall(walls, 24928)?.strike).toBe(25000);
    const largest = largestMoves([
      toPressureWall("CALL", row({ strike: 26000, erosion_30m: -0.03 })),
      toPressureWall("PUT", row({ strike: 24000, erosion_30m: 0.02 })),
    ]);
    expect(largest.oi?.strike).toBe(26000);
  });
});
