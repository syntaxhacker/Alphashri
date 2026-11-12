import "./tailwind.css";
import "@/ui/tailwindSafelist";
import "./style.css";
import * as Sentry from "@sentry/solid";
import { render } from "solid-js/web";
import { Notifications } from "@/ui";
import App from "./App";

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

// The router is mounted inside `App` because `AppLayout` reads `useLocation()`.
// `Notifications` is the toast host (was notistack's SnackbarProvider).
render(() => (
  <Notifications>
    <App />
  </Notifications>
), root);