// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { computeNiftyFreshness } from "./niftyFreshness";
import type { NiftyBurst } from "@/types/niftyReport";

function makeBurst(type: string): NiftyBurst {
  return {
    id: "test",
    side: "call",
    t: new Date().toISOString(),
    delta: 0,
    baseline: 0,
    score: 0,
    severity: "info",
    cumDoi: 0,
    spot: 0,
    tickVol: 0,
    signal: null,
    type: type as NiftyBurst["type"],
  };
}

describe("computeNiftyFreshness", () => {
  const nowMs = 1_700_000_000_000; // fixed timestamp for deterministic tests

  test("fresh (42s) during market hours → DATA 42s, not stale", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: nowMs - 42_000,
      marketOpen: true,
      bursts: [],
    });
    expect(result.label).toBe("DATA 42s");
    expect(result.isStale).toBe(false);
    expect(result.detail).toContain("Last update 42s ago");
  });

  test("stale (300s) during market hours → STALE, isStale=true", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: nowMs - 300_000,
      marketOpen: true,
      bursts: [],
    });
    expect(result.label).toBe("STALE");
    expect(result.isStale).toBe(true);
    expect(result.detail).toContain("tape stopped");
  });

  test("closed market → CLOSED, never stale", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: nowMs - 300_000, // even very old
      marketOpen: false,
      bursts: [],
    });
    expect(result.label).toBe("CLOSED");
    expect(result.isStale).toBe(false);
    expect(result.detail).toContain("Market closed");
  });

  test("missing timestamp during market hours → DATA —, not stale", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: null,
      marketOpen: true,
      bursts: [],
    });
    expect(result.label).toBe("DATA —");
    expect(result.isStale).toBe(false);
    expect(result.detail).toContain("No backend timestamp");
  });

  test("data_stale burst forces STALE even when timestamp is fresh", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: nowMs - 10_000, // only 10s old
      marketOpen: true,
      bursts: [makeBurst("data_stale")],
    });
    expect(result.label).toBe("STALE");
    expect(result.isStale).toBe(true);
    expect(result.detail).toContain("data_stale burst");
  });

  test("data_stale burst forces STALE even when timestamp is missing", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: null,
      marketOpen: true,
      bursts: [makeBurst("data_stale")],
    });
    expect(result.label).toBe("STALE");
    expect(result.isStale).toBe(true);
  });

  test("other burst types do not force STALE", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: nowMs - 10_000,
      marketOpen: true,
      bursts: [makeBurst("burst"), makeBurst("squeeze")],
    });
    expect(result.label).toBe("DATA 10s");
    expect(result.isStale).toBe(false);
  });

  test("exactly 120s boundary → DATA 2m (not stale)", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: nowMs - 120_000,
      marketOpen: true,
      bursts: [],
    });
    expect(result.label).toBe("DATA 2m");
    expect(result.isStale).toBe(false);
  });

  test("120s + 1ms → STALE", () => {
    const result = computeNiftyFreshness({
      nowMs,
      lastBackendMs: nowMs - 120_001,
      marketOpen: true,
      bursts: [],
    });
    expect(result.label).toBe("STALE");
    expect(result.isStale).toBe(true);
  });
});