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
      className="options-container"
      data-testid="options-container"
      sx={{ p: 1, height: "100%", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}
    >
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", width: "100%", maxWidth: 1400, alignItems: "center" }}>
        <OptionsPage activeTab={activeTab} setActiveTab={setActiveTab} {...options} />
      </Box>
    </Box>
  );
}
