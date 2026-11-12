import { Stack, Box, NumberInput, Text, Divider, Tabs } from "@/ui";
import { IconInfoCircle } from "@tabler/icons-react";
import type { StrategyFormData } from "./types";

interface RiskManagementPanelProps {
  initialValues: StrategyFormData;
  isIntraday: boolean;
}

export function RiskManagementPanel({ initialValues, isIntraday }: RiskManagementPanelProps) {
  return (
    <Tabs.Panel value="risk" keepMounted className="strategy-form-tab-panel" data-testid="strategy-panel-risk">
      <Stack spacing={1} gap="sm" mt="sm" className="p-2">
        <Box className="flex items-center justify-center p-2">
          <Text size="xs" c="dimmed" ta="center" style={{ "line-height": 1.5 }}>
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
              defaultValue={initialValues.risk_per_trade_pct}
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
              defaultValue={initialValues.max_capital_per_trade_pct}
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
              defaultValue={initialValues.min_trade_value}
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
              defaultValue={initialValues.max_trade_value}
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
          <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">{isIntraday ? "Cooldown Minutes" : "Cooldown Days"}</Text>
          <Box className="flex-1 flex items-center">
            {isIntraday ? (
              <NumberInput
                size="sm"
                name="cooldown_minutes"
                defaultValue={initialValues.cooldown_minutes}
                min={1}
                max={240}
                suffix=" min"
                description="Wait time between trades"
                data-testid="strategy-cooldown-input"
              />
            ) : (
              <NumberInput
                size="sm"
                name="cooldown_days"
                defaultValue={initialValues.cooldown_days}
                min={1}
                max={90}
                suffix=" days"
                description="Wait time between trades"
                data-testid="strategy-cooldown-input"
              />
            )}
          </Box>
        </Box>

        <Box className="flex items-center justify-center gap-2 p-2" mt="sm">
          <Text size="xs" c="dimmed" fs="italic" ta="center">
            <IconInfoCircle size={12} style={{ "vertical-align": "middle", "margin-right": 4 }} />
            Max Daily Loss % and Max Total Exposure % are configured at the bot level (Bot Settings).
          </Text>
        </Box>
      </Stack>
    </Tabs.Panel>
  );
}
