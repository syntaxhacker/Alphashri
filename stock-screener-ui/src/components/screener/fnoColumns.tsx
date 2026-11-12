import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Box, Text, Tooltip } from "@/ui";
import { SymbolLink } from "../common/SymbolLink";
import type { FnoScreenerRow } from "../../api/fnoScreener";
import { formatNumber, formatPercentage } from "@/utils/ui-helpers";

function setupTone(setup: FnoScreenerRow["setup"]): "success" | "info" | "warning" | "secondary" | "error" {
  switch (setup) {
    case "BREAKOUT": return "success";
    case "NEAR HIGH": return "info";
    case "EXTENDED": return "warning";
    case "WEAK": return "error";
    default: return "secondary";
  }
}

function setupShort(setup: FnoScreenerRow["setup"]): string {
  switch (setup) {
    case "BREAKOUT": return "BRK";
    case "NEAR HIGH": return "NEAR";
    case "EXTENDED": return "EXT";
    default: return setup;
  }
}

function setupLabel(setup: FnoScreenerRow["setup"]): string {
  switch (setup) {
    case "BREAKOUT": return "BREAKOUT — at/above 20-day high with volume ≥1.1× average";
    case "NEAR HIGH": return "NEAR HIGH — within 2% of the 20-day high";
    case "EXTENDED": return "EXTENDED — 5D >12% or >15% above the 20-DMA";
    case "BASE": return "BASE — within ±3% of the 20-DMA, volume <1.1×";
    case "WEAK": return "WEAK — 1D and 5D both negative";
    case "WATCH": return "WATCH — mixed momentum";
    default: return setup;
  }
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return formatPercentage(value);
}

function plainPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return formatPercentage(value, 2, false);
}

function pctTone(value: number | null | undefined): "success" | "error" | "secondary" {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return "secondary";
  return value > 0 ? "success" : "error";
}

function money2(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fix2(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return value.toFixed(2);
}

export function buildFnoColumns(): ColumnDef<FnoScreenerRow>[] {
  return [
    {
      id: "expand",
      header: "",
      meta: { align: "center" } as never,
      enableSorting: false,
      size: 24,
      cell: ({ cell }) => {
        const row = cell.row;
        const expanded = row.getIsExpanded();
        return (
          <Box
            component="button"
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse details" : "Expand details"}
            data-testid={`fno-expand-${row.original.symbol}`}
            onClick={(e) => {
              e.stopPropagation();
              row.toggleExpanded();
            }}
            className="inline-flex h-[20px] min-w-[24px] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[11px] leading-none text-inherit"
          >
            {expanded ? "▼" : "▶"}
          </Box>
        );
      },
    },
    {
      id: "symbol",
      accessorFn: (r) => r.symbol,
      sortDescFirst: false,
      header: "SYMBOL",
      size: 124,
      minSize: 124,
      meta: { align: "left" } as never,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <SymbolLink
            symbol={r.symbol}
            market="NSE"
            showChart={false}
            showCopy
            size="xs"
            weight={600}
            testId={`fno-cell-symbol-${r.symbol}`}
          />
        );
      },
    },
    {
      id: "setup",
      accessorFn: (r) => r.setup,
      sortDescFirst: false,
      header: "SETUP",
      size: 120,
      minSize: 120,
      meta: { align: "center" } as never,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Tooltip label={setupLabel(r.setup)}>
            <Badge
              size="xs"
              color={setupTone(r.setup)}
              data-testid={`fno-cell-setup-${r.symbol}`}
              style={{ "white-space": "nowrap", "font-size": 9 }}
            >
              {setupShort(r.setup)}
            </Badge>
          </Tooltip>
        );
      },
    },
    {
      id: "call",
      accessorFn: (r) => r.call,
      sortDescFirst: false,
      header: "CALL",
      size: 76,
      meta: { align: "center" } as never,
      cell: ({ row }) => (
        <Text size="xs" fw={600} data-testid={`fno-cell-call-${row.original.symbol}`}>
          {row.original.call}
        </Text>
      ),
    },
    {
      id: "spot",
      accessorFn: (r) => r.spot,
      sortDescFirst: false,
      header: "SPOT",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-spot-${row.original.symbol}`}>
          {money2(row.original.spot)}
        </Text>
      ),
    },
    {
      id: "d1",
      accessorFn: (r) => r.d1,
      sortDescFirst: false,
      header: "1D%",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" c={pctTone(row.original.d1)} data-testid={`fno-cell-d1-${row.original.symbol}`}>
          {pct(row.original.d1)}
        </Text>
      ),
    },
    {
      id: "d5",
      accessorFn: (r) => r.d5,
      sortDescFirst: false,
      header: "5D%",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" c={pctTone(row.original.d5)} data-testid={`fno-cell-d5-${row.original.symbol}`}>
          {pct(row.original.d5)}
        </Text>
      ),
    },
    {
      id: "vol_ratio",
      accessorFn: (r) => r.vol_ratio,
      sortDescFirst: false,
      header: "VOL×",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-vol-${row.original.symbol}`}>
          {fix2(row.original.vol_ratio)}×
        </Text>
      ),
    },
    {
      id: "otm_pct",
      accessorFn: (r) => r.otm_pct,
      sortDescFirst: false,
      header: "OTM%",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-otm-${row.original.symbol}`}>
          {plainPct(row.original.otm_pct)}
        </Text>
      ),
    },
    {
      id: "premium",
      accessorFn: (r) => r.premium,
      sortDescFirst: false,
      header: "PREMIUM",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-premium-${row.original.symbol}`}>
          {money2(row.original.premium)}
        </Text>
      ),
    },
    {
      id: "cost_lot",
      accessorFn: (r) => r.cost_lot,
      sortDescFirst: false,
      header: "COST",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-cost-${row.original.symbol}`}>
          ₹{Math.round(row.original.cost_lot).toLocaleString("en-IN")}
        </Text>
      ),
    },
    {
      id: "pop",
      accessorFn: (r) => r.pop,
      sortDescFirst: false,
      header: "POP%",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-pop-${row.original.symbol}`}>
          {plainPct(row.original.pop)}
        </Text>
      ),
    },
    {
      id: "delta",
      accessorFn: (r) => r.delta,
      sortDescFirst: false,
      header: "DELTA",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-delta-${row.original.symbol}`}>
          {fix2(row.original.delta)}
        </Text>
      ),
    },
    {
      id: "gamma",
      accessorFn: (r) => r.gamma,
      sortDescFirst: false,
      header: "GAMMA",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-gamma-${row.original.symbol}`}>
          {fix2(row.original.gamma)}
        </Text>
      ),
    },
    {
      id: "theta",
      accessorFn: (r) => r.theta,
      sortDescFirst: false,
      header: "THETA",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-theta-${row.original.symbol}`}>
          {fix2(row.original.theta)}
        </Text>
      ),
    },
    {
      id: "vega",
      accessorFn: (r) => r.vega,
      sortDescFirst: false,
      header: "VEGA",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-vega-${row.original.symbol}`}>
          {fix2(row.original.vega)}
        </Text>
      ),
    },
    {
      id: "iv",
      accessorFn: (r) => r.iv,
      sortDescFirst: false,
      header: "IV%",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-iv-${row.original.symbol}`}>
          {plainPct(row.original.iv)}
        </Text>
      ),
    },
    {
      id: "oi",
      accessorFn: (r) => r.oi,
      sortDescFirst: false,
      header: "OI",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-oi-${row.original.symbol}`}>
          {formatNumber(row.original.oi)}
        </Text>
      ),
    },
    {
      id: "spread_pct",
      accessorFn: (r) => r.spread_pct,
      sortDescFirst: false,
      header: "SPREAD%",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-spread-${row.original.symbol}`}>
          {plainPct(row.original.spread_pct)}
        </Text>
      ),
    },
    {
      id: "move_2pct_est",
      accessorFn: (r) => r.move_2pct_est,
      sortDescFirst: false,
      header: "+2% est.",
      meta: { align: "right" } as never,
      cell: ({ row }) => (
        <Text size="xs" data-testid={`fno-cell-move-${row.original.symbol}`}>
          {pct(row.original.move_2pct_est)}
        </Text>
      ),
    },
  ];
}
