import { useState } from "react";
import { useOptionsState } from "../../hooks/useOptionsState";
import { OptionsPage } from "./OptionsPage";

export function OptionsContainer() {
  const options = useOptionsState();
  const [activeTab, setActiveTab] = useState<string>("chain");

  return <OptionsPage activeTab={activeTab} setActiveTab={setActiveTab} {...options} />;
}
