import { Card, Text, Group, NumberInput } from "@mantine/core";
import type { StrategyConfig } from "../../types/paperTrading";

type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface OrbSettingsSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

export function OrbSettingsSection({ config, onChange }: OrbSettingsSectionProps) {
  return (
    <Card
      padding="sm"
      radius="sm"
      withBorder
      variant="default"
      className="paper-settings-section"
      id="orb-section"
    >
      <Text fw={500} size="sm" mb="xs">
        Opening Range Breakout
      </Text>
      <Group grow>
        <NumberInput
          label="OR Minutes"
          description="Opening range in minutes"
          data-testid="config-or-minutes"
          value={config.or_minutes}
          onChange={(v) => onChange("or_minutes", v)}
          min={15}
          max={120}
          step={15}
          size="sm"
        />
        <NumberInput
          label="Stop Loss %"
          description="Stop loss percentage"
          data-testid="config-sl-pct"
          value={config.sl_pct}
          onChange={(v) => onChange("sl_pct", Number(v))}
          min={0.1}
          max={5}
          step={0.1}
          size="sm"
        />
        <NumberInput
          label="Take Profit %"
          description="Take profit percentage"
          data-testid="config-tp-pct"
          value={config.tp_pct}
          onChange={(v) => onChange("tp_pct", Number(v))}
          min={0.1}
          max={10}
          step={0.1}
          size="sm"
        />
      </Group>
      <Group grow mt="sm">
        <NumberInput
          label="Min OR Range %"
          description="Minimum ORB range"
          data-testid="config-min-or-range"
          value={config.min_or_range_pct}
          onChange={(v) => onChange("min_or_range_pct", Number(v))}
          min={0.1}
          max={5}
          step={0.1}
          size="sm"
        />
        <NumberInput
          label="Max OR Range %"
          description="Maximum ORB range"
          data-testid="config-max-or-range"
          value={config.max_or_range_pct}
          onChange={(v) => onChange("max_or_range_pct", Number(v))}
          min={1}
          max={10}
          step={0.5}
          size="sm"
        />
      </Group>
    </Card>
  );
}
