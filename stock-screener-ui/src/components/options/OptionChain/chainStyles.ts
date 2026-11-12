import { fontWeights } from "../../../config/theme";
import * as palette from "@/ui/palette";

export type ThemeType = any;

function resolveFontSize(_theme: any, key: "sm" | "md"): string {
  return key === "sm" ? "12px" : "14px";
}

export const getStyles = (_theme: ThemeType, _isDark: boolean) => ({
  container: {
    display: "flex",
    "flex-direction": "column" as const,
    height: "calc(100vh - 300px)",
    "min-height": 400,
    width: "100%",
    overflow: "hidden" as const,
    "border-radius": 1,
    "background-color": palette.SURFACE,
  },
  header: {
    display: "grid",
    "grid-template-columns": "1fr 80px 1fr",
    "background-color": palette.SURFACE,
    position: "sticky" as const,
    top: 0,
    "z-index": 10,
  },
  headerCell: {
    padding: "10px 8px",
    "text-align": "center" as const,
    "font-weight": fontWeights.bold,
    "font-size": resolveFontSize(null as any, "md"),
    "letter-spacing": "0.08em",
    "text-transform": "uppercase" as const,
    color: palette.TEXT,
  },
  subHeader: {
    display: "grid",
    "grid-template-columns": "repeat(5, 1fr) 80px repeat(5, 1fr)",
    "background-color": palette.SURFACE,
    position: "sticky" as const,
    top: 40,
    "z-index": 9,
  },
  subHeaderCell: {
    padding: "5px 2px",
    "text-align": "center" as const,
    "font-size": "12px",
    color: palette.TEXT_MUTED,
    "font-weight": fontWeights.semibold,
    "text-transform": "uppercase" as const,
    "letter-spacing": "0.04em",
    fontVariantNumeric: "tabular-nums" as const,
  },
  row: {
    display: "grid",
    "grid-template-columns": "repeat(5, 1fr) 80px repeat(5, 1fr)",
    transition: "background 0.18s ease",
    position: "relative" as const,
    "background-color": palette.BG,
  },
  cell: {
    padding: "6px 4px",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    "font-size": resolveFontSize(null as any, "sm"),
    cursor: "pointer",
    "min-height": 42,
    width: "100%",
    position: "relative" as const,
    overflow: "hidden" as const,
    fontVariantNumeric: "tabular-nums" as const,
  },
  strikeCell: {
    padding: "4px 8px",
    display: "flex",
    "flex-direction": "column" as const,
    "align-items": "center",
    "justify-content": "center",
    "text-align": "center" as const,
    "background-color": palette.SURFACE,
    position: "sticky" as const,
    left: "calc(50% - 40px)",
    "z-index": 2,
    fontVariantNumeric: "tabular-nums" as const,
  },
  atmHighlight: {
    "background-color": "rgba(88, 166, 255, 0.14)",
    color: palette.WARNING,
  },
  // Distinct ATM row wash applied on top of the side gradient so the
  // at-the-money strike stays visually anchored after auto-scroll.
  atmRow: {
    outline: "1px solid",
    outlineColor: palette.WARNING,
  },
  // Subtle zebra tint for non-ATM rows (kept faint so heatmaps stay legible).
  zebraRow: {
    "background-color": "rgba(255, 255, 255, 0.04)",
  },
  // Compact ATM window toggle bar pinned above the sticky table header.
  windowBar: {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    gap: 8,
    padding: "4px 12px",
    "flex-wrap": "wrap" as const,
  },
});
