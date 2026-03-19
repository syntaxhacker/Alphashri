import { useState } from "react";
import { useOptionsState } from "../../hooks/useOptionsState";
import { OptionsPage } from "./OptionsPage";

export function OptionsContainer() {
  const options = useOptionsState();
  const [activeTab, setActiveTab] = useState<string>("chain");

  return (
    <div
      id="options-container"
      className="options-container"
      style={{ height: "100%", overflow: "hidden" }}
      data-testid="options-container"
    >
      <OptionsPage activeTab={activeTab} setActiveTab={setActiveTab} {...options} />
    </div>
  );
}
