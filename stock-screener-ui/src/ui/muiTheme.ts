import { createTheme } from "@mui/material/styles";
import {
  FIN_PRIMARY,
  FIN_POSITIVE,
  FIN_NEGATIVE,
  FIN_WARNING,
  FIN_INFO,
  FIN_BG_LIGHT,
  FIN_BG_DARK,
  FIN_PAPER_LIGHT,
  FIN_PAPER_DARK,
  FIN_TEXT_LIGHT,
  FIN_TEXT_DARK,
  FIN_TEXT_MUTED_LIGHT,
  FIN_TEXT_MUTED_DARK,
  FIN_BORDER_LIGHT,
  FIN_BORDER_DARK,
  FIN_RADIUS,
  FIN_RADIUS_SM,
  FIN_HEADER_H,
  FIN_NAV_W,
} from "./palette";

// Financial theme — simple, intuitive, data-first (TradingView/Bloomberg minimal)
// Light = default for daytime trading readability; dark preserved for night.
// Single source of truth: all FIN_* tokens come from palette.ts
export const muiTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
        mode: "light",
        contrastThreshold: 4.5,
        primary: { main: FIN_PRIMARY, light: "#3B82F6", dark: "#1D4ED8", contrastText: "#FFFFFF" },
        secondary: { main: FIN_TEXT_MUTED_LIGHT, light: "#94A3B8", dark: "#475569", contrastText: "#FFFFFF" },
        success: { main: FIN_POSITIVE, light: "#DCFCE7", dark: "#14532D", contrastText: "#FFFFFF" },
        error: { main: FIN_NEGATIVE, light: "#FEE2E2", dark: "#7F1D1D", contrastText: "#FFFFFF" },
        warning: { main: FIN_WARNING, light: "#FEF3C7", dark: "#78350F", contrastText: "#FFFFFF" },
        info: { main: FIN_INFO, light: "#E0F2FE", dark: "#164E63", contrastText: "#FFFFFF" },
        background: { default: FIN_BG_LIGHT, paper: FIN_PAPER_LIGHT },
        text: { primary: FIN_TEXT_LIGHT, secondary: FIN_TEXT_MUTED_LIGHT },
        divider: FIN_BORDER_LIGHT,
        grey: {
          50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0", 300: "#CBD5E1", 400: "#94A3B8",
          500: "#64748B", 600: "#475569", 700: "#334155", 800: "#1E293B", 900: "#0F172A",
        },
      },
    },
    dark: {
      palette: {
        mode: "dark",
        contrastThreshold: 4.5,
        primary: { main: "#3B82F6", light: "#60A5FA", dark: FIN_PRIMARY, contrastText: FIN_BG_DARK },
        secondary: { main: FIN_TEXT_MUTED_DARK, light: "#CBD5E1", dark: FIN_TEXT_MUTED_LIGHT, contrastText: FIN_BG_DARK },
        success: { main: "#22C55E", light: "#86EFAC", dark: FIN_POSITIVE, contrastText: FIN_BG_DARK },
        error: { main: "#EF4444", light: "#FCA5A5", dark: FIN_NEGATIVE, contrastText: FIN_BG_DARK },
        warning: { main: "#F59E0B", light: "#FDE68A", dark: FIN_WARNING, contrastText: FIN_BG_DARK },
        info: { main: "#06B6D4", light: "#67E8F9", dark: FIN_INFO, contrastText: FIN_BG_DARK },
        background: { default: FIN_BG_DARK, paper: FIN_PAPER_DARK },
        text: { primary: FIN_TEXT_DARK, secondary: FIN_TEXT_MUTED_DARK },
        divider: FIN_BORDER_DARK,
        grey: {
          50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0", 300: "#CBD5E1", 400: "#94A3B8",
          500: "#64748B", 600: "#475569", 700: "#334155", 800: "#1E293B", 900: "#0F172A",
        },
      },
    },
  },
  typography: {
    fontFamily: '"IBM Plex Sans", "Roboto", system-ui, sans-serif',
    h1: { fontSize: "20px", fontWeight: 600, lineHeight: 1.3 },
    h2: { fontSize: "16px", fontWeight: 600, lineHeight: 1.3 },
    h3: { fontSize: "14px", fontWeight: 600, lineHeight: 1.3 },
    h4: { fontSize: "12px", fontWeight: 600, lineHeight: 1.3 },
    h5: { fontSize: "12px", fontWeight: 600, lineHeight: 1.3 },
    h6: { fontSize: "12px", fontWeight: 600, lineHeight: 1.3 },
    body1: { fontSize: "14px", lineHeight: 1.5 },
    body2: { fontSize: "12px", lineHeight: 1.5 },
    button: { textTransform: "none" as const, fontWeight: 600 },
  },
  shape: { borderRadius: FIN_RADIUS },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { scrollbarWidth: "thin" as const },
        "*": { scrollbarWidth: "thin" as const },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme }: any) => ({
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: FIN_RADIUS,
          boxShadow: "none",
        }),
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme }: any) => ({
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: FIN_RADIUS,
          boxShadow: "none",
        }),
      },
    },
    MuiButton: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { borderRadius: FIN_RADIUS_SM, textTransform: "none" as const, fontWeight: 600, minHeight: 32 },
      },
    },
    MuiChip: {
      defaultProps: { size: "small" },
      styleOverrides: { root: { borderRadius: FIN_RADIUS_SM } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { padding: "8px 12px", fontSize: "12px", fontVariantNumeric: "tabular-nums" as const, lineHeight: 1.4 },
        head: { fontWeight: 600, fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "0.02em", color: FIN_TEXT_MUTED_LIGHT },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: "default" as const },
      styleOverrides: {
        root: ({ theme }: any) => ({
          borderBottom: `1px solid ${theme.palette.divider}`,
          boxShadow: "none",
          backgroundColor: theme.palette.background.paper,
        }),
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: {
          minHeight: FIN_HEADER_H,
          "@media (min-width:600px)": { minHeight: FIN_HEADER_H },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: `1px solid ${FIN_BORDER_LIGHT}`,
          borderRadius: 0,
        },
      },
    },
    MuiContainer: {
      defaultProps: { maxWidth: "xl" as const, disableGutters: false },
      styleOverrides: {
        root: { paddingLeft: 16, paddingRight: 16 },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: FIN_RADIUS,
          border: `1px solid ${FIN_BORDER_LIGHT}`,
          boxShadow: "none",
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 16, "&:last-child": { paddingBottom: 16 } },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: FIN_RADIUS, border: `1px solid ${FIN_BORDER_LIGHT}`, boxShadow: "0 8px 32px rgba(15,23,42,0.08)" },
      },
    },
  },
});

export type MuiTheme = typeof muiTheme;
