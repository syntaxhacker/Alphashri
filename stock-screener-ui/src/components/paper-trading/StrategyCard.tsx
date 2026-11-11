import { memo, useMemo } from "react";
import { Badge, Text, Progress, Tooltip, Button } from "@/ui";
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
    <div className="paper-strategy-group border-t border-fin-border" data-testid={`strategy-card-${strategyName}`}>
      <div className="flex items-center gap-1.5 px-1.5 py-0.5 min-w-0 bg-fin-surface-alt">
        <Text size="xs" fw={600} className="truncate min-w-0">{strategyName}</Text>
        <Badge size="xs" variant="light" className="shrink-0">{summary.count}</Badge>
        <Text size="xs" c={getPnLTextColor(summary.totalPnl)} fw={600} className="whitespace-nowrap shrink-0">
          {formatSignedPnl(summary.totalPnl)}
        </Text>
        <div className="flex-1 min-w-[8px]" />
        <div className="flex items-center gap-1.5 shrink-0">
          <Progress
            value={capacityPct}
            size={4}
            w={60}
            color={capacityPct >= 100 ? "error" : "primary"}
            aria-label={`${summary.count} of ${maxCapacity} positions`}
          />
          <Text size="xs" c="dimmed" className="whitespace-nowrap">{summary.count}/{maxCapacity}</Text>
        </div>
        <Tooltip label="Close all in this strategy">
          <Button
            size="xs"
            variant="subtle"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              onCloseAll(positions);
            }}
            data-testid={`close-strategy-${strategyName}`}
            className="shrink-0 min-w-0 px-1"
          >
            <IconX size={12} />
          </Button>
        </Tooltip>
      </div>
      <PositionsTableBody positions={positions} onSelect={onSelectSymbol} onClose={onClosePosition} />
    </div>
  );
});
