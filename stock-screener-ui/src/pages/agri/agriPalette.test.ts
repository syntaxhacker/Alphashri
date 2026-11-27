// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AGRI_ACCENT,
  AGRI_CATEGORICAL,
  AGRI_CONTEXT,
  AGRI_DOWN,
  AGRI_OUTLIER,
  AGRI_SEASON_STOPS,
  AGRI_UP,
  SURFACE,
  SURFACE_ALT,
} from "@/ui/palette";
import { contrastRatio, parseColor, pickTextColor } from "@/utils/contrast";

const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

const INKS = [AGRI_ACCENT, AGRI_UP, AGRI_DOWN, AGRI_OUTLIER, ...AGRI_CATEGORICAL];

describe("agri palette contrast", () => {
  it("keeps every data ink readable as text on both panel steps", () => {
    for (const ink of INKS) {
      expect(contrastRatio(ink, SURFACE), `${ink} on SURFACE`).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(ink, SURFACE_ALT), `${ink} on SURFACE_ALT`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("keeps the muted context ink visible as a graphic without competing with focus", () => {
    expect(contrastRatio(AGRI_CONTEXT, SURFACE)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    expect(contrastRatio(AGRI_CONTEXT, SURFACE_ALT)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    expect(AGRI_CONTEXT).not.toBe(AGRI_ACCENT);
  });

  it("labels every seasonality stop with an ink clearing AA", () => {
    for (const [index, fill] of AGRI_SEASON_STOPS.entries()) {
      const ink = pickTextColor(fill);
      expect(contrastRatio(ink, fill), `stop ${index} ${fill}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("is diverging blue → neutral → amber, never terminal green/red", () => {
    const low = parseColor(AGRI_SEASON_STOPS[0]);
    const mid = parseColor(AGRI_SEASON_STOPS[3]);
    const high = parseColor(AGRI_SEASON_STOPS[6]);
    expect(low.b).toBeGreaterThan(low.r);
    expect(high.r).toBeGreaterThan(high.b);
    expect(Math.abs(mid.r - mid.b)).toBeLessThan(20);
    expect(mid.r).toBeLessThan(high.r);
    expect(mid.b).toBeLessThan(low.b);
  });

  it("keeps the categorical set distinct", () => {
    expect(new Set(AGRI_CATEGORICAL).size).toBe(AGRI_CATEGORICAL.length);
    expect(AGRI_CATEGORICAL.length).toBeGreaterThanOrEqual(5);
  });
});
