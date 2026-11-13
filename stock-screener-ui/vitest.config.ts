import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    conditions: ["development", "browser"],
  },
  plugins: [solid()],
  test: {
    exclude: [
      "**/node_modules/**",
      "**/tests/e2e/**",
      "**/dist/**",
      "**/coverage/**",
      "**/poc/**",
    ],
    environment: "happy-dom",
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ["./src/test-setup.ts"],
    // Solid compiles JSX at build time. Without the web transform mode the
    // `.tsx` test files would not be transformed for the browser environment.
    transformMode: {
      web: [/\.[jt]sx?$/],
    },
    server: {
      deps: {
        inline: [/solid-js/, /@solidjs/],
      },
    },
    pool: "forks",
    execArgv: ["--max-old-space-size=8192"],
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
