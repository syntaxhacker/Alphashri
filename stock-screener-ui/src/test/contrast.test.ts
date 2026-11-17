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
import { compositeOver, contrastRatio, pickTextColor } from "@/utils/contrast";

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
