/// <reference types="vite/client" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    // Solid ships browser + server builds behind export conditions. The
    // development/browser pair forces the browser build and keeps
    // `solid-js/web` on the client instead of the SSR stub.
    resolve: {
      alias: {
        "@": fileURLToPath(new URL('./src', import.meta.url)),
        tslib: fileURLToPath(new URL('./node_modules/tslib/tslib.es6.js', import.meta.url)),
      },
      conditions: ['development', 'browser'],
    },
    plugins: [
      solid(),
      tailwindcss(),
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
          filesToDeleteAfterUpload: ['dist/**/*.map'],
        },
      }),
    ],
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules/solid-js") || id.includes("node_modules/@solidjs")) return "vendor";
            if (id.includes("@tanstack")) return "tanstack";
            // Keep the chart engine out of the shared chunk so the entry shell
            // does not statically pull it in (chart pages import it lazily).
            if (id.includes("echarts") || id.includes("zrender")) return "echarts";
          },
        },
      },
    },
    server: {
      host: true,
      watch: {
        // Only source/config should trigger HMR. The repo writes thousands of
        // files into experiments/, reports/, logs/ and backups/ (caches, charts,
        // bot output) — watching them stalls the dev server for seconds.
        ignored: [
          '**/.venv/**',
          '**/venv/**',
          '**/experiments/**',
          '**/reports/**',
          '**/backups/**',
          '**/logs/**',
          '**/dist/**',
          '**/test-results/**',
          '**/playwright-report/**',
          '**/coverage/**',
        ],
      },
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8765',
          changeOrigin: true
        }
      }
    }
  };
});
