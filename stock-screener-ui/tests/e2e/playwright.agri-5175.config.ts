import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

/**
 * Local override for the agri release lane's dev server on 5175. The shared
 * config stays on 5173; this file only re-points baseURL and testDir.
 */
export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  use: { ...base.use, baseURL: "http://127.0.0.1:5175" },
});
