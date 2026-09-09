import { Stack, Box, NumberInput, Text, Divider, Tabs } from "@/ui";
import { IconInfoCircle } from "@tabler/icons-react";
import type { StrategyFormData } from "./types";

interface RiskManagementPanelProps {
  initialValues: StrategyFormData;
  isIntraday: boolean;
}

export function RiskManagementPanel({ initialValues, isIntraday }: RiskManagementPanelProps) {
  return (
    <Tabs.Panel value="risk" className="strategy-form-tab-panel" data-testid="strategy-panel-risk">
      <Stack spacing={1} gap="sm" mt="sm" sx={{ gap: 1, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
          <Text size="xs" c="dimmed" ta="center" style={{ lineHeight: 1.5 }}>
            These limits apply to the capital allocated to this strategy from the bot. Example: if bot
            allocates ₹5Lac to this strategy, a 1% risk = max loss ₹5,000 per trade.
          </Text>
        </Box>

        <Divider label="Per-Trade Sizing" labelPosition="left" />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Risk Per Trade %</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Max Position Size %</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
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

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Min Trade Value</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Max Trade Value</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
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

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>{isIntraday ? "Cooldown Minutes" : "Cooldown Days"}</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
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

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, mt: 1 }}>
          <Text size="xs" c="dimmed" fs="italic" ta="center">
            <IconInfoCircle size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            Max Daily Loss % and Max Total Exposure % are configured at the bot level (Bot Settings).
          </Text>
        </Box>
      </Stack>
    </Tabs.Panel>
  );
}
