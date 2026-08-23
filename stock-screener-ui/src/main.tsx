import "./style.css";
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { SnackbarProvider } from "notistack";
import { UIProvider } from "@/ui";
import { muiTheme } from "@/ui/muiTheme";
import App from "./App";
import { store } from "./state/store";
import "@/ui/styles.css";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app root element");
}

createRoot(root).render(
  <Provider store={store}>
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} autoHideDuration={4000}>
        <UIProvider defaultColorScheme="dark">
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </UIProvider>
      </SnackbarProvider>
    </ThemeProvider>
  </Provider>,
);
