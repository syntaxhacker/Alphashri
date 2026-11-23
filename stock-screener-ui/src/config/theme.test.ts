import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sxTheme } from "@/ui/sxTheme";
import {
  BG,
  BG_COLOR,
  BORDER,
  CHART_BG,
  CHART_DATAZOOM_BG,
  INFO,
  NEGATIVE,
  POSITIVE,
  PRIMARY,
  SURFACE,
  SURFACE_ALT,
  SURFACE_COLOR,
  TEXT,
  TEXT_MUTED,
  TOOLTIP_BG,
  WARNING,
} from "@/ui/palette";
import { fontWeights, theme } from "./theme";

describe("Theme tokens (local Tailwind/sxTheme)", () => {
  it("exports the local sxTheme", () => {
    expect(sxTheme).toBeDefined();
    expect(typeof sxTheme).toBe("object");
  });
  it("derives palette from palette.ts (single source of truth)", () => {
    expect(sxTheme.palette).toBeDefined();
  });

  it("renders a black page with a perceptibly raised panel", () => {
    expect(BG_COLOR).toBe("#000000");
    expect(sxTheme.palette.background.default).toBe(BG_COLOR);
    expect(sxTheme.palette.background.paper).toBe(SURFACE_COLOR);
    expect(BG).toBe(BG_COLOR);
    expect(SURFACE).toBe(SURFACE_COLOR);
    // A panel indistinguishable from the page is not a panel.
    expect(SURFACE).not.toBe(BG);
    expect(SURFACE_ALT).not.toBe(SURFACE);
  });

  it("keeps chart plot surfaces black and tooltips on the raised step", () => {
    expect(CHART_BG).toBe(BG);
    expect(CHART_DATAZOOM_BG).toBe(BG);
    expect(TOOLTIP_BG).toBe(SURFACE_ALT);
  });
});

describe("fontWeights", () => {
  it("matches theme.other.fontWeights", () => {
    expect(fontWeights.normal).toBe(400);
    expect(fontWeights.medium).toBe(500);
    expect(fontWeights.semibold).toBe(600);
    expect(fontWeights.bold).toBe(700);
  });

  it("stays one object with the theme's font weights", () => {
    expect(fontWeights).toBe(theme.fontWeights);
  });
});

describe("uiTheme (JS theme tokens)", () => {
  it("is a non-empty object with defined, typed values", () => {
    expect(theme).toBeTruthy();
    expect(typeof theme).toBe("object");
    expect(Object.keys(theme).length).toBeGreaterThan(0);

    // Reading through an explicit shape fails to compile if a field is missing
    // or regresses back to `any`, which a runtime `toBeDefined` cannot catch.
    const typed: {
      fontFamily: string;
      fontSizes: { sm: string; md: string; lg: string; xl: string };
      colors: { primary: string; background: string; text: string };
      fontWeights: { normal: number; bold: number };
    } = theme;
    expect(typed.fontFamily).toBeTypeOf("string");
    for (const size of Object.values(typed.fontSizes)) expect(size).toBeTypeOf("string");
    expect(typed.colors.primary).toBeTypeOf("string");
    expect(typed.fontWeights.normal).toBeTypeOf("number");
  });

  it("matches the chart fallbacks so no renderer changes visually", () => {
    expect(theme.fontFamily).toBe('"IBM Plex Sans", "Roboto", system-ui, sans-serif');
    expect(theme.fontSizes).toEqual({ sm: "12px", md: "14px", lg: "16px", xl: "20px" });
  });

  it("aliases the semantic colours from the single palette source", () => {
    expect(theme.colors).toEqual({
      primary: PRIMARY,
      success: POSITIVE,
      error: NEGATIVE,
      warning: WARNING,
      info: INFO,
      text: TEXT,
      textMuted: TEXT_MUTED,
      background: BG,
      surface: SURFACE,
      surfaceAlt: SURFACE_ALT,
      border: BORDER,
    });
    // A palette retune must flow through without touching this module.
    expect(theme.colors.background).toBe(BG_COLOR);
    expect(theme.colors.surface).toBe(SURFACE_COLOR);
  });

  it("imports the palette instead of hardcoding a colour in theme.tsx", () => {
    const source = readFileSync(resolve(process.cwd(), "src/ui/theme.tsx"), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).toContain('from "./palette"');
    expect(source).not.toContain("as any");
  });
});
