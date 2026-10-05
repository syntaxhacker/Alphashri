import { ActionIcon, Box, Card, Text, ToolbarRow, Tooltip } from "@/ui";
import { IconArrowsMaximize } from "@tabler/icons-react";
import { formatCurrency, formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { PatternHitDTO, TrendlinesView } from "@/types/chartPatterns";
import { PatternMiniChart } from "./PatternMiniChart";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";

export interface PatternCardProps {
  hit: PatternHitDTO;
  selected?: boolean;
  onClick?: (hit: PatternHitDTO) => void;
  onExpand?: (hit: PatternHitDTO) => void;
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
}

function price(value: number | null | undefined): string {
  return value == null ? "—" : formatCurrency(value, 2);
}

/** Render a range percentage with at most one decimal (`13` not `13.0`). */
function rangePct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Level({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Box data-testid={testId} sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Text size="xs" c="dimmed" style={{ textTransform: "uppercase" }} fw={700} truncate>
        {label}
      </Text>
      <Text size="sm" fw={600} truncate>
        {value}
      </Text>
    </Box>
  );
}

/**
 * Box edges for the neutral `consolidation` pattern. The detector stores the
 * upper edge as `breakout_level` and draws the two flat box edges as the
 * boundary trendlines (upper first, lower second). Prefer the lower trendline
 * price, then the lowest pivot low, then the (ATR-capped) stop, so older
 * persisted hits without trendlines still show a sensible range.
 */
function consolidationBounds(hit: PatternHitDTO): { lo: number | null; hi: number | null } {
  const prices = (hit.trendlines ?? [])
    .filter((line) => line.length > 0)
    .map((line) => line[0]?.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));

  const hi =
    hit.breakout_level > 0 ? hit.breakout_level : prices.length > 0 ? Math.max(...prices) : null;
  const below = hi == null ? prices : prices.filter((p) => p < hi);
  const pivotLows = (hit.pivots ?? [])
    .filter((p) => p.kind !== "high")
    .map((p) => p.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && (hi == null || p < hi));

  let lo: number | null = null;
  if (below.length > 0) lo = Math.min(...below);
  else if (pivotLows.length > 0) lo = Math.min(...pivotLows);
  else if (hit.stop > 0 && (hi == null || hit.stop < hi)) lo = hit.stop;

  return { lo, hi };
}

/** One pattern result card in the grid. */
export function PatternCard({ hit, selected = false, onClick, onExpand, trendlinesView = "both" }: PatternCardProps) {
  const sinceStart = hit.start_price !== 0 ? ((hit.end_price - hit.start_price) / hit.start_price) * 100 : 0;
  const lastPrice = hit.last_close ?? hit.end_price;
  const changePct = hit.day_change_pct ?? sinceStart;
  const barsLabel = `${hit.bars_ago} ${hit.timeframe} candle${hit.bars_ago === 1 ? "" : "s"} ago`;
  const baseDays = hit.base_days ?? 0;
  const isConsolidation = hit.pattern_id === "consolidation" || baseDays > 0;
  const bounds = isConsolidation ? consolidationBounds(hit) : null;

  return (
    <Card
      data-testid={`patterns-card-${hit.symbol}-${hit.pattern_id}`}
      onClick={() => onClick?.(hit)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(hit);
              }
            }
          : undefined
      }
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
          <PatternMiniChart hit={hit} trendlinesView={trendlinesView} />
        </Box>

        {isConsolidation && bounds ? (
          <ToolbarRow gap={1.5} justify="space-between" wrap={false}>
            <Level
              testId={`patterns-card-range-${hit.symbol}`}
              label="Range"
              value={
                bounds.lo != null && bounds.hi != null
                  ? `${price(bounds.lo)} – ${price(bounds.hi)}`
                  : "—"
              }
            />
            <Box
              data-testid={`patterns-card-breakout-both-${hit.symbol}`}
              sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}
            >
              <Text size="xs" c="dimmed" style={{ textTransform: "uppercase" }} fw={700} truncate>
                Breakout
              </Text>
              <ToolbarRow gap={6} wrap={false}>
                <Text size="sm" fw={600} c="success" truncate>
                  ↑ {price(bounds.hi)}
                </Text>
                <Text size="sm" fw={600} c="error" truncate>
                  ↓ {price(bounds.lo)}
                </Text>
              </ToolbarRow>
            </Box>
          </ToolbarRow>
        ) : (
          <ToolbarRow gap={1.5} justify="space-between" wrap={false}>
            <Level label="Breakout" value={price(hit.breakout_level)} />
            <Level label="Target" value={price(hit.target)} />
            <Level label="Stop" value={price(hit.stop)} />
            <Level label="R:R" value={hit.rr > 0 ? hit.rr.toFixed(2) : "—"} />
          </ToolbarRow>
        )}

        {baseDays > 0 || hit.to_52w_high != null ? (
          <ToolbarRow justify="space-between" gap={1}>
            {baseDays > 0 ? (
              <Text
                size="xs"
                c="dimmed"
                truncate
                data-testid={`patterns-card-base-${hit.symbol}-${hit.pattern_id}`}
              >
                {hit.range_pct != null
                  ? `Base ${baseDays}d · ${rangePct(hit.range_pct)}%`
                  : `Base ${baseDays}d`}
              </Text>
            ) : (
              <Box sx={{ flex: 1 }} />
            )}
            {hit.to_52w_high != null ? (
              <Text
                size="xs"
                c="dimmed"
                truncate
                data-testid="patterns-card-52w-gap"
                sx={{ textAlign: "right" }}
              >
                52W: {rangePct(hit.to_52w_high)}%
              </Text>
            ) : null}
          </ToolbarRow>
        ) : null}

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
