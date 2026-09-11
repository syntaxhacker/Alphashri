import { memo, useMemo } from "react";
import { Badge, Text, Progress, Tooltip, Button } from "@/ui";
import Box from "@mui/material/Box";
import { IconX } from "@tabler/icons-react";
import { PositionsTableBody } from "./PositionsHelpers";
import type { PaperPosition } from "../../types/paperTrading";
import { formatSignedPnl, getPnLTextColor } from "../../utils/ui-helpers";

interface StrategyCardProps {
  strategyName: string;
  positions: PaperPosition[];
  maxCapacity: number;
  onSelectSymbol: (
    symbol: string,
    tradeId?: string,
    strategyName?: string,
    strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => void;
  onClosePosition: (symbol: string, price: number) => void;
  onCloseAll: (positions: PaperPosition[]) => void;
}

function calcSummary(positions: PaperPosition[]) {
  let totalPnl = 0;
  for (const p of positions) totalPnl += p.pnl || 0;
  return { totalPnl, count: positions.length };
}

export const StrategyCard = memo(function StrategyCard({
  strategyName,
  positions,
  maxCapacity,
  onSelectSymbol,
  onClosePosition,
  onCloseAll,
}: StrategyCardProps) {
  const summary = useMemo(() => calcSummary(positions), [positions]);
  const capacityPct = Math.min(100, (summary.count / maxCapacity) * 100);

  return (
    <Box
      className="paper-strategy-group"
      data-testid={`strategy-card-${strategyName}`}
      sx={{ borderTop: 1, borderColor: "divider", "&:first-of-type": { borderTop: 0 } }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.5,
          minWidth: 0,
          bgcolor: "action.hover",
        }}
      >
        <Text size="xs" fw={600} truncate sx={{ minWidth: 0, flexShrink: 1 }}>{strategyName}</Text>
        <Badge size="xs" variant="light" sx={{ flexShrink: 0 }}>{summary.count}</Badge>
        <Text size="xs" c={getPnLTextColor(summary.totalPnl)} fw={600} sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>
          {formatSignedPnl(summary.totalPnl)}
        </Text>
        <Box sx={{ flex: 1, minWidth: 8 }} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
          <Progress
            value={capacityPct}
            size={4}
            w={60}
            color={capacityPct >= 100 ? "error" : "primary"}
            aria-label={`${summary.count} of ${maxCapacity} positions`}
          />
          <Text size="xs" c="dimmed" sx={{ whiteSpace: "nowrap" }}>{summary.count}/{maxCapacity}</Text>
        </Box>
        <Tooltip label="Close all in this strategy">
          <Button
            size="compact-xs"
            variant="subtle"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              onCloseAll(positions);
            }}
            data-testid={`close-strategy-${strategyName}`}
            sx={{ flexShrink: 0, minWidth: 0, px: 0.5 }}
          >
            <IconX size={12} />
          </Button>
        </Tooltip>
      </Box>
      <PositionsTableBody positions={positions} onSelect={onSelectSymbol} onClose={onClosePosition} />
    </Box>
  );
});
