import { memo } from "react";
import { Text, Stack, NumberInput } from "@/ui";
import Box from "@mui/material/Box";
import type { StrategyConfig } from "../../types/paperTrading";

type ConfigValueHandler = (
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) => void;

interface RunnerSettingsSectionProps {
  config: StrategyConfig;
  onChange: ConfigValueHandler;
}

export const RunnerSettingsSection = memo(function RunnerSettingsSection({ config, onChange }: RunnerSettingsSectionProps) {
  return (
    <Stack gap="xs" className="paper-settings-section" id="runner-section">
      <Text fw={600} size="xs" tt="uppercase" mb={2}>
        Runner Configuration
      </Text>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            label="Cooldown (min)"
            description="Cooldown between trades"
            data-testid="config-cooldown"
            value={config.cooldown_minutes}
            onChange={(v) => onChange("cooldown_minutes", Number(v))}
            min={0}
            max={120}
            step={5}
            size="xs"
            style={{ width: "100%" }}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            label="Max Distance from OR %"
            description="Max distance from opening range"
            data-testid="config-max-distance"
            value={config.max_distance_from_or_pct}
            onChange={(v) => onChange("max_distance_from_or_pct", Number(v))}
            min={0.5}
            max={5}
            step={0.25}
            size="xs"
            style={{ width: "100%" }}
          />
        </Box>
      </Box>
    </Stack>
  );
});
