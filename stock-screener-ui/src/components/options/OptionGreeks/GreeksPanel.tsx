import { Text } from "@/ui";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TableContainer from "@mui/material/TableContainer";

export function GreeksPanel() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
      <Grid container spacing={1} sx={{ justifyContent: "center", alignItems: "center", width: "100%", maxWidth: 1000 }}>
        <Grid size={{ xs: 12 }} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Stack id="greeks-panel" className="greeks-panel" spacing={1} sx={{ alignItems: "center", justifyContent: "center", width: "100%" }} data-testid="options-greeks-panel">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
              <Text size="lg" fw={500} className="greeks-title" style={{ textAlign: "center" as any }}>
                Greeks Analysis
              </Text>
            </Box>
            <Paper elevation={1} sx={{ p: 1, width: "100%" }} className="greeks-content" data-testid="options-greeks-content">
              <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                <TableContainer component={Paper} elevation={1}>
                  <Box sx={{ p: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Text c="dimmed">Greeks visualization will appear here</Text>
                  </Box>
                </TableContainer>
              </CardContent>
            </Paper>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
