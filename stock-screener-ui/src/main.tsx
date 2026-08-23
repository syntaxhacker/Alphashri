import "@mantine/dates/styles.css";
import "./style.css";
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { UIProvider } from "@/ui";
import { Notifications } from "@/ui";
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
    <UIProvider defaultColorScheme="dark">
      <Notifications position="bottom-right" />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </UIProvider>
  </Provider>,
);
