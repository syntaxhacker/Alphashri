import { MantineProvider, ColorSchemeScript, createTheme, virtualColor } from "@mantine/core";
import type { UIThemeProviderProps } from "./types";
import {
  SCALE_TEAL, SCALE_GREEN, SCALE_RED, SCALE_ORANGE, SCALE_DARK,
  SCALE_GRAY, SCALE_BLUE, SCALE_YELLOW, SCALE_CYAN, SCALE_VIOLET, SCALE_INDIGO,
  BLACK,
} from "./palette";
import { ThemePlayground } from "./ThemePlayground";

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
  // Mantine default dark scheme (professional dark grays, NOT pitch black)
  primaryColor: "blue",
  primaryShade: { light: 6, dark: 8 },
  autoContrast: true, // filled = blue-8 (#1449B8, dark) -> white text automatically
  white: "#FFFFFF",
  black: BLACK,
  colors,
  defaultRadius: "xs",
  focusRing: "auto",
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
    Paper: { defaultProps: { radius: "xs" } },
    Card: { defaultProps: { radius: "xs", padding: "sm", withBorder: false } },
    Button: {
      defaultProps: { size: "sm", radius: "xs" },
      styles: { label: { fontWeight: 600 } },
    },
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
        tabLabel: { fontWeight: 600 },
        list: { gap: "0.35rem" },
        panel: { paddingTop: "0.75rem" },
      },
    },
  },
  other: {
    fontWeights: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  },
});

export function UIProvider({ children, defaultColorScheme = "dark", forceColorScheme: _force }: UIThemeProviderProps) {
  return (
    <>
      <ColorSchemeScript defaultColorScheme={defaultColorScheme} />
      <MantineProvider theme={uiTheme} defaultColorScheme={defaultColorScheme} forceColorScheme={_force}>
        {children}
        <ThemePlayground />
      </MantineProvider>
    </>
  );
}
