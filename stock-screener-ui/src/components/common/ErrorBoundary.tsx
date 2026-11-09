import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Box, Button, Text } from "@/ui";
import { BORDER, SURFACE, TEXT_MUTED } from "@/ui/palette";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short surface name used in the fallback copy (e.g. "Market screener"). */
  label?: string;
  /** Changing this clears the error (e.g. when a new symbol is opened). */
  resetKey?: string | number | null;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Page/panel-level boundary. Keeps a render-time or lazy-chunk failure from
 * blanking the whole app and gives the user a retry path.
 *
 * Note: this cannot catch a browser-process crash (SIGILL/OOM) — no React
 * boundary can. It covers JS/render/chunk errors, which are the blank-page
 * cases we can actually recover from.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack in the console for debugging; the UI stays generic.
    // eslint-disable-next-line no-console
    console.error(
      `[ui-error-boundary] ${this.props.label ?? "page"} failed`,
      error,
      info?.componentStack,
    );
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const label = this.props.label ?? "This page";
    return (
      <Box
        role="alert"
        data-testid="ui-error-boundary"
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 0.75,
          m: 1,
          p: 1.5,
          minHeight: 120,
          border: 1,
          borderColor: BORDER,
          bgcolor: SURFACE,
        }}
      >
        <Text size="sm" fw={700} c="dimmed">
          {label} hit an error
        </Text>
        <Text size="xs" c="dimmed" sx={{ color: TEXT_MUTED, wordBreak: "break-word" }}>
          {this.state.error.message || String(this.state.error)}
        </Text>
        <Box sx={{ display: "flex", gap: 0.75, mt: 0.5 }}>
          <Button size="xs" variant="outline" onClick={this.reset} data-testid="ui-error-retry">
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
  }
}
