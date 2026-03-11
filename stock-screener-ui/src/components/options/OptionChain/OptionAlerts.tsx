import {
  Box,
  Group,
  Paper,
  Text,
  Stack,
  Badge,
  ThemeIcon,
  Timeline,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconBellRinging,
  IconTrendingUp,
  IconTrendingDown,
  IconBolt,
  IconWall,
  IconActivity,
} from "@tabler/icons-react";
import { useMemo } from "react";

interface OptionAlertsProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
}

export function OptionAlerts({ strikeMatrix, spotPrice }: OptionAlertsProps) {
  const alerts = useMemo(() => {
    const list: any[] = [];
    if (!spotPrice) return list;

    strikeMatrix.forEach(({ strike, ce, pe }) => {
      [ce, pe].forEach((opt, idx) => {
        if (!opt) return;
        const type = idx === 0 ? "CE" : "PE";
        const m = opt.market_data;
        const g = opt.option_greeks;

        const oi = m?.oi ?? 0;
        const prevOi = m?.prev_oi ?? 0;
        const change = oi - prevOi;
        const changePct = prevOi > 0 ? (change / prevOi) * 100 : 0;
        const volume = m?.volume ?? 0;
        const ltp = m?.ltp ?? 0;

        // 1. Detection: Huge OI Addition (The Wall)
        if (changePct > 40 && change > 50000) {
          list.push({
            type: "WALL",
            title: `New ${type} Wall at ${strike}`,
            description: `Aggressive building! Added ${Math.round(changePct)}% (${(change / 1000).toFixed(1)}k) new contracts. Professional sellers are defending this strike.`,
            intensity: "High",
            icon: <IconWall size={16} />,
            color: type === "CE" ? "red" : "green",
          });
        }

        // 2. Detection: Potential Short Squeeze (Panicking Sellers)
        const priceUp = ltp > (m?.bid_price || ltp);
        if (priceUp && change < -20000 && type === "CE" && strike > spotPrice) {
          list.push({
            type: "SQUEEZE",
            title: `Call Squeeze Alert: ${strike}`,
            description: `Exited ${Math.abs(Math.round(changePct))}% (${(Math.abs(change) / 1000).toFixed(1)}k) contracts while price is rising. Sellers are running for cover!`,
            intensity: "Critical",
            icon: <IconBolt size={16} />,
            color: "cyan",
          });
        }

        // 3. Detection: Aggressive Buying (Volume/OI Spike)
        if (volume > 100000 && changePct > 20) {
          list.push({
            type: "VOL_SPIKE",
            title: `Aggressive ${type} Entry`,
            description: `High Volume (${(volume / 1000).toFixed(1)}k) with ${Math.round(changePct)}% OI addition. Fresh directional bets are being placed.`,
            intensity: "Medium",
            icon: <IconActivity size={16} />,
            color: "indigo",
          });
        }
      });
    });

    return list.sort((a, b) => (a.type === "SQUEEZE" ? -1 : 1)).slice(0, 5);
  }, [strikeMatrix, spotPrice]);

  return (
    <Paper
      p="md"
      withBorder
      radius="md"
      style={{ background: "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))" }}
    >
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <ThemeIcon color="orange" variant="light">
            <IconBellRinging size={18} />
          </ThemeIcon>
          <Text fw={800} size="sm" style={{ letterSpacing: "0.5px" }}>
            LIVE SMART MONEY ALERTS
          </Text>
        </Group>
        <Badge variant="dot" color="green" size="sm">
          Scanning Live
        </Badge>
      </Group>

      {alerts.length === 0 ? (
        <Box py="xl" style={{ textAlign: "center" }}>
          <Text size="xs" c="dimmed">
            Waiting for unusual activity patterns...
          </Text>
        </Box>
      ) : (
        <Timeline active={0} bulletSize={24} lineWidth={2}>
          {alerts.map((alert, i) => (
            <Timeline.Item
              key={i}
              bullet={alert.icon}
              color={alert.color}
              title={
                <Group justify="space-between">
                  <Text size="sm" fw={700}>
                    {alert.title}
                  </Text>
                  <Badge size="xs" color={alert.intensity === "Critical" ? "red" : "blue"}>
                    {alert.intensity}
                  </Badge>
                </Group>
              }
            >
              <Text size="xs" c="dimmed" mt={4}>
                {alert.description}
              </Text>
            </Timeline.Item>
          ))}
        </Timeline>
      )}

      <Paper
        mt="md"
        p="xs"
        bg="light-dark(blue.0, dark.6)"
        radius="xs"
        style={{ border: "1px dashed var(--mantine-color-blue-4)" }}
      >
        <Text size="xs" fw={600} c="blue.7">
          💡 HOW TO PROFIT: When a "Squeeze" alert appears near the spot price, consider a quick
          bullish trade. When a "Wall" appears, expect the price to reverse from that strike.
        </Text>
      </Paper>
    </Paper>
  );
}
