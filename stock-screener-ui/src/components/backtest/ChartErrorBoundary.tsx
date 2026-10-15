// ChartErrorBoundary — keeps a chart crash from unmounting the whole page.
import { Component, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

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
        <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
          <Typography variant="body2" color="error.main">
            Chart failed to render: {String(this.state.error?.message ?? this.state.error)}
          </Typography>
        </Box>
      );
    }
    return this.props.children;
  }
}
