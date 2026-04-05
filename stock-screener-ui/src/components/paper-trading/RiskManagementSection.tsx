import { Card, Text, Group, NumberInput } from "@mantine/core";
import type { StrategyConfig } from "../../types/paperTrading";

type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface RiskManagementSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

export function RiskManagementSection({ config, onChange }: RiskManagementSectionProps) {
  return (
    <Card
      padding="sm"
      radius="sm"
      withBorder
      variant="default"
      className="paper-settings-section"
      id="risk-section"
    >
      <Text fw={500} size="sm" mb="xs">
        Risk Parameters
      </Text>
      <Group grow>
        <NumberInput
          label="Max Positions"
          description="Maximum concurrent positions"
          data-testid="config-max-positions"
          value={config.max_positions}
          onChange={(v) => onChange("max_positions", Number(v))}
          min={1}
          max={10}
          step={1}
          size="sm"
        />
        <NumberInput
          label="Capital/Trade %"
          description="Capital per trade"
          data-testid="config-capital-per-trade"
          value={config.max_capital_per_trade_pct * 100}
          onChange={(v) => onChange("max_capital_per_trade_pct", Number(v) / 100)}
          min={5}
          max={25}
          step={1}
          size="sm"
        />
        <NumberInput
          label="Daily Loss %"
          description="Maximum daily loss"
          data-testid="config-daily-loss"
          value={config.max_daily_loss_pct * 100}
          onChange={(v) => onChange("max_daily_loss_pct", Number(v) / 100)}
          min={1}
          max={10}
          step={1}
          size="sm"
        />
      </Group>
      <Group grow mt="sm">
        <NumberInput
          label="Max Exposure %"
          description="Maximum total exposure"
          data-testid="config-max-exposure"
          value={config.max_total_exposure_pct * 100}
          onChange={(v) => onChange("max_total_exposure_pct", Number(v) / 100)}
          min={20}
          max={100}
          step={5}
          size="sm"
        />
        <NumberInput
          label="Risk/Trade %"
          description="Risk per trade"
          data-testid="config-risk-per-trade"
          value={config.risk_per_trade_pct * 100}
          onChange={(v) => onChange("risk_per_trade_pct", Number(v) / 100)}
          min={0.5}
          max={5}
          step={0.5}
          size="sm"
        />
      </Group>
      <Group grow mt="sm">
        <NumberInput
          label="Min Trade Value"
          description="Minimum trade value (₹)"
          data-testid="config-min-trade"
          value={config.min_trade_value}
          onChange={(v) => onChange("min_trade_value", Number(v))}
          min={1000}
          max={50000}
          step={1000}
          size="sm"
        />
        <NumberInput
          label="Max Trade Value"
          description="Maximum trade value (₹)"
          data-testid="config-max-trade"
          value={config.max_trade_value}
          onChange={(v) => onChange("max_trade_value", Number(v))}
          min={10000}
          max={500000}
          step={10000}
          size="sm"
        />
      </Group>
    </Card>
  );
}
