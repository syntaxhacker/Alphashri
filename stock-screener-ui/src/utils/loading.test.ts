import { describe, expect, it } from "vitest";
import { createLoadingState, setLoading, isLoading, isAnyLoading } from "./loading";
import type { LoadingState } from "./loading";

describe("createLoadingState", () => {
  it("creates state with all keys initialized to false", () => {
    const state = createLoadingState(["stocks", "trades"]);
    expect(state).toEqual({ stocks: false, trades: false });
  });

  it("returns empty object for empty keys array", () => {
    const state = createLoadingState([]);
    expect(state).toEqual({});
  });

  it("handles single key", () => {
    const state = createLoadingState(["stocks"]);
    expect(state).toEqual({ stocks: false });
  });

  it("handles many keys", () => {
    const keys = ["a", "b", "c", "d", "e"];
    const state = createLoadingState(keys);
    expect(state).toEqual({
      a: false,
      b: false,
      c: false,
      d: false,
      e: false,
    });
  });
});

describe("setLoading", () => {
  it("sets a key to loading (true)", () => {
    const state = createLoadingState(["stocks"]);
    const next = setLoading(state, "stocks", true);
    expect(next).toEqual({ stocks: true });
  });

  it("sets a key to not loading (false)", () => {
    const state: LoadingState<"stocks"> = { stocks: true };
    const next = setLoading(state, "stocks", false);
    expect(next).toEqual({ stocks: false });
  });

  it("does not mutate the original state", () => {
    const state = createLoadingState(["stocks", "trades"]);
    setLoading(state, "stocks", true);
    expect(state).toEqual({ stocks: false, trades: false });
  });

  it("updates only the target key, leaving others unchanged", () => {
    const state: LoadingState<"stocks" | "trades"> = {
      stocks: false,
      trades: true,
    };
    const next = setLoading(state, "stocks", true);
    expect(next).toEqual({ stocks: true, trades: true });
  });
});

describe("isLoading", () => {
  it("returns false when key is not loading", () => {
    const state = createLoadingState(["stocks"]);
    expect(isLoading(state, "stocks")).toBe(false);
  });

  it("returns true when key is loading", () => {
    const state: LoadingState<"stocks"> = { stocks: true };
    expect(isLoading(state, "stocks")).toBe(true);
  });

  it("returns false for unknown key", () => {
    const state = createLoadingState(["stocks"]);
    expect(isLoading(state, "trades" as "stocks")).toBe(false);
  });

  it("returns false for empty state", () => {
    const state = createLoadingState([]);
    expect(isLoading(state, "" as never)).toBe(false);
  });
});

describe("isAnyLoading", () => {
  it("returns false when nothing is loading", () => {
    const state = createLoadingState(["stocks", "trades"]);
    expect(isAnyLoading(state)).toBe(false);
  });

  it("returns true when one key is loading", () => {
    const state: LoadingState<"stocks" | "trades"> = {
      stocks: true,
      trades: false,
    };
    expect(isAnyLoading(state)).toBe(true);
  });

  it("returns true when all keys are loading", () => {
    const state: LoadingState<"stocks" | "trades"> = {
      stocks: true,
      trades: true,
    };
    expect(isAnyLoading(state)).toBe(true);
  });

  it("returns false for empty state", () => {
    const state = createLoadingState([]);
    expect(isAnyLoading(state)).toBe(false);
  });
});
