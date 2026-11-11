import { Stack, Box, Text, Select, NumberInput, Tabs } from "@/ui";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface SrBreakoutParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
}

export function SrBreakoutParamsPanel({ initialValues, isSwing }: SrBreakoutParamsPanelProps) {
  return (
    <Tabs.Panel value="sr" keepMounted className="strategy-form-tab-panel" data-testid="strategy-panel-sr">
      <Stack spacing={1} gap="sm" mt="sm" className="p-2">
        <SlTpRow
          slDefault={initialValues.sl_pct}
          tpDefault={initialValues.tp_pct}
          isSwing={isSwing}
        />
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Pivot Type</Text>
          <Box className="flex-1 flex items-center">
            <Select
              size="sm"
              name="pivot_type"
              data={[
                { value: "classic", label: "Classic" },
                { value: "fibonacci", label: "Fibonacci" },
                { value: "camarilla", label: "Camarilla" },
              ]}
              defaultValue={initialValues.pivot_type}
              required
              data-testid="strategy-pivot-type-input"
            />
          </Box>
        </Box>
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Breakout Buffer %</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="breakout_buffer_pct"
              defaultValue={initialValues.breakout_buffer_pct}
              min={0}
              max={1}
              step={0.05}
              suffix="%"
              data-testid="strategy-breakout-buffer-input"
            />
          </Box>
        </Box>
      </Stack>
    </Tabs.Panel>
  );
}
