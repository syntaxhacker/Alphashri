import type { useMantineTheme } from "@mantine/core";
import { fontWeights } from "../../../theme";
import { hexToRgba } from "./cellPalette";

export type ThemeType = ReturnType<typeof useMantineTheme>;

export const getStyles = (theme: ThemeType, isDark: boolean) => ({
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 300px)",
    minHeight: 400,
    overflow: "hidden",
    border: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    borderRadius: "var(--mantine-radius-lg)",
    background:
      "linear-gradient(180deg, light-dark(rgba(255,255,255,0.96), rgba(15,23,42,0.94)) 0%, light-dark(rgba(248,250,252,0.88), rgba(11,15,20,0.9)) 100%)",
    boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    background:
      "linear-gradient(135deg, light-dark(rgba(240,253,250,0.96), rgba(12,22,20,0.96)) 0%, light-dark(rgba(255,255,255,0.96), rgba(17,24,39,0.95)) 50%, light-dark(rgba(255,240,245,0.96), rgba(24,13,18,0.96)) 100%)",
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
    color: "light-dark(var(--mantine-color-gray-8), var(--mantine-color-dark-0))",
  },
  subHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    background:
      "linear-gradient(90deg, light-dark(rgba(236,253,245,0.92), rgba(12,18,16,0.92)) 0%, light-dark(rgba(248,250,252,0.95), rgba(15,23,42,0.88)) 50%, light-dark(rgba(254,242,242,0.92), rgba(24,12,16,0.92)) 100%)",
    borderBottom: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.7)}`,
    position: "sticky" as const,
    top: 40,
    zIndex: 9,
  },
  subHeaderCell: {
    padding: "5px 2px",
    textAlign: "center" as const,
    fontSize: "11px",
    color: "var(--mantine-color-dimmed)",
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
    background:
      "linear-gradient(90deg, transparent 0%, light-dark(rgba(255,255,255,0.12), rgba(255,255,255,0.03)) 50%, transparent 100%)",
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
    background:
      "linear-gradient(180deg, light-dark(rgba(255,255,255,0.96), rgba(15,23,42,0.92)) 0%, light-dark(rgba(245,247,250,0.95), rgba(11,15,20,0.95)) 100%)",
    borderLeft: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    borderRight: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    position: "sticky" as const,
    left: "calc(50% - 40px)",
    zIndex: 2,
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
  },
  atmHighlight: {
    background:
      "linear-gradient(180deg, light-dark(rgba(254,240,138,0.96), rgba(133,77,14,0.52)) 0%, light-dark(rgba(253,224,71,0.9), rgba(120,53,15,0.42)) 100%)",
    color: "light-dark(var(--mantine-color-yellow-9), var(--mantine-color-yellow-0))",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
  },
});
