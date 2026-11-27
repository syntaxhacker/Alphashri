import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHomeDerivedCache,
  HOME_DERIVED_TTL_MS,
  readHomeDerived,
  type HomeCacheScope,
} from "./homeDerivedCache";

const scope = (over: Partial<HomeCacheScope> = {}): HomeCacheScope => ({
  session: "2026-11-22",
  universe: "india",
  layout: "monitor",
  ...over,
});

beforeEach(() => {
  clearHomeDerivedCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-22T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  clearHomeDerivedCache();
});

describe("home derived cache", () => {
  it("returns the same array across an identical tick instead of re-deriving", () => {
    const derive = vi.fn(() => [{ id: 1 }]);
    const first = readHomeDerived("session-checks", scope(), { reading: 1 }, derive);
    const second = readHomeDerived("session-checks", scope(), { reading: 1 }, derive);

    expect(second).toBe(first);
    expect(derive).toHaveBeenCalledTimes(1);
  });

  it("re-derives on a changed reading, not on a changed clock", () => {
    const derive = vi.fn((value: number) => [value]);
    readHomeDerived("sector-leaders", scope(), { reading: 1 }, () => derive(1));
    readHomeDerived("sector-leaders", scope(), { reading: 1 }, () => derive(1));
    expect(derive).toHaveBeenCalledTimes(1);

    readHomeDerived("sector-leaders", scope(), { reading: 2 }, () => derive(2));
    expect(derive).toHaveBeenCalledTimes(2);
  });

  it("separates entries by session, universe, layout and domain", () => {
    const derive = vi.fn(() => [] as number[]);
    readHomeDerived("catalyst-news", scope(), { reading: 1 }, derive);
    readHomeDerived("catalyst-news", scope({ session: "2026-11-23" }), { reading: 1 }, derive);
    readHomeDerived("catalyst-news", scope({ universe: "usa" }), { reading: 1 }, derive);
    readHomeDerived("catalyst-news", scope({ layout: "desk:Main" }), { reading: 1 }, derive);
    readHomeDerived("session-checks", scope(), { reading: 1 }, derive);

    expect(derive).toHaveBeenCalledTimes(5);
  });

  it("expires at the TTL and honours an explicit force refresh", () => {
    const derive = vi.fn(() => [] as number[]);
    readHomeDerived("session-checks", scope(), { reading: 1 }, derive);
    vi.advanceTimersByTime(HOME_DERIVED_TTL_MS - 1);
    readHomeDerived("session-checks", scope(), { reading: 1 }, derive);
    expect(derive).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    readHomeDerived("session-checks", scope(), { reading: 1 }, derive);
    expect(derive).toHaveBeenCalledTimes(2);

    readHomeDerived("session-checks", scope(), { reading: 1 }, derive, { force: true });
    expect(derive).toHaveBeenCalledTimes(3);
  });

  it("clear() drops every domain at once", () => {
    const derive = vi.fn(() => [] as number[]);
    readHomeDerived("session-checks", scope(), { reading: 1 }, derive);
    readHomeDerived("catalyst-news", scope(), { reading: 1 }, derive);

    clearHomeDerivedCache();

    readHomeDerived("session-checks", scope(), { reading: 1 }, derive);
    readHomeDerived("catalyst-news", scope(), { reading: 1 }, derive);
    expect(derive).toHaveBeenCalledTimes(4);
  });
});
