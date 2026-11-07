import { describe, expect, test } from "vitest";
import { displayStatusForHit, patternDisplayStatus, type DisplayStatus } from "./patternDisplayStatus";

const base = (overrides: Partial<Parameters<typeof patternDisplayStatus>[0]> = {}): DisplayStatus =>
  patternDisplayStatus({
    rawStatus: "forming",
    isBase: true,
    lastClose: 120,
    upper: 130,
    lower: 100,
    ...overrides,
  });

describe("patternDisplayStatus", () => {
  describe("missing or non-positive data → raw status fallback", () => {
    test("missing lastClose falls back to raw", () => {
      const s = base({ lastClose: null });
      expect(s.label).toBe("FORMING");
      expect(s.tone).toBe("info");
      expect(s.tooltip).toBe("DB status: forming");
    });

    test("undefined lastClose falls back to raw", () => {
      const s = patternDisplayStatus({
        rawStatus: "confirmed",
        isBase: true,
        upper: 130,
      });
      expect(s.label).toBe("CONFIRMED");
      expect(s.tone).toBe("success");
    });

    test("non-positive lastClose (0) falls back to raw", () => {
      const s = base({ lastClose: 0 });
      expect(s.label).toBe("FORMING");
      expect(s.tone).toBe("info");
    });

    test("missing upper falls back to raw", () => {
      const s = base({ upper: null });
      expect(s.label).toBe("FORMING");
      expect(s.tone).toBe("info");
    });

    test("non-positive upper (0) falls back to raw", () => {
      const s = base({ upper: 0 });
      expect(s.label).toBe("FORMING");
      expect(s.tone).toBe("info");
    });

    test("unknown raw status upper-cases with neutral tone (fallback path)", () => {
      const s = base({ rawStatus: "weird", lastClose: null });
      expect(s.label).toBe("WEIRD");
      expect(s.tone).toBe("neutral");
      expect(s.tooltip).toBe("DB status: weird");
    });
  });

  describe("base — price relative to the box", () => {
    test("more than 5% above the trigger → EXTENDED (warning)", () => {
      const s = base({ lastClose: 140 }); // (140-130)/130 ≈ +7.7%
      expect(s.label).toBe("EXTENDED");
      expect(s.tone).toBe("warning");
      expect(s.tooltip).toBe(
        "More than 5% above the breakout trigger — the move is already in progress · raw: forming",
      );
    });

    test("exactly 5% above the trigger → BREAKOUT (success)", () => {
      const s = base({ lastClose: 136.5 }); // (136.5-130)/130 = 5%
      expect(s.label).toBe("BREAKOUT");
      expect(s.tone).toBe("success");
      expect(s.tooltip).toBe("Closed above the trigger · raw: forming");
    });

    test("just above the trigger → BREAKOUT (success)", () => {
      const s = base({ lastClose: 130.01 }); // ≈ +0.01%
      expect(s.label).toBe("BREAKOUT");
      expect(s.tone).toBe("success");
    });

    test("exactly at the trigger → BREAKOUT (success)", () => {
      const s = base({ lastClose: 130 }); // 0%
      expect(s.label).toBe("BREAKOUT");
      expect(s.tone).toBe("success");
    });

    test("below the trigger but inside the box → ARMED (info)", () => {
      const s = base({ lastClose: 120 }); // -7.7%, ≥ lower 100
      expect(s.label).toBe("ARMED");
      expect(s.tone).toBe("info");
      expect(s.tooltip).toBe("Inside the base, below the trigger · raw: forming");
    });

    test("at the lower box edge → ARMED (info)", () => {
      const s = base({ lastClose: 100 }); // lastClose >= lower
      expect(s.label).toBe("ARMED");
      expect(s.tone).toBe("info");
    });

    test("below the trigger with no lower edge → ARMED (info)", () => {
      const s = base({ lower: null });
      expect(s.label).toBe("ARMED");
      expect(s.tone).toBe("info");
    });

    test("below the box → INVALID (error)", () => {
      const s = base({ lastClose: 90 }); // < lower 100
      expect(s.label).toBe("INVALID");
      expect(s.tone).toBe("error");
      expect(s.tooltip).toBe("Below the base — the setup is broken · raw: forming");
    });
  });

  describe("non-base → raw status mapping (never ARMED)", () => {
    const notBase = (rawStatus: string, lastClose?: number | null) =>
      patternDisplayStatus({ rawStatus, isBase: false, lastClose, upper: 130, lower: 100 });

    test("confirmed → CONFIRMED (success)", () => {
      expect(notBase("confirmed", 120)).toMatchObject({
        label: "CONFIRMED",
        tone: "success",
      });
    });

    test("forming → FORMING (info)", () => {
      expect(notBase("forming", 120)).toMatchObject({ label: "FORMING", tone: "info" });
    });

    test("failed → FAILED (error)", () => {
      expect(notBase("failed", 120)).toMatchObject({ label: "FAILED", tone: "error" });
    });

    test("marginal → MARGINAL (neutral)", () => {
      expect(notBase("marginal", 120)).toMatchObject({ label: "MARGINAL", tone: "neutral" });
    });

    test("unknown → uppercase raw (neutral)", () => {
      const s = notBase("suspended");
      expect(s.label).toBe("SUSPENDED");
      expect(s.tone).toBe("neutral");
      expect(s.tooltip).toBe("DB status: suspended");
    });
  });
});

describe("displayStatusForHit", () => {
  const hit = (over: Record<string, unknown> = {}) =>
    ({
      pattern_id: "consolidation",
      status: "failed",
      base_days: 80,
      last_close: 120,
      trendlines: [
        [{ t: "2026-01-01", price: 130 }],
        [{ t: "2026-01-01", price: 100 }],
      ],
      pivots: [],
      ...over,
    }) as never;

  test("derives ARMED from the hit's own box edges", () => {
    expect(displayStatusForHit(hit()).label).toBe("ARMED");
  });

  test("derives BREAKOUT above the box top", () => {
    expect(displayStatusForHit(hit({ last_close: 134 })).label).toBe("BREAKOUT");
  });

  test("derives INVALID below the box bottom", () => {
    expect(displayStatusForHit(hit({ last_close: 90 })).label).toBe("INVALID");
  });

  test("non-base hits keep the raw status", () => {
    const s = displayStatusForHit(hit({ pattern_id: "falling_wedge", base_days: 0 }));
    expect(s.label).toBe("FAILED");
  });

  test("falls back to the raw status without a live price", () => {
    expect(displayStatusForHit(hit({ last_close: null })).label).toBe("FAILED");
  });
});
