import { Badge, Box, Paper, Text } from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import { SymbolAvatar } from "../../components/screener/SymbolAvatar";
import { Sparkline } from "../../components/screener/Sparkline";
import type { DailyMoveRow, DailyMovesPanelId } from "../../types/report";
import { formatCurrency, formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";

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
      role={onOpenSymbol ? "button" : undefined}
      tabIndex={onOpenSymbol ? 0 : undefined}
      onClick={onOpenSymbol ? () => onOpenSymbol(row.symbol) : undefined}
      onKeyDown={
        onOpenSymbol
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenSymbol(row.symbol);
              }
            }
          : undefined
      }
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        minWidth: 0,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
        cursor: onOpenSymbol ? "pointer" : "default",
        fontVariantNumeric: "tabular-nums",
        "&:hover": onOpenSymbol ? { bgcolor: "action.hover" } : {},
      }}
    >
      <SymbolAvatar symbol={row.symbol} name={row.name} logo={row.logo} size={20} />
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0 }}>
        <Text size="xs" fw={700} truncate span title={row.symbol}>
          {row.symbol}
        </Text>
        {row.sub_value || row.sub_label ? (
          <Text size="xs" c="dimmed" truncate span title={row.sub_label}>
            {row.sub_value || row.sub_label}
          </Text>
        ) : null}
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
        <Text size="xs" ta="right" span sx={{ fontVariantNumeric: "tabular-nums" }}>
          {formatCurrency(row.close, 2)}
        </Text>
        <Text size="xs" c={getPnLTextColor(row.change)} ta="right" span sx={{ fontVariantNumeric: "tabular-nums" }}>
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
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          sm: "repeat(2, minmax(0, 1fr))",
          md: "repeat(3, minmax(0, 1fr))",
          lg: "repeat(4, minmax(0, 1fr))",
        },
        gap: 1,
        minWidth: 0,
        width: "100%",
      }}
    >
      {MOVE_PANELS.map((panel) => {
        const rows = moves?.[panel.id] ?? [];
        return (
          <Paper
            key={panel.id}
            data-testid={`report-moves-${panel.id}`}
            sx={{
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              border: 1,
              borderColor: BORDER,
              borderRadius: 2,
              bgcolor: SURFACE,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1,
                pt: 1,
                minWidth: 0,
              }}
            >
              <Text size="xs" fw={600} truncate span sx={{ flex: 1, minWidth: 0 }} data-testid={`report-moves-${panel.id}-title`}>
                {panel.title}
              </Text>
              <Badge size="xs" data-testid={`report-moves-${panel.id}-count`}>
                {rows.length}
              </Badge>
            </Box>
            {rows.length === 0 ? (
              <Box sx={{ px: 1, py: 1 }} data-testid={`report-moves-${panel.id}-empty`}>
                <Text size="xs" c="dimmed">
                  No stocks qualify
                </Text>
              </Box>
            ) : (
              <Box sx={{ px: 1 }} data-testid={`report-moves-${panel.id}-rows`}>
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
