import { createTheme } from "@mui/material/styles";

// Default MUI theme only — no custom palette
export const muiTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: true,
    dark: true,
  },
});

export type MuiTheme = typeof muiTheme;
