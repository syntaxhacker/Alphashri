import { useState } from "react";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import CardContent from "@mui/material/CardContent";
import TableContainer from "@mui/material/TableContainer";
import { useOptionsState } from "../../hooks/useOptionsState";
import { OptionsPage } from "../../components/options/OptionsPage";

export function OptionsContainer() {
  const options = useOptionsState();
  const [activeTab, setActiveTab] = useState<string>("chain");

  return (
    <Container
      maxWidth="xl"
      id="options-container"
      className="options-container"
      data-testid="options-container"
      sx={{ py: 2, height: "100%", overflow: "hidden" }}
    >
      <Grid container spacing={2} sx={{ height: "100%" }}>
        <Grid size={{ xs: 12 }}>
          <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
            <TableContainer>
              <OptionsPage activeTab={activeTab} setActiveTab={setActiveTab} {...options} />
            </TableContainer>
          </CardContent>
        </Grid>
      </Grid>
    </Container>
  );
}
