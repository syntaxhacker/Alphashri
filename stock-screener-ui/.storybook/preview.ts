import type { Preview } from "@storybook/html-vite";
import "../src/tailwind.css";
import "../src/style.css";
import "solid-notifications/index.css";
import { disposeSolidStories } from "../src/stories/solidStory";
import * as palette from "../src/ui/palette";

const preview: Preview = {
  beforeEach: (context) => {
    // Docs renders every story in a group together; disposing here would blank
    // all but the last one. Story-mode navigation still gets a clean teardown.
    if (context.viewMode === "story") disposeSolidStories();
  },
  parameters: {
    backgrounds: {
      default: "canvas",
      values: [
        { name: "canvas", value: palette.BG_COLOR },
        { name: "panel", value: palette.SURFACE },
      ],
    },
    layout: "fullscreen",
    controls: { expanded: true },
  },
};

export default preview;
