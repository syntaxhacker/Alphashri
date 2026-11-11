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
        className="flex flex-col items-start gap-2 p-4 m-2 min-h-[120px] border border-fin-border bg-fin-surface"
        style={{ borderColor: BORDER, backgroundColor: SURFACE }}
      >
        <Text size="sm" fw={700} c="dimmed">
          {label} hit an error
        </Text>
        <Text size="xs" c="dimmed" style={{ color: TEXT_MUTED, wordBreak: "break-word" }}>
          {this.state.error.message || String(this.state.error)}
        </Text>
        <Box style={{ display: "flex", gap: 12, marginTop: 8 }}>
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
