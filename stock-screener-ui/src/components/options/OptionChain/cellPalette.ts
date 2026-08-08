import type { MantineTheme } from "@/ui";
import { clamp } from "../../../utils/ui-helpers";
import {
  SCALE_GREEN,
  SCALE_RED,
  SCALE_ORANGE,
  SCALE_TEAL,
  SCALE_YELLOW,
  TEXT_MUTED,
} from "../../../config/colors";

function parseHex(hex: string) {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;
  const int = Number.parseInt(value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixColors(colorA: string, colorB: string, ratio: number): string {
  const normalizedRatio = clamp(ratio, 0, 1);
  const ca = parseHex(colorA);
  const cb = parseHex(colorB);
  const r = Math.round(ca.r + (cb.r - ca.r) * normalizedRatio);
  const g = Math.round(ca.g + (cb.g - ca.g) * normalizedRatio);
  const blue = Math.round(ca.b + (cb.b - ca.b) * normalizedRatio);
  return `rgb(${r}, ${g}, ${blue})`;
}

export type CellKind = "oi" | "change" | "volume" | "iv" | "ltp";

export type CellPaletteResult = {
  background: string;
  border: string;
  shadow: string;
  text: string;
  accent: string;
};

export type ThemeType = MantineTheme;

function getSidePalette(theme: ThemeType, type: "CE" | "PE") {
  const colors = theme.colors || {};
  const green = colors.green || colors.gray || SCALE_GREEN;
  const teal = colors.teal || colors.cyan || colors.green || SCALE_TEAL;
  const lime = colors.lime || colors.yellow || colors.green || SCALE_YELLOW;
  const red = colors.red || colors.pink || SCALE_RED;
  const orange = colors.orange || colors.yellow || colors.red || SCALE_ORANGE;
  const pink = colors.pink || colors.red || SCALE_RED;

  return type === "CE"
    ? {
        main: green[6] ?? green[5],
        alt: teal[5] ?? teal[4],
        glow: lime[4] ?? lime[3],
        ink: green[8] ?? green[7],
      }
    : {
        main: red[6] ?? red[5],
        alt: orange[5] ?? orange[4],
        glow: pink[4] ?? pink[3],
        ink: red[8] ?? red[7],
      };
}

export function getCellPalette(
  theme: ThemeType,
  kind: CellKind,
  type: "CE" | "PE",
  intensity: number,
  isHovered: boolean,
  isATM: boolean,
  isITM: boolean,
  isPositive?: boolean,
): CellPaletteResult {
  const side = getSidePalette(theme, type);
  const boost = isHovered ? 1.18 : 1;
  const atmBoost = isATM ? 1.12 : 1;
  const itmBoost = isITM ? 1.08 : 1;
  const baseIntensity = clamp(intensity * boost * atmBoost * itmBoost, 0, 1);
  const secondaryScale = clamp(baseIntensity * 0.7, 0, 1);

  let base = side.main;
  let alt = side.alt;
  let glow = side.glow;
  let text = side.ink;

  const colors = theme.colors || {};
  const getColor = (name: string, index: number): string => {
    const arr = colors[name] || colors.gray || [];
    return arr[index] || arr[0] || TEXT_MUTED;
  };

  if (kind === "change") {
    base = isPositive ? getColor("green", 6) : getColor("red", 6);
    alt = isPositive ? getColor("teal", 5) : getColor("orange", 5);
    glow = isPositive ? getColor("lime", 4) : getColor("pink", 4);
    text = isPositive ? getColor("green", 8) : getColor("red", 8);
  } else if (kind === "volume") {
    base = getColor("blue", 6);
    alt = getColor("cyan", 5);
    glow = getColor("indigo", 4);
    text = getColor("blue", 8);
  } else if (kind === "iv") {
    base = getColor("violet", 6);
    alt = getColor("grape", 5);
    glow = getColor("indigo", 4);
    text = getColor("violet", 8);
  } else if (kind === "ltp") {
    base = type === "CE" ? getColor("yellow", 6) : getColor("orange", 6);
    alt = type === "CE" ? getColor("amber", 5) : getColor("yellow", 5);
    glow = getColor("orange", 4);
    text = mixColors(getColor("gray", 9), base, 0.55);
  }

  const baseAlpha = 0.08 + baseIntensity * 0.26;
  const altAlpha = 0.04 + secondaryScale * 0.18;
  const borderAlpha = 0.18 + baseIntensity * 0.24;
  const shadowAlpha = 0.08 + baseIntensity * 0.16;

  return {
    background: `linear-gradient(135deg, ${hexToRgba(base, baseAlpha)} 0%, ${hexToRgba(alt, altAlpha)} 100%)`,
    border: hexToRgba(glow, borderAlpha),
    shadow: `inset 0 1px 0 ${hexToRgba(theme.white, 0.06)}, 0 0 0 1px ${hexToRgba(glow, shadowAlpha)}`,
    text,
    accent: glow,
  };
}

export { hexToRgba };
