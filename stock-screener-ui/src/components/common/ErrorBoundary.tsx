import { ErrorBoundary as SolidErrorBoundary, createEffect, type JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import { BORDER, SURFACE, TEXT_MUTED } from "@/ui/palette";

interface ErrorBoundaryProps {
  children?: JSX.Element;
  /** Short surface name used in the fallback copy (e.g. "Market screener"). */
  label?: string;
  /** Changing this clears the error (e.g. when a new symbol is opened). */
  resetKey?: string | number | null;
}

/**
 * Page/panel-level boundary. Keeps a render-time or lazy-chunk failure from
 * blanking the whole app and gives the user a retry path.
 *
 * Note: this cannot catch a browser-process crash (SIGILL/OOM) — no boundary
 * can. It covers JS/render/chunk errors, which are the blank-page cases we
 * can actually recover from.
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  let resetError: (() => void) | undefined;
  let prevResetKey = props.resetKey;
  createEffect(() => {
    const key = props.resetKey;
    if (key !== prevResetKey) {
      prevResetKey = key;
      resetError?.();
    }
  });

  return (
    <SolidErrorBoundary
      fallback={(error, reset) => {
        resetError = reset;
        const label = props.label ?? "This page";
        // Keep the stack in the console for debugging; the UI stays generic.
        // eslint-disable-next-line no-console
        console.error(`[ui-error-boundary] ${label} failed`, error);
        return (
          <Box
            role="alert"
            data-testid="ui-error-boundary"
            className="flex flex-col items-start gap-2 p-4 m-2 min-h-[120px] border border-fin-border bg-fin-surface"
            style={{ "border-color": BORDER, "background-color": SURFACE }}
          >
            <Text size="sm" fw={700} c="dimmed">
              {label} hit an error
            </Text>
            <Text size="xs" c="dimmed" style={{ color: TEXT_MUTED, "word-break": "break-word" }}>
              {error?.message || String(error)}
            </Text>
            <Box style={{ display: "flex", gap: "12px", "margin-top": "8px" }}>
              <Button size="xs" variant="outline" onClick={() => reset()} data-testid="ui-error-retry">
                Try again
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => window.location.reload()}
                data-testid="ui-error-reload"
              >
                Reload page
              </Button>
            </Box>
          </Box>
        );
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  );
}
