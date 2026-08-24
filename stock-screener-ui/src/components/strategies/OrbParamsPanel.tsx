import { Stack, Box, Text, NumberInput, Tabs } from "@/ui";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface OrbParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
}

export function OrbParamsPanel({ initialValues, isSwing }: OrbParamsPanelProps) {
  return (
    <Tabs.Panel value="orb" className="strategy-form-tab-panel" data-testid="strategy-panel-orb">
      <Stack spacing={1} gap="sm" mt="sm" sx={{ gap: 1, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>OR Duration (min)</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="or_minutes"
              defaultValue={initialValues.or_minutes}
              min={1}
              max={60}
              suffix=" min"
              required
              description="Minutes used to calculate the opening range"
              data-testid="strategy-or-minutes-input"
            />
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Min Range</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="min_or_range_pct"
              defaultValue={initialValues.min_or_range_pct}
              min={0.1}
              max={5}
              step={0.1}
              suffix="% of price"
              description="Skip if opening range width is below this (stock too tight)"
              data-testid="strategy-min-or-range-input"
            />
          </Box>
        </Box>
        <SlTpRow
          slDefault={initialValues.sl_pct}
          tpDefault={initialValues.tp_pct}
          isSwing={isSwing}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Max Range</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="max_or_range_pct"
              defaultValue={initialValues.max_or_range_pct}
              min={0.1}
              max={10}
              step={0.1}
              suffix="% of price"
              description="Skip if opening range width is above this (stock too volatile)"
              data-testid="strategy-max-or-range-input"
            />
          </Box>
        </Box>
      </Stack>
    </Tabs.Panel>
  );
}
