import { Text, Grid, Stack, NumberInput } from "@mantine/core";
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
    <Stack gap="xs" className="paper-settings-section" id="costs-section">
      <Text fw={600} size="xs" tt="uppercase" mb={2}>
        Cost Parameters
      </Text>
      <Grid gutter={4}>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <NumberInput
            label="Brokerage %"
            description="Brokerage percentage"
            data-testid="config-brokerage"
            value={config.brokerage_pct * 100}
            onChange={(v) => onChange("brokerage_pct", Number(v) / 100)}
            min={0}
            max={1}
            step={0.01}
            size="xs"
            style={{ width: "100%" }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <NumberInput
            label="Min Brokerage"
            description="Minimum brokerage (₹)"
            data-testid="config-min-brokerage"
            value={config.min_brokerage}
            onChange={(v) => onChange("min_brokerage", Number(v))}
            min={0}
            max={100}
            step={1}
            size="xs"
            style={{ width: "100%" }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <NumberInput
            label="STT %"
            description="Securities transaction tax"
            data-testid="config-stt"
            value={config.stt_pct * 100}
            onChange={(v) => onChange("stt_pct", Number(v) / 100)}
            min={0}
            max={0.1}
            step={0.001}
            size="xs"
            style={{ width: "100%" }}
          />
        </Grid.Col>
      </Grid>
      <Grid gutter={4} mt={2}>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <NumberInput
            label="Exchange %"
            description="Exchange charges"
            data-testid="config-exchange"
            value={config.exchange_pct * 100}
            onChange={(v) => onChange("exchange_pct", Number(v) / 100)}
            min={0}
            max={0.01}
            step={0.0001}
            size="xs"
            style={{ width: "100%" }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <NumberInput
            label="SEBI %"
            description="SEBI charges"
            data-testid="config-sebi"
            value={config.sebi_pct * 100}
            onChange={(v) => onChange("sebi_pct", Number(v) / 100)}
            min={0}
            max={0.01}
            step={0.0001}
            size="xs"
            style={{ width: "100%" }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <NumberInput
            label="Stamp %"
            description="Stamp duty"
            data-testid="config-stamp"
            value={config.stamp_pct * 100}
            onChange={(v) => onChange("stamp_pct", Number(v) / 100)}
            min={0}
            max={0.01}
            step={0.0001}
            size="xs"
            style={{ width: "100%" }}
          />
        </Grid.Col>
      </Grid>
      <Grid gutter={4} mt={2}>
        <Grid.Col span={12}>
          <NumberInput
            label="GST %"
            description="Goods and services tax"
            data-testid="config-gst"
            value={config.gst_pct * 100}
            onChange={(v) => onChange("gst_pct", Number(v) / 100)}
            min={0}
            max={30}
            step={1}
            size="xs"
            style={{ width: "100%" }}
          />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
