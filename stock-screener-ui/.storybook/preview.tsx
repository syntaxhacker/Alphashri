import type { Preview } from "@storybook/react-vite";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { SnackbarProvider } from "notistack";
import { muiTheme } from "../src/ui/muiTheme";
import "../src/style.css";
import { AuthContext } from "../src/components/auth/AuthProvider2";
import { NewsWebSocketProvider } from "../src/state/newsWebSocket";

// The app's style.css sets `body { overflow: hidden }` (app-shell layout).
// That leaks into Storybook's iframe and kills scrolling on docs/canvas pages.
// Restore normal scrolling here only — the app bundle is unaffected.
if (typeof document !== "undefined") {
  const sbFix = document.createElement("style");
  sbFix.dataset.storybookScrollFix = "true";
  sbFix.innerHTML =
    "body.sb-show-main { overflow: auto !important; height: auto !important; }" +
    ".docs-story body, .sb-docs-preview-stories body { overflow: auto !important; }";
  document.head.appendChild(sbFix);
}

// ECharts is available as an npm package (echarts) — in the app it is also
// exposed as window.echarts for useECharts. Provide it synchronously in the
// Storybook iframe so TradingChart/CorrelationHeatmap actually render.
import * as echarts from "echarts";
if (typeof window !== "undefined") {
  (window as any).echarts = (echarts as any).default ?? echarts;
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
    layout: "centered",
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#1a1a1a" },
      ],
    },
    chromatic: {
      modes: {
        dark: { background: "#1a1a1a" },
        light: { background: "#ffffff" },
      },
    },
  },
  globalTypes: {
    colorScheme: {
      name: "Color Scheme",
      description: "Global color scheme for components",
      defaultValue: "light",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", icon: "sun", title: "Light" },
          { value: "dark", icon: "moon", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    // Global providers HOC — every story that uses `useAuth` (AdminPage, NavbarNested, UserButton, AppLayout)
    // or `useNewsWebSocket` (NewsPanel2, SectorPage) needs these. Provides mocked admin user and
    // a no-op news socket so stories render without hitting the real backend or WebSocket.
    // Router is NOT provided globally — stories that need `useLocation`/`useNavigate` add their own `MemoryRouter`/`BrowserRouter`.
    (Story) => {
      const mockAuth: any = {
        user: {
          id: 1,
          email: "qa@test.com",
          display_name: "QA User",
          initial_capital: 100000,
          created_at: new Date().toISOString(),
          is_admin: true,
        },
        isAuthenticated: true,
        loading: false,
        error: null,
        login: async () => ({ success: true }),
        register: async () => ({ success: true }),
        logout: async () => {},
        getAccessToken: () => "mock-token",
        fetchWithAuth: (url: string, opts?: RequestInit) => fetch(url, opts),
        clearError: () => {},
      };
      return (
        <AuthContext.Provider value={mockAuth}>
          <NewsWebSocketProvider>
            <Story />
          </NewsWebSocketProvider>
        </AuthContext.Provider>
      );
    },
    (Story, context) => {
      const colorScheme = context.globals.colorScheme || "light";
      // Update MUI theme mode via document attribute for CssBaseline; ThemeProvider handles colorSchemes internally
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-color-scheme", colorScheme);
      }
      return (
        <ThemeProvider theme={muiTheme} defaultColorScheme={colorScheme}>
          <CssBaseline />
          <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
            <div style={{ backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#ffffff", padding: "1rem", borderRadius: "8px" }}>
              <Story />
            </div>
          </SnackbarProvider>
        </ThemeProvider>
      );
    },
  ],
};

export default preview;
