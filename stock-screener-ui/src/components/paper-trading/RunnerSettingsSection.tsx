import { Text, NumberInput, Stack } from "@/ui";
import type { StrategyConfig } from "../../types/paperTrading";
type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface RunnerSettingsSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

export function RunnerSettingsSection(props: RunnerSettingsSectionProps) {
  return (
    <Stack gap="xs" className="paper-settings-section" id="runner-section">
      <Text fw={600} size="xs" className="uppercase" c="dimmed" mb={1}>
        Runner Configuration
      </Text>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <NumberInput
          label="Cooldown (min)"
          description="Cooldown between trades"
          data-testid="config-cooldown"
          value={props.config.cooldown_minutes}
          onChange={(v) => props.onChange("cooldown_minutes", Number(v))}
          min={0}
          max={120}
          step={5}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Max Distance from OR %"
          description="Max distance from opening range"
          data-testid="config-max-distance"
          value={props.config.max_distance_from_or_pct}
          onChange={(v) => props.onChange("max_distance_from_or_pct", Number(v))}
          min={0.5}
          max={5}
          step={0.25}
          size="xs"
          style={{ width: "100%" }}
        />
      </div>
    </Stack>
  );
}
