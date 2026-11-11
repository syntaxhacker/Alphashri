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

  it("renders a pitch-black body with near-black panels", () => {
    expect(BG_COLOR).toBe("#000000");
    expect(SURFACE_COLOR).toBe("#0A0A0A");
    expect(SURFACE_ALT).toBe("#121212");
    expect(sxTheme.palette.background.default).toBe("#000000");
    expect(sxTheme.palette.background.paper).toBe("#0A0A0A");
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
