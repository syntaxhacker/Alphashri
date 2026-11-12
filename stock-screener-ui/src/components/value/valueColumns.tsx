import type { JSX } from "solid-js";
import { For } from "solid-js";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import { Box, Badge, Text } from "@/ui";
import type { ValueRow } from "../../api/valueScan";
import { SymbolLink } from "../common/SymbolLink";
import { ValueScoreCell } from "./ValueScoreCell";
import {
  formatValueMcap,
  formatValueNum,
  formatValuePct,
  formatValuePrice,
} from "./valueFormat";

function dash(symbol: string, key: string): JSX.Element {
  return (
    <Text size="xs" c="dimmed" data-testid={`value-dash-${symbol}-${key}`}>
      –
    </Text>
  );
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

export function valueRowToCsvRow(row: ValueRow): (string | number)[] {
  return [
    row.symbol,
    row.name,
    row.exchange,
    row.price,
    row.change,
    row.mcap_bn,
    row.pe ?? "",
    row.ps ?? "",
    row.pb ?? "",
    row.fcf_yield ?? "",
    row.roe ?? "",
    row.rev_yoy ?? "",
    row.score,
    row.peer.bucket,
    row.flags.join("|"),
    row.off_52w_high ?? "",
  ];
}

export function escapeCsvCell(cell: string | number): string {
  const s = String(cell);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildValueColumns(): ColumnDef<ValueRow>[] {
  return [
    {
      id: "name",
      header: "NAME",
      meta: { align: "left" },
      cell: ({ row }) => {
        const r = row.original;
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
            />
            <Text
              size="xs"
              c="dimmed"
              truncate
              lh={1.15}
              title={`${r.name} · ${r.exchange}`}
              data-testid={`value-subname-${r.symbol}`}
              className="min-w-0 text-[10px]"
            >
              {r.name} · {r.exchange}
            </Text>
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
          <Text size="xs" fw={500} data-testid={`value-price-${r.symbol}`}>
            {formatValuePrice(r)}
          </Text>
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
          <Text
            size="xs"
            fw={600}
            c={r.change >= 0 ? "success" : "error"}
            data-testid={`value-change-${r.symbol}`}
          >
            {formatValuePct(r.change)}
          </Text>
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
          <Text size="xs" data-testid={`value-mcap-${r.symbol}`}>
            {formatValueMcap(r)}
          </Text>
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
        if (r.pe === null) return dash(r.symbol, "pe");
        return (
          <Text size="xs" data-testid={`value-pe-${r.symbol}`}>
            {formatValueNum(r.pe)}
          </Text>
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
        if (r.ps === null) return dash(r.symbol, "ps");
        return (
          <Text size="xs" data-testid={`value-ps-${r.symbol}`}>
            {formatValueNum(r.ps)}
          </Text>
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
        if (r.fcf_yield === null) return dash(r.symbol, "fcf");
        return (
          <Text size="xs" data-testid={`value-fcf-${r.symbol}`}>
            {formatValuePct(r.fcf_yield)}
          </Text>
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
        if (r.roe === null) return dash(r.symbol, "roe");
        return (
          <Text size="xs" data-testid={`value-roe-${r.symbol}`}>
            {formatValuePct(r.roe)}
          </Text>
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
        if (r.rev_yoy === null) return dash(r.symbol, "rev");
        return (
          <Text size="xs" data-testid={`value-rev-${r.symbol}`}>
            {formatValuePct(r.rev_yoy)}
          </Text>
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
        if (r.flags.length === 0) return dash(r.symbol, "flags");
        return (
          <Box
            className="flex flex-nowrap justify-center gap-1 overflow-hidden"
            data-testid={`value-flags-${r.symbol}`}
          >
            <For each={r.flags.slice(0, 3)}>
              {(f) => (
                <Badge size="xs" color="secondary">
                  {f.replace(/_/g, " ")}
                </Badge>
              )}
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
        if (r.off_52w_high === null) return dash(r.symbol, "w52");
        return (
          <Text size="xs" data-testid={`value-w52-${r.symbol}`}>
            {formatValuePct(r.off_52w_high)}
          </Text>
        );
      },
    },
  ];
}
