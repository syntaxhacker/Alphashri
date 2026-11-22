import { describe, expect, test, vi } from "vitest";
import type { ReplayTrade } from "../tick";
import { closedCount, newStableArray, revealedCount, stableArray } from "./stableReveal";

const trade = (time: number, exit_time: number, pnl: number): ReplayTrade => ({
  time, exit_time, pnl, side: "LONG", kind: "inv",
  entry: 100, sl: 99, tp: 102, exit: 101, result: "TP", rr: 1,
});

const TRADES = [trade(10, 15, 2), trade(20, 25, -1), trade(30, 35, 4)];

describe("stableArray — replay clock derivations", () => {
  test("reuses the revealed array across 120 clock ticks with no new reveal", () => {
    const lateTrades = [trade(1000, 1500, 2), trade(2000, 2500, -1), trade(3000, 3500, 4)];
    const cache = newStableArray<ReplayTrade>();
    const build = vi.fn((now: number) => lateTrades.filter((t) => t.time <= now));
    const reveal = (now: number) =>
      stableArray(lateTrades, revealedCount(lateTrades, now), () => build(now), cache);

    const first = reveal(5);
    let naiveAllocations = 0;
    for (let now = 5; now < 125; now++) {
      // the old memo called `.filter()` on every tick — count what it would allocate
      naiveAllocations += 1;
      void lateTrades.filter((t) => t.time <= now);
      expect(reveal(now)).toBe(first);
    }

    expect(build).toHaveBeenCalledTimes(1);
    expect(naiveAllocations).toBe(120);
    expect(first).toHaveLength(0);
  });

  test("rebuilds only at reveal boundaries and preserves contents", () => {
    const cache = newStableArray<ReplayTrade>();
    const build = vi.fn((now: number) => TRADES.filter((t) => t.time <= now));
    const reveal = (now: number) =>
      stableArray(TRADES, revealedCount(TRADES, now), () => build(now), cache);

    const before = reveal(5);
    const first = reveal(10);
    const second = reveal(25);
    const third = reveal(40);

    expect(before).toHaveLength(0);
    expect(first).toEqual([TRADES[0]]);
    expect(second).toEqual([TRADES[0], TRADES[1]]);
    expect(third).toEqual(TRADES);
    expect(new Set([before, first, second, third]).size).toBe(4);
    expect(build).toHaveBeenCalledTimes(4);
  });

  test("closed set and net reuse their array while a revealed trade stays open", () => {
    const revealed = TRADES.filter((t) => t.time <= 30);
    const closedCache = newStableArray<ReplayTrade>();
    const build = vi.fn((now: number) => revealed.filter((t) => t.exit_time <= now));
    const closedAt = (now: number) =>
      stableArray(revealed, closedCount(revealed, now), () => build(now), closedCache);

    const first = closedAt(5);
    for (let now = 5; now < 15; now++) expect(closedAt(now)).toBe(first);
    const afterFirst = closedAt(15);
    for (let now = 15; now < 25; now++) expect(closedAt(now)).toBe(afterFirst);

    expect(first).toHaveLength(0);
    expect(afterFirst).toEqual([TRADES[0]]);
    expect(afterFirst.reduce((a, t) => a + t.pnl, 0)).toBe(2);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("a new trades array invalidates the cache even at the same count", () => {
    const cache = newStableArray<ReplayTrade>();
    const build = vi.fn((src: ReplayTrade[]) => src.filter((t) => t.time <= 20));
    const at = (src: ReplayTrade[]) => stableArray(src, revealedCount(src, 20), () => build(src), cache);

    const a = at(TRADES);
    const b = at([...TRADES]);
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
