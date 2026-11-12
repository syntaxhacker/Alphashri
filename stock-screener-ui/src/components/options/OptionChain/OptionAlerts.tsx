import { Text, Badge } from "@/ui";
import { Box } from "@/ui";
import { IconBellRinging, IconBolt, IconWall, IconActivity } from "@/patterns/icons";
import { createMemo, Show, For } from "solid-js";
import * as palette from "@/ui/palette";
import { CompactPanel } from "../../common/compact";

interface OptionAlertsProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
}

export function OptionAlerts(props: OptionAlertsProps) {
  const alerts = createMemo(() => {
    const list: any[] = [];
    const spotPrice = props.spotPrice;
    if (!spotPrice) return list;

    props.strikeMatrix.forEach(({ strike, ce, pe }) => {
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

    return list.sort((a) => (a.type === "SQUEEZE" ? -1 : 1)).slice(0, 5);
  });

  return (
    <CompactPanel id="option-alerts" className="option-alerts-panel" data-testid="options-alerts-panel">
      <Box className="flex items-center justify-center gap-[8px] p-[8px] w-full alerts-header" data-testid="options-alerts-header">
        <Box className="flex items-center gap-[8px]">
          <Box
            className="inline-flex size-8 items-center justify-center rounded-md bg-amber-400/10 text-amber-400"
            aria-hidden="true"
          >
            <IconBellRinging size={18} />
          </Box>
          <Text fw={800} size="sm" style={{ letterSpacing: "0.5px" }}>
            LIVE SMART MONEY ALERTS
          </Text>
        </Box>
        <Badge variant="dot" color="success" size="sm" className="alerts-status-badge">
          Scanning Live
        </Badge>
      </Box>

      <Show
        when={alerts().length > 0}
        fallback={
          <Box className="py-[16px] flex items-center justify-center alerts-empty-state" data-testid="options-alerts-empty">
            <Text size="sm" className="text-fin-text-muted">
              Waiting for unusual activity patterns...
            </Text>
          </Box>
        }
      >
        <Box className="alerts-timeline" data-testid="options-alerts-timeline" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <For each={alerts()}>
            {(alert, i) => (
              <Box
                className="alert-item flex gap-3 relative min-h-[56px]"
                data-testid={`options-alert-item-${i()}`}
              >
                <Box className="flex flex-col items-center">
                  <Box
                    className="inline-flex size-7 items-center justify-center rounded-full border-2"
                    classList={{
                      "border-rose-500 text-rose-500": alert.color === "error",
                      "border-emerald-400 text-emerald-400": alert.color === "success",
                      "border-sky-400 text-sky-400": alert.color === "info",
                      "border-neutral-400 text-neutral-400": alert.color === "secondary",
                    }}
                    aria-hidden="true"
                  >
                    {alert.icon}
                  </Box>
                </Box>
                <Box className="flex-1 flex flex-col">
                  <Box className="flex items-center justify-between w-full">
                    <Text size="sm" fw={700}>{alert.title}</Text>
                    <Badge size="sm" color={alert.intensity === "Critical" ? "error" : "primary"}>{alert.intensity}</Badge>
                  </Box>
                  <Text size="sm" className="text-fin-text-muted" style={{ marginTop: "8px" }}>
                    {alert.description}
                  </Text>
                </Box>
              </Box>
            )}
          </For>
        </Box>
      </Show>

      <Box
        className="alerts-profit-tip"
        data-testid="options-alerts-profit-tip"
        style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${palette.BORDER}` }}
      >
        <Text size="sm" fw={600} className="text-fin-primary">
          💡 HOW TO PROFIT: When a "Squeeze" alert appears near the spot price, consider a quick bullish trade. When a "Wall" appears, expect the price to reverse from that strike.
        </Text>
      </Box>
    </CompactPanel>
  );
}
