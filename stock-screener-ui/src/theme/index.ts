import { createTheme, virtualColor, type MantineColorsTuple } from "@mantine/core";

const teal: MantineColorsTuple = [
  "#e6fffa",
  "#b2f5ea",
  "#81e6d9",
  "#4fd1c5",
  "#38b2ac",
  "#319795",
  "#2c7a7b",
  "#285e61",
  "#234e52",
  "#1d4044",
];

const green: MantineColorsTuple = [
  "#f0fff4",
  "#c6f6d5",
  "#9ae6b4",
  "#68d391",
  "#48bb78",
  "#38a169",
  "#2f855a",
  "#276749",
  "#22543d",
  "#1c4532",
];

const red: MantineColorsTuple = [
  "#fff5f5",
  "#fed7d7",
  "#feb2b2",
  "#fc8181",
  "#f56565",
  "#e53e3e",
  "#c53030",
  "#9b2c26",
  "#822727",
  "#63171b",
];

const orange: MantineColorsTuple = [
  "#fffaf0",
  "#feebc8",
  "#fbd38d",
  "#f6ad55",
  "#ed8936",
  "#dd6b20",
  "#c05621",
  "#9c4221",
  "#7b341e",
  "#652b19",
];

const dark: MantineColorsTuple = [
  "#C1C2C5",
  "#A6A7AB",
  "#909296",
  "#5c5f66",
  "#373A40",
  "#2C2E33",
  "#1a1a1a",
  "#141517",
  "#0f0f0f",
  "#0a0a0a",
];

export const colors = {
  teal,
  green,
  red,
  orange,
  dark,
  success: virtualColor({ name: "success", dark: "green", light: "green" }),
  danger: virtualColor({ name: "danger", dark: "red", light: "red" }),
  warning: virtualColor({ name: "warning", dark: "orange", light: "orange" }),
};

export const APP_FONT_FAMILY = "Roboto, Poppins, system-ui, sans-serif";

export const theme = createTheme({
  primaryColor: "teal",
  primaryShade: { light: 5, dark: 6 },
  colors,
  defaultRadius: "sm",
  fontFamily: APP_FONT_FAMILY,
  fontFamilyMonospace: "ui-monospace, monospace",
  fontSizes: {
    sm: "12px",
    md: "14px",
    lg: "16px",
    xl: "20px",
  },
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
    Button: {
      defaultProps: {
        size: "sm",
      },
    },
    NavLink: {
      defaultProps: {
        variant: "light",
      },
    },
    Input: {
      defaultProps: {
        size: "sm",
      },
    },
    NumberInput: {
      defaultProps: {
        size: "sm",
      },
    },
    Select: {
      defaultProps: {
        size: "sm",
      },
    },
    TextInput: {
      defaultProps: {
        size: "sm",
      },
    },
    Textarea: {
      defaultProps: {
        size: "sm",
      },
    },
    Tabs: {
      defaultProps: {
        variant: "pills",
      },
    },
  },
  other: {
    fontWeights: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
});

export type AppTheme = typeof theme;

export const fontWeights = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};
