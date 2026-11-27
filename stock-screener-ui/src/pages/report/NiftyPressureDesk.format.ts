import type { JSX } from "solid-js";
import * as palette from "@/ui/palette";
import { statusTone } from "./niftyWallsFormat";
import type { PressureSide } from "./pressureDesk";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
} from "./reportTokens";

export const CE = palette.TERM_CE;
export const PE = palette.TERM_PE;
export const SELECTED = palette.TEXT;
export const MUTED = palette.TEXT_MUTED;
export const BORDER = palette.TERM_BORDER;
export const SURFACE = palette.TERM_BG;
export const MONO = palette.MONO;

export const sideColor = (side: PressureSide): string => (side === "CALL" ? CE : PE);

export function statusColor(status: string | null | undefined): string {
  switch (statusTone(status)) {
    case "positive":
      return palette.POSITIVE;
    case "warning":
      return palette.WARNING;
    case "negative":
      return palette.NEGATIVE;
    default:
      return MUTED;
  }
}

export function panelTitleStyles(): JSX.CSSProperties {
  return {
    "font-size": `${REPORT_FONT.value}px`,
    "font-weight": String(REPORT_FONT_WEIGHT.extrabold),
    "letter-spacing": REPORT_LETTER_SPACING.wide,
    "text-transform": "uppercase",
    color: MUTED,
    "line-height": REPORT_LINE_HEIGHT.tight,
  };
}
