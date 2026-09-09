import { describe, expect, test } from "vitest";
import { typeConfig } from "./Notification";

describe("typeConfig", () => {
  test("has config for success type", () => {
    expect(typeConfig.success.icon).toBe("✓");
    expect(typeConfig.success.color).toBe("success.main");
  });

  test("has config for error type", () => {
    expect(typeConfig.error.icon).toBe("✕");
    expect(typeConfig.error.color).toBe("error.main");
  });

  test("has config for warning type", () => {
    expect(typeConfig.warning.icon).toBe("⚠");
    expect(typeConfig.warning.color).toBe("warning.main");
  });

  test("has config for info type", () => {
    expect(typeConfig.info.icon).toBe("ℹ");
    expect(typeConfig.info.color).toBe("info.main");
  });

  test("has exactly four notification types", () => {
    expect(Object.keys(typeConfig)).toHaveLength(4);
  });

  test("all configs have semantic MUI colors and icons", () => {
    for (const key of Object.keys(typeConfig)) {
      const config = typeConfig[key as keyof typeof typeConfig];
      expect(config.borderColor).toMatch(/\.main$/);
      expect(config.icon.length).toBeGreaterThan(0);
    }
  });
});
