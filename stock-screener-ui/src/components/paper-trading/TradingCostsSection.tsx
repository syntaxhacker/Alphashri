import { memo } from "react";
import { Text, Stack, NumberInput } from "@/ui";
import Box from "@mui/material/Box";
import type { StrategyConfig } from "../../types/paperTrading";

type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface TradingCostsSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

/** fraction → percent, rounded to avoid float artifacts (e.g. 0.00009999…) */
const pct = (v: number, decimals = 4) => Number((v * 100).toFixed(decimals));

export const TradingCostsSection = memo(function TradingCostsSection({ config, onChange }: TradingCostsSectionProps) {
  return (
    <Stack gap="xs" className="paper-settings-section" id="costs-section">
      <Text fw={600} size="xs" tt="uppercase" c="dimmed" mb={1}>
        Cost Parameters
      </Text>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        <NumberInput
          label="Brokerage %"
          description="Brokerage percentage"
          data-testid="config-brokerage"
          value={pct(config.brokerage_pct)}
          onChange={(v) => onChange("brokerage_pct", Number(v) / 100)}
          min={0}
          max={1}
          step={0.01}
          size="xs"
          style={{ width: "100%" }}
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
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="STT %"
          description="Securities transaction tax"
          data-testid="config-stt"
          value={pct(config.stt_pct)}
          onChange={(v) => onChange("stt_pct", Number(v) / 100)}
          min={0}
          max={0.1}
          step={0.001}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Exchange %"
          description="Exchange charges"
          data-testid="config-exchange"
          value={pct(config.exchange_pct)}
          onChange={(v) => onChange("exchange_pct", Number(v) / 100)}
          min={0}
          max={0.01}
          step={0.0001}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="SEBI %"
          description="SEBI charges"
          data-testid="config-sebi"
          value={pct(config.sebi_pct)}
          onChange={(v) => onChange("sebi_pct", Number(v) / 100)}
          min={0}
          max={0.01}
          step={0.0001}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="Stamp %"
          description="Stamp duty"
          data-testid="config-stamp"
          value={pct(config.stamp_pct)}
          onChange={(v) => onChange("stamp_pct", Number(v) / 100)}
          min={0}
          max={0.01}
          step={0.0001}
          size="xs"
          style={{ width: "100%" }}
        />
        <NumberInput
          label="GST %"
          description="Goods and services tax"
          data-testid="config-gst"
          value={pct(config.gst_pct)}
          onChange={(v) => onChange("gst_pct", Number(v) / 100)}
          min={0}
          max={30}
          step={1}
          size="xs"
          style={{ width: "100%" }}
        />
      </Box>
    </Stack>
  );
});
