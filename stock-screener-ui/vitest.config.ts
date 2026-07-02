import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [react()],
  test: {
    exclude: [
      "**/node_modules/**",
      "**/tests/e2e/**",
      "**/dist/**",
      "**/coverage/**",
      // Third-party Mantine component library — not part of this project's test suite
      "**/ui.mantine.dev/**",
    ],
  },
});
