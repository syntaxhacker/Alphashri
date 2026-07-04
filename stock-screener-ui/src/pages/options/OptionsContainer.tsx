import { useState } from "react";
import { Box } from "@/ui";
import { useOptionsState } from "../../hooks/useOptionsState";
import { OptionsPage } from "../../components/options/OptionsPage";

export function OptionsContainer() {
  const options = useOptionsState();
  const [activeTab, setActiveTab] = useState<string>("chain");

  return (
    <Box
      id="options-container"
      className="options-container"
      h="100%"
      style={{ overflow: "hidden" }}
      data-testid="options-container"
    >
      <OptionsPage activeTab={activeTab} setActiveTab={setActiveTab} {...options} />
    </Box>
  );
}
