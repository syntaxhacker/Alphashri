import { onMount } from "solid-js";
import { StrategiesPage } from "../../components/strategies/StrategiesPage";
import { useStrategiesState } from "../../hooks/useStrategiesState";
import * as strategiesState from "../../state/strategies";

export function StrategiesContainer() {
  const props = useStrategiesState();

  onMount(() => {
    strategiesState.initStrategiesState();
  });

  return <StrategiesPage {...props} />;
}
