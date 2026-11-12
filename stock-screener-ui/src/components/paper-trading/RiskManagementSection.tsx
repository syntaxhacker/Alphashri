import { Text, NumberInput } from "@/ui";
import type { StrategyConfig } from "../../types/paperTrading";
import { Stack } from "./primitives";

type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface RiskManagementSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

/** fraction → percent, rounded to avoid float artifacts (e.g. 0.00009999…) */
const pct = (v: number, decimals = 4) => Number((v * 100).toFixed(decimals));

export function RiskManagementSection(props: RiskManagementSectionProps) {
  return (
    <Stack gap="xs" className="paper-settings-section" id="risk-section">
      <Text fw={600} size="xs" tt="uppercase" c="dimmed" mb={1}>
        Risk Parameters
      </Text>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <NumberInput
          label="Max Positions"
          description="Maximum concurrent positions"
          data-testid="config-max-positions"
          value={props.config.max_positions}
          onChange={(v) => props.onChange("max_positions", Number(v))}
          min={1}
          max={10}
          step={1}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Capital/Trade %"
          description="Capital per trade"
          data-testid="config-capital-per-trade"
          value={pct(props.config.max_capital_per_trade_pct)}
          onChange={(v) => props.onChange("max_capital_per_trade_pct", Number(v) / 100)}
          min={5}
          max={25}
          step={1}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Daily Loss %"
          description="Maximum daily loss"
          data-testid="config-daily-loss"
          value={pct(props.config.max_daily_loss_pct)}
          onChange={(v) => props.onChange("max_daily_loss_pct", Number(v) / 100)}
          min={1}
          max={10}
          step={1}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Max Exposure %"
          description="Maximum total exposure"
          data-testid="config-max-exposure"
          value={pct(props.config.max_total_exposure_pct)}
          onChange={(v) => props.onChange("max_total_exposure_pct", Number(v) / 100)}
          min={20}
          max={100}
          step={5}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Risk/Trade %"
          description="Risk per trade"
          data-testid="config-risk-per-trade"
          value={pct(props.config.risk_per_trade_pct)}
          onChange={(v) => props.onChange("risk_per_trade_pct", Number(v) / 100)}
          min={0.5}
          max={5}
          step={0.5}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Min Trade Value"
          description="Minimum trade value (₹)"
          data-testid="config-min-trade"
          value={props.config.min_trade_value}
          onChange={(v) => props.onChange("min_trade_value", Number(v))}
          min={1000}
          max={50000}
          step={1000}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Max Trade Value"
          description="Maximum trade value (₹)"
          data-testid="config-max-trade"
          value={props.config.max_trade_value}
          onChange={(v) => props.onChange("max_trade_value", Number(v))}
          min={10000}
          max={500000}
          step={10000}
          size="xs"
          style={{ width: "100%" }}
        />
      </div>
    </Stack>
  );
}
