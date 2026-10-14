import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";

interface ChartErrorBoundaryProps {
  children: ReactNode;
  /** Short label used in the fallback copy (e.g. "Price × gamma chart"). */
  label?: string;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
}

/**
 * Contains a charting failure to the chart itself.
 *
 * ECharts throws synchronously during render for some malformed options (e.g.
 * a `markPoint` using `coord`), and without a boundary that exception unmounts
 * the whole React tree — blanking the entire page. This keeps a bad chart a
 * local, visible "unavailable" state instead.
 */
export class ChartErrorBoundary extends Component<
  ChartErrorBoundaryProps,
  ChartErrorBoundaryState
> {
  state: ChartErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ChartErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the detail server/console-side; the UI only shows the fallback.
    // eslint-disable-next-line no-console
    console.error("chart render failed", error, info?.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Box
          data-testid="chart-error"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 120,
            p: 1,
          }}
        >
          <Text size="xs" c="dimmed" span>
            {this.props.label ?? "Chart"} unavailable
          </Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
