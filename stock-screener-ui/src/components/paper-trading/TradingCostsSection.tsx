import { Card, Text, Group, NumberInput } from "@mantine/core";
import type { StrategyConfig } from "../../types/paperTrading";

type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface TradingCostsSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

export function TradingCostsSection({ config, onChange }: TradingCostsSectionProps) {
  return (
    <Card
      padding="sm"
      radius="sm"
      withBorder
      variant="default"
      className="paper-settings-section"
      id="costs-section"
    >
      <Text fw={500} size="sm" mb="xs">
        Cost Parameters
      </Text>
      <Group grow>
        <NumberInput
          label="Brokerage %"
          description="Brokerage percentage"
          data-testid="config-brokerage"
          value={config.brokerage_pct * 100}
          onChange={(v) => onChange("brokerage_pct", Number(v) / 100)}
          min={0}
          max={1}
          step={0.01}
          size="sm"
        />
        <NumberInput
          label="Min Brokerage"
          description="Minimum brokerage (₹)"
          data-testid="config-min-brokerage"
          value={config.min_brokerage}
          onChange={(v) => onChange("min_brokerage", Number(v))}
          min={0}
          max={100}
          step={1}
          size="sm"
        />
        <NumberInput
          label="STT %"
          description="Securities transaction tax"
          data-testid="config-stt"
          value={config.stt_pct * 100}
          onChange={(v) => onChange("stt_pct", Number(v) / 100)}
          min={0}
          max={0.1}
          step={0.001}
          size="sm"
        />
      </Group>
      <Group grow mt="sm">
        <NumberInput
          label="Exchange %"
          description="Exchange charges"
          data-testid="config-exchange"
          value={config.exchange_pct * 100}
          onChange={(v) => onChange("exchange_pct", Number(v) / 100)}
          min={0}
          max={0.01}
          step={0.0001}
          size="sm"
        />
        <NumberInput
          label="SEBI %"
          description="SEBI charges"
          data-testid="config-sebi"
          value={config.sebi_pct * 100}
          onChange={(v) => onChange("sebi_pct", Number(v) / 100)}
          min={0}
          max={0.01}
          step={0.0001}
          size="sm"
        />
        <NumberInput
          label="Stamp %"
          description="Stamp duty"
          data-testid="config-stamp"
          value={config.stamp_pct * 100}
          onChange={(v) => onChange("stamp_pct", Number(v) / 100)}
          min={0}
          max={0.01}
          step={0.0001}
          size="sm"
        />
      </Group>
      <Group grow mt="sm">
        <NumberInput
          label="GST %"
          description="Goods and services tax"
          data-testid="config-gst"
          value={config.gst_pct * 100}
          onChange={(v) => onChange("gst_pct", Number(v) / 100)}
          min={0}
          max={30}
          step={1}
          size="sm"
        />
      </Group>
    </Card>
  );
}
