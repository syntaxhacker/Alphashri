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
      <Text fw={600} size="xs" tt="uppercase" c="dimmed" mb={1}>
        Runner Configuration
      </Text>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
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
    </Stack>
  );
});
