import { MantineProvider, ColorSchemeScript, createTheme, virtualColor, rgba } from "@mantine/core";
import type { UIThemeProviderProps } from "./types";
import {
  SCALE_TEAL, SCALE_GREEN, SCALE_RED, SCALE_ORANGE, SCALE_DARK,
  SCALE_GRAY, SCALE_BLUE, SCALE_YELLOW, SCALE_CYAN, SCALE_VIOLET, SCALE_INDIGO,
  CREAM, BROWN, BROWN_DARK, BLACK, TRADING_GREEN, TRADING_RED,
} from "./palette";

export type { MantineProviderProps } from "@mantine/core";

const colors = {
  teal: SCALE_TEAL,
  green: SCALE_GREEN,
  red: SCALE_RED,
  orange: SCALE_ORANGE,
  dark: SCALE_DARK,
  gray: SCALE_GRAY,
  blue: SCALE_BLUE,
  yellow: SCALE_YELLOW,
  cyan: SCALE_CYAN,
  violet: SCALE_VIOLET,
  indigo: SCALE_INDIGO,
  success: virtualColor({ name: "success", dark: "green", light: "green" }),
  danger: virtualColor({ name: "danger", dark: "red", light: "red" }),
  warning: virtualColor({ name: "warning", dark: "orange", light: "orange" }),
};

const APP_FONT_FAMILY = '"IBM Plex Sans", "Roboto", "Poppins", system-ui, sans-serif';

export const uiTheme = createTheme({
  primaryColor: "teal", // cream-derived accent
  primaryShade: { light: 5, dark: 6 },
  white: CREAM,
  black: BLACK,
  colors,
  defaultRadius: "xs",
  fontFamily: APP_FONT_FAMILY,
  fontFamilyMonospace: "ui-monospace, monospace",
  fontSizes: { sm: "12px", md: "14px", lg: "16px", xl: "20px" },
  headings: {
    fontFamily: APP_FONT_FAMILY,
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "20px", lineHeight: "1.3" },
      h2: { fontSize: "16px", lineHeight: "1.3" },
      h3: { fontSize: "14px", lineHeight: "1.3" },
      h4: { fontSize: "12px", lineHeight: "1.3" },
      h5: { fontSize: "12px", lineHeight: "1.3" },
      h6: { fontSize: "12px", lineHeight: "1.3" },
    },
  },
  components: {
    AppShell: {
      styles: {
        main: {
          background:
            "light-dark(linear-gradient(180deg, #1F150C 0%, #412D15 100%), linear-gradient(180deg, #000000 0%, #1F150C 100%))",
        },
      },
    },
    Paper: { defaultProps: { radius: "xs" } },
    Card: {
      defaultProps: { radius: "xs", padding: "sm", withBorder: false },
      styles: {
        root: {
          backgroundColor: "light-dark(rgba(225, 220, 201, 0.92), rgba(31, 21, 12, 0.92))",
          backdropFilter: "blur(12px)",
        },
      },
    },
    Button: { defaultProps: { size: "sm", radius: "xs" } },
    ActionIcon: { defaultProps: { radius: "xs" } },
    Badge: { defaultProps: { radius: "xs" } },
    NavLink: { defaultProps: { variant: "light" } },
    Input: { defaultProps: { size: "sm" } },
    NumberInput: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    TextInput: { defaultProps: { size: "sm" } },
    Textarea: { defaultProps: { size: "sm" } },
    Tabs: {
      defaultProps: { variant: "default" },
      styles: {
        tab: { fontWeight: 600 },
        list: { gap: "0.35rem" },
        panel: { paddingTop: "0.75rem" },
      },
    },
    Table: {
      styles: {
        table: { fontSize: "var(--mantine-font-size-sm)" },
        th: {
          backgroundColor: "light-dark(rgba(225, 220, 201, 0.9), rgba(31, 21, 12, 0.85))",
        },
      },
    },
  },
  other: {
    fontWeights: { normal: 400, medium: 500, semibold: 600, bold: 700 },
    shell: {
      border: {
        light: rgba(BROWN, 0.25),
        dark: rgba(CREAM, 0.16),
      },
    },
  },
});

export function UIProvider({ children, defaultColorScheme = "dark", forceColorScheme: _force }: UIThemeProviderProps) {
  return (
    <>
      <ColorSchemeScript defaultColorScheme={defaultColorScheme} />
      <MantineProvider theme={uiTheme} defaultColorScheme={defaultColorScheme} forceColorScheme={_force}>
        {children}
      </MantineProvider>
    </>
  );
}
