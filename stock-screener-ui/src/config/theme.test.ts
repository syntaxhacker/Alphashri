import { describe, expect, it } from "vitest";
import { sxTheme } from "@/ui/sxTheme";
import { BG, BG_COLOR, CHART_BG, CHART_DATAZOOM_BG, SURFACE, SURFACE_COLOR, SURFACE_ALT, TOOLTIP_BG } from "@/ui/palette";
import { fontWeights } from "./theme";

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
});
