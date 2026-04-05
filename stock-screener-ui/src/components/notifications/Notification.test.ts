import { describe, expect, test } from "vitest";
import { typeConfig } from "./Notification";

describe("typeConfig", () => {
  test("has config for success type", () => {
    expect(typeConfig.success.icon).toBe("✓");
    expect(typeConfig.success.className).toBe("toast-success");
  });

  test("has config for error type", () => {
    expect(typeConfig.error.icon).toBe("✕");
    expect(typeConfig.error.className).toBe("toast-error");
  });

  test("has config for warning type", () => {
    expect(typeConfig.warning.icon).toBe("⚠");
    expect(typeConfig.warning.className).toBe("toast-warning");
  });

  test("has config for info type", () => {
    expect(typeConfig.info.icon).toBe("ℹ");
    expect(typeConfig.info.className).toBe("toast-info");
  });

  test("has exactly four notification types", () => {
    expect(Object.keys(typeConfig)).toHaveLength(4);
  });

  test("all class names follow toast- prefix convention", () => {
    for (const key of Object.keys(typeConfig)) {
      const config = typeConfig[key as keyof typeof typeConfig];
      expect(config.className).toMatch(/^toast-/);
      expect(config.icon.length).toBeGreaterThan(0);
    }
  });
});
