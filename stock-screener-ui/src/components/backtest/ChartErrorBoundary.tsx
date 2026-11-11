// ChartErrorBoundary — keeps a chart crash from unmounting the whole page.
import { Component, type ReactNode } from "react";
import { Box, Text } from "@/ui";

interface Props {
  children: ReactNode;
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <Box className="flex items-center justify-center p-2 h-full">
          <Text size="xs" c="error">
            Chart failed to render: {String(this.state.error?.message ?? this.state.error)}
          </Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
