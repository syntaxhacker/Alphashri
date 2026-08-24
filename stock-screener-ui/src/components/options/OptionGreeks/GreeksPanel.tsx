import { Text, Stack } from "@/ui";
import Paper from "@mui/material/Paper";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import TableContainer from "@mui/material/TableContainer";
import CardContent from "@mui/material/CardContent";

export function GreeksPanel() {
  return (
    <Stack id="greeks-panel" className="greeks-panel" data-testid="options-greeks-panel">
      <Text size="lg" fw={500} className="greeks-title">
        Greeks Analysis
      </Text>
      <Paper sx={{ p: 3 }} className="greeks-content" data-testid="options-greeks-content">
        <Text c="dimmed">Greeks visualization will appear here</Text>
      </Paper>
    </Stack>
  );
}
