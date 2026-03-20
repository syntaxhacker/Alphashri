import { describe, expect, it } from "vitest";
import { resolveColor } from "./useThemeColors";

describe("resolveColor", () => {
  it("returns dark color when isDark is true", () => {
    expect(resolveColor(true, "#fff", "#000")).toBe("#000");
  });

  it("returns light color when isDark is false", () => {
    expect(resolveColor(false, "#fff", "#000")).toBe("#fff");
  });

  it("handles identical light and dark colors", () => {
    expect(resolveColor(true, "#888", "#888")).toBe("#888");
    expect(resolveColor(false, "#888", "#888")).toBe("#888");
  });

  it("handles empty strings", () => {
    expect(resolveColor(true, "", "dark")).toBe("dark");
    expect(resolveColor(false, "light", "")).toBe("light");
  });

  it("handles Mantine-style color references", () => {
    expect(resolveColor(true, "white", "dark[0]")).toBe("dark[0]");
    expect(resolveColor(false, "gray[7]", "dark[0]")).toBe("gray[7]");
  });
});
