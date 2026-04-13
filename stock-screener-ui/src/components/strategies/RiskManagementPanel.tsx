import { Stack, Group, NumberInput, Tabs } from "@mantine/core";
import type { StrategyFormData } from "./types";

interface RiskManagementPanelProps {
  initialValues: StrategyFormData;
  isIntraday: boolean;
}

export function RiskManagementPanel({ initialValues, isIntraday }: RiskManagementPanelProps) {
  return (
    <Tabs.Panel value="risk" className="strategy-form-tab-panel" data-testid="strategy-panel-risk">
      <Stack gap="sm" mt="sm">
        <Group grow>
          <NumberInput
            label="Max Positions"
            name="max_positions"
            defaultValue={initialValues.max_positions}
            min={1}
            max={20}
            required
            data-testid="strategy-max-positions-input"
          />
          <NumberInput
            label="Capital Per Trade %"
            name="max_capital_per_trade_pct"
            defaultValue={initialValues.max_capital_per_trade_pct}
            min={1}
            max={100}
            suffix="%"
            data-testid="strategy-capital-per-trade-input"
          />
        </Group>
        <Group grow>
          <NumberInput
            label="Max Daily Loss %"
            name="max_daily_loss_pct"
            defaultValue={initialValues.max_daily_loss_pct}
            min={1}
            max={50}
            suffix="%"
            data-testid="strategy-max-daily-loss-input"
          />
          <NumberInput
            label="Max Total Exposure %"
            name="max_total_exposure_pct"
            defaultValue={initialValues.max_total_exposure_pct}
            min={1}
            max={100}
            suffix="%"
            data-testid="strategy-max-exposure-input"
          />
        </Group>
        <Group grow>
          <NumberInput
            label="Risk Per Trade %"
            name="risk_per_trade_pct"
            defaultValue={initialValues.risk_per_trade_pct}
            min={0.1}
            max={10}
            step={0.1}
            suffix="%"
            data-testid="strategy-risk-per-trade-input"
          />
          <NumberInput
            label="Min R:R Ratio"
            name="min_rr_ratio"
            defaultValue={initialValues.min_rr_ratio}
            min={0.1}
            max={10}
            step={0.1}
            data-testid="strategy-min-rr-input"
          />
        </Group>
        <Group grow>
          {isIntraday ? (
            <NumberInput
              label="Cooldown Minutes"
              name="cooldown_minutes"
              defaultValue={initialValues.cooldown_minutes}
              min={1}
              max={240}
              suffix=" min"
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
              data-testid="strategy-cooldown-input"
            />
          )}
        </Group>
      </Stack>
    </Tabs.Panel>
  );
}
