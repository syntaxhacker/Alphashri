import type { StorybookConfig } from "@storybook/html-vite";
import { fileURLToPath, URL } from "node:url";
import solid from "vite-plugin-solid";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/html-vite", options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (viteConfig) => {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), solid()];
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
      conditions: ["development", "browser"],
    };
    return viteConfig;
  },
};

export default config;
