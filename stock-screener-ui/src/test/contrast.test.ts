import { describe, expect, it } from "vitest";
import {
  BG,
  INFO,
  LEVEL_CALL_WALL,
  LEVEL_MAX_PAIN,
  LEVEL_PUT_WALL,
  LEVEL_RESISTANCE,
  LEVEL_SUPPORT,
  NEGATIVE,
  OI_CALL,
  OI_PUT,
  POSITIVE,
  PRIMARY,
  SURFACE,
  SURFACE_ALT,
  TEXT,
  TEXT_MUTED,
  WARNING,
} from "@/ui/palette";
import { compositeOver, contrastRatio, parseColor, pickTextColor } from "@/utils/contrast";
import * as palette from "@/ui/palette";

const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

/** Every token that can appear behind text, as an ink, or as a rail/graphic. */
const SEMANTIC_TOKENS = [
  ["POSITIVE", POSITIVE],
  ["NEGATIVE", NEGATIVE],
  ["WARNING", WARNING],
  ["INFO", INFO],
  ["PRIMARY", PRIMARY],
  ["OI_CALL", OI_CALL],
  ["OI_PUT", OI_PUT],
  ["LEVEL_CALL_WALL", LEVEL_CALL_WALL],
  ["LEVEL_PUT_WALL", LEVEL_PUT_WALL],
  ["LEVEL_MAX_PAIN", LEVEL_MAX_PAIN],
  ["LEVEL_SUPPORT", LEVEL_SUPPORT],
  ["LEVEL_RESISTANCE", LEVEL_RESISTANCE],
] as const;

/** Tints used behind text — every one must keep the off-white ink legible. */
const TINT_ALPHAS = [0.08, 0.1, 0.12, 0.14] as const;

type ContrastCase = { label: string; fg: string; bg: string; min: number };

const matrix: ContrastCase[] = [];
for (const [name, token] of SEMANTIC_TOKENS) {
  for (const alpha of TINT_ALPHAS) {
    matrix.push({
      label: `TEXT / ${name}@${alpha} tint`,
      fg: TEXT,
      bg: compositeOver(token, SURFACE, alpha),
      min: AA_TEXT,
    });
  }
  matrix.push({ label: `${name} as ink on SURFACE`, fg: token, bg: SURFACE, min: AA_TEXT });
  matrix.push({ label: `${name} as 2px rail on SURFACE`, fg: token, bg: SURFACE, min: AA_GRAPHIC });
  matrix.push({
    label: `pickTextColor on ${name} fill`,
    fg: pickTextColor(token),
    bg: token,
    min: AA_TEXT,
  });
}

describe("contrast — WCAG maths", () => {
  it("white on black is 21:1 and identical colours are 1:1", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio(TEXT, TEXT)).toBeCloseTo(1, 5);
  });

  it("text on every surface clears AA", () => {
    expect(contrastRatio(TEXT, BG)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(TEXT, SURFACE)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(TEXT, SURFACE_ALT)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(TEXT_MUTED, SURFACE)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(TEXT_MUTED, SURFACE_ALT)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("semantic colours clear AA as text and graphics", () => {
    expect(contrastRatio(POSITIVE, SURFACE)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(NEGATIVE, SURFACE)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(INFO, SURFACE)).toBeGreaterThanOrEqual(AA_TEXT);
    // Decorative hairlines are intentionally below 3:1; meaningful rails are
    // checked by the OI cases below and by the generated matrix.
  });

  it("never puts the off-white ink directly on a solid OI fill", () => {
    // #E8E8E8 on #2FA36B / #E5606A measures ~2.6:1 — the defect this utility
    // exists to prevent. The readable ink is the dark page token.
    expect(contrastRatio(TEXT, OI_CALL)).toBeLessThan(AA_TEXT);
    expect(contrastRatio(TEXT, OI_PUT)).toBeLessThan(AA_TEXT);
    expect(pickTextColor(OI_CALL)).toBe(BG);
    expect(pickTextColor(OI_PUT)).toBe(BG);
    expect(contrastRatio(pickTextColor(OI_CALL), OI_CALL)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(pickTextColor(OI_PUT), OI_PUT)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps text readable over the low-alpha OI tint used in the cell", () => {
    const callTint = compositeOver(OI_CALL, SURFACE, 0.14);
    const putTint = compositeOver(OI_PUT, SURFACE, 0.14);
    expect(contrastRatio(TEXT, callTint)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(TEXT, putTint)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("contrast — every semantic tint behind text", () => {
  it.each(matrix)("$label", ({ fg, bg, min }: ContrastCase) => {
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}:1, need >= ${min}:1`).toBeGreaterThanOrEqual(
      min,
    );
  });
});

describe("contrast — report level/OI tint pairs", () => {
  it("keeps the walls new-OI cell ink readable at both ends of its alpha ramp", () => {
    // newOiTint tints with LEVEL_MAX_PAIN between 6% and 12% over the panel.
    for (const [name, alpha] of [["min", 0.06], ["max", 0.12]] as const) {
      const bg = compositeOver(LEVEL_MAX_PAIN, SURFACE, alpha);
      for (const [inkName, ink] of [["POSITIVE", POSITIVE], ["NEGATIVE", NEGATIVE], ["TEXT", TEXT]] as const) {
        const ratio = contrastRatio(ink, bg);
        expect(ratio, `${inkName} on LEVEL_MAX_PAIN@${name}=${alpha} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it("keeps an AT level's side ink readable on its own tint", () => {
    const putAt = compositeOver(POSITIVE, SURFACE, 0.12);
    const callAt = compositeOver(NEGATIVE, SURFACE, 0.12);
    expect(contrastRatio(POSITIVE, putAt)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(NEGATIVE, callAt)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("contrast — hostile input never throws", () => {
  const bad = [undefined, null, 42, {}, Number.NaN] as unknown as string[];

  it("parseColor returns a safe default instead of throwing", () => {
    for (const value of bad) {
      expect(() => parseColor(value), String(value)).not.toThrow();
      expect(parseColor(value), String(value)).toEqual({ r: 0, g: 0, b: 0 });
    }
  });

  it("pickTextColor returns a safe default for bad input instead of throwing", () => {
    for (const value of bad) {
      expect(() => pickTextColor(value), String(value)).not.toThrow();
      expect(pickTextColor(value), String(value)).toBe(TEXT);
    }
  });

  it("still picks correctly for real colours", () => {
    expect(pickTextColor(OI_CALL)).toBe(BG);
    expect(pickTextColor(BG)).toBe(TEXT);
  });
});

/**
 * Cividis mid-tones are the hardest fills on the market map: the ramp crosses
 * the luminance band where neither off-white nor near-black ink is comfortable.
 * These are the measured matplotlib stops with the documented stop-8 adjustment.
 */
const CIVIDIS_STOPS: readonly string[] =
  (palette as unknown as { CIVIDIS_STOPS?: readonly string[] }).CIVIDIS_STOPS ?? [];

describe("contrast — cividis market ramp is fully labelable", () => {
  it("picks a label ink clearing 4.5:1 for all 17 stops", () => {
    expect(CIVIDIS_STOPS, "palette must export the 17 cividis stops").toHaveLength(17);
    for (const [i, fill] of CIVIDIS_STOPS.entries()) {
      const ink = pickTextColor(fill, "#FFFFFF");
      const ratio = contrastRatio(ink, fill);
      expect(ratio, `stop ${i} ${fill}: ${ink} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("the substituted stop 8 clears with both inks; matplotlib's exact mid does not", () => {
    expect(CIVIDIS_STOPS[8], "stop 8 must be the measured substitution").toBe("#797674");
    expect(contrastRatio("#FFFFFF", "#797674")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio("#000000", "#797674")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio("#FFFFFF", "#7d7c78")).toBeLessThan(AA_TEXT);
  });
});
