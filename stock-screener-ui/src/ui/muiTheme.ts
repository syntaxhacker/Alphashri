import { createTheme } from "@mui/material/styles";

// Default MUI theme only — no custom palette
export const muiTheme = createTheme({
  cssVariables: {
    colorSchemeSelector: "data-mui-color-scheme",
  },
  colorSchemes: {
    light: true,
    dark: true,
  },
});

export type MuiTheme = typeof muiTheme;
