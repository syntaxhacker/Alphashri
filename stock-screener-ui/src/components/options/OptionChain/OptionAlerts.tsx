import { Text, Badge, ThemeIcon, Timeline, TimelineItem } from "@/ui";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
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
            color: type === "CE" ? "error" : "success",
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
            color: "info",
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
            color: "secondary",
          });
        }
      });
    });

    return list.sort((_a, _b) => (_a.type === "SQUEEZE" ? -1 : 1)).slice(0, 5);
  }, [strikeMatrix, spotPrice]);

  return (
    <CompactPanel id="option-alerts" className="option-alerts-panel" data-testid="options-alerts-panel">
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }} className="alerts-header" data-testid="options-alerts-header">
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ThemeIcon color="warning" variant="light">
            <IconBellRinging size={18} />
          </ThemeIcon>
          <Text fw={800} size="sm" style={{ letterSpacing: "0.5px" }}>
            LIVE SMART MONEY ALERTS
          </Text>
        </Box>
        <Badge variant="dot" color="success" size="sm" className="alerts-status-badge">
          Scanning Live
        </Badge>
      </Box>

      {alerts.length === 0 ? (
        <Box sx={{ py: 2, display: "flex", alignItems: "center", justifyContent: "center" }} className="alerts-empty-state" data-testid="options-alerts-empty">
          <Text size="sm" c="dimmed">
            Waiting for unusual activity patterns...
          </Text>
        </Box>
      ) : (
        <Timeline active={0} bulletSize={24} lineWidth={2} className="alerts-timeline" data-testid="options-alerts-timeline">
          {alerts.map((alert, i) => (
            <TimelineItem key={i} bullet={alert.icon} color={alert.color} className="alert-item" data-testid={`options-alert-item-${i}`} title={
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <Text size="sm" fw={700}>{alert.title}</Text>
                  <Badge size="sm" color={alert.intensity === "Critical" ? "error" : "primary"}>{alert.intensity}</Badge>
                </Box>
              }>
              <Text size="sm" c="dimmed" mt={4}>
                {alert.description}
              </Text>
            </TimelineItem>
          ))}
        </Timeline>
      )}

      <Box sx={{ mt: 1 }}>
        <CompactPanel p="xs" className="alerts-profit-tip" data-testid="options-alerts-profit-tip">
          <Text size="sm" fw={600} c="primary">
            💡 HOW TO PROFIT: When a "Squeeze" alert appears near the spot price, consider a quick bullish trade. When a "Wall" appears, expect the price to reverse from that strike.
          </Text>
        </CompactPanel>
      </Box>
    </CompactPanel>
  );
}
