import { Stack, Group, NumberInput, Switch, Tabs, Text, Divider } from "@mantine/core";
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
      <Stack gap="sm" mt="sm">
        <Text size="xs" c="dimmed">
          Execution settings — how and when trades are placed.
        </Text>

        <Divider label="Entry Filters" labelPosition="left" />
        {isOrb && (
          <NumberInput
            label="Max Distance from OR"
            name="max_distance_from_or_pct"
            defaultValue={initialValues.max_distance_from_or_pct}
            min={0.1}
            max={10}
            step={0.1}
            suffix="%"
            description="Skip if current price is too far from OR boundary (missed entry)"
            data-testid="strategy-max-distance-input"
          />
        )}

        <Divider label="Execution Rules" labelPosition="left" />
        <Group grow>
          <Switch
            label="Enable Shorts"
            name="enable_shorts"
            defaultChecked={initialValues.enable_shorts ?? false}
            data-testid="strategy-enable-shorts-input"
          />
        </Group>
        <Group grow>
          <NumberInput
            label="EOD Exit Hour"
            name="eod_exit_hour"
            defaultValue={initialValues.eod_exit_hour ?? 15}
            min={9}
            max={16}
            step={1}
            description="Hour to force-close all positions"
            data-testid="strategy-eod-hour-input"
          />
          <NumberInput
            label="EOD Exit Minute"
            name="eod_exit_minute"
            defaultValue={initialValues.eod_exit_minute ?? 30}
            min={0}
            max={59}
            step={5}
            description="Minute of the hour"
            data-testid="strategy-eod-minute-input"
          />
        </Group>
      </Stack>
    </Tabs.Panel>
  );
}
