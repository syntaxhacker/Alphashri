import { describe, expect, test } from "vitest";
import { typeConfig } from "./Notification";
import * as palette from "@/ui/palette";

describe("typeConfig", () => {
  test("has config for success type", () => {
    expect(typeConfig.success.icon).toBe("✓");
    expect(typeConfig.success.color).toBe(palette.POSITIVE);
    expect(typeConfig.success.borderColor).toBe(palette.POSITIVE);
  });

  test("has config for error type", () => {
    expect(typeConfig.error.icon).toBe("✕");
    expect(typeConfig.error.color).toBe(palette.NEGATIVE);
    expect(typeConfig.error.borderColor).toBe(palette.NEGATIVE);
  });

  test("has config for warning type", () => {
    expect(typeConfig.warning.icon).toBe("⚠");
    expect(typeConfig.warning.color).toBe(palette.WARNING);
    expect(typeConfig.warning.borderColor).toBe(palette.WARNING);
  });

  test("has config for info type", () => {
    expect(typeConfig.info.icon).toBe("ℹ");
    expect(typeConfig.info.color).toBe(palette.INFO);
    expect(typeConfig.info.borderColor).toBe(palette.INFO);
  });

  test("has exactly four notification types", () => {
    expect(Object.keys(typeConfig)).toHaveLength(4);
  });

  test("all configs have hex colors and icons", () => {
    for (const key of Object.keys(typeConfig)) {
      const config = typeConfig[key as keyof typeof typeConfig];
      expect(config.borderColor).toMatch(/^#/);
      expect(config.icon.length).toBeGreaterThan(0);
    }
  });
});
