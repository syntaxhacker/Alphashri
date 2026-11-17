import { describe, expect, test } from "vitest";
import {
  ANALYTICS_DEFAULT_EXPIRIES,
  ANALYTICS_MAX_EXPIRIES,
  SURFACE_MAX_STRIKES,
} from "./optionsAnalytics";

describe("options analytics limits", () => {
  test("defaults the expiry ladder to three expiries", () => {
    expect(ANALYTICS_DEFAULT_EXPIRIES).toBe(3);
  });

  test("clamps the expiry count at six", () => {
    expect(ANALYTICS_MAX_EXPIRIES).toBe(6);
  });

  test("caps the IV surface at 21 strike columns", () => {
    expect(SURFACE_MAX_STRIKES).toBe(21);
  });

  test("all limits are positive integers and max exceeds the default", () => {
    for (const value of [
      ANALYTICS_DEFAULT_EXPIRIES,
      ANALYTICS_MAX_EXPIRIES,
      SURFACE_MAX_STRIKES,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(ANALYTICS_MAX_EXPIRIES).toBeGreaterThan(ANALYTICS_DEFAULT_EXPIRIES);
  });
});
