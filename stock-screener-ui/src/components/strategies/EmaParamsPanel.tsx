import { Stack, Box, Text, NumberInput, Tabs } from "@/ui";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface EmaParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
}

export function EmaParamsPanel(props: EmaParamsPanelProps) {
  return (
    <Tabs.Panel value="ema" keepMounted className="strategy-form-tab-panel" data-testid="strategy-panel-ema">
      <Stack spacing={1} gap="sm" mt="sm" className="p-2">
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Fast EMA Period</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="ema_fast_period"
              defaultValue={props.initialValues.ema_fast_period}
              min={3}
              max={50}
              required
              data-testid="strategy-ema-fast-period-input"
            />
          </Box>
        </Box>
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Slow EMA Period</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="ema_slow_period"
              defaultValue={props.initialValues.ema_slow_period}
              min={10}
              max={200}
              required
              data-testid="strategy-ema-slow-period-input"
            />
          </Box>
        </Box>
        <SlTpRow
          slDefault={props.initialValues.sl_pct}
          tpDefault={props.initialValues.tp_pct}
          isSwing={props.isSwing}
        />
      </Stack>
    </Tabs.Panel>
  );
}
