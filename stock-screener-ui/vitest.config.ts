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
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.stories.*", "src/ui/**", "src/types/**", "src/patterns/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
