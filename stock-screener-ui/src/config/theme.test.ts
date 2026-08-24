import { describe, expect, it } from "vitest";
import { muiTheme } from "@/ui/muiTheme";
import { FIN_PRIMARY, FIN_POSITIVE, FIN_NEGATIVE } from "@/ui/palette";
import { fontWeights } from "./theme";

describe("Theme Configuration (MUI Financial)", () => {
  it("exports muiTheme", () => {
    expect(muiTheme).toBeDefined();
    expect(typeof muiTheme).toBe("object");
  });
  it("has correct primary color", () => {
    // @ts-ignore light palette
    expect(muiTheme.palette?.primary?.main || (muiTheme as any).colorSchemes?.light?.palette?.primary?.main).toBe(FIN_PRIMARY);
  });
  it("has success/error from FIN tokens", () => {
    const light = (muiTheme as any).colorSchemes?.light?.palette;
    expect(light.success.main).toBe(FIN_POSITIVE);
    expect(light.error.main).toBe(FIN_NEGATIVE);
  });
  it("has shape radius 8", () => {
    expect(muiTheme.shape.borderRadius).toBe(8);
  });
  it("has typography IBM Plex Sans", () => {
    expect(muiTheme.typography.fontFamily).toContain("IBM Plex Sans");
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
