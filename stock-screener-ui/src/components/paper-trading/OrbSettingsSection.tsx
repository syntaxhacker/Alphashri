import { memo } from "react";
import { Text, Stack, NumberInput } from "@/ui";
import Box from "@mui/material/Box";
import type { StrategyConfig } from "../../types/paperTrading";

type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface OrbSettingsSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

export const OrbSettingsSection = memo(function OrbSettingsSection({ config, onChange }: OrbSettingsSectionProps) {
  const slPctError = config.sl_pct < 0.1 || config.sl_pct > 5;

  return (
    <Stack gap="xs" className="paper-settings-section" id="orb-section">
      <Text fw={600} size="xs" tt="uppercase" mb={2}>
        Opening Range Breakout
      </Text>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            label="OR Minutes"
            description="Opening range in minutes"
            data-testid="config-or-minutes"
            value={config.or_minutes}
            onChange={(v) => onChange("or_minutes", v)}
            min={15}
            max={120}
            step={15}
            size="xs"
            style={{ width: "100%" }}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            label="Stop Loss %"
            description="Stop loss percentage"
            data-testid="config-sl-pct"
            value={config.sl_pct}
            onChange={(v) => onChange("sl_pct", Number(v))}
            min={0.1}
            max={5}
            step={0.1}
            size="xs"
            style={{ width: "100%" }}
            error={slPctError ? "Invalid stop loss percentage" : undefined}
            errorProps={{ "data-testid": "config-sl-pct-error" }}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            label="Take Profit %"
            description="Take profit percentage"
            data-testid="config-tp-pct"
            value={config.tp_pct}
            onChange={(v) => onChange("tp_pct", Number(v))}
            min={0.1}
            max={10}
            step={0.1}
            size="xs"
            style={{ width: "100%" }}
          />
        </Box>
      </Box>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, mt: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            label="Min OR Range %"
            description="Minimum ORB range"
            data-testid="config-min-or-range"
            value={config.min_or_range_pct}
            onChange={(v) => onChange("min_or_range_pct", Number(v))}
            min={0.1}
            max={5}
            step={0.1}
            size="xs"
            style={{ width: "100%" }}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            label="Max OR Range %"
            description="Maximum ORB range"
            data-testid="config-max-or-range"
            value={config.max_or_range_pct}
            onChange={(v) => onChange("max_or_range_pct", Number(v))}
            min={1}
            max={10}
            step={0.5}
            size="xs"
            style={{ width: "100%" }}
          />
        </Box>
      </Box>
    </Stack>
  );
});
