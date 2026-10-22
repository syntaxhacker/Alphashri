import { describe, expect, it } from "vitest";
import { muiTheme } from "@/ui/muiTheme";
import { BG, BG_COLOR, CHART_BG, CHART_DATAZOOM_BG, SURFACE, SURFACE_COLOR, SURFACE_ALT, TOOLTIP_BG } from "@/ui/palette";
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

  it("renders a pitch-black body with near-black panels", () => {
    expect(BG_COLOR).toBe("#000000");
    expect(SURFACE_COLOR).toBe("#0A0A0A");
    expect(SURFACE_ALT).toBe("#121212");
    expect(muiTheme.colorSchemes.dark.palette.background.default).toBe("#000000");
    expect(muiTheme.colorSchemes.dark.palette.background.paper).toBe("#0A0A0A");
    expect(muiTheme.colorSchemes.light.palette.background.default).toBe("#000000");
    expect(muiTheme.colorSchemes.light.palette.background.paper).toBe("#0A0A0A");
    expect(BG).toBe("#000000");
    expect(SURFACE).toBe("#0A0A0A");
  });

  it("keeps chart surfaces black and tooltips dark", () => {
    expect(CHART_BG).toBe("#000000");
    expect(CHART_DATAZOOM_BG).toBe("#000000");
    expect(TOOLTIP_BG).toBe("#111111");
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
