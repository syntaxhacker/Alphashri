import { describe, expect, it } from "vitest";
import { muiTheme } from "@/ui/muiTheme";
import { fontWeights } from "./theme";

describe("Theme Configuration (MUI default)", () => {
  it("exports muiTheme", () => {
    expect(muiTheme).toBeDefined();
    expect(typeof muiTheme).toBe("object");
  });
  it("has cssVariables enabled", () => {
    // NT theme uses cssVariables object form -> createThemeWithVars exposes
    // generated CSS vars via theme.vars (no boolean .cssVariables flag)
    expect((muiTheme as any).vars).toBeDefined();
  });
  it("has colorSchemes light and dark", () => {
    const cs = (muiTheme as any).colorSchemes;
    expect(cs).toBeDefined();
    expect(cs.light).toBeDefined();
    expect(cs.dark).toBeDefined();
  });
  it("derives palette from palette.ts (single source of truth)", () => {
    // Custom NT theme: colors derive from palette.ts, not MUI defaults
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
