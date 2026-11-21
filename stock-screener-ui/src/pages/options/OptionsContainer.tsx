import { createSignal } from "solid-js";
import { Box } from "@/ui";
import { useOptionsState } from "../../hooks/useOptionsState";
import { OptionsPage } from "../../components/options/OptionsPage";

export function OptionsContainer() {
  const options = useOptionsState();
  const [activeTab, setActiveTab] = createSignal<string>("chain");

  return (
    <Box
      id="options-container"
      data-testid="options-container"
      px={2}
      py={1}
      className="flex flex-col h-full w-full min-h-0 overflow-hidden"
    >
      <Box className="flex flex-col h-full w-full min-h-0 overflow-hidden" style={{ flex: 1 }}>
        <OptionsPage activeTab={activeTab()} setActiveTab={setActiveTab} {...options} />
      </Box>
    </Box>
  );
}
