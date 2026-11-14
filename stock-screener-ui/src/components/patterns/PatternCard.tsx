import { createMemo, Show } from "solid-js";
import { Badge, Box, Card, Text, Tooltip } from "@/ui";
import { IconArrowsMaximize } from "@/patterns/icons";
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

/** Derived display tone → shared `Badge` colour token. */
const STATUS_BADGE_COLOR: Record<string, string> = {
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
  neutral: "default",
};

/** One stat cell: 10px label left, 11px mono value right. No rules, no cells. */
function Metric(props: { label: string; value: string }) {
  return (
    <Box className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1.5">
      <Text size="xs" c="dimmed" fw={600} truncate style={{ "font-size": "10px", "line-height": 1 }}>
        {props.label}
      </Text>
      <Text
        size="xs"
        fw={600}
        truncate
        className="font-mono tabular-nums"
        style={{ "font-size": "11px", "line-height": 1 }}
      >
        {props.value}
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
export function PatternCard(props: PatternCardProps) {
  const hit = () => props.hit;
  const selected = () => props.selected ?? false;
  const trendlinesView = () => props.trendlinesView ?? "both";

  const lastPrice = createMemo(() => hitLastPrice(hit()));
  const changePct = createMemo(() => hitChangePct(hit()));
  const barsLabel = () => `${hit().bars_ago} ${hit().timeframe} candle${hit().bars_ago === 1 ? "" : "s"} ago`;
  const baseDays = createMemo(() => hit().base_days ?? 0);
  const isConsolidation = createMemo(() => hit().pattern_id === "consolidation" || baseDays() > 0);
  const missingCandles = () => (hit().candles ?? []).length === 0;
  const bounds = createMemo(() => (isConsolidation() ? consolidationBounds(hit()) : null));
  const triggerDistance = createMemo(() => {
    if (!isConsolidation() || bounds()?.hi == null || lastPrice() <= 0) return null;
    return ((lastPrice() - bounds()!.hi!) / bounds()!.hi!) * 100;
  });
  const display = createMemo(() =>
    patternDisplayStatus({
      rawStatus: hit().status,
      isBase: isConsolidation(),
      lastClose: hit().last_close ?? null,
      upper: bounds()?.hi ?? null,
      lower: bounds()?.lo ?? null,
    }),
  );
  const qualityKey = createMemo(() => String(hit().quality ?? "").toLowerCase());
  const qualityInfo = () => QUALITY_INFO[qualityKey() as keyof typeof QUALITY_INFO];
  const quality = () => qualityLabelFor(qualityKey(), "—");
  const canShowMembers = () => Boolean(props.onShowMembers && hasIndexMembers(hit().symbol));

  return (
    <Card
      data-testid={`patterns-card-${hit().symbol}-${hit().pattern_id}`}
      onClick={() => props.onClick?.(hit())}
      role={props.onClick ? "button" : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onKeyDown={
        props.onClick
          ? (e: KeyboardEvent) => {
              // Inner controls (Members, expand) own their own keys; a bubbled
              // Enter must not also select the card.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                props.onClick?.(hit());
              }
            }
          : undefined
      }
      className={`flex min-w-0 flex-col overflow-hidden rounded-fin border bg-fin-surface transition-[border-color] duration-[120ms] ${
        selected() ? "border-fin-primary" : missingCandles() ? "border-fin-negative" : "border-fin-border"
      } ${props.onClick ? "hover:border-fin-primary" : ""}`}
      style={{
        cursor: props.onClick ? "pointer" : "default",
        // Offscreen containment: the browser skips layout/paint for cards
        // outside the visible area while the user scrolls a long results grid.
        "content-visibility": "auto",
        "contain-intrinsic-size": "194px 196px",
      }}
    >
      <Box
        data-testid="patterns-card"
        data-selected={selected() ? "true" : undefined}
        className="flex min-w-0 flex-1 flex-col"
      >
        {/* Hierarchy: the symbol is the only strong element, the pattern name sits
            muted beneath it, and the state chip + bars-ago line align right. */}
        <Box className="flex min-w-0 items-start gap-2 px-1.5 pb-0.5 pt-1">
          <Box className="min-w-0 flex-1">
            <SymbolLink
              symbol={hit().symbol}
              testId={`patterns-card-tv-${hit().symbol}-${hit().pattern_id}`}
              chartTestId={`patterns-card-chart-${hit().symbol}-${hit().pattern_id}`}
              onOpen={props.onSymbolOpen}
              onPreview={props.onSymbolPreview}
              onPreviewEnd={props.onSymbolPreviewEnd}
              size="xs"
              weight={700}
              className="max-w-full"
            />
            <Box className="flex min-w-0 items-center justify-between gap-1">
              <Text size="xs" c="dimmed" truncate style={{ "font-size": "10px", "line-height": 1.2 }}>
                {hit().pattern_name}
              </Text>
              <Tooltip label={qualityInfo()?.description ?? quality()} position="left" withArrow>
                <Text
                  data-testid={`patterns-quality-${qualityKey() || "unknown"}`}
                  size="xs"
                  c="dimmed"
                  className="cursor-help shrink-0"
                  style={{ "font-size": "10px", "line-height": 1 }}
                >
                  {quality()}
                </Text>
              </Tooltip>
            </Box>
          </Box>
          <Box className="flex shrink-0 flex-col items-end gap-1">
            <Tooltip label={display().tooltip} withArrow position="top">
              {/* Borderless tinted chip: the card owns the only 1px rule. */}
              <Badge
                data-testid={`patterns-status-${String(hit().status ?? "").toLowerCase()}`}
                size="xs"
                variant="light"
                color={STATUS_BADGE_COLOR[display().tone]}
                style={{ border: "0", "text-transform": "none", "letter-spacing": "normal" }}
              >
                {display().label}
              </Badge>
            </Tooltip>
            <Text size="xs" c="dimmed" style={{ "font-size": "10px", "line-height": 1, "white-space": "nowrap" }}>
              {barsLabel()}
            </Text>
          </Box>
        </Box>

        <Box className="flex min-w-0 items-baseline gap-2 px-1.5 pb-1">
          <Text
            size="xs"
            fw={600}
            className="font-mono tabular-nums"
            style={{ "font-size": "11px", "line-height": 1.1 }}
          >
            {formatPrice(lastPrice())}
          </Text>
          <Text
            size="xs"
            className="font-mono tabular-nums"
            style={{
              "font-size": "11px",
              "line-height": 1.1,
              color: changeChartColor(changePct()),
            }}
          >
            {formatPercentage(changePct(), 2)}
          </Text>
          <Show when={triggerDistance() != null}>
            <Text
              data-testid={`patterns-card-to-trigger-${hit().symbol}`}
              size="xs"
              c={(triggerDistance() ?? 0) >= 0 ? "success" : "dimmed"}
              className="font-mono tabular-nums"
              style={{
                "font-size": "10px",
                "line-height": 1.1,
                "white-space": "nowrap",
              }}
            >
              {`${formatSignedPct1(triggerDistance()!)} to trigger`}
            </Text>
          </Show>
          <Show when={missingCandles()}>
            <Tooltip
              label="Chart data failed to load (rate limit or fetch error) — pattern levels only. Refresh or force-rescan to retry."
              withArrow
              position="top"
            >
              <Badge
                color="error"
                size="xs"
                variant="light"
                data-testid={`patterns-card-no-data-${hit().symbol}`}
                style={{ border: "0", "text-transform": "none", "letter-spacing": "normal" }}
              >
                No chart
              </Badge>
            </Tooltip>
          </Show>
        </Box>

        <Box className="relative min-w-0 flex-1 overflow-hidden bg-fin-bg">
          <PatternMiniChart hit={hit()} trendlinesView={trendlinesView()} />
          <Box
            className="absolute right-[2px] top-[2px] z-[1] flex items-center gap-[2px]"
          >
            <Show when={props.onExpand}>
              <Tooltip label="Open fullscreen chart" withArrow position="left">
                <button
                  type="button"
                  aria-label={`Open fullscreen chart for ${hit().symbol} ${hit().pattern_name}`}
                  data-testid={`patterns-card-expand-${hit().symbol}-${hit().pattern_id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onExpand?.(hit());
                  }}
                  style={{ "background-color": "transparent" }}
                  className="inline-flex size-5 items-center justify-center rounded border-0 text-fin-text-muted transition-colors hover:text-fin-text"
                >
                  <IconArrowsMaximize size={12} />
                </button>
              </Tooltip>
            </Show>
          </Box>
        </Box>

        <Show when={isConsolidation() && bounds()}>
          <Box className="flex h-5 min-w-0 items-center gap-2 px-1.5">
            <Box
              data-testid={`patterns-card-range-${hit().symbol}`}
              className="flex min-w-0 items-center gap-1"
            >
              <Text
                size="xs"
                c="dimmed"
                fw={600}
                truncate
                style={{ "font-size": "10px", "line-height": 1 }}
              >
                Range
              </Text>
              <Text
                size="xs"
                fw={600}
                truncate
                className="font-mono tabular-nums"
                style={{ "font-size": "11px", "line-height": 1 }}
              >
                {bounds()?.lo != null && bounds()?.hi != null
                  ? `${formatPrice(bounds()!.lo!)} – ${formatPrice(bounds()!.hi!)}`
                  : "—"}
              </Text>
            </Box>
            <Box
              data-testid={`patterns-card-breakout-both-${hit().symbol}`}
              className="ml-auto flex shrink-0 items-center gap-1.5"
            >
              <Text
                size="xs"
                fw={600}
                truncate
                className="font-mono tabular-nums"
                style={{ "font-size": "11px", color: PATTERN_CONFIRMED }}
              >
                ↑ {bounds()?.hi != null ? formatPrice(bounds()!.hi!) : "—"}
              </Text>
              <Text
                size="xs"
                fw={600}
                truncate
                className="font-mono tabular-nums"
                style={{ "font-size": "11px", color: PATTERN_FAILED }}
              >
                ↓ {bounds()?.lo != null ? formatPrice(bounds()!.lo!) : "—"}
              </Text>
            </Box>
          </Box>
        </Show>

        <Show when={baseDays() > 0 || hit().to_52w_high != null}>
          <Box className="flex h-[18px] min-w-0 items-center justify-between gap-2 px-1.5">
            <Show when={baseDays() > 0} fallback={<Box className="flex-1" />}>
              <Text
                size="xs"
                c="dimmed"
                truncate
                data-testid={`patterns-card-base-${hit().symbol}-${hit().pattern_id}`}
                style={{ "font-size": "10px", "line-height": 1.2 }}
              >
                {hit().range_pct != null
                  ? `Base ${baseDays()}d · ${formatOneDecimal(hit().range_pct!)}%`
                  : `Base ${baseDays()}d`}
              </Text>
            </Show>
            <Show when={hit().to_52w_high != null}>
              <Text
                size="xs"
                c="dimmed"
                truncate
                data-testid="patterns-card-52w-gap"
                style={{ "font-size": "10px", "line-height": 1.2, "text-align": "right" }}
              >
                52W: {formatOneDecimal(hit().to_52w_high!)}%
              </Text>
            </Show>
          </Box>
        </Show>

        {/* Stat strip: one 18px line, background-shifted (no hairline) — the
            card already has its single outer border. */}
        <Box className="flex h-[18px] min-w-0 items-center bg-fin-surface-alt">
          <Metric label="Score" value={formatScore(hit().confidence)} />
          <Metric label="Pos" value={formatRangePos(hit().range_pos)} />
          <Show when={canShowMembers()}>
            <Box className="flex shrink-0 items-center pr-1.5">
              <button
                type="button"
                data-testid={`patterns-card-members-${hit().symbol}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onShowMembers?.(hit().symbol);
                }}
                className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-semibold text-fin-primary hover:underline"
              >
                Members
              </button>
            </Box>
          </Show>
        </Box>
      </Box>
    </Card>
  );
}
