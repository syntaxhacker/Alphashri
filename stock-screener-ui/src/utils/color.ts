import { alpha } from "@/ui/alpha";
import { parseColor } from "@/utils/contrast";

export { alpha } from "@/ui/alpha";

/** Accepts 3-char (#RGB) and 6-char (#RRGGBB) hex. */
export function withAlpha(hex: string, opacity: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function hexToRgba(hex: string, opacity: number): string {
  return alpha(hex, opacity);
}

/** Linear RGB interpolation; `t` is clamped to 0..1. */
export function interpolateHex(a: string, b: string, t: number): string {
  const from = parseColor(a);
  const to = parseColor(b);
  const mix = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const channels = [
    from.r + (to.r - from.r) * mix,
    from.g + (to.g - from.g) * mix,
    from.b + (to.b - from.b) * mix,
  ];
  return `#${channels
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, channel)))
        .toString(16)
        .padStart(2, "0")
        .toUpperCase(),
    )
    .join("")}`;
}
