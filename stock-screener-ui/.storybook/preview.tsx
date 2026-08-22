import type { Preview } from "@storybook/react-vite";
import { MantineProvider } from "@mantine/core";
import { theme } from "../src/config/theme";
import "@mantine/core/styles.css";
import "../src/style.css";

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
          <div
            style={{
              backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#ffffff",
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "2rem",
            }}
          >
            <Story />
          </div>
        </MantineProvider>
      );
    },
  ],
};

export default preview;
