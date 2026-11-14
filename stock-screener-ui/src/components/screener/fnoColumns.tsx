import type { TableColumnDef } from "../common/TanStackTable";
import { Box, Tooltip } from "@/ui";
import { BadgeCell, NumCell, TextCell } from "../common/tableCells";
import { SymbolLink } from "../common/SymbolLink";
import type { FnoScreenerRow } from "../../api/fnoScreener";
import { formatNumber, formatPercentage } from "@/utils/ui-helpers";

function setupTone(
  setup: FnoScreenerRow["setup"],
): "success" | "info" | "warning" | "secondary" | "error" {
  switch (setup) {
    case "BREAKOUT":
      return "success";
    case "NEAR HIGH":
      return "info";
    case "EXTENDED":
      return "warning";
    case "WEAK":
      return "error";
    default:
      return "secondary";
  }
}

function setupShort(setup: FnoScreenerRow["setup"]): string {
  switch (setup) {
    case "BREAKOUT":
      return "BRK";
    case "NEAR HIGH":
      return "NEAR";
    case "EXTENDED":
      return "EXT";
    default:
      return setup;
  }
}

function setupLabel(setup: FnoScreenerRow["setup"]): string {
  switch (setup) {
    case "BREAKOUT":
      return "BREAKOUT — at/above 20-day high with volume ≥1.1× average";
    case "NEAR HIGH":
      return "NEAR HIGH — within 2% of the 20-day high";
    case "EXTENDED":
      return "EXTENDED — 5D >12% or >15% above the 20-DMA";
    case "BASE":
      return "BASE — within ±3% of the 20-DMA, volume <1.1×";
    case "WEAK":
      return "WEAK — 1D and 5D both negative";
    case "WATCH":
      return "WATCH — mixed momentum";
    default:
      return setup;
  }
}

const DASH = "–";

/** Zero is the neutral reading for a momentum column, not a gain. */
function pctTone(value: number): "dimmed" | undefined {
  return value === 0 ? "dimmed" : undefined;
}

function money2(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildFnoColumns(): TableColumnDef<FnoScreenerRow>[] {
  return [
    {
      id: "expand",
      header: "",
      meta: { align: "center" },
      enableSorting: false,
      size: 24,
      cell: ({ row }) => {
        const expanded = row.isExpanded();
        return (
          <Box
            component="button"
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse details" : "Expand details"}
            data-testid={`fno-expand-${row.original.symbol}`}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              row.toggle();
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
      header: "SYMBOL",
      size: 124,
      meta: { align: "left" },
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
      header: "SETUP",
      size: 120,
      meta: { align: "center" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Tooltip label={setupLabel(r.setup)}>
            <BadgeCell
              label={setupShort(r.setup)}
              color={setupTone(r.setup)}
              testId={`fno-cell-setup-${r.symbol}`}
            />
          </Tooltip>
        );
      },
    },
    {
      id: "call",
      accessorFn: (r) => r.call,
      header: "CALL",
      size: 76,
      meta: { align: "left" },
      cell: ({ row }) => (
        <TextCell
          value={row.original.call}
          fw={600}
          testId={`fno-cell-call-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "spot",
      accessorFn: (r) => r.spot,
      header: "SPOT",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.spot}
          dash={DASH}
          format={money2}
          testId={`fno-cell-spot-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "d1",
      accessorFn: (r) => r.d1,
      header: "1D%",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.d1}
          dash={DASH}
          signed
          tone={pctTone(row.original.d1)}
          format={formatPercentage}
          testId={`fno-cell-d1-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "d5",
      accessorFn: (r) => r.d5,
      header: "5D%",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.d5}
          dash={DASH}
          signed
          tone={pctTone(row.original.d5)}
          format={formatPercentage}
          testId={`fno-cell-d5-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "vol_ratio",
      accessorFn: (r) => r.vol_ratio,
      header: "VOL×",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.vol_ratio}
          dash={DASH}
          format={(v) => `${v.toFixed(2)}×`}
          testId={`fno-cell-vol-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "otm_pct",
      accessorFn: (r) => r.otm_pct,
      header: "OTM%",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.otm_pct}
          dash={DASH}
          format={(v) => formatPercentage(v, 2, false)}
          testId={`fno-cell-otm-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "premium",
      accessorFn: (r) => r.premium,
      header: "PREMIUM",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.premium}
          dash={DASH}
          format={money2}
          testId={`fno-cell-premium-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "cost_lot",
      accessorFn: (r) => r.cost_lot,
      header: "COST",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.cost_lot}
          dash={DASH}
          format={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`}
          testId={`fno-cell-cost-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "pop",
      accessorFn: (r) => r.pop,
      header: "POP%",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.pop}
          dash={DASH}
          format={(v) => formatPercentage(v, 2, false)}
          testId={`fno-cell-pop-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "delta",
      accessorFn: (r) => r.delta,
      header: "DELTA",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.delta}
          dash={DASH}
          format={(v) => v.toFixed(2)}
          testId={`fno-cell-delta-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "gamma",
      accessorFn: (r) => r.gamma,
      header: "GAMMA",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.gamma}
          dash={DASH}
          format={(v) => v.toFixed(2)}
          testId={`fno-cell-gamma-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "theta",
      accessorFn: (r) => r.theta,
      header: "THETA",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.theta}
          dash={DASH}
          format={(v) => v.toFixed(2)}
          testId={`fno-cell-theta-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "vega",
      accessorFn: (r) => r.vega,
      header: "VEGA",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.vega}
          dash={DASH}
          format={(v) => v.toFixed(2)}
          testId={`fno-cell-vega-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "iv",
      accessorFn: (r) => r.iv,
      header: "IV%",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.iv}
          dash={DASH}
          format={(v) => formatPercentage(v, 2, false)}
          testId={`fno-cell-iv-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "oi",
      accessorFn: (r) => r.oi,
      header: "OI",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.oi}
          dash={DASH}
          format={formatNumber}
          testId={`fno-cell-oi-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "spread_pct",
      accessorFn: (r) => r.spread_pct,
      header: "SPREAD%",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.spread_pct}
          dash={DASH}
          format={(v) => formatPercentage(v, 2, false)}
          testId={`fno-cell-spread-${row.original.symbol}`}
        />
      ),
    },
    {
      id: "move_2pct_est",
      accessorFn: (r) => r.move_2pct_est,
      header: "+2% est.",
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell
          value={row.original.move_2pct_est}
          dash={DASH}
          format={formatPercentage}
          testId={`fno-cell-move-${row.original.symbol}`}
        />
      ),
    },
  ];
}
