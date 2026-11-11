import { Badge, Box, Paper, Text } from "@/ui";
import { SymbolAvatar } from "../../components/screener/SymbolAvatar";
import { Sparkline } from "../../components/screener/Sparkline";
import type { DailyMoveRow, DailyMovesPanelId } from "../../types/report";
import { formatCurrency, formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";
import { symbolRowCursor, symbolRowProps } from "../../components/common/symbolRowProps";

const MOVE_PANELS: Array<{ id: DailyMovesPanelId; title: string }> = [
  { id: "gainers", title: "Top gainers" },
  { id: "losers", title: "Top losers" },
  { id: "volume_surge", title: "Volume surge" },
  { id: "gap_up", title: "Gap up" },
  { id: "gap_down", title: "Gap down" },
  { id: "range_expansion", title: "Range expansion" },
  { id: "new_52w_high", title: "New 52W high" },
  { id: "new_52w_low", title: "New 52W low" },
  { id: "turnover", title: "Turnover" },
];

function MoveRow({ row, onOpenSymbol }: { row: DailyMoveRow; onOpenSymbol?: (symbol: string) => void }) {
  return (
    <Box
      data-testid={`report-move-row-${row.symbol}`}
      data-symbol={row.symbol}
      {...symbolRowProps(onOpenSymbol, row.symbol)}
      className={`flex items-center gap-2 min-w-0 py-1 border-b border-fin-border tabular-nums ${onOpenSymbol ? "hover:bg-fin-surface-alt" : ""}`}
      style={{ cursor: symbolRowCursor(onOpenSymbol) }}
    >
      <SymbolAvatar symbol={row.symbol} name={row.name} logo={row.logo} size={20} />
      <Box className="flex-1 min-w-0 flex flex-col gap-0">
        <Text size="xs" fw={700} truncate span title={row.symbol}>
          {row.symbol}
        </Text>
        {row.sub_value || row.sub_label ? (
          <Text size="xs" c="dimmed" truncate span title={row.sub_label}>
            {row.sub_value || row.sub_label}
          </Text>
        ) : null}
      </Box>
      <Box className="flex flex-col items-end shrink-0">
        <Text size="xs" ta="right" span className="tabular-nums">
          {formatCurrency(row.close, 2)}
        </Text>
        <Text size="xs" c={getPnLTextColor(row.change)} ta="right" span className="tabular-nums">
          {formatPercentage(row.change)}
        </Text>
      </Box>
      <Sparkline data={row.spark ?? []} change={row.change} width={64} height={20} />
    </Box>
  );
}

interface ReportMovePanelsProps {
  moves: Partial<Record<DailyMovesPanelId, DailyMoveRow[]>> | null;
  onOpenSymbol?: (symbol: string) => void;
}

export function ReportMovePanels({ moves, onOpenSymbol }: ReportMovePanelsProps) {
  return (
    <Box
      className="grid grid-cols-1 min-[600px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1200px]:grid-cols-4 gap-2 min-w-0 w-full"
    >
      {MOVE_PANELS.map((panel) => {
        const rows = moves?.[panel.id] ?? [];
        return (
          <Paper
            key={panel.id}
            data-testid={`report-moves-${panel.id}`}
            className="min-w-0 min-h-0 flex flex-col overflow-hidden border border-fin-border rounded-[2px] bg-fin-surface"
          >
            <Box className="flex items-center gap-2 px-2 pt-2 min-w-0">
              <Text size="xs" fw={600} truncate span className="flex-1 min-w-0" data-testid={`report-moves-${panel.id}-title`}>
                {panel.title}
              </Text>
              <Badge size="xs" data-testid={`report-moves-${panel.id}-count`}>
                {rows.length}
              </Badge>
            </Box>
            {rows.length === 0 ? (
              <Box className="px-2 py-2" data-testid={`report-moves-${panel.id}-empty`}>
                <Text size="xs" c="dimmed">
                  No stocks qualify
                </Text>
              </Box>
            ) : (
              <Box className="px-2" data-testid={`report-moves-${panel.id}-rows`}>
                {rows.map((row) => (
                  <MoveRow key={row.symbol} row={row} onOpenSymbol={onOpenSymbol} />
                ))}
              </Box>
            )}
          </Paper>
        );
      })}
    </Box>
  );
}
