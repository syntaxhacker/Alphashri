import type { MantineTheme } from "@/ui";
import { fontWeights } from "../../../config/theme";
import { hexToRgba } from "./cellPalette";
import { CREAM, BROWN, BROWN_DARK, BLACK } from "../../../config/colors";

export type ThemeType = MantineTheme;

export const getStyles = (theme: ThemeType, isDark: boolean) => ({
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 300px)",
    minHeight: 400,
    overflow: "hidden",
    border: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    borderRadius: "12px",
    background: `linear-gradient(180deg, light-dark(${hexToRgba(CREAM, 0.96)}, ${hexToRgba(BROWN_DARK, 0.94)}) 0%, light-dark(${hexToRgba(CREAM, 0.88)}, ${hexToRgba(BLACK, 0.9)}) 100%)`,
    boxShadow: `0 18px 50px ${hexToRgba(BLACK, 0.08)}`,
  },
  header: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    background: `linear-gradient(135deg, light-dark(${hexToRgba(CREAM, 0.96)}, ${hexToRgba(BROWN_DARK, 0.96)}) 0%, light-dark(${hexToRgba(CREAM, 0.96)}, ${hexToRgba(BLACK, 0.95)}) 50%, light-dark(${hexToRgba(CREAM, 0.96)}, ${hexToRgba(BROWN_DARK, 0.96)}) 100%)`,
    borderBottom: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.75)}`,
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
  },
  headerCell: {
    padding: "10px 8px",
    textAlign: "center" as const,
    fontWeight: fontWeights.bold,
    fontSize: theme.fontSizes.md,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "text.primary",
  },
  subHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    background: `linear-gradient(90deg, light-dark(${hexToRgba(CREAM, 0.92)}, ${hexToRgba(BROWN_DARK, 0.92)}) 0%, light-dark(${hexToRgba(CREAM, 0.95)}, ${hexToRgba(BLACK, 0.88)}) 50%, light-dark(${hexToRgba(CREAM, 0.92)}, ${hexToRgba(BROWN_DARK, 0.92)}) 100%)`,
    borderBottom: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.7)}`,
    position: "sticky" as const,
    top: 40,
    zIndex: 9,
  },
  subHeaderCell: {
    padding: "5px 2px",
    textAlign: "center" as const,
    fontSize: "11px",
    color: "text.secondary",
    fontWeight: fontWeights.semibold,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    borderBottom: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 5 : 2], 0.65)}`,
    transition: "background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
    position: "relative" as const,
    background: `linear-gradient(90deg, transparent 0%, light-dark(${hexToRgba(CREAM, 0.12)}, ${hexToRgba(CREAM, 0.03)}) 50%, transparent 100%)`,
  },
  cell: {
    padding: "6px 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: theme.fontSizes.sm,
    cursor: "pointer",
    minHeight: 42,
    position: "relative" as const,
    overflow: "hidden",
  },
  strikeCell: {
    padding: "4px 8px",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    background: `linear-gradient(180deg, light-dark(${hexToRgba(CREAM, 0.96)}, ${hexToRgba(BROWN_DARK, 0.92)}) 0%, light-dark(${hexToRgba(CREAM, 0.95)}, ${hexToRgba(BLACK, 0.95)}) 100%)`,
    borderLeft: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    borderRight: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    position: "sticky" as const,
    left: "calc(50% - 40px)",
    zIndex: 2,
    boxShadow: `inset 0 0 0 1px ${hexToRgba(CREAM, 0.02)}`,
  },
  atmHighlight: {
    background: `linear-gradient(180deg, light-dark(${hexToRgba(CREAM, 0.96)}, ${hexToRgba(BROWN, 0.52)}) 0%, light-dark(${hexToRgba(CREAM, 0.9)}, ${hexToRgba(BROWN, 0.42)}) 100%)`,
    color: "warning.main",
    boxShadow: `inset 0 0 0 1px ${hexToRgba(CREAM, 0.18)}`,
  },
});
