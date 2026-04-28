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
      default: "dark",
      values: [
        { name: "dark", value: "#1a1a1a" },
        { name: "light", value: "#ffffff" },
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
      defaultValue: "dark",
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
      const colorScheme = context.globals.colorScheme || "dark";
      return (
        <MantineProvider theme={theme} defaultColorScheme={colorScheme}>
          <div
            style={{
              backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#ffffff",
              padding: "1rem",
              borderRadius: "8px",
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
