import * as palette from "./palette";

const BREAKPOINTS = { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } as const;

/**
 * Plain theme object for chart/component code: just
 * the palette paths used by hooks and chart helpers.
 */
export const sxTheme = {
  palette: {
    primary: { main: palette.PRIMARY, contrastText: palette.BG },
    secondary: { main: palette.TEXT_MUTED, contrastText: palette.BG },
    success: { main: palette.POSITIVE, contrastText: palette.BG },
    error: { main: palette.NEGATIVE, contrastText: palette.BG },
    warning: { main: palette.WARNING, contrastText: palette.BG },
    info: { main: palette.INFO, contrastText: palette.BG },
    text: { primary: palette.TEXT, secondary: palette.TEXT_MUTED, disabled: palette.TEXT_MUTED },
    background: { default: palette.BG, paper: palette.SURFACE },
    divider: palette.BORDER,
    grey: {
      50: palette.SCALE_GRAY[0],
      100: palette.SCALE_GRAY[1],
      200: palette.SCALE_GRAY[2],
      300: palette.SCALE_GRAY[3],
      400: palette.SCALE_GRAY[4],
      500: palette.SCALE_GRAY[5],
      600: palette.SCALE_GRAY[6],
      700: palette.SCALE_GRAY[7],
      800: palette.SCALE_GRAY[8],
      900: palette.SCALE_GRAY[9],
    },
  },
  shape: { borderRadius: 8 },
  spacing: (n: number) => `${n * 8}px`,
  breakpoints: {
    values: BREAKPOINTS,
    up: (key: keyof typeof BREAKPOINTS) => `@media (min-width:${BREAKPOINTS[key]}px)`,
    down: (key: keyof typeof BREAKPOINTS) => `@media (max-width:${BREAKPOINTS[key] - 0.05}px)`,
  },
  typography: {
    fontFamily: palette.MONO,
    fontSize: 12,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 700,
  },
  transitions: {
    create: () => "all 150ms ease",
  },
} as const;

export type SxTheme = typeof sxTheme;
