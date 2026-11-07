import { ActionIcon, Badge, Box, Card, Text, ToolbarRow, Tooltip } from "@/ui";
import { IconArrowsMaximize } from "@tabler/icons-react";
import { formatPercentage } from "@/utils/ui-helpers";
import type { PatternHitDTO, TrendlinesView } from "@/types/chartPatterns";
import { QUALITY_INFO } from "@/config/patternCatalog";
import { SymbolLink } from "@/components/common/SymbolLink";
import { hasIndexMembers } from "@/config/indexGroups";
import {
  INFO,
  NEUTRAL,
  NEGATIVE,
  PATTERN_CONFIRMED,
  PATTERN_FAILED,
  POSITIVE,
  WARNING,
} from "@/ui/palette";
import { formatPrice } from "./shared";
import { patternDisplayStatus, type DisplayTone } from "./patternDisplayStatus";
import { changeChartColor, qualityLabel as qualityLabelFor } from "./patternTone";
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

/** Render a range percentage with at most one decimal (`13` not `13.0`). */
function rangePct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ px: 0.75, py: 0.5, minWidth: 0 }}>
      <Text
        size="xs"
        c="dimmed"
        fw={700}
        truncate
        sx={{ fontSize: 9, lineHeight: 1, letterSpacing: 0.6, textTransform: "uppercase" }}
      >
        {label}
      </Text>
      <Text
        size="xs"
        fw={600}
        truncate
        sx={{ fontSize: 11, lineHeight: 1.25, fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Text>
    </Box>
  );
}

function Level({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Box data-testid={testId} sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Text
        size="xs"
        c="dimmed"
        fw={700}
        truncate
        sx={{ fontSize: 9, lineHeight: 1, letterSpacing: 0.5, textTransform: "uppercase" }}
      >
        {label}
      </Text>
      <Text size="xs" fw={600} truncate sx={{ fontSize: 11, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
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

/** Palette color for the status pill dot + text, keyed by the derived tone. */
function displayToneColor(tone: DisplayTone): string {
  switch (tone) {
    case "success":
      return POSITIVE;
    case "warning":
      return WARNING;
    case "error":
      return NEGATIVE;
    case "info":
      return INFO;
    case "neutral":
      return NEUTRAL;
  }
}

/** One pattern result card in the grid. */
export function PatternCard({
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
  const sinceStart = hit.start_price !== 0 ? ((hit.end_price - hit.start_price) / hit.start_price) * 100 : 0;
  const lastPrice = hit.last_close ?? hit.end_price;
  const changePct = hit.day_change_pct ?? sinceStart;
  const barsLabel = `${hit.bars_ago} ${hit.timeframe} candle${hit.bars_ago === 1 ? "" : "s"} ago`;
  const baseDays = hit.base_days ?? 0;
  const isConsolidation = hit.pattern_id === "consolidation" || baseDays > 0;
  const bounds = isConsolidation ? consolidationBounds(hit) : null;
  const missingCandles = (hit.candles ?? []).length === 0;
  const triggerDistance =
    isConsolidation && bounds?.hi != null && lastPrice > 0
      ? ((lastPrice - bounds.hi) / bounds.hi) * 100
      : null;
  const display = patternDisplayStatus({
    rawStatus: hit.status,
    isBase: isConsolidation,
    lastClose: hit.last_close ?? null,
    upper: bounds?.hi ?? null,
    lower: bounds?.lo ?? null,
  });
  const qualityKey = String(hit.quality ?? "").toLowerCase();
  const qualityInfo = QUALITY_INFO[qualityKey as keyof typeof QUALITY_INFO];
  const quality = qualityLabelFor(qualityKey, "—");
  const canShowMembers = Boolean(onShowMembers && hasIndexMembers(hit.symbol));
  const metrics = [
    { label: "Score", value: hit.confidence != null ? hit.confidence.toFixed(1) : "—" },
    {
      label: "Pos",
      value: hit.range_pos != null && Number.isFinite(hit.range_pos) ? `${Math.round(hit.range_pos)}%` : "—",
    },
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
      sx={{
        border: "1px solid",
        borderColor: selected ? "primary.main" : missingCandles ? "error.main" : "divider",
        boxShadow: selected ? "inset 0 0 0 1px var(--mui-palette-primary-main)" : "none",
        borderRadius: 1,
        bgcolor: "background.paper",
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 120ms ease",
        "&:hover": onClick ? { borderColor: "primary.main" } : undefined,
      }}
    >
      <Box
        data-testid="patterns-card"
        data-selected={selected ? "true" : undefined}
        sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        <Box sx={{ px: 0.75, pt: 0.75, pb: 0.5, display: "flex", gap: 0.75, minWidth: 0 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <SymbolLink
              symbol={hit.symbol}
              testId={`patterns-card-tv-${hit.symbol}-${hit.pattern_id}`}
              chartTestId={`patterns-card-chart-${hit.symbol}-${hit.pattern_id}`}
              onOpen={onSymbolOpen}
              onPreview={onSymbolPreview}
              onPreviewEnd={onSymbolPreviewEnd}
              size="sm"
              weight={700}
              sx={{ maxWidth: "100%" }}
            />
            <Text size="xs" c="dimmed" truncate sx={{ fontSize: 10, lineHeight: 1.25 }}>
              {hit.pattern_name}
            </Text>
          </Box>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.25, flexShrink: 0 }}>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 0.25,
                minWidth: 0,
              }}
            >
              <Text size="xs" c="dimmed" sx={{ fontSize: 9, lineHeight: 1, whiteSpace: "nowrap" }}>
                {barsLabel}
              </Text>
              <Tooltip label={display.tooltip} withArrow position="top">
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box
                    sx={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      bgcolor: displayToneColor(display.tone),
                      flexShrink: 0,
                    }}
                  />
                  <Text
                    data-testid={`patterns-status-${String(hit.status ?? "").toLowerCase()}`}
                    size="xs"
                    fw={700}
                    sx={{
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
                  sx={{
                    fontSize: 9,
                    lineHeight: 1,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    color: "text.secondary",
                    cursor: "help",
                  }}
                >
                  {quality}
                </Text>
              </Tooltip>
            </Box>
          </Box>
        </Box>

        <Box sx={{ px: 0.75, pb: 0.5, display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
          <Text
            size="sm"
            fw={700}
            sx={{ fontSize: 16, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}
          >
            {formatPrice(lastPrice)}
          </Text>
          <Text
            size="xs"
            sx={{
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
              sx={{
                fontSize: 10,
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {`${triggerDistance >= 0 ? "+" : "−"}${Math.abs(triggerDistance).toFixed(1)}% to trigger`}
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
          sx={{
            position: "relative",
            borderTop: "1px solid",
            borderColor: "divider",
            bgcolor: "background.default",
            minWidth: 0,
          }}
        >
          <PatternMiniChart hit={hit} trendlinesView={trendlinesView} />
          <Box
            sx={{
              position: "absolute",
              top: 2,
              right: 2,
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              zIndex: 1,
            }}
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
                  sx={{
                    color: "text.secondary",
                    bgcolor: "background.paper",
                    opacity: 0.85,
                    "&:hover": { color: "text.primary", opacity: 1 },
                  }}
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
            sx={{ px: 0.75, py: 0.5, borderTop: "1px solid", borderColor: "divider" }}
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
              sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}
            >
              <Text
                size="xs"
                c="dimmed"
                fw={700}
                truncate
                sx={{ fontSize: 9, lineHeight: 1, letterSpacing: 0.5, textTransform: "uppercase" }}
              >
                Range
              </Text>
              <ToolbarRow gap={6} wrap={false}>
                <Text size="xs" fw={600} truncate sx={{ fontSize: 11, color: PATTERN_CONFIRMED }}>
                  ↑ {formatPrice(bounds.hi)}
                </Text>
                <Text size="xs" fw={600} truncate sx={{ fontSize: 11, color: PATTERN_FAILED }}>
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
            sx={{ px: 0.75, py: 0.25, borderTop: "1px solid", borderColor: "divider" }}
          >
            {baseDays > 0 ? (
              <Text
                size="xs"
                c="dimmed"
                truncate
                data-testid={`patterns-card-base-${hit.symbol}-${hit.pattern_id}`}
                sx={{ fontSize: 9, lineHeight: 1.2 }}
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
                sx={{ fontSize: 9, lineHeight: 1.2, textAlign: "right" }}
              >
                52W: {rangePct(hit.to_52w_high)}%
              </Text>
            ) : null}
          </ToolbarRow>
        ) : null}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(${canShowMembers ? 5 : 4}, minmax(0, 1fr))`,
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          {metrics.map((metric, index) => (
            <Box
              key={metric.label}
              sx={{
                borderLeft: index === 0 ? "none" : "1px solid",
                borderColor: "divider",
                minWidth: 0,
              }}
            >
              <Metric label={metric.label} value={metric.value} />
            </Box>
          ))}
          {canShowMembers ? (
            <Box
              sx={{
                borderLeft: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 0,
              }}
            >
              <Box
                component="button"
                type="button"
                data-testid={`patterns-card-members-${hit.symbol}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onShowMembers?.(hit.symbol);
                }}
                sx={{
                  border: 0,
                  bgcolor: "transparent",
                  color: "primary.main",
                  cursor: "pointer",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  p: 0.5,
                  "&:hover": { textDecoration: "underline" },
                }}
              >
                Members
              </Box>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Card>
  );
}
