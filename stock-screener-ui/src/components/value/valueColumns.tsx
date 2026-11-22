import { For } from "solid-js";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import { Box } from "@/ui";
import type { ValueRow } from "../../api/valueScan";
import { SymbolLink } from "../common/SymbolLink";
import { chartHrefForSymbol, isInAppChartMarket } from "../common/symbolDockContext";
import { BadgeCell, DashCell, NumCell, TextCell } from "../common/tableCells";
import { ValueScoreCell } from "./ValueScoreCell";
import { formatValueMcap, formatValueNum, formatValuePct, formatValuePrice } from "./valueFormat";

const DASH = "–";

// Exchange → chart/options capability lives in symbolDockContext so every
// table agrees on what "US" and "in-app chart" mean.
export function isInAppChartExchange(exchange: string | undefined): boolean {
  return isInAppChartMarket(exchange);
}

export function buildChartHref(symbol: string, exchange?: string): string {
  return chartHrefForSymbol(symbol, exchange);
}

interface ValueCsvColumn {
  key: string;
  header: string;
}

const VALUE_CSV_COLUMNS: ValueCsvColumn[] = [
  { key: "symbol", header: "symbol" },
  { key: "name", header: "name" },
  { key: "exchange", header: "exchange" },
  { key: "price", header: "price" },
  { key: "change", header: "change_pct" },
  { key: "mcap_bn", header: "mcap_bn" },
  { key: "pe", header: "pe" },
  { key: "ps", header: "ps" },
  { key: "pb", header: "pb" },
  { key: "fcf_yield", header: "fcf_yield_pct" },
  { key: "roe", header: "roe_pct" },
  { key: "rev_yoy", header: "rev_yoy_pct" },
  { key: "score", header: "score" },
  { key: "bucket", header: "peer_bucket" },
  { key: "flags", header: "flags" },
  { key: "off_52w_high", header: "off_52w_high_pct" },
];

export const VALUE_CSV_HEADERS: string[] = VALUE_CSV_COLUMNS.map((c) => c.header);

/** A missing metric is an empty CSV cell — never the literal "NaN"/"undefined". */
function csvNumber(value: number | null | undefined): number | string {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

export function valueRowToCsvRow(row: ValueRow): (string | number)[] {
  return [
    row.symbol,
    row.name,
    row.exchange,
    csvNumber(row.price),
    csvNumber(row.change),
    csvNumber(row.mcap_bn),
    csvNumber(row.pe),
    csvNumber(row.ps),
    csvNumber(row.pb),
    csvNumber(row.fcf_yield),
    csvNumber(row.roe),
    csvNumber(row.rev_yoy),
    csvNumber(row.score),
    row.peer.bucket,
    row.flags.join("|"),
    csvNumber(row.off_52w_high),
  ];
}

export function escapeCsvCell(cell: string | number): string {
  const s = String(cell);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildValueColumns(
  onSymbolClick?: (symbol: string, exchange?: string) => void,
): ColumnDef<ValueRow>[] {
  return [
    {
      id: "name",
      header: "NAME",
      accessorFn: (r) => r.name ?? r.symbol,
      meta: { align: "left" },
      cell: ({ row }) => {
        const r = row.original;
        const inApp = isInAppChartExchange(r.exchange) && typeof onSymbolClick === "function";
        return (
          // Single-line identity: symbol + company·exchange. A stacked second
          // line doubled the row height (40px) for information the drawer
          // already carries; the full name stays in the tooltip.
          <Box className="flex min-w-0 items-center gap-[6px] text-left">
            <SymbolLink
              symbol={r.symbol}
              market={r.exchange}
              testId={`value-name-${r.symbol}`}
              chartTestId={`value-chart-${r.symbol}`}
              size="xs"
              weight={600}
              className="flex-shrink-0"
              inAppText={inApp}
              tvIcon={!inApp}
              onTextClick={inApp ? (sym) => onSymbolClick?.(sym, r.exchange) : undefined}
            />
            <TextCell
              value={`${r.name} · ${r.exchange}`}
              dimmed
              title={`${r.name} · ${r.exchange}`}
              testId={`value-subname-${r.symbol}`}
            />
          </Box>
        );
      },
    },
    {
      id: "price",
      header: "PRICE",
      accessorFn: (r) => r.price,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <NumCell
            value={r.price}
            dash={DASH}
            fw={500}
            format={(v) => formatValuePrice({ ...r, price: v })}
            testId={`value-price-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "change",
      header: "CH%",
      accessorFn: (r) => r.change,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <NumCell
            value={r.change}
            dash={DASH}
            signed
            fw={600}
            format={(v) => formatValuePct(v)}
            testId={`value-change-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "mcap",
      header: "MCAP",
      accessorFn: (r) => r.mcap_bn,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <NumCell
            value={r.mcap_bn}
            dash={DASH}
            format={(v) => formatValueMcap({ ...r, mcap_bn: v })}
            testId={`value-mcap-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "pe",
      header: "P/E",
      accessorFn: (r) => r.pe,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        if (r.pe === null) return <DashCell testId={`value-dash-${r.symbol}-pe`} />;
        return (
          <NumCell
            value={r.pe}
            dash={DASH}
            format={(v) => formatValueNum(v)}
            testId={`value-pe-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "ps",
      header: "P/S",
      accessorFn: (r) => r.ps,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        if (r.ps === null) return <DashCell testId={`value-dash-${r.symbol}-ps`} />;
        return (
          <NumCell
            value={r.ps}
            dash={DASH}
            format={(v) => formatValueNum(v)}
            testId={`value-ps-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "fcf",
      header: "FCF%",
      accessorFn: (r) => r.fcf_yield,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        if (r.fcf_yield === null) return <DashCell testId={`value-dash-${r.symbol}-fcf`} />;
        return (
          <NumCell
            value={r.fcf_yield}
            dash={DASH}
            format={(v) => formatValuePct(v)}
            testId={`value-fcf-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "roe",
      header: "ROE%",
      accessorFn: (r) => r.roe,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        if (r.roe === null) return <DashCell testId={`value-dash-${r.symbol}-roe`} />;
        return (
          <NumCell
            value={r.roe}
            dash={DASH}
            format={(v) => formatValuePct(v)}
            testId={`value-roe-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "rev",
      header: "REV%",
      accessorFn: (r) => r.rev_yoy,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        if (r.rev_yoy === null) return <DashCell testId={`value-dash-${r.symbol}-rev`} />;
        return (
          <NumCell
            value={r.rev_yoy}
            dash={DASH}
            format={(v) => formatValuePct(v)}
            testId={`value-rev-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "score",
      header: "SCORE",
      accessorFn: (r) => r.score,
      meta: { align: "center" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <ValueScoreCell score={r.score} subscores={r.subscores} peer={r.peer} symbol={r.symbol} />
        );
      },
    },
    {
      id: "flags",
      header: "FLAGS",
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => {
        const r = row.original;
        if (r.flags.length === 0) return <DashCell testId={`value-dash-${r.symbol}-flags`} />;
        return (
          <Box
            className="flex flex-nowrap justify-center gap-1 overflow-hidden"
            data-testid={`value-flags-${r.symbol}`}
          >
            <For each={r.flags.slice(0, 3)}>
              {(f) => <BadgeCell label={f.replace(/_/g, " ")} color="secondary" />}
            </For>
          </Box>
        );
      },
    },
    {
      id: "w52",
      header: "52W",
      accessorFn: (r) => r.off_52w_high,
      meta: { align: "right" },
      cell: ({ row }) => {
        const r = row.original;
        if (r.off_52w_high === null) return <DashCell testId={`value-dash-${r.symbol}-w52`} />;
        return (
          <NumCell
            value={r.off_52w_high}
            dash={DASH}
            format={(v) => formatValuePct(v)}
            testId={`value-w52-${r.symbol}`}
          />
        );
      },
    },
  ];
}
