import { Show } from "solid-js";
import { Stack, Box, NumberInput, Text, Divider, Tabs } from "@/ui";
import { IconInfoCircle } from "../common/Icons";
import type { StrategyFormData } from "./types";

interface RiskManagementPanelProps {
  initialValues: StrategyFormData;
  isIntraday: boolean;
}

export function RiskManagementPanel(props: RiskManagementPanelProps) {
  return (
    <Tabs.Panel value="risk" keepMounted className="strategy-form-tab-panel" data-testid="strategy-panel-risk">
      <Stack spacing={1} gap="sm" mt="sm" className="p-2">
        <Box className="flex items-center justify-center p-2">
          <Text size="xs" c="dimmed" ta="center" style={{ lineHeight: 1.5 }}>
            These limits apply to the capital allocated to this strategy from the bot. Example: if bot
            allocates ₹5Lac to this strategy, a 1% risk = max loss ₹5,000 per trade.
          </Text>
        </Box>

        <Divider label="Per-Trade Sizing" labelPosition="left" />

        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Risk Per Trade %</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="risk_per_trade_pct"
              defaultValue={props.initialValues.risk_per_trade_pct}
              min={0.1}
              max={10}
              step={0.1}
              suffix="%"
              description="Max loss per trade as % of allocated capital"
              data-testid="strategy-risk-per-trade-input"
            />
          </Box>
        </Box>
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Max Position Size %</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="max_capital_per_trade_pct"
              defaultValue={props.initialValues.max_capital_per_trade_pct}
              min={1}
              max={100}
              suffix="%"
              description="Max position value as % of allocated capital"
              data-testid="strategy-capital-per-trade-input"
            />
          </Box>
        </Box>

        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Min Trade Value</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="min_trade_value"
              defaultValue={props.initialValues.min_trade_value}
              min={1000}
              max={100000}
              step={1000}
              prefix="₹"
              description="Skip trades below this value"
              data-testid="strategy-min-trade-value-input"
            />
          </Box>
        </Box>
        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Max Trade Value</Text>
          <Box className="flex-1 flex items-center">
            <NumberInput
              size="sm"
              name="max_trade_value"
              defaultValue={props.initialValues.max_trade_value}
              min={5000}
              max={500000}
              step={5000}
              prefix="₹"
              description="Skip trades above this value"
              data-testid="strategy-max-trade-value-input"
            />
          </Box>
        </Box>

        <Divider label="Cooldown" labelPosition="left" />

        <Box className="flex items-center gap-2 p-2">
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">{props.isIntraday ? "Cooldown Minutes" : "Cooldown Days"}</Text>
          <Box className="flex-1 flex items-center">
            <Show
              when={props.isIntraday}
              fallback={
                <NumberInput
                  size="sm"
                  name="cooldown_days"
                  defaultValue={props.initialValues.cooldown_days}
                  min={1}
                  max={90}
                  suffix=" days"
                  description="Wait time between trades"
                  data-testid="strategy-cooldown-input"
                />
              }
            >
              <NumberInput
                size="sm"
                name="cooldown_minutes"
                defaultValue={props.initialValues.cooldown_minutes}
                min={1}
                max={240}
                suffix=" min"
                description="Wait time between trades"
                data-testid="strategy-cooldown-input"
              />
            </Show>
          </Box>
        </Box>

        <Box className="flex items-center justify-center gap-2 p-2" mt="sm">
          <Text size="xs" c="dimmed" fs="italic" ta="center">
            <IconInfoCircle size={12} className="align-middle mr-1" />
            Max Daily Loss % and Max Total Exposure % are configured at the bot level (Bot Settings).
          </Text>
        </Box>
      </Stack>
    </Tabs.Panel>
  );
}
