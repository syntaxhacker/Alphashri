import type { Preview } from "@storybook/react-vite";
import { MantineProvider } from "@mantine/core";
import { theme } from "../src/config/theme";
import "@mantine/core/styles.css";
import "../src/style.css";

// The app's style.css sets `body { overflow: hidden }` (app-shell layout).
// That leaks into Storybook's iframe and kills scrolling on docs/canvas pages.
// Restore normal scrolling here only — the app bundle is unaffected.
if (typeof document !== "undefined") {
  const sbFix = document.createElement("style");
  sbFix.dataset.storybookScrollFix = "true";
  sbFix.innerHTML =
    "body.sb-show-main { overflow: auto !important; height: auto !important; }" +
    ".docs-story body, .sb-docs-preview-stories body { overflow: auto !important; }";
  document.head.appendChild(sbFix);
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
    layout: "centered",
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#1a1a1a" },
      ],
    },
    chromatic: {
      modes: {
        dark: { background: "#1a1a1a" },
        light: { background: "#ffffff" },
      },
    },
  },
  globalTypes: {
    colorScheme: {
      name: "Color Scheme",
      description: "Global color scheme for components",
      defaultValue: "light",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", icon: "sun", title: "Light" },
          { value: "dark", icon: "moon", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const colorScheme = context.globals.colorScheme || "light";
      return (
        <MantineProvider theme={theme} defaultColorScheme={colorScheme} forceColorScheme={colorScheme}>
          <div style={{ backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#ffffff", padding: "1rem", borderRadius: "8px" }}>
            <Story />
          </div>
        </MantineProvider>
      );
    },
  ],
};

export default preview;
