import { For, Show } from "solid-js";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import { Badge, Box, Text, Tooltip } from "@/ui";
import { SymbolLink } from "../common/SymbolLink";
import { hasIndianOptionsChain } from "../common/symbolDockContext";
import type { MarketRow, MarketUniverse } from "../../types/marketScreener";
import {
  descriptorForCurrency,
  formatMarketCap,
  formatPrice,
  marketCapLabel,
  marketCapOf,
  marketUniverseDescriptor,
  type MarketUniverseDescriptor,
} from "../../config/marketUniverses";
import type { PatternSummaryItem } from "./usePatternSummary";
import { DashCell } from "../common/tableCells";

const DASH = "–";

// A cached snapshot can carry NaN/undefined for a field TV did not return;
// `=== null` alone let those reach `toFixed` as "NaN%" or "undefined%".
const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Cells derive their descriptor from the row's own currency, never the tab. */
function rowDescriptor(row: MarketRow): MarketUniverseDescriptor {
  return descriptorForCurrency(row.currency);
}

function fmtPct(value: number | null | undefined, signed = true): string {
  if (!finite(value)) return DASH;
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function fmtNum(value: number | null | undefined, digits = 1): string {
  if (!finite(value)) return DASH;
  return value.toFixed(digits);
}

function pctColor(value: number | null | undefined): "success" | "error" | undefined {
  if (!finite(value)) return undefined;
  return value >= 0 ? "success" : "error";
}

const NAME_TEXT_CLASS = "block max-w-[110px]";
const SECTOR_TEXT_CLASS = "block max-w-[80px]";
const SYMBOL_CELL_CLASS = "flex min-w-0 items-center gap-1";
const SYMBOL_LINK_CLASS = "min-w-0 flex-[1_1_auto]";
const BADGE_WRAP_CLASS = "inline-flex flex-shrink-0";
const WEEK52_TRACK_CLASS =
  "relative mx-auto h-[6px] w-[48px] overflow-hidden rounded-[3px] bg-fin-border";
const WEEK52_FILL_CLASS = "absolute left-0 top-0 bottom-0 rounded-[3px] bg-fin-primary";

const CAP_TIER_COLOR: Record<string, "primary" | "info" | "warning" | "success" | "default"> = {
  mega: "success",
  large: "primary",
  mid: "info",
  small: "warning",
  micro: "default",
};

/** Horizontal 52-week position bar (0–100), coloured by proximity to the high. */
function Week52Bar(props: { row: MarketRow }) {
  const pos = () => props.row.pos52w;
  const clamped = () => Math.max(0, Math.min(100, pos()!));
  const title = () => {
    const low = props.row.low52w;
    const high = props.row.high52w;
    if (finite(low) && finite(high)) {
      const descriptor = rowDescriptor(props.row);
      const symbol = descriptor.currencySymbol;
      return `52W range ${symbol}${low.toLocaleString(descriptor.priceLocale)}–${symbol}${high.toLocaleString(descriptor.priceLocale)} · at ${clamped().toFixed(0)}%`;
    }
    return `52W position ${clamped().toFixed(0)}%`;
  };
  return (
    <Show when={finite(pos())} fallback={<DashCell testId={`market-dash-${props.row.symbol}-week52`} />}>
      <Tooltip label={title()}>
        <Box
          role="img"
          aria-label={title()}
          data-testid={`market-52w-${props.row.symbol}`}
          className={WEEK52_TRACK_CLASS}
        >
          <Box
            className={WEEK52_FILL_CLASS}
            style={{ width: `${clamped()}%` }}
          />
        </Box>
      </Tooltip>
    </Show>
  );
}

export interface MarketColumnHandlers {
  /** Open the in-app chart. The text opens in-app; ↗ stays TradingView. */
  onSymbolOpen?: (symbol: string) => void;
  /**
   * Chart-icon destination override. The row's exchange travels with the symbol
   * so the host can pick a data provider. When absent, `SymbolLink` keeps its
   * default dock behaviour (single-arg `onSymbolOpen` contract stays intact).
   */
  onChartOpen?: (symbol: string, exchange: string | undefined) => void;
  /** Drop the SECTOR column when every visible row shares one sector. */
  hideSector?: boolean;
  /** Stored 1D patterns for a symbol — absent means "not looked up yet". */
  patternsFor?: (symbol: string) => PatternSummaryItem | undefined;
  /** Drives the MCAP header unit; cells still read each row's own currency. */
  universe?: MarketUniverse;
}

type PatternTone = "bullish" | "bearish" | "mixed";

const PATTERN_TONE_COLOR: Record<PatternTone, "success" | "error" | "default"> = {
  bullish: "success",
  bearish: "error",
  mixed: "default",
};

const PATTERN_GLYPH: Record<PatternTone, string> = {
  bullish: "▲",
  bearish: "▼",
  mixed: "",
};

/** One tone for the row: one-sided only when every stored hit agrees. */
function patternTone(patterns: PatternSummaryItem["patterns"]): PatternTone {
  let bullish = false;
  let bearish = false;
  for (const pattern of patterns) {
    const direction = String(pattern.direction ?? "").toLowerCase();
    if (direction === "bullish") bullish = true;
    else if (direction === "bearish") bearish = true;
  }
  if (bullish && bearish) return "mixed";
  return bullish ? "bullish" : bearish ? "bearish" : "mixed";
}

function patternTooltip(patterns: PatternSummaryItem["patterns"]) {
  return (
    <Box component="span" className="flex flex-col gap-0.5">
      <For each={patterns}>
        {(pattern) => (
          <span className="block whitespace-nowrap">
            {pattern.name}
            {pattern.confidence === null ? "" : ` · ${Math.round(pattern.confidence)}`}
          </span>
        )}
      </For>
    </Box>
  );
}

/** Stored-pattern summary: count plus the tone its hits agree on. */
function PatternBadge(props: { symbol: string; item: PatternSummaryItem | undefined }) {
  const tone = () => (props.item ? patternTone(props.item.patterns) : "mixed");
  return (
    <Show when={props.item} fallback={<DashCell testId={`market-dash-${props.symbol}-patterns`} />}>
      <Tooltip label={patternTooltip(props.item!.patterns)} multiline position="top">
        <Badge
          size="xs"
          variant="light"
          color={PATTERN_TONE_COLOR[tone()]}
          data-testid={`market-patterns-${props.symbol}`}
        >
          {`${props.item!.count}${PATTERN_GLYPH[tone()]}`}
        </Badge>
      </Tooltip>
    </Show>
  );
}


export function buildMarketColumns(handlers: MarketColumnHandlers = {}): ColumnDef<MarketRow>[] {
  const headerDescriptor = marketUniverseDescriptor(handlers.universe);
  const columns: ColumnDef<MarketRow>[] = [
    {
      id: "symbol",
      header: "SYMBOL",
      size: 205,
      accessorFn: (r) => r.symbol,
      meta: { align: "left" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Box className={SYMBOL_CELL_CLASS}>
            <SymbolLink
              symbol={r.symbol}
              market={r.exchange ?? "NSE"}
              showOptions={hasIndianOptionsChain(r.exchange)}
              testId={`market-symbol-${r.symbol}`}
              chartTestId={`market-chart-${r.symbol}`}
              size="xs"
              weight={600}
              className={SYMBOL_LINK_CLASS}
              inAppText
              tvIcon
              onTextClick={(sym) => handlers.onSymbolOpen?.(sym)}
              // Only override the chart icon when the host supplied a destination;
              // otherwise SymbolLink falls back to the app-wide dock.
              onOpen={
                handlers.onChartOpen
                  ? (sym) => handlers.onChartOpen!(sym, r.exchange ?? undefined)
                  : undefined
              }
            />
            {r.fno && hasIndianOptionsChain(r.exchange) ? (
              <Box className={BADGE_WRAP_CLASS}>
                <Badge size="xs" variant="light" color="info" data-testid={`market-fno-${r.symbol}`}>
                  F&O
                </Badge>
              </Box>
            ) : null}
            {r.etf ? (
              <Box className={BADGE_WRAP_CLASS}>
                <Badge
                  size="xs"
                  variant="light"
                  color="default"
                  data-testid={`market-etf-${r.symbol}`}
                >
                  ETF
                </Badge>
              </Box>
            ) : null}
          </Box>
        );
      },
    },
    {
      id: "name",
      header: "NAME",
      size: 110,
      accessorFn: (r) => r.name,
      meta: { align: "left" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Text
            size="xs"
            truncate
            c="dimmed"
            title={r.name}
            data-testid={`market-name-${r.symbol}`}
            className={NAME_TEXT_CLASS}
          >
            {r.name || DASH}
          </Text>
        );
      },
    },
    {
      id: "sector",
      header: "SECTOR",
      size: 80,
      accessorFn: (r) => r.sector ?? "",
      meta: { align: "left" },
      cell: ({ row }) => {
        const r = row.original;
        return r.sector ? (
          <Text size="xs" truncate data-testid={`market-sector-${r.symbol}`} className={SECTOR_TEXT_CLASS}>
            {r.sector}
          </Text>
        ) : (
          <DashCell testId={`market-dash-${r.symbol}-sector`} />
        );
      },
    },
    {
      id: "close",
      header: "LTP",
      size: 70,
      accessorFn: (r) => r.close,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return !finite(r.close) ? (
          <DashCell testId={`market-dash-${r.symbol}-close`} />
        ) : (
          <Text size="xs" fw={600} data-testid={`market-close-${r.symbol}`}>
            {rowDescriptor(r).currencySymbol}
            {formatPrice(r.close, rowDescriptor(r))}
          </Text>
        );
      },
    },
    {
      id: "day_change",
      header: "DAY %",
      size: 60,
      accessorFn: (r) => r.change,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return !finite(r.change) ? (
          <DashCell testId={`market-dash-${r.symbol}-change`} />
        ) : (
          <Text size="xs" fw={600} c={pctColor(r.change)} data-testid={`market-change-${r.symbol}`}>
            {fmtPct(r.change)}
          </Text>
        );
      },
    },
    {
      // Historical sort id. `size: 0` keeps it out of the rendered header while
      // TanStack can still resolve a saved sorter that names it.
      id: "change",
      size: 0,
      accessorFn: (r) => r.change,
    },
    {
      id: "perf_w",
      header: "1W %",
      size: 54,
      accessorFn: (r) => r.perfW,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return !finite(r.perfW) ? (
          <DashCell testId={`market-dash-${r.symbol}-perf-w`} />
        ) : (
          <Text size="xs" c={pctColor(r.perfW)} data-testid={`market-perfw-${r.symbol}`}>
            {fmtPct(r.perfW)}
          </Text>
        );
      },
    },
    {
      id: "perf_1m",
      header: "1M %",
      size: 54,
      accessorFn: (r) => r.perf1m,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return !finite(r.perf1m) ? (
          <DashCell testId={`market-dash-${r.symbol}-perf-1m`} />
        ) : (
          <Text size="xs" c={pctColor(r.perf1m)} data-testid={`market-perf1m-${r.symbol}`}>
            {fmtPct(r.perf1m)}
          </Text>
        );
      },
    },
    {
      id: "pos_52w",
      header: "52W",
      size: 62,
      accessorFn: (r) => r.pos52w,
      meta: { align: "center" },
      cell: ({ row }) => <Week52Bar row={row.original} />,
    },
    {
      id: "rsi",
      header: "RSI",
      size: 42,
      accessorFn: (r) => r.rsi,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return !finite(r.rsi) ? (
          <DashCell testId={`market-dash-${r.symbol}-rsi`} />
        ) : (
          <Text size="xs" data-testid={`market-rsi-${r.symbol}`}>
            {fmtNum(r.rsi)}
          </Text>
        );
      },
    },
    {
      id: "adx",
      header: "ADX",
      size: 42,
      accessorFn: (r) => r.adx,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return !finite(r.adx) ? (
          <DashCell testId={`market-dash-${r.symbol}-adx`} />
        ) : (
          <Text size="xs" data-testid={`market-adx-${r.symbol}`}>
            {fmtNum(r.adx)}
          </Text>
        );
      },
    },
    {
      id: "relative_volume",
      header: "RELVOL",
      size: 56,
      accessorFn: (r) => r.relativeVolume,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return !finite(r.relativeVolume) ? (
          <DashCell testId={`market-dash-${r.symbol}-relvol`} />
        ) : (
          <Text size="xs" data-testid={`market-relvol-${r.symbol}`}>
            {fmtNum(r.relativeVolume, 2)}x
          </Text>
        );
      },
    },
    {
      id: "market_cap_cr",
      header: `MCAP ${headerDescriptor.currencySymbol}${headerDescriptor.capUnit}`,
      size: 76,
      accessorFn: (r) => marketCapOf(r),
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        const descriptor = rowDescriptor(r);
        const cap = marketCapOf(r, descriptor);
        return cap === null ? (
          <DashCell testId={`market-dash-${r.symbol}-mcap`} />
        ) : (
          <Tooltip label={marketCapLabel(cap, descriptor)} position="top">
            <Text size="xs" data-testid={`market-mcap-${r.symbol}`}>
              {formatMarketCap(cap, descriptor)}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      id: "cap_tier",
      header: "CAP",
      size: 52,
      accessorFn: (r) => r.capTier ?? "",
      meta: { align: "center" },
      cell: ({ row }) => {
        const r = row.original;
        const tier = r.capTier;
        if (!tier) return <DashCell testId={`market-dash-${r.symbol}-cap-tier`} />;
        return (
          <Badge
            size="xs"
            variant="light"
            color={CAP_TIER_COLOR[tier] ?? "default"}
            data-testid={`market-captier-${r.symbol}`}
          >
            {tier.toUpperCase()}
          </Badge>
        );
      },
    },
    {
      id: "patterns",
      header: "PATTERNS",
      size: 104,
      // No `accessorFn` + no sorting on purpose. The value arrives per visible
      // window, so a sort would (a) rank every not-yet-loaded row as 0, and
      // (b) reorder rows under the cursor the moment the lookup lands.
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => {
        const r = row.original;
        return <PatternBadge symbol={r.symbol} item={handlers.patternsFor?.(r.symbol)} />;
      },
    },
  ];
  return handlers.hideSector ? columns.filter((column) => column.id !== "sector") : columns;
}
