import { Text, NumberInput, Stack } from "@/ui";
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

export function TradingCostsSection(props: TradingCostsSectionProps) {
  return (
    <Stack gap="xs" className="paper-settings-section" id="costs-section">
      <Text fw={600} size="xs" className="uppercase mb-2" c="dimmed">
        Cost Parameters
      </Text>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <NumberInput
          label="Brokerage %"
          description="Brokerage percentage"
          data-testid="config-brokerage"
          value={pct(props.config.brokerage_pct)}
          onChange={(v: number | string) => props.onChange("brokerage_pct", Number(v) / 100)}
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
          value={props.config.min_brokerage}
          onChange={(v: number | string) => props.onChange("min_brokerage", Number(v))}
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
          value={pct(props.config.stt_pct)}
          onChange={(v: number | string) => props.onChange("stt_pct", Number(v) / 100)}
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
          value={pct(props.config.exchange_pct)}
          onChange={(v: number | string) => props.onChange("exchange_pct", Number(v) / 100)}
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
          value={pct(props.config.sebi_pct)}
          onChange={(v: number | string) => props.onChange("sebi_pct", Number(v) / 100)}
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
          value={pct(props.config.stamp_pct)}
          onChange={(v: number | string) => props.onChange("stamp_pct", Number(v) / 100)}
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
          value={pct(props.config.gst_pct)}
          onChange={(v: number | string) => props.onChange("gst_pct", Number(v) / 100)}
          min={0}
          max={30}
          step={1}
          size="xs"
          style={{ width: "100%" }}
        />
      </div>
    </Stack>
  );
}
