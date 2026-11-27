import { typeSize } from "@/ui";
import type { JSX } from "solid-js";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import * as palette from "@/ui/palette";
import { formatExpiryHead, type PayoffRow, type PayoffTableExpiry } from "./payoffTableOption";

export interface PayoffColumnsArgs {
  expiries: PayoffTableExpiry[];
  prefix: string;
  renderStrikeCell: (row: PayoffRow, index: number) => JSX.Element;
  renderPnlCell: (row: PayoffRow, rowIndex: number, colIndex: number) => JSX.Element;
}

/** Column descriptors for the dense payoff table; kept beside the consumer. */
export function payoffColumns(args: PayoffColumnsArgs): TableColumnDef<PayoffRow>[] {
  return [
    {
      id: "strike",
      header: "STRIKE",
      meta: { align: "left" },
      size: 116,
      enableSorting: false,
      cell: (ctx) => args.renderStrikeCell(ctx.row.original, ctx.row.index),
    },
    ...args.expiries.map((expiry, colIndex): TableColumnDef<PayoffRow> => ({
      id: `exp-${colIndex}`,
      header: () => {
        const head = formatExpiryHead(expiry);
        return (
          <div
            className="flex flex-col items-end leading-tight"
            data-testid={`${args.prefix}-col-head-${colIndex}`}
          >
            <span
              className="uppercase"
              style={{ "font-size": `${typeSize("micro")}px`, color: palette.TEXT_MUTED, "letter-spacing": "0.06em" }}
            >
              {head.month}
            </span>
            <span className="font-mono tabular-nums" style={{ "font-size": `${typeSize("micro")}px`, color: palette.TEXT }}>
              {head.date}
            </span>
          </div>
        );
      },
      meta: { align: "right" },
      size: 92,
      enableSorting: false,
      cell: (ctx) => args.renderPnlCell(ctx.row.original, ctx.row.index, colIndex),
    })),
  ];
}
