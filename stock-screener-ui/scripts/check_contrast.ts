/**
 * Contrast gate for the financial palette.
 *
 *   bun run contrast
 *
 * Fails when a text/fill pair falls below WCAG AA (4.5:1), or a UI graphic
 * (bar, rail, border) falls below 3:1. Add new fill/tint pairs here and in
 * `src/test/contrast.test.ts`; do not eyeball a saturated fill behind text.
 *
 * The `baseChecks` below are the explicit, hand-picked regressions. `matrix`
 * is generated for EVERY semantic token so a new token cannot be introduced
 * behind text without being forced through the same WCAG maths.
 */

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
} from "../src/ui/palette";
import { compositeOver, contrastRatio, pickTextColor } from "../src/utils/contrast";

type Check = { label: string; fg: string; bg: string; min: number };

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

const baseChecks: Check[] = [
  { label: "TEXT / BG", fg: TEXT, bg: BG, min: 4.5 },
  { label: "TEXT / SURFACE", fg: TEXT, bg: SURFACE, min: 4.5 },
  { label: "TEXT / SURFACE_ALT", fg: TEXT, bg: SURFACE_ALT, min: 4.5 },
  { label: "TEXT_MUTED / SURFACE", fg: TEXT_MUTED, bg: SURFACE, min: 4.5 },
  { label: "TEXT_MUTED / SURFACE_ALT", fg: TEXT_MUTED, bg: SURFACE_ALT, min: 4.5 },
  { label: "POSITIVE / SURFACE", fg: POSITIVE, bg: SURFACE, min: 4.5 },
  { label: "NEGATIVE / SURFACE", fg: NEGATIVE, bg: SURFACE, min: 4.5 },
  { label: "INFO / SURFACE", fg: INFO, bg: SURFACE, min: 4.5 },
  // BORDER is a decorative hairline, not a control boundary; it is exempt from
  // the 3:1 non-text rule. Meaningful rails/bars are checked by the matrix.
  { label: "OI_CALL rail / SURFACE (graphic)", fg: OI_CALL, bg: SURFACE, min: 3 },
  { label: "OI_PUT rail / SURFACE (graphic)", fg: OI_PUT, bg: SURFACE, min: 3 },
  {
    label: "TEXT / OI_CALL tint",
    fg: TEXT,
    bg: compositeOver(OI_CALL, SURFACE, 0.14),
    min: 4.5,
  },
  {
    label: "TEXT / OI_PUT tint",
    fg: TEXT,
    bg: compositeOver(OI_PUT, SURFACE, 0.14),
    min: 4.5,
  },
  {
    label: "readable ink on OI_CALL",
    fg: pickTextColor(OI_CALL),
    bg: OI_CALL,
    min: 4.5,
  },
  {
    label: "readable ink on OI_PUT",
    fg: pickTextColor(OI_PUT),
    bg: OI_PUT,
    min: 4.5,
  },
];

const matrix: Check[] = [];
for (const [name, token] of SEMANTIC_TOKENS) {
  for (const alpha of TINT_ALPHAS) {
    matrix.push({
      label: `TEXT / ${name}@${alpha} tint`,
      fg: TEXT,
      bg: compositeOver(token, SURFACE, alpha),
      min: 4.5,
    });
  }
  matrix.push({ label: `${name} as ink / SURFACE`, fg: token, bg: SURFACE, min: 4.5 });
  matrix.push({ label: `${name} as 2px rail / SURFACE`, fg: token, bg: SURFACE, min: 3 });
  matrix.push({
    label: `pickTextColor on ${name} fill`,
    fg: pickTextColor(token),
    bg: token,
    min: 4.5,
  });
}

const checks = [...baseChecks, ...matrix];
const failures: string[] = [];

console.log(`CONTRAST GATE — ${checks.length} checks (${baseChecks.length} explicit + ${matrix.length} matrix)\n`);
for (const check of checks) {
  const ratio = contrastRatio(check.fg, check.bg);
  const ok = ratio >= check.min;
  if (!ok) failures.push(`${check.label} — ${ratio.toFixed(2)}:1 < ${check.min}:1`);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${check.label.padEnd(42)} ${ratio.toFixed(2).padStart(5)}:1 (min ${check.min})`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} contrast check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} contrast checks pass.`);
