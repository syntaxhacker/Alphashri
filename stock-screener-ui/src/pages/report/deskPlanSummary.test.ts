import { describe, expect, test } from "vitest";
import {
  MAX_HEADLINE_LENGTH,
  normalizePlanWeights,
  summarizeDeskPlan,
  triggerLevel,
  type PlanInput,
} from "./deskPlanSummary";

const FULL_ACTION = "Sell rallies / buy puts on a failed retest";

function bearishPlan(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    bias: "bearish",
    spot: 22_812,
    bear: {
      do: {
        action: FULL_ACTION,
        trigger: "1-min close below 22,800, or reject 22,950",
        stop: 22_830,
        target: 22_700,
        rr: 2.1,
      },
    },
    reasons: [
      { tag: "trend", text: "spot below PP and EMA20" },
      { tag: "gamma", text: "dealers short gamma" },
      { tag: "oi", text: "call wall 22,900" },
      { tag: "vol", text: "ATM IV 14.2 vs RV 11.8" },
      { tag: "structure", text: "support 22,700 held twice" },
    ],
    ...overrides,
  };
}

describe("summarizeDeskPlan — bearish read", () => {
  const summary = summarizeDeskPlan(bearishPlan());

  test("headline carries bias, spot, trigger, stop and target with Indian grouping", () => {
    expect(summary.headline).toContain("BEARISH");
    expect(summary.headline).toContain("spot 22,812");
    expect(summary.headline).toContain("sell rallies at 22,800");
    expect(summary.headline).toContain("cut 22,830");
    expect(summary.headline).toContain("target 22,700");
    expect(summary.headline.length).toBeLessThanOrEqual(MAX_HEADLINE_LENGTH);
  });

  test("confidence counts the four directional reasons and stays capped", () => {
    expect(summary.confidence).toBe(83);
    expect(summary.confidence).toBeGreaterThan(60);
    expect(summary.confidence).toBeLessThanOrEqual(95);
  });

  test("action is the active side's action and tone is negative", () => {
    expect(summary.action).toBe(FULL_ACTION);
    expect(summary.tone).toBe("negative");
  });

  test("weights are normalized to 100", () => {
    const total = summary.weights.reduce((sum, row) => sum + row.weight, 0);
    expect(summary.weights.map((row) => row.tag)).toEqual([
      "trend",
      "gamma",
      "oi",
      "vol",
      "structure",
    ]);
    expect(total).toBe(100);
    expect(summary.weights[0]).toEqual({ tag: "trend", weight: 40 });
  });
});

describe("summarizeDeskPlan — neutral", () => {
  test("never trades, never scores, and says so verbatim", () => {
    const summary = summarizeDeskPlan({
      bias: "neutral",
      spot: 22_812,
      reasons: [{ tag: "trend", text: "mixed" }],
    });
    expect(summary.headline).toBe("NEUTRAL · no trade — wait for a trigger");
    expect(summary.action).toBe("Wait");
    expect(summary.tone).toBe("neutral");
    expect(summary.confidence).toBe(0);
  });
});

describe("summarizeDeskPlan — weak reward:risk", () => {
  test("subtracts 15 points and flags the headline", () => {
    const weak = summarizeDeskPlan(
      bearishPlan({
        bear: {
          do: {
            action: FULL_ACTION,
            trigger: "1-min close below 22,800",
            stop: 22_830,
            target: 22_805,
            rr: 1.2,
          },
        },
      }),
    );
    expect(weak.confidence).toBe(68);
    expect(weak.headline.endsWith("· weak R:R")).toBe(true);
    expect(weak.headline).toContain("· weak R:R");
  });

  test("R:R of exactly 1.5 is not weak", () => {
    const edge = summarizeDeskPlan(
      bearishPlan({
        bear: { do: { action: FULL_ACTION, rr: 1.5 } },
      }),
    );
    expect(edge.confidence).toBe(83);
    expect(edge.headline).not.toContain("weak R:R");
  });
});

describe("summarizeDeskPlan — sparse input", () => {
  test("missing reasons yields no weights and base confidence", () => {
    const summary = summarizeDeskPlan({
      bias: "bearish",
      spot: 22_812,
      bear: { do: { action: FULL_ACTION } },
    });
    expect(summary.weights).toEqual([]);
    expect(summary.confidence).toBe(35);
    expect(summary.headline).toContain("BEARISH");
    expect(summary.headline).toContain("sell rallies");
  });

  test("missing side falls back to the no-trade action", () => {
    const summary = summarizeDeskPlan({ bias: "bullish", spot: 22_812 });
    expect(summary.action).toBe("No trade — wait");
    expect(summary.confidence).toBe(35);
  });

  test("never throws on an empty/partial payload", () => {
    expect(() => summarizeDeskPlan({} as PlanInput)).not.toThrow();
    expect(() =>
      summarizeDeskPlan({ bias: "bullish", spot: Number.NaN }),
    ).not.toThrow();
    const partial = summarizeDeskPlan({ bias: "bullish", spot: Number.NaN });
    expect(typeof partial.headline).toBe("string");
    expect(partial.headline).not.toContain("NaN");
    expect(partial.headline.length).toBeLessThanOrEqual(MAX_HEADLINE_LENGTH);
  });

  test("duplicate and unknown tags cannot inflate confidence or weights", () => {
    const summary = summarizeDeskPlan(
      bearishPlan({
        reasons: [
          { tag: "trend", text: "first" },
          { tag: "trend", text: "duplicate" },
          { tag: "sentiment", text: "unknown bucket" },
        ],
      }),
    );
    expect(summary.weights).toEqual([{ tag: "trend", weight: 100 }]);
    expect(summary.confidence).toBe(47);
  });
});

describe("summarizeDeskPlan — bullish read", () => {
  test("tones positive and points to the buy side", () => {
    const summary = summarizeDeskPlan({
      bias: "bullish",
      spot: 22_812,
      bull: {
        do: {
          action: "Buy dips / buy calls on a reclaim",
          trigger: "1-min close above 22,850",
          stop: 22_780,
          target: 22_950,
          rr: 2,
        },
      },
      reasons: [
        { tag: "trend", text: "spot above PP" },
        { tag: "gamma", text: "dealers long gamma" },
        { tag: "oi", text: "put wall 22,700" },
        { tag: "structure", text: "resistance 22,850" },
      ],
    });
    expect(summary.tone).toBe("positive");
    expect(summary.headline).toContain("BULLISH");
    expect(summary.headline).toContain("buy dips at 22,850");
    expect(summary.headline).toContain("cut 22,780");
    expect(summary.headline).toContain("target 22,950");
    expect(summary.confidence).toBe(83);
  });
});

describe("weight + trigger helpers", () => {
  test("normalizes a subset to exactly 100 with integer remainder distribution", () => {
    const weights = normalizePlanWeights(["oi", "vol"]);
    expect(weights).toEqual([
      { tag: "oi", weight: 67 },
      { tag: "vol", weight: 33 },
    ]);
    expect(weights.reduce((sum, row) => sum + row.weight, 0)).toBe(100);
  });

  test("extracts the level, not the timeframe, from a trigger sentence", () => {
    expect(triggerLevel("1-min close below 22,690")).toBe(22_690);
    expect(triggerLevel("wait for pivots")).toBeNull();
    expect(triggerLevel(undefined)).toBeNull();
  });
});
