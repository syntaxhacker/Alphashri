import { Box, Group, Text, Badge, ThemeIcon, Timeline, TimelineItem } from "@/ui";
import { IconBellRinging, IconBolt, IconWall, IconActivity } from "@tabler/icons-react";
import { useMemo } from "react";
import { CompactPanel } from "../../common/compact";

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

    return list.sort((_a, _b) => (_a.type === "SQUEEZE" ? -1 : 1)).slice(0, 5);
  }, [strikeMatrix, spotPrice]);

  return (
    <CompactPanel
      id="option-alerts"
      className="option-alerts-panel"
      data-testid="options-alerts-panel"
    >
      <Group
        justify="space-between"
        mb="md"
        className="alerts-header"
        data-testid="options-alerts-header"
      >
        <Group gap="xs">
          <ThemeIcon color="orange" variant="light">
            <IconBellRinging size={18} />
          </ThemeIcon>
          <Text fw={800} size="sm" style={{ letterSpacing: "0.5px" }}>
            LIVE SMART MONEY ALERTS
          </Text>
        </Group>
        <Badge variant="dot" color="green" size="sm" className="alerts-status-badge">
          Scanning Live
        </Badge>
      </Group>

      {alerts.length === 0 ? (
        <Box py="lg" ta="center" className="alerts-empty-state" data-testid="options-alerts-empty">
          <Text size="sm" c="dimmed">
            Waiting for unusual activity patterns...
          </Text>
        </Box>
      ) : (
        <Timeline
          active={0}
          bulletSize={24}
          lineWidth={2}
          className="alerts-timeline"
          data-testid="options-alerts-timeline"
        >
          {alerts.map((alert, i) => (
            <TimelineItem
              key={i}
              bullet={alert.icon}
              color={alert.color}
              className="alert-item"
              data-testid={`options-alert-item-${i}`}
              title={
                <Group justify="space-between">
                  <Text size="sm" fw={700}>
                    {alert.title}
                  </Text>
                  <Badge size="sm" color={alert.intensity === "Critical" ? "red" : "blue"}>
                    {alert.intensity}
                  </Badge>
                </Group>
              }
            >
              <Text size="sm" c="dimmed" mt={4}>
                {alert.description}
              </Text>
            </TimelineItem>
          ))}
        </Timeline>
      )}

      <CompactPanel mt="md" p="xs" className="alerts-profit-tip" data-testid="options-alerts-profit-tip">
        <Text size="sm" fw={600} c="blue.7">
          💡 HOW TO PROFIT: When a "Squeeze" alert appears near the spot price, consider a quick
          bullish trade. When a "Wall" appears, expect the price to reverse from that strike.
        </Text>
      </CompactPanel>
    </CompactPanel>
  );
}
