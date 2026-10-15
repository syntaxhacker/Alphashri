import { createTheme } from "@mui/material/styles";
import {
  BG,
  SURFACE,
  BORDER,
  TEXT,
  POSITIVE,
  NEGATIVE,
  MARKER_EOD,
  MARKER_BORDER,
  DIALOG_SHADOW,
} from "./palette";

// MUI theme — all colors derive from palette.ts (single source of truth)
export const muiTheme = createTheme({
  cssVariables: {
    colorSchemeSelector: "data-mui-color-scheme",
  },
  shape: { borderRadius: 8 },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: BG, contrastText: TEXT },
        success: { main: POSITIVE, contrastText: MARKER_BORDER },
        error: { main: NEGATIVE, contrastText: MARKER_BORDER },
        warning: { main: MARKER_EOD, contrastText: BG },
        background: { default: BG, paper: SURFACE },
        divider: BORDER,
      },
    },
    dark: {
      palette: {
        primary: { main: TEXT, contrastText: BG },
        success: { main: POSITIVE, contrastText: MARKER_BORDER },
        error: { main: NEGATIVE, contrastText: MARKER_BORDER },
        warning: { main: MARKER_EOD, contrastText: BG },
        background: { default: BG, paper: SURFACE },
        divider: BORDER,
      },
    },
  },
  components: {
    MuiCard: { styleOverrides: { root: { borderRadius: 8, border: `1px solid ${BORDER}` } } },
    // Flat surfaces: MUI's dark-mode elevation adds a white overlay gradient to
    // Paper/Dialog, which washed modals out to near-white. Drop it everywhere.
    MuiPaper: { styleOverrides: { root: { borderRadius: 8, backgroundImage: "none" } } },
    MuiDialog: {
      styleOverrides: {
        paper: { backgroundImage: "none", boxShadow: DIALOG_SHADOW },
      },
    },
    MuiCardContent: { styleOverrides: { root: { padding: 8, "&:last-child": { paddingBottom: 8 } } } },
    MuiToolbar: { styleOverrides: { root: { minHeight: 48 } } },
  },
});

export type MuiTheme = typeof muiTheme;
