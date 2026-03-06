import { StrategiesPage } from "../components/strategies";
import { useStrategiesState } from "../hooks/useStrategiesState";
import * as strategiesState from "../state/strategies";
import { useEffect } from "react";

export function StrategiesContainer() {
  const props = useStrategiesState();

  useEffect(() => {
    strategiesState.initStrategiesState();
  }, []);

  return <StrategiesPage {...props} />;
}
