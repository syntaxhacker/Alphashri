import { StrategiesPage } from "../components/strategies";
import { useStrategiesState } from "../hooks/useStrategiesState";

export function StrategiesContainer() {
  const props = useStrategiesState();

  return <StrategiesPage {...props} />;
}
