import { useState } from "react";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import { useOptionsState } from "../../hooks/useOptionsState";
import { OptionsPage } from "../../components/options/OptionsPage";

export function OptionsContainer() {
  const options = useOptionsState();
  const [activeTab, setActiveTab] = useState<string>("chain");

  return (
    <Container
      maxWidth="xl"
      id="options-container"
      data-testid="options-container"
      sx={{ py: 1, height: "100%", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}
    >
      <Grid container spacing={1} justifyContent="center" sx={{ flex: 1, minHeight: 0, width: "100%", overflow: "hidden" }}>
        <Grid size={12} sx={{ display: "flex", justifyContent: "center", minHeight: 0, overflow: "hidden" }}>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", width: "100%", maxWidth: 1400, alignItems: "center" }}>
            <OptionsPage activeTab={activeTab} setActiveTab={setActiveTab} {...options} />
          </Box>
        </Grid>
      </Grid>
    </Container>
  );
}
