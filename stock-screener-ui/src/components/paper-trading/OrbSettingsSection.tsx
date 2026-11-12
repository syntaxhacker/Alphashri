import { Text, NumberInput, Stack } from "@/ui";
import type { StrategyConfig } from "../../types/paperTrading";
type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface OrbSettingsSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

export function OrbSettingsSection(props: OrbSettingsSectionProps) {
  const slPctError = () => props.config.sl_pct < 0.1 || props.config.sl_pct > 5;

  return (
    <Stack gap="xs" className="paper-settings-section" id="orb-section">
      <Text fw={600} size="xs" className="uppercase" c="dimmed" mb={1}>
        Opening Range Breakout
      </Text>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <NumberInput
          label="OR Minutes"
          description="Opening range in minutes"
          data-testid="config-or-minutes"
          value={props.config.or_minutes}
          onChange={(v) => props.onChange("or_minutes", v)}
          min={15}
          max={120}
          step={15}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Stop Loss %"
          description="Stop loss percentage"
          data-testid="config-sl-pct"
          value={props.config.sl_pct}
          onChange={(v) => props.onChange("sl_pct", Number(v))}
          min={0.1}
          max={5}
          step={0.1}
          size="xs"
          style={{ width: "100%" }}
          error={slPctError() ? "Invalid stop loss percentage" : undefined}
          errorProps={{ dataTestid: "config-sl-pct-error" }}
        />
        <NumberInput
          label="Take Profit %"
          description="Take profit percentage"
          data-testid="config-tp-pct"
          value={props.config.tp_pct}
          onChange={(v) => props.onChange("tp_pct", Number(v))}
          min={0.1}
          max={10}
          step={0.1}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Min OR Range %"
          description="Minimum ORB range"
          data-testid="config-min-or-range"
          value={props.config.min_or_range_pct}
          onChange={(v) => props.onChange("min_or_range_pct", Number(v))}
          min={0.1}
          max={5}
          step={0.1}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Max OR Range %"
          description="Maximum ORB range"
          data-testid="config-max-or-range"
          value={props.config.max_or_range_pct}
          onChange={(v) => props.onChange("max_or_range_pct", Number(v))}
          min={1}
          max={10}
          step={0.5}
          size="xs"
          style={{ width: "100%" }}
        />
      </div>
    </Stack>
  );
}
