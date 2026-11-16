import type { TableColumnDef } from "@/components/common/TanStackTable";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import type { ChainLeg, ChainRow } from "@/api/optionsDock";
import { formatNumber } from "@/utils/ui-helpers";

/**
 * Chain column definitions.
 *
 * Column order is the wireframe contract: CE side reads outward-in as
 * `OI IV Δ LTP`, the strike sits in the middle, and the PE side mirrors it as
 * `LTP Δ IV OI`. Numbers are right-aligned, the strike is centred — and the
 * wrapper's own `justify` matches `meta.align`, which is where the centring
 * bug comes from when the two disagree.
 */

const DASH = "—";

function fmtGreek(value: number | null, digits: number): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value.toFixed(digits);
}

function fmtIv(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return DASH;
  return value.toFixed(1);
}

const CELL = "block w-full font-mono tabular-nums text-[10px] leading-none";

/** A clickable price cell: buy on click, sell on shift-click. */
function PriceCell(props: {
  leg: ChainLeg;
  optionType: "CE" | "PE";
  strike: number;
  onPick?: (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => void;
  align?: "right" | "left";
}) {
  const label = () =>
    `${props.optionType === "CE" ? "Call" : "Put"} ${props.strike} · buy · shift-click to sell`;
  return (
    <Box
      component="button"
      type="button"
      aria-label={label()}
      title={label()}
      data-testid={`options-${props.optionType.toLowerCase()}-${props.strike}`}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        props.onPick?.(props.strike, props.optionType, props.leg, event.shiftKey ? "sell" : "buy");
      }}
      className={`${CELL} cursor-pointer border-0 bg-transparent p-0 text-fin-text hover:text-fin-primary`}
      style={{ "text-align": props.align ?? "right" }}
    >
      {props.leg.ltp == null ? DASH : props.leg.ltp.toFixed(1)}
    </Box>
  );
}

/** A one-`div` OI bar: length is `oi / max(oi)`, floored at 1px. No canvas. */
function OiCell(props: { value: number; max: number; side: "ce" | "pe" }) {
  const pct = () => {
    const max = props.max;
    if (!(max > 0) || !Number.isFinite(props.value)) return 0;
    return Math.max(1, Math.min(100, (props.value / max) * 100));
  };
  const fill = () => (props.side === "ce" ? palette.TINT_POSITIVE : palette.TINT_NEGATIVE);
  return (
    <Box className="relative flex h-[13px] w-full items-center justify-end">
      <Box
        aria-hidden="true"
        className="absolute right-0 top-0 h-[13px]"
        style={{ width: `${pct()}%`, "background-color": fill() }}
      />
      <span className={`${CELL} relative`}>{props.value > 0 ? formatNumber(props.value) : DASH}</span>
    </Box>
  );
}

export interface ChainColumnHandlers {
  /** Largest OI on either side — the OI bar denominator. */
  maxOi: () => number;
  onPick?: (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => void;
}

export function chainColumns(handlers: ChainColumnHandlers): TableColumnDef<ChainRow>[] {
  const ceIn = (row: ChainRow) => row.ce;
  const peIn = (row: ChainRow) => row.pe;

  const columnDefs: TableColumnDef<ChainRow>[] = [
    {
      id: "ce_oi",
      header: "OI",
      size: 54,
      meta: { align: "right" },
      accessorFn: (row) => row.ce.oi,
      cell: ({ row }) => <OiCell value={row.original.ce.oi} max={handlers.maxOi()} side="ce" />,
    },
    {
      id: "ce_iv",
      header: "IV",
      size: 38,
      meta: { align: "right" },
      accessorFn: (row) => row.ce.iv,
      cell: ({ row }) => <span className={CELL}>{fmtIv(row.original.ce.iv)}</span>,
    },
    {
      id: "ce_delta",
      header: "Δ",
      size: 34,
      meta: { align: "right" },
      accessorFn: (row) => row.ce.delta,
      cell: ({ row }) => <span className={CELL}>{fmtGreek(row.original.ce.delta, 2)}</span>,
    },
    {
      id: "ce_ltp",
      header: "LTP",
      size: 52,
      meta: { align: "right" },
      accessorFn: (row) => row.ce.ltp,
      cell: ({ row }) => (
        <PriceCell
          leg={ceIn(row.original)}
          optionType="CE"
          strike={row.original.strike}
          onPick={handlers.onPick}
        />
      ),
    },
    {
      id: "strike",
      header: "STRIKE",
      size: 72,
      meta: { align: "center" },
      accessorFn: (row) => row.strike,
      cell: ({ row }) => (
        <span className={`${CELL} text-center text-fin-text-muted`}>
          {row.original.strike.toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      id: "pe_ltp",
      header: "LTP",
      size: 52,
      meta: { align: "right" },
      accessorFn: (row) => row.pe.ltp,
      cell: ({ row }) => (
        <PriceCell
          leg={peIn(row.original)}
          optionType="PE"
          strike={row.original.strike}
          onPick={handlers.onPick}
        />
      ),
    },
    {
      id: "pe_delta",
      header: "Δ",
      size: 34,
      meta: { align: "right" },
      accessorFn: (row) => row.pe.delta,
      cell: ({ row }) => <span className={CELL}>{fmtGreek(row.original.pe.delta, 2)}</span>,
    },
    {
      id: "pe_iv",
      header: "IV",
      size: 38,
      meta: { align: "right" },
      accessorFn: (row) => row.pe.iv,
      cell: ({ row }) => <span className={CELL}>{fmtIv(row.original.pe.iv)}</span>,
    },
    {
      id: "pe_oi",
      header: "OI",
      size: 54,
      meta: { align: "right" },
      accessorFn: (row) => row.pe.oi,
      cell: ({ row }) => <OiCell value={row.original.pe.oi} max={handlers.maxOi()} side="pe" />,
    },
  ];

  return columnDefs;
}
