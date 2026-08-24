import { memo, useMemo } from "react";
import { Badge, Text, Progress, Tooltip, Button } from "@/ui";
import Box from "@mui/material/Box";
import { IconX } from "@tabler/icons-react";
import { CompactPanel } from "../common/compact";
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
    <CompactPanel testId={`strategy-card-${strategyName}`} scrollable={false}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, flexWrap: "wrap" }}>
          <Text size="sm" fw={600}>{strategyName}</Text>
          <Badge size="xs">{summary.count}</Badge>
          <Text size="xs" c={getPnLTextColor(summary.totalPnl)} fw={600}>
            {formatSignedPnl(summary.totalPnl)}
          </Text>
          <Progress
            value={capacityPct}
            size="xs"
            w={60}
            color={capacityPct >= 100 ? "error" : "primary"}
            aria-label={`${summary.count} of ${maxCapacity} positions`}
          />
          <Text size="xs" c="dimmed">{summary.count}/{maxCapacity}</Text>
        </Box>
        <Tooltip label="Close all in this strategy">
          <Button
            size="compact-xs"
            variant="light"
            color="error"
            leftSection={<IconX size={12} />}
            onClick={(e) => {
              e.stopPropagation();
              onCloseAll(positions);
            }}
            data-testid={`close-strategy-${strategyName}`}
          >
            Close All
          </Button>
        </Tooltip>
      </Box>
      <PositionsTableBody positions={positions} onSelect={onSelectSymbol} onClose={onClosePosition} />
    </CompactPanel>
  );
});
