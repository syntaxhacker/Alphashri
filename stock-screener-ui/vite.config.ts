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
      react({
        reactCompiler: true,
      }),
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
            if (id.includes("node_modules/@mantine/")) return "mantine";
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
        ignored: ['**/.venv/**', '**/venv/**'],
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
