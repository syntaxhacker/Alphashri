import { describe, expect, test } from "vitest";
import { deriveOiSignal, resolveFuelState, resolveOiDirection } from "./niftyOiBursts.signal";
import type { OiBurst } from "./niftyOiBursts.types";

const chain = [
  { strike: 22_650, ce: { ltp: 70 }, pe: { ltp: 12 } },
  { strike: 22_700, ce: { ltp: 22 }, pe: { ltp: 28 } },
];
const spot = 22_722;

function burst(patch: Partial<OiBurst> = {}): OiBurst {
  return {
    id: "x",
    side: "put",
    t: "14:03",
    baseline: 1_000,
    score: 4,
    severity: "watch",
    spot,
    ...patch,
  };
}

describe("optional OI readings never become a directional claim", () => {
  test("a missing delta blocks the premium-only fuel inference", () => {
    expect(resolveFuelState(burst({ premChg: 50 }))).toBeNull();
    expect(resolveFuelState(burst({ delta: -1_000, premChg: 50 }))).toBe("writers_covering");
  });

  test("a missing delta blocks premium and legacy OI direction", () => {
    const premium = resolveOiDirection(burst({ premChg: -50 }));
    expect(premium.bearish).toBeNull();
    expect(premium.basis).toContain("no OI reading");
    expect(resolveOiDirection(burst()).basis).toContain("no OI reading");
    expect(resolveOiDirection(burst({ delta: 1_000 }))).toMatchObject({ leg: "CE", via: "oi" });
  });

  test("no mechanical plan is emitted without an OI reading or backend verdict", () => {
    expect(deriveOiSignal(burst(), chain, spot)).toBeNull();
    const plan = deriveOiSignal(burst({ delta: -1_000 }), chain, spot);
    expect(plan).not.toBeNull();
    expect(plan!.leg).toBe("PE");
  });

  test("a squeeze with no OI reading prints an unknown, not a fake number", () => {
    const plan = deriveOiSignal(
      burst({ type: "squeeze", wall: 22_700, leg: "CE" }),
      chain,
      spot,
    );
    expect(plan!.basis).toContain("? units");
    expect(plan!.basis).not.toContain("0 units");
  });

  // 2026-11-27 verifier defect 2: a coil's delta is 0 and carries no one-minute
  // OI move. Premium alone must never be turned into a covering/liquidating
  // fuel claim (which then printed "FUEL: spent" in the live DOM).
  test("a zero delta with a premium change makes no fuel claim", () => {
    const coil = burst({ type: "coil", delta: 0, premChg: 12, wall: 22_700 });
    expect(resolveFuelState(coil)).toBeNull();
    expect(deriveOiSignal(coil, chain, spot)).toBeNull();
    // A real non-zero delta keeps the genuine 2×2 inference intact.
    expect(resolveFuelState(burst({ delta: -1_000, premChg: 12 }))).toBe("writers_covering");
  });
});
