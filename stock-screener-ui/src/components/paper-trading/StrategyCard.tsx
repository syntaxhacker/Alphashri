import { useMemo } from "react";
import { Badge, Text, Group, Progress, Tooltip, Button, Collapse } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { CompactPanel } from "../common/compact";
import { PositionsTableBody } from "./PositionsHelpers";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";

interface StrategyCardProps {
  strategyName: string;
  positions: PaperPosition[];
  maxCapacity: number;
  isExpanded: boolean;
  onToggle: () => void;
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

export function StrategyCard({
  strategyName,
  positions,
  maxCapacity,
  isExpanded,
  onToggle,
  onSelectSymbol,
  onClosePosition,
  onCloseAll,
}: StrategyCardProps) {
  const summary = useMemo(() => calcSummary(positions), [positions]);
  const capacityPct = Math.min(100, (summary.count / maxCapacity) * 100);

  return (
    <CompactPanel testId={`strategy-card-${strategyName}`} scrollable={false}>
      <Group
        justify="space-between"
        mb={2}
        onClick={onToggle}
        style={{ cursor: "pointer" }}
      >
        <Group gap="xs" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed">{isExpanded ? "▼" : "▶"}</Text>
          <Text size="sm" fw={600}>{strategyName}</Text>
          <Badge size="xs">{summary.count}</Badge>
          <Text size="xs" c={getPnLTextColor(summary.totalPnl)} fw={600}>
            {summary.totalPnl >= 0 ? "+" : ""}₹{formatNumber(summary.totalPnl)}
          </Text>
          <Progress
            value={capacityPct}
            size="xs"
            w={60}
            color={capacityPct >= 100 ? "red" : "blue"}
            aria-label={`${summary.count} of ${maxCapacity} positions`}
          />
          <Text size="xs" c="dimmed">{summary.count}/{maxCapacity}</Text>
        </Group>
        <Tooltip label="Close all in this strategy">
          <Button
            size="compact-xs"
            variant="light"
            color="red"
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
      </Group>
      <Collapse in={isExpanded}>
        <PositionsTableBody positions={positions} onSelect={onSelectSymbol} onClose={onClosePosition} />
      </Collapse>
    </CompactPanel>
  );
}
