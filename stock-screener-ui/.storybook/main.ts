import type { StorybookConfig } from "@storybook/html-vite";
import { fileURLToPath, URL } from "node:url";
import solid from "vite-plugin-solid";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/html-vite", options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (viteConfig) => {
    // Storybook must not inherit the app's build reporters/Sentry uploader:
    // the root Vite config would otherwise overwrite perf/bundle-sizes.json
    // with Storybook chunks and add Sentry debug IDs to every story.
    const plugins = ((viteConfig.plugins ?? []) as unknown[]).flat(Infinity) as Array<
      { name?: string } | null | false | undefined
    >;
    const filtered = plugins.filter((plugin) => {
      if (!plugin) return false;
      const name = String(plugin.name ?? "").toLowerCase();
      return name !== "bundle-budget-reporter" && !name.includes("sentry");
    });
    if (!filtered.some((plugin) => plugin?.name === "solid")) filtered.push(solid());
    viteConfig.plugins = filtered as never;

    const existingAlias = viteConfig.resolve?.alias;
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        ...(existingAlias && !Array.isArray(existingAlias) ? existingAlias : {}),
        "@": fileURLToPath(new URL("../src", import.meta.url)),
      },
      // The app config forces the Solid development/browser pair for the dev
      // server. Storybook's static build should use the production browser build.
      conditions: ["browser"],
    };
    return viteConfig;
  },
};

export default config;
