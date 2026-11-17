/**
 * WCAG contrast maths for palette-derived colours.
 *
 * Everything in the UI is rendered from `src/ui/palette.ts`; this module is the
 * single place that answers "can this foreground be read on this background?".
 * Use it instead of eyeballing a fill, and keep the guard test
 * (`src/test/contrast.test.ts`) in sync when adding a token pair.
 */

import { BG, TEXT } from "@/ui/palette";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(raw: string): Rgb | null {
  const hex = raw.trim().replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function parseRgb(raw: string): Rgb | null {
  const match = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!match) return null;
  return {
    r: Math.round(Number(match[1])),
    g: Math.round(Number(match[2])),
    b: Math.round(Number(match[3])),
  };
}

/** Parse a hex or rgb()/rgba() colour; alpha must be composited first. */
export function parseColor(color: string): Rgb {
  const parsed = parseHex(color) ?? parseRgb(color);
  if (!parsed) throw new Error(`Unsupported colour: ${color}`);
  return parsed;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(color: string): number {
  const { r, g, b } = parseColor(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1..21. Text needs >= 4.5, UI graphics >= 3. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Composite a translucent colour over an opaque background, returning hex. */
export function compositeOver(
  foreground: string,
  background: string,
  alpha = 1,
): string {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const a = Math.max(0, Math.min(1, alpha));
  const mix = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  return `#${[mix(fg.r, bg.r), mix(fg.g, bg.g), mix(fg.b, bg.b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Pick the readable text colour for a filled surface. Defaults are the app's
 * off-white text and black page token; pass different anchors for light mode.
 */
export function pickTextColor(
  background: string,
  light: string = TEXT,
  dark: string = BG,
): string {
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}
