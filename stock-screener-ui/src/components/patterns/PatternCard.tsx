import { ActionIcon, Box, Card, Text, ToolbarRow, Tooltip } from "@/ui";
import { IconArrowsMaximize } from "@tabler/icons-react";
import { formatCurrency, formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternMiniChart } from "./PatternMiniChart";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";

export interface PatternCardProps {
  hit: PatternHitDTO;
  selected?: boolean;
  onClick?: (hit: PatternHitDTO) => void;
  onExpand?: (hit: PatternHitDTO) => void;
}

function price(value: number | null | undefined): string {
  return value == null ? "—" : formatCurrency(value, 2);
}

function Level({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Text size="xs" c="dimmed" style={{ textTransform: "uppercase" }} fw={700} truncate>
        {label}
      </Text>
      <Text size="sm" fw={600} truncate>
        {value}
      </Text>
    </Box>
  );
}

/** One pattern result card in the grid. */
export function PatternCard({ hit, selected = false, onClick, onExpand }: PatternCardProps) {
  const sinceStart = hit.start_price !== 0 ? ((hit.end_price - hit.start_price) / hit.start_price) * 100 : 0;
  const lastPrice = hit.last_close ?? hit.end_price;
  const changePct = hit.day_change_pct ?? sinceStart;
  const barsLabel = `${hit.bars_ago} ${hit.timeframe} candle${hit.bars_ago === 1 ? "" : "s"} ago`;

  return (
    <Card
      data-testid={`patterns-card-${hit.symbol}-${hit.pattern_id}`}
      onClick={() => onClick?.(hit)}
      sx={{
        border: "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        p: 1.5,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <Box data-testid="patterns-card" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <ToolbarRow justify="space-between" gap={1} wrap={false}>
          <Box sx={{ minWidth: 0 }}>
            <Text size="sm" fw={700} truncate>
              {hit.symbol}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {hit.pattern_name}
            </Text>
          </Box>
          <ToolbarRow gap={0.5} wrap={false} sx={{ flexShrink: 0 }}>
            <StatusBadge status={hit.status} />
            {onExpand ? (
              <Tooltip label="Open fullscreen chart" withArrow position="left">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={`Open fullscreen chart for ${hit.symbol} ${hit.pattern_name}`}
                  data-testid={`patterns-card-expand-${hit.symbol}-${hit.pattern_id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand(hit);
                  }}
                >
                  <IconArrowsMaximize size={15} />
                </ActionIcon>
              </Tooltip>
            ) : null}
          </ToolbarRow>
        </ToolbarRow>

        <Box sx={{ px: 0.5 }}>
          <PatternMiniChart hit={hit} />
        </Box>

        <ToolbarRow gap={1.5} justify="space-between" wrap={false}>
          <Level label="Breakout" value={price(hit.breakout_level)} />
          <Level label="Target" value={price(hit.target)} />
          <Level label="Stop" value={price(hit.stop)} />
          <Level label="R:R" value={hit.rr > 0 ? hit.rr.toFixed(2) : "—"} />
        </ToolbarRow>

        <ToolbarRow justify="space-between" gap={1}>
          <Text size="xs" c="dimmed" truncate>
            {barsLabel}
          </Text>
          <QualityBadge quality={hit.quality} />
        </ToolbarRow>

        <ToolbarRow justify="space-between" gap={1}>
          <Text size="sm" fw={600}>
            {price(lastPrice)}
          </Text>
          <Text size="xs" c={getPnLTextColor(changePct)}>
            {formatPercentage(changePct, 2)}
          </Text>
        </ToolbarRow>
      </Box>
    </Card>
  );
}
