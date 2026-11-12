import type { JSX } from "solid-js";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import { Badge, Box, Text, Tooltip } from "@/ui";
import { SymbolLink } from "../common/SymbolLink";
import type { MarketRow } from "../../types/marketScreener";

const DASH = "–";

function fmtPrice(value: number | null): string {
  if (value === null) return DASH;
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(value: number | null, signed = true): string {
  if (value === null) return DASH;
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function fmtNum(value: number | null, digits = 1): string {
  if (value === null) return DASH;
  return value.toFixed(digits);
}

function fmtCr(value: number | null): string {
  if (value === null) return DASH;
  return Math.round(value).toLocaleString("en-IN");
}

function pctColor(value: number | null): "success" | "error" | undefined {
  if (value === null) return undefined;
  return value >= 0 ? "success" : "error";
}

function dash(symbol: string, key: string) {
  return (
    <Text size="xs" c="dimmed" data-testid={`market-dash-${symbol}-${key}`}>
      {DASH}
    </Text>
  );
}

const NAME_TEXT_CLASS = "block max-w-[110px]";
const SECTOR_TEXT_CLASS = "block max-w-[80px]";
const SYMBOL_CELL_CLASS = "flex min-w-0 items-center gap-1";
const SYMBOL_LINK_CLASS = "min-w-0 flex-[1_1_auto]";
const BADGE_WRAP_CLASS = "inline-flex flex-shrink-0";
const WEEK52_TRACK_CLASS =
  "relative mx-auto h-[6px] w-[48px] overflow-hidden rounded-[3px] bg-fin-border";
const WEEK52_FILL_CLASS = "absolute left-0 top-0 bottom-0 rounded-[3px] bg-fin-primary";

const CAP_TIER_COLOR: Record<string, "primary" | "info" | "warning" | "default"> = {
  large: "primary",
  mid: "info",
  small: "warning",
  micro: "default",
};

/** Horizontal 52-week position bar (0–100), coloured by proximity to the high. */
function Week52Bar({ row }: { row: MarketRow }) {
  const pos = row.pos52w;
  if (pos === null) return <>{dash(row.symbol, "week52")}</>;
  const clamped = Math.max(0, Math.min(100, pos));
  const title =
    row.high52w !== null && row.low52w !== null
      ? `52W range ₹${row.low52w.toLocaleString("en-IN")}–₹${row.high52w.toLocaleString("en-IN")} · at ${clamped.toFixed(0)}%`
      : `52W position ${clamped.toFixed(0)}%`;
  return (
    <Tooltip label={title}>
      <Box
        role="img"
        aria-label={title}
        data-testid={`market-52w-${row.symbol}`}
        className={WEEK52_TRACK_CLASS}
      >
        <Box
          className={WEEK52_FILL_CLASS}
          style={{ width: `${clamped}%` }}
        />
      </Box>
    </Tooltip>
  );
}

export function buildMarketColumns(): ColumnDef<MarketRow>[] {
  return [
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
              testId={`market-symbol-${r.symbol}`}
              chartTestId={`market-chart-${r.symbol}`}
              size="xs"
              weight={600}
              className={SYMBOL_LINK_CLASS}
            />
            {r.fno ? (
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
          dash(r.symbol, "sector")
        );
      },
    },
    {
      id: "close",
      header: "LTP",
      size: 70,
      accessorFn: (r) => r.close ?? 0,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return r.close === null ? (
          dash(r.symbol, "close")
        ) : (
          <Text size="xs" fw={600} data-testid={`market-close-${r.symbol}`}>
            ₹{fmtPrice(r.close)}
          </Text>
        );
      },
    },
    {
      id: "change",
      header: "DAY %",
      size: 60,
      accessorFn: (r) => r.change ?? 0,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return r.change === null ? (
          dash(r.symbol, "change")
        ) : (
          <Text size="xs" fw={600} c={pctColor(r.change)} data-testid={`market-change-${r.symbol}`}>
            {fmtPct(r.change)}
          </Text>
        );
      },
    },
    {
      id: "perf_w",
      header: "1W %",
      size: 54,
      accessorFn: (r) => r.perfW ?? 0,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return r.perfW === null ? (
          dash(r.symbol, "perf-w")
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
      accessorFn: (r) => r.perf1m ?? 0,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return r.perf1m === null ? (
          dash(r.symbol, "perf-1m")
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
      accessorFn: (r) => r.pos52w ?? 0,
      meta: { align: "center" },
      cell: ({ row }) => <Week52Bar row={row.original} />,
    },
    {
      id: "rsi",
      header: "RSI",
      size: 42,
      accessorFn: (r) => r.rsi ?? 0,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return r.rsi === null ? (
          dash(r.symbol, "rsi")
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
      accessorFn: (r) => r.adx ?? 0,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return r.adx === null ? (
          dash(r.symbol, "adx")
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
      accessorFn: (r) => r.relativeVolume ?? 0,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return r.relativeVolume === null ? (
          dash(r.symbol, "relvol")
        ) : (
          <Text size="xs" data-testid={`market-relvol-${r.symbol}`}>
            {fmtNum(r.relativeVolume, 2)}x
          </Text>
        );
      },
    },
    {
      id: "market_cap_cr",
      header: "MCAP ₹Cr",
      size: 76,
      accessorFn: (r) => r.marketCapCr ?? 0,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return r.marketCapCr === null ? (
          dash(r.symbol, "mcap")
        ) : (
          <Text size="xs" data-testid={`market-mcap-${r.symbol}`}>
            {fmtCr(r.marketCapCr)}
          </Text>
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
        if (!tier) return dash(r.symbol, "cap-tier");
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
  ];
}
