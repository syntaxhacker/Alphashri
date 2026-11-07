/// <reference types="vite/client" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  
  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [
      react(),
      // React Compiler disabled: the app is built on mutable module stores
      // read during render (`useStoreSubscription` + `get*State()`), which the
      // compiler memoizes as pure and renders stale (empty panels under lazy
      // Suspense — reproduced 2026-11-07, PR #157 smoke failures). Re-enable
      // only after migrating store consumers to `useSyncExternalStore`
      // (see `useEventsStore` in src/state/events.ts).
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
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) return "vendor";
            if (id.includes("@mui/") || id.includes("@emotion/")) return "mui";
            if (id.includes("@tanstack")) return "tanstack";
            if (id.includes("echarts") || id.includes("zrender")) return "echarts";
            if (id.includes("node_modules/@tabler/icons-react")) return "icons";
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
