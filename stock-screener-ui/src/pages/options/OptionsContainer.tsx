import { useState } from "react";
import Box from "@mui/material/Box";
import { useOptionsState } from "../../hooks/useOptionsState";
import { OptionsPage } from "../../components/options/OptionsPage";

export function OptionsContainer() {
  const options = useOptionsState();
  const [activeTab, setActiveTab] = useState<string>("chain");

  return (
    <Box
      id="options-container"
      data-testid="options-container"
      sx={{ width: "100%", p: 2 }}
    >
      <OptionsPage activeTab={activeTab} setActiveTab={setActiveTab} {...options} />
    </Box>
  );
}
