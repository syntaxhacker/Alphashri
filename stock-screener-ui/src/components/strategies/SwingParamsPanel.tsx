import { Stack, Box, Text, NumberInput, Switch, Tabs } from "@/ui";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface SwingParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
  is52wChaser: boolean;
}

export function SwingParamsPanel({ initialValues, isSwing, is52wChaser }: SwingParamsPanelProps) {
  return (
    <Tabs.Panel value="52w" className="strategy-form-tab-panel" data-testid="strategy-panel-52w">
      <Stack spacing={1} gap="sm" mt="sm" sx={{ gap: 1, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Entry Threshold %</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="entry_threshold_pct"
              defaultValue={initialValues.entry_threshold_pct}
              min={0.5}
              max={10}
              step={0.5}
              suffix="%"
              required
              data-testid="strategy-entry-threshold-input"
            />
          </Box>
        </Box>
        <SlTpRow
          slDefault={initialValues.sl_pct}
          tpDefault={initialValues.tp_pct}
          isSwing={isSwing}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Trailing Stop %</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="trailing_stop_pct"
              defaultValue={initialValues.trailing_stop_pct}
              min={0.1}
              max={10}
              step={0.1}
              suffix="%"
              data-testid="strategy-trailing-stop-input"
            />
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Max Holding Days</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="max_holding_days"
              defaultValue={initialValues.max_holding_days}
              min={1}
              max={90}
              suffix=" days"
              data-testid="strategy-max-holding-input"
            />
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Cooldown Days</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <NumberInput
              size="sm"
              name="cooldown_days"
              defaultValue={initialValues.cooldown_days}
              min={1}
              max={90}
              suffix=" days"
              data-testid="strategy-cooldown-days-input"
            />
          </Box>
        </Box>
        {is52wChaser && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
              <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Enable Trailing Stop</Text>
              <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
                <Switch
                  label=""
                  name="enable_trailing_stop"
                  defaultChecked={initialValues.enable_trailing_stop}
                  data-testid="strategy-enable-trailing-input"
                />
              </Box>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
              <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Enable Filters</Text>
              <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
                <Switch
                  label="ADX/RSI/Volume/MA"
                  name="enable_filters"
                  defaultChecked={initialValues.enable_filters}
                  data-testid="strategy-enable-filters-input"
                />
              </Box>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
              <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Trailing Activation %</Text>
              <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
                <NumberInput
                  size="sm"
                  name="trailing_activation_pct"
                  defaultValue={initialValues.trailing_activation_pct}
                  min={0.1}
                  max={10}
                  step={0.1}
                  suffix="%"
                  data-testid="strategy-trailing-activation-input"
                />
              </Box>
            </Box>
          </>
        )}
      </Stack>
    </Tabs.Panel>
  );
}
