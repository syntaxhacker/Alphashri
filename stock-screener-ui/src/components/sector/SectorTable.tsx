import { For, Show } from "solid-js";
import { Text, Badge, Progress, Box } from "@/ui";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import type { SectorItem } from "../../types/sector";
import { TanStackTable } from "../common/TanStackTable";
import { SymbolLink } from "../common/SymbolLink";
import { useSymbolDock } from "../common/symbolDockContext";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { formatSectorPercentage, normalizePercentText } from "./sectorUtils";
import { POSITIVE, NEGATIVE, TEXT_MUTED } from "@/ui/palette";

interface SectorTableProps {
  sectors: SectorItem[];
  market?: string;
  onSymbolClick?: (symbol: string) => void;
}

/** Sum of the column sizes + slack, so A/D and later columns scroll instead of being clipped. */
export const SECTOR_TABLE_MIN_WIDTH = 760;

export function getMovementBarValue(pctChange: number): { capped: number; color: string } {
  const normalized = (pctChange + 3) / 6;
  const capped = Math.max(0, Math.min(1, normalized)) * 100;
  // A value that prints 0.00% must also read neutral, not red because its
  // unrounded float was -0.001.
  const color = getPnLTextColor(Number(pctChange.toFixed(2)));
  return { capped, color };
}

export function getStrengthInfo(avgAdx: number): { label: string; color: string } {
  if (avgAdx > 25) return { label: "Strong", color: "green" };
  if (avgAdx < 15) return { label: "Weak", color: "red" };
  return { label: "Neutral", color: "gray" };
}

function getMovementBar(pctChange: number) {
  const { capped, color } = getMovementBarValue(pctChange);

  return (
    <Box className="flex w-[70px] flex-col items-center justify-center gap-0.5">
      <Progress value={capped} color={color} size="sm" radius="xl" />
      <Text
        data-testid="sector-move-delta"
        className="text-ui-micro font-mono tabular-nums"
        style={{ color: color === "success" ? POSITIVE : NEGATIVE }}
      >
        Δ {formatSectorPercentage(pctChange, 2)}
      </Text>
    </Box>
  );
}

function TopMoversCell(props: { text: string; onOpen?: (symbol: string) => void }) {
  const parts = () => Array.from(props.text.matchAll(/([A-Za-z0-9&._-]+)\(([+-]?\d+(?:\.\d+)?%)\)/g));
  const plainSymbols = () =>
    props.text.split(",").map((value) => value.trim()).filter(Boolean);

  const link = (symbol: string) => (
    <SymbolLink
      symbol={symbol}
      inAppText
      tvLink={false}
      showChart={false}
      showOptions={false}
      size="xs"
      weight={600}
      testId={`sector-top-mover-${symbol}`}
      onTextClick={(sym) => props.onOpen?.(sym)}
    />
  );

  return (
    <Show when={parts().length > 0} fallback={
      <Box className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <For each={plainSymbols()}>{(symbol) => link(symbol)}</For>
      </Box>
    }>
      <Box className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <For each={parts()}>
          {(part) => {
            const symbol = part[1];
            const raw = normalizePercentText(part[2]);
            return (
              <Text span className="text-ui-micro font-mono tabular-nums">
                {link(symbol)}
                <Box component="span" style={{ color: getPnLTextColor(parseFloat(raw)) === "success" ? POSITIVE : NEGATIVE, "font-weight": 600 }}>
                  ({raw})
                </Box>
              </Text>
            );
          }}
        </For>
      </Box>
    </Show>
  );
}

export function SectorTable(props: SectorTableProps) {
  const dock = useSymbolDock();
  const openSymbol = (symbol: string) =>
    props.onSymbolClick
      ? props.onSymbolClick(symbol)
      : dock.open(symbol, "chart", props.market);
  const columns: TableColumnDef<SectorItem>[] = [
    {
      id: "sector",
      header: () => <Box className="flex items-center justify-start">Sector</Box>,
      accessorKey: "sector",
      meta: { align: "left" },
      size: 180,
      cell: ({ row }) => <Box className="flex items-center justify-start whitespace-nowrap text-ui-micro font-semibold">{row.original.sector}</Box>,
    },
    {
      id: "avg_change",
      header: () => <Box className="flex items-center justify-end">Change</Box>,
      accessorKey: "avg_change",
      meta: { align: "right" },
      size: 80,
      cell: ({ row }) => {
        const val = row.original.avg_change;
        const rounded = Number(val.toFixed(2));
        const tone = getPnLTextColor(rounded);
        return (
          <Box
            className="flex items-center justify-end whitespace-nowrap font-semibold tabular-nums font-mono text-ui-micro"
            style={{
              color:
                tone === "success"
                  ? POSITIVE
                  : tone === "error"
                    ? NEGATIVE
                    : TEXT_MUTED,
            }}
          >
            {formatSectorPercentage(val, 2)}
          </Box>
        );
      },
    },
    {
      id: "movement",
      header: () => <Box className="flex items-center justify-center">Move</Box>,
      accessorKey: "avg_change",
      meta: { align: "center" },
      size: 100,
      cell: ({ row }) => <Box className="flex items-center justify-center">{getMovementBar(row.original.avg_change)}</Box>,
    },
    {
      id: "ad_ratio",
      header: () => <Box className="flex items-center justify-end">A/D</Box>,
      accessorFn: (row) => `${row.advances} : ${row.declines}`,
      meta: { align: "right" },
      size: 84,
      cell: ({ row }) => {
        const adColor = row.original.advances > row.original.declines
          ? POSITIVE
          : row.original.advances < row.original.declines
            ? NEGATIVE
            : TEXT_MUTED;
        return (
          <Box className="flex items-center justify-end whitespace-nowrap font-semibold tabular-nums font-mono text-ui-micro" style={{ color: adColor }}>
            {row.original.advances} : {row.original.declines}
          </Box>
        );
      },
    },
    {
      id: "strength",
      header: () => <Box className="flex items-center justify-center">ADX</Box>,
      accessorKey: "avg_adx",
      meta: { align: "center" },
      size: 72,
      cell: ({ row }) => {
        const { label, color } = getStrengthInfo(row.original.avg_adx);
        return (
          <Box className="flex items-center justify-center">
            <Badge color={color} variant="filled" size="xs">
              {label}
            </Badge>
          </Box>
        );
      },
    },
    {
      id: "top_movers",
      header: () => <Box className="flex items-center justify-start">Top Movers</Box>,
      accessorKey: "top_movers",
      meta: { align: "left" },
      size: 260,
      cell: ({ row }) => <TopMoversCell text={row.original.top_movers} onOpen={openSymbol} />,
    },
  ];

  return (
    <>
      <style data-testid="sector-table-sticky-style">{`
        [data-testid="sector-table"] th:first-child,
        [data-testid="sector-table"] td:first-child {
          position: sticky !important;
          left: 0 !important;
          z-index: 2;
          background-color: var(--color-fin-surface) !important;
          box-shadow: 1px 0 0 var(--color-fin-border);
        }
      `}</style>
      <TanStackTable<SectorItem>
        data={props.sectors}
        columns={columns}
        enableSorting={false}
        emptyMessage="No sector data available"
        dataTestId="sector-table"
        ariaLabel="Sector performance, scroll sideways for all columns"
        getRowTestId={(sector) => `sector-row-${sector.sector.toLowerCase()}`}
        dense
        fillContainer
        rowWindowSize={40}
        minTableWidth={SECTOR_TABLE_MIN_WIDTH}
      />
    </>
  );
}
