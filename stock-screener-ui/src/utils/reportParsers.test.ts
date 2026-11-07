import { describe, expect, it } from "vitest";

import { median } from "./reportParsers";

describe("median", () => {
  it("returns the middle value for an odd-length set", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, -5, 7, 42, 0])).toBe(7);
  });

  it("averages the two middle values for an even-length set", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([10, 20])).toBe(15);
    expect(median([1, 2, 3, 100])).toBe(2.5);
  });

  it("returns 0 for an empty set", () => {
    expect(median([])).toBe(0);
  });

  it("returns the only value for a single-element set", () => {
    expect(median([7])).toBe(7);
  });

  it("does not mutate the input array", () => {
    const input = [5, 1, 4, 2, 3];
    const copy = [...input];
    median(input);
    expect(input).toEqual(copy);
  });

  it("handles unsorted and negative values", () => {
    expect(median([-10, -30, -20])).toBe(-20);
    expect(median([-1, 5, -3, 8])).toBe(2);
  });
});
