import { describe, expect, test } from "vitest";
import {
  SESSION_END_MIN,
  SESSION_MINUTES,
  SESSION_START_MIN,
  computeReplayCoverage,
  coverageTone,
  minuteLabel,
  minuteOfDay,
} from "./niftyReplayCoverage";

const iso = (min: number) => {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `2026-10-19T${h}:${m}:00+05:30`;
};

describe("minuteOfDay", () => {
  test("parses ISO instants and bare HH:MM", () => {
    expect(minuteOfDay("2026-10-19T10:33:00+05:30")).toBe(10 * 60 + 33);
    expect(minuteOfDay("10:33")).toBe(633);
    expect(minuteOfDay("2026-10-19 09:15")).toBe(555);
  });

  test("rejects junk", () => {
    expect(minuteOfDay("")).toBeNull();
    expect(minuteOfDay("not-a-time")).toBeNull();
    expect(minuteOfDay("25:00")).toBeNull();
    expect(minuteOfDay("10:99")).toBeNull();
  });
});

describe("computeReplayCoverage", () => {
  test(`a full session is ${SESSION_MINUTES} minutes at 100%`, () => {
    const frames = Array.from({ length: SESSION_MINUTES }, (_, i) => ({
      t: iso(SESSION_START_MIN + i),
    }));
    const c = computeReplayCoverage(frames);
    expect(c.recorded).toBe(SESSION_MINUTES);
    expect(c.missing).toBe(0);
    expect(c.pct).toBe(100);
    expect(c.gaps).toEqual([]);
    expect(c.stepMissing.every((n) => n === 0)).toBe(true);
  });

  test("a late start is reported as a leading gap", () => {
    const c = computeReplayCoverage([{ t: iso(633) }, { t: iso(634) }]);
    expect(c.firstMin).toBe(633);
    expect(c.recorded).toBe(2);
    expect(c.missing).toBe(SESSION_MINUTES - 2);
    // 09:15 → 10:32 is missing (78 minutes) before the first frame.
    expect(c.gaps[0]).toEqual({ start: SESSION_START_MIN, end: 632, minutes: 78 });
    // …but the largest hole is the afternoon after the last frame (10:34).
    expect(c.largestGap).toEqual({ start: 635, end: SESSION_END_MIN, minutes: 295 });
  });

  test("holes between frames are counted once and become stepMissing", () => {
    const c = computeReplayCoverage([
      { t: iso(555) }, // 09:15
      { t: iso(558) }, // 09:18 → 09:16 and 09:17 missing
      { t: iso(559) }, // 09:19
    ]);
    expect(c.recorded).toBe(3);
    expect(c.stepMissing).toEqual([2, 0]);
    expect(c.gaps).toContainEqual({ start: 556, end: 557, minutes: 2 });
  });

  test("dedupes repeated minutes and ignores out-of-session frames", () => {
    const c = computeReplayCoverage([
      { t: iso(600) },
      { t: iso(600) },
      { t: iso(601) },
      { t: iso(120) }, // 02:00 — a pre-market manual snapshot
    ]);
    expect(c.recorded).toBe(2);
    expect(c.firstMin).toBe(600);
  });

  test("an empty day is one gap covering the session", () => {
    const c = computeReplayCoverage([]);
    expect(c.recorded).toBe(0);
    expect(c.pct).toBe(0);
    expect(c.gaps).toEqual([
      { start: SESSION_START_MIN, end: SESSION_END_MIN, minutes: SESSION_MINUTES },
    ]);
  });
});

describe("coverageTone / minuteLabel", () => {
  test("thresholds", () => {
    expect(coverageTone(100)).toBe("good");
    expect(coverageTone(98)).toBe("good");
    expect(coverageTone(97.9)).toBe("warn");
    expect(coverageTone(85)).toBe("warn");
    expect(coverageTone(84.9)).toBe("bad");
  });

  test("labels", () => {
    expect(minuteLabel(SESSION_START_MIN)).toBe("09:15");
    expect(minuteLabel(SESSION_END_MIN)).toBe("15:29");
  });
});
