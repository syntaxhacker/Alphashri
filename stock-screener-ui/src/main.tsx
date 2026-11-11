import "./style.css";
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { SnackbarProvider } from "notistack";
import { emotionCache } from "@/ui/emotionCache";
import { muiTheme } from "@/ui/muiTheme";
import App from "./App";
import { store } from "./state/store";
import "@/ui/styles.css";

if (import.meta.env.VITE_SENTRY_DSN) {
  // Session Replay records every DOM mutation. On the Index Report (1 Hz spot
  // tick, thousands of table cells, chart overlays) it can pin hundreds of MB
  // for the life of the tab. Keep it opt-in for a deliberate debugging run.
  const replayEnabled = import.meta.env.VITE_SENTRY_REPLAY === "1";
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      ...(replayEnabled
        ? [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })]
        : []),
    ],
    tracesSampleRate: 0.1,
    ...(replayEnabled
      ? { replaysSessionSampleRate: 0.05, replaysOnErrorSampleRate: 0.25 }
      : {}),
  });
}

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app root element");
}

  createRoot(root).render(
  <Provider store={store}>
    <CacheProvider value={emotionCache}>
    <ThemeProvider theme={muiTheme} defaultMode="dark" modeStorageKey="mui-color-scheme" colorSchemeStorageKey="mui-color-scheme">
      <CssBaseline />
      <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} autoHideDuration={4000}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SnackbarProvider>
    </ThemeProvider>
    </CacheProvider>
  </Provider>,
);
