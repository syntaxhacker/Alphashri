import { fontWeights } from "../../../config/theme";
import * as palette from "@/ui/palette";

export type ThemeType = any;

function resolveFontSize(_theme: any, key: "sm" | "md"): string {
  return key === "sm" ? "12px" : "14px";
}

export const getStyles = (_theme: ThemeType, _isDark: boolean) => ({
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 300px)",
    minHeight: 400,
    width: "100%",
    overflow: "hidden" as const,
    borderRadius: 1,
    backgroundColor: palette.SURFACE,
  },
  header: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    backgroundColor: palette.SURFACE,
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
  },
  headerCell: {
    padding: "10px 8px",
    textAlign: "center" as const,
    fontWeight: fontWeights.bold,
    fontSize: resolveFontSize(null as any, "md"),
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: palette.TEXT,
  },
  subHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    backgroundColor: palette.SURFACE,
    position: "sticky" as const,
    top: 40,
    zIndex: 9,
  },
  subHeaderCell: {
    padding: "5px 2px",
    textAlign: "center" as const,
    fontSize: "12px",
    color: palette.TEXT_MUTED,
    fontWeight: fontWeights.semibold,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    fontVariantNumeric: "tabular-nums" as const,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    transition: "background 0.18s ease",
    position: "relative" as const,
    backgroundColor: palette.BG,
  },
  cell: {
    padding: "6px 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: resolveFontSize(null as any, "sm"),
    cursor: "pointer",
    minHeight: 42,
    width: "100%",
    position: "relative" as const,
    overflow: "hidden" as const,
    fontVariantNumeric: "tabular-nums" as const,
  },
  strikeCell: {
    padding: "4px 8px",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    backgroundColor: palette.SURFACE,
    position: "sticky" as const,
    left: "calc(50% - 40px)",
    zIndex: 2,
    fontVariantNumeric: "tabular-nums" as const,
  },
  atmHighlight: {
    backgroundColor: "rgba(88, 166, 255, 0.14)",
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
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  // Compact ATM window toggle bar pinned above the sticky table header.
  windowBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "4px 12px",
    flexWrap: "wrap" as const,
  },
});
