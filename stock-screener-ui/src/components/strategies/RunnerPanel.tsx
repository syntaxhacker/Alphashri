import { Stack, Box, NumberInput, Switch, Tabs, Text, Divider } from "@/ui";
import type { StrategyFormData } from "./types";

interface RunnerPanelProps {
  initialValues: StrategyFormData;
  isOrb: boolean;
}

export function RunnerPanel({ initialValues, isOrb }: RunnerPanelProps) {
  return (
    <Tabs.Panel
      value="runner"
      className="strategy-form-tab-panel"
      data-testid="strategy-panel-runner"
    >
      <Stack spacing={1} gap="sm" mt="sm" sx={{ gap: 1, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
          <Text size="xs" c="dimmed" ta="center">
            Execution settings — how and when trades are placed.
          </Text>
        </Box>

        <Divider label="Entry Filters" labelPosition="left" />
        {isOrb && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
            <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Max Distance from OR</Text>
            <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
              <NumberInput
                size="sm"
                name="max_distance_from_or_pct"
                defaultValue={initialValues.max_distance_from_or_pct}
                min={0.1}
                max={10}
                step={0.1}
                suffix="%"
                description="Skip if current price is too far from OR boundary (missed entry)"
                data-testid="strategy-max-distance-input"
              />
            </Box>
          </Box>
        )}

        <Divider label="Execution Rules" labelPosition="left" />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Enable Shorts</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <Switch
              label=""
              name="enable_shorts"
              defaultChecked={initialValues.enable_shorts ?? false}
              data-testid="strategy-enable-shorts-input"
            />
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>EOD Exit Hour</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="eod_exit_hour"
              defaultValue={initialValues.eod_exit_hour ?? 15}
              min={9}
              max={16}
              step={1}
              description="Hour to force-close all positions"
              data-testid="strategy-eod-hour-input"
            />
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>EOD Exit Minute</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="eod_exit_minute"
              defaultValue={initialValues.eod_exit_minute ?? 30}
              min={0}
              max={59}
              step={5}
              description="Minute of the hour"
              data-testid="strategy-eod-minute-input"
            />
          </Box>
        </Box>
      </Stack>
    </Tabs.Panel>
  );
}
