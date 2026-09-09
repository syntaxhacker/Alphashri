import { Stack, Box, Text, NumberInput, Tabs } from "@/ui";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface EmaParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
}

export function EmaParamsPanel({ initialValues, isSwing }: EmaParamsPanelProps) {
  return (
    <Tabs.Panel value="ema" className="strategy-form-tab-panel" data-testid="strategy-panel-ema">
      <Stack spacing={1} gap="sm" mt="sm" sx={{ gap: 1, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Fast EMA Period</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="ema_fast_period"
              defaultValue={initialValues.ema_fast_period}
              min={3}
              max={50}
              required
              data-testid="strategy-ema-fast-period-input"
            />
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Slow EMA Period</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="ema_slow_period"
              defaultValue={initialValues.ema_slow_period}
              min={10}
              max={200}
              required
              data-testid="strategy-ema-slow-period-input"
            />
          </Box>
        </Box>
        <SlTpRow
          slDefault={initialValues.sl_pct}
          tpDefault={initialValues.tp_pct}
          isSwing={isSwing}
        />
      </Stack>
    </Tabs.Panel>
  );
}
