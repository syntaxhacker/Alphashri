import type { UITheme } from "@/ui";
import { fontWeights } from "../../../config/theme";

export type ThemeType = UITheme;

function resolveFontSize(theme: any, key: "sm" | "md"): string {
  return theme?.fontSizes?.[key] ?? (key === "sm" ? "12px" : "14px");
}

export const getStyles = (theme: ThemeType, _isDark: boolean) => ({
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 300px)",
    minHeight: 400,
    overflow: "hidden",
    borderRadius: 1,
    bgcolor: "background.paper",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    bgcolor: "background.paper",
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
  },
  headerCell: {
    padding: "10px 8px",
    textAlign: "center" as const,
    fontWeight: fontWeights.bold,
    fontSize: resolveFontSize(theme as any, "md"),
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "text.primary",
  },
  subHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    bgcolor: "background.paper",
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
    transition: "background 0.18s ease",
    position: "relative" as const,
    bgcolor: "background.default",
  },
  cell: {
    padding: "6px 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: resolveFontSize(theme as any, "sm"),
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
    bgcolor: "background.paper",
    position: "sticky" as const,
    left: "calc(50% - 40px)",
    zIndex: 2,
  },
  atmHighlight: {
    bgcolor: "action.selected",
    color: "warning.main",
  },
});
