import { Show } from "solid-js";
import { Stack, Box, NumberInput, Switch, Tabs, Text, Divider } from "@/ui";
import type { StrategyFormData } from "./types";

interface RunnerPanelProps {
  initialValues: StrategyFormData;
  isOrb: boolean;
}

export function RunnerPanel(props: RunnerPanelProps) {
  return (
    <Tabs.Panel
      value="runner"
      keepMounted
      className="strategy-form-tab-panel"
      data-testid="strategy-panel-runner"
    >
      <Stack spacing={1} gap="sm" mt="sm" className="p-2">
        <Box className="flex items-center justify-center p-2">
          <Text size="xs" c="dimmed" ta="center">
            Execution settings — how and when trades are placed.
          </Text>
        </Box>

        <Divider label="Entry Filters" labelPosition="left" />
        <Show when={props.isOrb}>
          <Box className="flex items-center gap-2 p-2">
            <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Max Distance from OR</Text>
            <Box className="flex-1 flex items-center">
              <NumberInput
                size="sm"
                name="max_distance_from_or_pct"
                defaultValue={props.initialValues.max_distance_from_or_pct}
                min={0.1}
                max={10}
                step={0.1}
                suffix="%"
                description="Skip if current price is too far from OR boundary (missed entry)"
                data-testid="strategy-max-distance-input"
              />
            </Box>
          </Box>
        </Show>

        <Divider label="Execution Rules" labelPosition="left" />
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Enable Shorts</Text>
          <Box className="flex-1 flex items-center">
            <Switch
              label=""
              name="enable_shorts"
              defaultChecked={props.initialValues.enable_shorts ?? false}
              data-testid="strategy-enable-shorts-input"
            />
          </Box>
        </Box>
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">EOD Exit Hour</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="eod_exit_hour"
              defaultValue={props.initialValues.eod_exit_hour ?? 15}
              min={9}
              max={16}
              step={1}
              description="Hour to force-close all positions"
              data-testid="strategy-eod-hour-input"
            />
          </Box>
        </Box>
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">EOD Exit Minute</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="eod_exit_minute"
              defaultValue={props.initialValues.eod_exit_minute ?? 30}
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
