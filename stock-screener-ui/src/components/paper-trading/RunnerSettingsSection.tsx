import { Card, Text, Group, NumberInput } from "@mantine/core";
import type { StrategyConfig } from "../../types/paperTrading";

type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface RunnerSettingsSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

export function RunnerSettingsSection({ config, onChange }: RunnerSettingsSectionProps) {
  return (
    <Card
      padding="sm"
      radius="sm"
      withBorder
      variant="default"
      className="paper-settings-section"
      id="runner-section"
    >
      <Text fw={500} size="sm" mb="xs">
        Runner Configuration
      </Text>
      <Group grow>
        <NumberInput
          label="Cooldown (min)"
          description="Cooldown between trades"
          data-testid="config-cooldown"
          value={config.cooldown_minutes}
          onChange={(v) => onChange("cooldown_minutes", Number(v))}
          min={0}
          max={120}
          step={5}
          size="sm"
        />
        <NumberInput
          label="Max Distance from OR %"
          description="Max distance from opening range"
          data-testid="config-max-distance"
          value={config.max_distance_from_or_pct}
          onChange={(v) => onChange("max_distance_from_or_pct", Number(v))}
          min={0.5}
          max={5}
          step={0.25}
          size="sm"
        />
      </Group>
    </Card>
  );
}
