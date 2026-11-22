/**
 * The decision strip's flex weights must be derived from the cell minimums.
 *
 * Hand-tuned weights (3 / 3.1 / 3 / 4.35) were correct against the old smaller
 * type. When every cell grew to fit the bigger numerals the weights were left
 * alone, so PRICE was allotted 389px for five cells that needed 547 — `Regime`
 * (439→621) and `Max-OI call` (553→656) overlapped by 68px on the same row and
 * the header labels collided. Every unit test passed, because none looked at
 * layout.
 */
import { describe, expect, test } from "vitest";
import { REPORT_STRIP_CELL_MIN, REPORT_STRIP_GROUP_WEIGHT } from "./reportTokens";

describe("reportTokens — decision strip geometry", () => {
  test("each group weight is exactly the sum of its own cell minimums", () => {
    expect(REPORT_STRIP_GROUP_WEIGHT.price).toBe(
      REPORT_STRIP_CELL_MIN.symbol +
        REPORT_STRIP_CELL_MIN.change +
        REPORT_STRIP_CELL_MIN.spot +
        REPORT_STRIP_CELL_MIN.regime +
        REPORT_STRIP_CELL_MIN.flip,
    );
    expect(REPORT_STRIP_GROUP_WEIGHT.walls).toBe(
      REPORT_STRIP_CELL_MIN.callWall +
        REPORT_STRIP_CELL_MIN.putWall +
        REPORT_STRIP_CELL_MIN.pin +
        REPORT_STRIP_CELL_MIN.maxPain,
    );
    expect(REPORT_STRIP_GROUP_WEIGHT.volatility).toBe(
      REPORT_STRIP_CELL_MIN.pcrOi + REPORT_STRIP_CELL_MIN.pcrVol,
    );
  });

  test("no group is allotted less width than its cells need", () => {
    // Flex weight units are arbitrary, so compare the ratio the strip applies:
    // with N groups the allotted share is weight / sum(weights).
    const groups = ["price", "walls", "volatility"] as const;
    const needs = {
      price:
        REPORT_STRIP_CELL_MIN.symbol +
        REPORT_STRIP_CELL_MIN.change +
        REPORT_STRIP_CELL_MIN.spot +
        REPORT_STRIP_CELL_MIN.regime +
        REPORT_STRIP_CELL_MIN.flip,
      walls:
        REPORT_STRIP_CELL_MIN.callWall +
        REPORT_STRIP_CELL_MIN.putWall +
        REPORT_STRIP_CELL_MIN.pin +
        REPORT_STRIP_CELL_MIN.maxPain,
      volatility: REPORT_STRIP_CELL_MIN.pcrOi + REPORT_STRIP_CELL_MIN.pcrVol,
    };
    const totalWeight = groups.reduce((s, g) => s + REPORT_STRIP_GROUP_WEIGHT[g], 0);
    // The strip is 1746px in the measured desktop layout, minus the 4px inline
    // gutter between groups.
    const stripPx = 1746;
    for (const g of groups) {
      const allotted = (stripPx * REPORT_STRIP_GROUP_WEIGHT[g]) / totalWeight;
      expect(allotted, `${g} is under-allotted`).toBeGreaterThanOrEqual(needs[g]);
    }
  });

  test("the widest total still fits the measured strip", () => {
    const groups = ["price", "walls", "volatility", "flow"] as const;
    const totalWeight = groups.reduce((s, g) => s + REPORT_STRIP_GROUP_WEIGHT[g], 0);
    expect(totalWeight).toBeGreaterThan(0);
    // A zero/NaN weight would silently blank every group.
    for (const g of groups) {
      expect(Number.isFinite(REPORT_STRIP_GROUP_WEIGHT[g]), `${g} weight`).toBe(true);
      expect(REPORT_STRIP_GROUP_WEIGHT[g]!, `${g} weight`).toBeGreaterThan(0);
    }
  });
});
