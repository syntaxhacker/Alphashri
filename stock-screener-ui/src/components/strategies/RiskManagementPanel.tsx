import { Stack, Group, NumberInput, Text, Divider, Tabs } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { StrategyFormData } from "./types";

interface RiskManagementPanelProps {
  initialValues: StrategyFormData;
  isIntraday: boolean;
}

export function RiskManagementPanel({ initialValues, isIntraday }: RiskManagementPanelProps) {
  return (
    <Tabs.Panel value="risk" className="strategy-form-tab-panel" data-testid="strategy-panel-risk">
      <Stack gap="sm" mt="sm">
        <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
          These limits apply to the capital allocated to this strategy from the bot.
          Example: if bot allocates ₹5Lac to this strategy, a 1% risk = max loss ₹5,000 per trade.
        </Text>

        <Divider label="Per-Trade Sizing" labelPosition="left" />

        <Group grow>
          <NumberInput
            label="Risk Per Trade %"
            name="risk_per_trade_pct"
            defaultValue={initialValues.risk_per_trade_pct}
            min={0.1}
            max={10}
            step={0.1}
            suffix="%"
            description="Max loss per trade as % of allocated capital"
            data-testid="strategy-risk-per-trade-input"
          />
          <NumberInput
            label="Max Position Size %"
            name="max_capital_per_trade_pct"
            defaultValue={initialValues.max_capital_per_trade_pct}
            min={1}
            max={100}
            suffix="%"
            description="Max position value as % of allocated capital"
            data-testid="strategy-capital-per-trade-input"
          />
        </Group>

        <Group grow>
          <NumberInput
            label="Min Trade Value (₹)"
            name="min_trade_value"
            defaultValue={initialValues.min_trade_value}
            min={1000}
            max={100000}
            step={1000}
            prefix="₹"
            description="Skip trades below this value"
            data-testid="strategy-min-trade-value-input"
          />
          <NumberInput
            label="Max Trade Value (₹)"
            name="max_trade_value"
            defaultValue={initialValues.max_trade_value}
            min={5000}
            max={500000}
            step={5000}
            prefix="₹"
            description="Skip trades above this value"
            data-testid="strategy-max-trade-value-input"
          />
        </Group>

        <Divider label="Cooldown" labelPosition="left" />

        <Group grow>
          {isIntraday ? (
            <NumberInput
              label="Cooldown Minutes"
              name="cooldown_minutes"
              defaultValue={initialValues.cooldown_minutes}
              min={1}
              max={240}
              suffix=" min"
              description="Wait time between trades"
              data-testid="strategy-cooldown-input"
            />
          ) : (
            <NumberInput
              label="Cooldown Days"
              name="cooldown_days"
              defaultValue={initialValues.cooldown_days}
              min={1}
              max={90}
              suffix=" days"
              description="Wait time between trades"
              data-testid="strategy-cooldown-input"
            />
          )}
        </Group>

        <Text size="xs" c="dimmed" fs="italic" mt="sm">
          <IconInfoCircle size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Max Daily Loss % and Max Total Exposure % are configured at the bot level (Bot Settings).
        </Text>
      </Stack>
    </Tabs.Panel>
  );
}
