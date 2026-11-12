import { createMemo } from "solid-js";
import { Badge, Text, Progress, Tooltip, Button } from "@/ui";
import { IconX } from "@/components/common/Icons";
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

export function StrategyCard(props: StrategyCardProps) {
  const summary = createMemo(() => calcSummary(props.positions));
  const capacityPct = () => Math.min(100, (summary().count / props.maxCapacity) * 100);

  return (
    <div class="paper-strategy-group border-t border-fin-border" data-testid={`strategy-card-${props.strategyName}`}>
      <div class="flex items-center gap-1.5 px-1.5 py-0.5 min-w-0 bg-fin-surface-alt">
        <Text size="xs" fw={600} class="truncate min-w-0">{props.strategyName}</Text>
        <Badge size="xs" variant="light" class="shrink-0">{summary().count}</Badge>
        <Text size="xs" c={getPnLTextColor(summary().totalPnl)} fw={600} class="whitespace-nowrap shrink-0 font-mono tabular-nums">
          {formatSignedPnl(summary().totalPnl)}
        </Text>
        <div class="flex-1 min-w-[8px]" />
        <div class="flex items-center gap-1.5 shrink-0">
          <Progress
            value={capacityPct()}
            size={4}
            w={60}
            color={capacityPct() >= 100 ? "error" : "primary"}
            aria-label={`${summary().count} of ${props.maxCapacity} positions`}
          />
          <Text size="xs" c="dimmed" class="whitespace-nowrap font-mono tabular-nums">{summary().count}/{props.maxCapacity}</Text>
        </div>
        <Tooltip label="Close all in this strategy">
          <Button
            size="xs"
            variant="subtle"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              props.onCloseAll(props.positions);
            }}
            data-testid={`close-strategy-${props.strategyName}`}
            class="shrink-0 min-w-0 px-1"
          >
            <IconX size={12} />
          </Button>
        </Tooltip>
      </div>
      <PositionsTableBody positions={props.positions} onSelect={props.onSelectSymbol} onClose={props.onClosePosition} />
    </div>
  );
}
