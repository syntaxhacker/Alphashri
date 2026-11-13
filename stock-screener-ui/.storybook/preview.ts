import type { Preview } from "@storybook/html-vite";
import "../src/tailwind.css";
import "../src/style.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "canvas",
      values: [{ name: "canvas", value: "#000000" }],
    },
    layout: "fullscreen",
    controls: { expanded: true },
  },
};

export default preview;
