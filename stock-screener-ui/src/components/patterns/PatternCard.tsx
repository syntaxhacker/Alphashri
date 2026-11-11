import { memo, useMemo } from "react";
import { ActionIcon, Badge, Box, Card, Text, ToolbarRow, Tooltip } from "@/ui";
import { IconArrowsMaximize } from "@tabler/icons-react";
import { formatPercentage } from "@/utils/ui-helpers";
import type { PatternHitDTO, TrendlinesView } from "@/types/chartPatterns";
import { QUALITY_INFO } from "@/config/patternCatalog";
import { SymbolLink } from "@/components/common/SymbolLink";
import { hasIndexMembers } from "@/config/indexGroups";
import { PATTERN_CONFIRMED, PATTERN_FAILED } from "@/ui/palette";
import { formatPrice } from "./shared";
import { patternDisplayStatus } from "./patternDisplayStatus";
import {
  formatOneDecimal,
  formatRangePos,
  formatScore,
  formatSignedPct1,
  hitChangePct,
  hitLastPrice,
} from "./patternFormat";
import { changeChartColor, displayToneColor, qualityLabel as qualityLabelFor } from "./patternTone";
import { PatternMiniChart } from "./PatternMiniChart";

export interface PatternCardProps {
  hit: PatternHitDTO;
  selected?: boolean;
  onClick?: (hit: PatternHitDTO) => void;
  onExpand?: (hit: PatternHitDTO) => void;
  onShowMembers?: (symbol: string) => void;
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
  /** Hover intent for the right-side symbol preview (host debounces). */
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
  /** Chart icon: open the symbol in the right-side chart. */
  onSymbolOpen?: (symbol: string) => void;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box className="min-w-0 px-1.5 py-1">
      <Text
        size="xs"
        c="dimmed"
        fw={700}
        truncate
        style={{ fontSize: 9, lineHeight: 1, letterSpacing: 0.6, textTransform: "uppercase" }}
      >
        {label}
      </Text>
      <Text
        size="xs"
        fw={600}
        truncate
        style={{ fontSize: 11, lineHeight: 1.25, fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Text>
    </Box>
  );
}

function Level({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Box data-testid={testId} className="flex min-w-0 flex-col gap-[2px]">
      <Text
        size="xs"
        c="dimmed"
        fw={700}
        truncate
        style={{ fontSize: 9, lineHeight: 1, letterSpacing: 0.5, textTransform: "uppercase" }}
      >
        {label}
      </Text>
      <Text size="xs" fw={600} truncate style={{ fontSize: 11, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
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

  const pivotHighs = (hit.pivots ?? [])
    .filter((p) => p.kind !== "low")
    .map((p) => p.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  const hi =
    prices.length > 0 ? Math.max(...prices) : pivotHighs.length > 0 ? Math.max(...pivotHighs) : null;
  const below = hi == null ? prices : prices.filter((p) => p < hi);
  const pivotLows = (hit.pivots ?? [])
    .filter((p) => p.kind !== "high")
    .map((p) => p.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && (hi == null || p < hi));

  let lo: number | null = null;
  if (below.length > 0) lo = Math.min(...below);
  else if (pivotLows.length > 0) lo = Math.min(...pivotLows);

  return { lo, hi };
}

/** One pattern result card in the grid. */
export const PatternCard = memo(function PatternCard({
  hit,
  selected = false,
  onClick,
  onExpand,
  onShowMembers,
  trendlinesView = "both",
  onSymbolPreview,
  onSymbolPreviewEnd,
  onSymbolOpen,
}: PatternCardProps) {
  const lastPrice = hitLastPrice(hit);
  const changePct = hitChangePct(hit);
  const barsLabel = `${hit.bars_ago} ${hit.timeframe} candle${hit.bars_ago === 1 ? "" : "s"} ago`;
  const baseDays = hit.base_days ?? 0;
  const isConsolidation = hit.pattern_id === "consolidation" || baseDays > 0;
  const missingCandles = (hit.candles ?? []).length === 0;
  const bounds = useMemo(() => (isConsolidation ? consolidationBounds(hit) : null), [hit, isConsolidation]);
  const triggerDistance = useMemo(() => {
    if (!isConsolidation || bounds?.hi == null || lastPrice <= 0) return null;
    return ((lastPrice - bounds.hi) / bounds.hi) * 100;
  }, [isConsolidation, bounds, lastPrice]);
  const display = useMemo(
    () =>
      patternDisplayStatus({
        rawStatus: hit.status,
        isBase: isConsolidation,
        lastClose: hit.last_close ?? null,
        upper: bounds?.hi ?? null,
        lower: bounds?.lo ?? null,
      }),
    [hit, isConsolidation, bounds]
  );
  const qualityKey = String(hit.quality ?? "").toLowerCase();
  const qualityInfo = QUALITY_INFO[qualityKey as keyof typeof QUALITY_INFO];
  const quality = qualityLabelFor(qualityKey, "—");
  const canShowMembers = Boolean(onShowMembers && hasIndexMembers(hit.symbol));
  const metrics = [
    { label: "Score", value: formatScore(hit.confidence) },
    { label: "Pos", value: formatRangePos(hit.range_pos) },
  ];

  return (
    <Card
      data-testid={`patterns-card-${hit.symbol}-${hit.pattern_id}`}
      onClick={() => onClick?.(hit)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e: React.KeyboardEvent) => {
              // Inner controls (Members, expand) own their own keys; a bubbled
              // Enter must not also select the card.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(hit);
              }
            }
          : undefined
      }
      className={`overflow-hidden rounded-fin border bg-fin-surface transition-[border-color] duration-[120ms] ${
        selected ? "border-fin-primary" : missingCandles ? "border-fin-negative" : "border-fin-border"
      } ${onClick ? "hover:border-fin-primary" : ""}`}
      style={{
        boxShadow: selected ? "inset 0 0 0 1px var(--color-fin-primary)" : "none",
        cursor: onClick ? "pointer" : "default",
        // Offscreen containment: the browser skips layout/paint for cards
        // outside the visible area while the user scrolls a long results grid.
        contentVisibility: "auto",
        containIntrinsicSize: "300px 480px",
      }}
    >
      <Box
        data-testid="patterns-card"
        data-selected={selected ? "true" : undefined}
        className="flex min-w-0 flex-col"
      >
        <Box className="flex min-w-0 gap-1.5 px-1.5 pb-1 pt-1.5">
          <Box className="min-w-0 flex-1">
            <SymbolLink
              symbol={hit.symbol}
              testId={`patterns-card-tv-${hit.symbol}-${hit.pattern_id}`}
              chartTestId={`patterns-card-chart-${hit.symbol}-${hit.pattern_id}`}
              onOpen={onSymbolOpen}
              onPreview={onSymbolPreview}
              onPreviewEnd={onSymbolPreviewEnd}
              size="sm"
              weight={700}
              className="max-w-full"
            />
            <Text size="xs" c="dimmed" truncate style={{ fontSize: 10, lineHeight: 1.25 }}>
              {hit.pattern_name}
            </Text>
          </Box>
          <Box className="flex shrink-0 items-start gap-[2px]">
            <Box
              className="flex min-w-0 flex-col items-end gap-[2px]"
            >
              <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1, whiteSpace: "nowrap" }}>
                {barsLabel}
              </Text>
              <Tooltip label={display.tooltip} withArrow position="top">
                <Box className="flex items-center gap-1">
                  <Box
                    className="h-[5px] w-[5px] shrink-0 rounded-full"
                    style={{ backgroundColor: displayToneColor(display.tone) }}
                  />
                  <Text
                    data-testid={`patterns-status-${String(hit.status ?? "").toLowerCase()}`}
                    size="xs"
                    fw={700}
                    style={{
                      fontSize: 9,
                      lineHeight: 1,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color: displayToneColor(display.tone),
                    }}
                  >
                    {display.label}
                  </Text>
                </Box>
              </Tooltip>
              <Tooltip label={qualityInfo?.description ?? quality} position="left" withArrow>
                <Text
                  data-testid={`patterns-quality-${qualityKey || "unknown"}`}
                  size="xs"
                  fw={600}
                  c="dimmed"
                  className="cursor-help"
                  style={{
                    fontSize: 9,
                    lineHeight: 1,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                  }}
                >
                  {quality}
                </Text>
              </Tooltip>
            </Box>
          </Box>
        </Box>

        <Box className="flex min-w-0 items-baseline gap-2 px-1.5 pb-1">
          <Text
            size="sm"
            fw={700}
            style={{ fontSize: 16, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}
          >
            {formatPrice(lastPrice)}
          </Text>
          <Text
            size="xs"
            style={{
              fontSize: 11,
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
              color: changeChartColor(changePct),
            }}
          >
            {formatPercentage(changePct, 2)}
          </Text>
          {triggerDistance != null ? (
            <Text
              data-testid={`patterns-card-to-trigger-${hit.symbol}`}
              size="xs"
              c={triggerDistance >= 0 ? "success" : "dimmed"}
              style={{
                fontSize: 10,
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {`${formatSignedPct1(triggerDistance)} to trigger`}
            </Text>
          ) : null}
          {missingCandles ? (
            <Tooltip
              label="Chart data failed to load (rate limit or fetch error) — pattern levels only. Refresh or force-rescan to retry."
              withArrow
              position="top"
            >
              <Badge color="error" size="xs" data-testid={`patterns-card-no-data-${hit.symbol}`}>
                No chart
              </Badge>
            </Tooltip>
          ) : null}
        </Box>

        <Box
          className="relative min-w-0 border-t border-fin-border bg-fin-bg"
        >
          <PatternMiniChart hit={hit} trendlinesView={trendlinesView} />
          <Box
            className="absolute right-[2px] top-[2px] z-[1] flex items-center gap-[2px]"
          >
            {onExpand ? (
              <Tooltip label="Open fullscreen chart" withArrow position="left">
                <ActionIcon
                  variant="subtle"
                  size="xs"
                  aria-label={`Open fullscreen chart for ${hit.symbol} ${hit.pattern_name}`}
                  data-testid={`patterns-card-expand-${hit.symbol}-${hit.pattern_id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand(hit);
                  }}
                  style={{ backgroundColor: "var(--color-fin-surface)" }}
                  className="opacity-[0.85] hover:text-fin-text hover:opacity-100"
                >
                  <IconArrowsMaximize size={12} />
                </ActionIcon>
              </Tooltip>
            ) : null}
          </Box>
        </Box>

        {isConsolidation && bounds ? (
          <ToolbarRow
            gap={1.5}
            justify="space-between"
            wrap={false}
            className="border-t border-fin-border px-1.5 py-1"
          >
            <Level
              testId={`patterns-card-range-${hit.symbol}`}
              label="Range"
              value={
                bounds.lo != null && bounds.hi != null
                  ? `${formatPrice(bounds.lo)} – ${formatPrice(bounds.hi)}`
                  : "—"
              }
            />
            <Box
              data-testid={`patterns-card-breakout-both-${hit.symbol}`}
              className="flex min-w-0 flex-col gap-[2px]"
            >
              <Text
                size="xs"
                c="dimmed"
                fw={700}
                truncate
                style={{ fontSize: 9, lineHeight: 1, letterSpacing: 0.5, textTransform: "uppercase" }}
              >
                Range
              </Text>
              <ToolbarRow gap={6} wrap={false}>
                <Text size="xs" fw={600} truncate style={{ fontSize: 11, color: PATTERN_CONFIRMED }}>
                  ↑ {formatPrice(bounds.hi)}
                </Text>
                <Text size="xs" fw={600} truncate style={{ fontSize: 11, color: PATTERN_FAILED }}>
                  ↓ {formatPrice(bounds.lo)}
                </Text>
              </ToolbarRow>
            </Box>
          </ToolbarRow>
        ) : null}

        {baseDays > 0 || hit.to_52w_high != null ? (
          <ToolbarRow
            justify="space-between"
            gap={1}
            className="border-t border-fin-border px-1.5 py-[2px]"
          >
            {baseDays > 0 ? (
              <Text
                size="xs"
                c="dimmed"
                truncate
                data-testid={`patterns-card-base-${hit.symbol}-${hit.pattern_id}`}
                style={{ fontSize: 9, lineHeight: 1.2 }}
              >
                {hit.range_pct != null
                  ? `Base ${baseDays}d · ${formatOneDecimal(hit.range_pct)}%`
                  : `Base ${baseDays}d`}
              </Text>
            ) : (
              <Box className="flex-1" />
            )}
            {hit.to_52w_high != null ? (
              <Text
                size="xs"
                c="dimmed"
                truncate
                data-testid="patterns-card-52w-gap"
                style={{ fontSize: 9, lineHeight: 1.2, textAlign: "right" }}
              >
                52W: {formatOneDecimal(hit.to_52w_high)}%
              </Text>
            ) : null}
          </ToolbarRow>
        ) : null}

        <Box
          className="grid border-t border-fin-border"
          style={{ gridTemplateColumns: `repeat(${canShowMembers ? 5 : 4}, minmax(0, 1fr))` }}
        >
          {metrics.map((metric, index) => (
            <Box
              key={metric.label}
              className={`min-w-0 ${index === 0 ? "" : "border-l border-fin-border"}`}
            >
              <Metric label={metric.label} value={metric.value} />
            </Box>
          ))}
          {canShowMembers ? (
            <Box
              className="flex min-w-0 items-center justify-center border-l border-fin-border"
            >
              <Box
                component="button"
                type="button"
                data-testid={`patterns-card-members-${hit.symbol}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onShowMembers?.(hit.symbol);
                }}
                className="cursor-pointer border-0 bg-transparent p-1 text-[9px] font-bold uppercase tracking-[0.5px] text-fin-primary hover:underline"
              >
                Members
              </Box>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Card>
  );
});
