import { alpha as muiAlpha } from "@mui/material/styles";

export { alpha } from "@mui/material/styles";

/**
 * Convert hex color to rgba string with alpha.
 * Supports 3-char (#RGB) and 6-char (#RRGGBB) hex.
 */
export function withAlpha(hex: string, alpha: number): string {
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
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Hex to rgba via MUI alpha (handles 3-char hex, named colors via MUI).
 */
export function hexToRgba(hex: string, alpha: number): string {
  return muiAlpha(hex, alpha);
}
