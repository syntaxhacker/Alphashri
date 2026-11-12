import { ErrorBoundary as SolidErrorBoundary, type JSX } from "solid-js";
import { Box, Text } from "@/ui";

interface ChartErrorBoundaryProps {
  children?: JSX.Element;
  /** Short label used in the fallback copy (e.g. "Price × gamma chart"). */
  label?: string;
}

/**
 * Contains a charting failure to the chart itself.
 *
 * ECharts throws synchronously during render for some malformed options (e.g.
 * a `markPoint` using `coord`), and without a boundary that exception unmounts
 * the whole tree — blanking the entire page. This keeps a bad chart a
 * local, visible "unavailable" state instead.
 */
export function ChartErrorBoundary(props: ChartErrorBoundaryProps) {
  return (
    <SolidErrorBoundary
      fallback={(error) => {
        // Keep the detail server/console-side; the UI only shows the fallback.
        // eslint-disable-next-line no-console
        console.error("chart render failed", error);
        return (
          <Box
            data-testid="chart-error"
            className="flex items-center justify-center"
            style={{ "min-height": 120, padding: 8 }}
          >
            <Text size="xs" c="dimmed" span>
              {props.label ?? "Chart"} unavailable
            </Text>
          </Box>
        );
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  );
}
