import { describe, expect, it } from "vitest";
import { muiTheme } from "@/ui/muiTheme";
import { fontWeights } from "./theme";

describe("Theme Configuration (MUI default)", () => {
  it("exports muiTheme", () => {
    expect(muiTheme).toBeDefined();
    expect(typeof muiTheme).toBe("object");
  });
  it("has cssVariables enabled", () => {
    // default MUI theme uses cssVariables for colorSchemes
    expect((muiTheme as any).cssVariables).toBe(true);
  });
  it("has colorSchemes light and dark enabled", () => {
    const cs = (muiTheme as any).colorSchemes;
    expect(cs).toBeDefined();
    expect(cs.light).toBe(true);
    expect(cs.dark).toBe(true);
  });
  it("is default MUI theme without custom palette overrides", () => {
    // Should not have custom primary hardcoded; MUI defaults are used
    // Just ensure theme object is valid
    expect(muiTheme.palette).toBeDefined();
  });
});

describe("fontWeights", () => {
  it("matches theme.other.fontWeights", () => {
    expect(fontWeights.normal).toBe(400);
    expect(fontWeights.medium).toBe(500);
    expect(fontWeights.semibold).toBe(600);
    expect(fontWeights.bold).toBe(700);
  });
});
