import { formatNumberIN } from "@/utils/ui-helpers";
import { createMemo } from "solid-js";
import type { TableColumnDef } from "../../common/TanStackTable";
import { Badge, Box, Text } from "@/ui";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { TanStackTable } from "../../common/TanStackTable";
import { hexToRgba } from "../OptionChain/cellPalette";
import { EM_DASH, formatCr, formatShares, type PositioningStrikeRow } from "@/utils/positioning";

interface PositioningStrikeTableProps {
  rows: PositioningStrikeRow[];
  maxAbsCr?: number;
}

type BadgeColor = "success" | "error" | "warning" | "info" | "default";

function classBadgeColor(cls: string | null): BadgeColor {
  switch (cls) {
    case "Long Buildup":
      return "success";
    case "Short Buildup":
      return "error";
    case "Short Covering":
      return "info";
    case "Long Unwinding":
      return "warning";
    default:
      return "default";
  }
}

function ClassCell(props: { cls: string | null }) {
  return (
    <Badge color={classBadgeColor(props.cls)} size="xs">
      {props.cls ?? EM_DASH}
    </Badge>
  );
}

/** Alpha wash scaled by |cr| / max, following the cellPalette.ts precedent. */
export function heatBg(cr: number | null, max: number): string | undefined {
  if (cr === null || cr === undefined || max <= 0) return undefined;
  const intensity = Math.min(Math.abs(cr) / max, 1);
  const alpha = 0.04 + intensity * 0.22;
  return hexToRgba(cr < 0 ? NEGATIVE : POSITIVE, alpha);
}

function CrCell(props: { cr: number | null; max: number }) {
  if (props.cr === null || props.cr === undefined) {
    return (
      <Text size="sm" c="dimmed">
        {EM_DASH}
      </Text>
    );
  }
  const bg = heatBg(props.cr, props.max);
  return (
    <Box
      style={{
        display: "inline-block",
        backgroundColor: bg,
        borderRadius: "1px",
        padding: "8px 4px",
        fontVariantNumeric: "tabular-nums",
        color: props.cr < 0 ? NEGATIVE : POSITIVE,
      }}
    >
      {formatCr(props.cr)}
    </Box>
  );
}

function SharesCell(props: { v: number | null }) {
  if (props.v === null || props.v === undefined) {
    return (
      <Text size="sm" c="dimmed">
        {EM_DASH}
      </Text>
    );
  }
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatShares(props.v)}</span>;
}

export function PositioningStrikeTable(props: PositioningStrikeTableProps) {
  const max = createMemo(() => {
    if (props.maxAbsCr !== undefined && props.maxAbsCr > 0) return props.maxAbsCr;
    let m = 0;
    for (const r of props.rows) {
      for (const v of [r.ce_cr, r.pe_cr, r.net_cr]) {
        if (v !== null && v !== undefined) m = Math.max(m, Math.abs(v));
      }
    }
    return m;
  });

  const columns: TableColumnDef<PositioningStrikeRow>[] = [
    {
      id: "strike",
      header: "Strike",
      accessorKey: "strike",
      meta: { align: "center" },
      cell: (ctx) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatNumberIN(ctx.row.original.strike)}
        </span>
      ),
    },
    {
      id: "ce_class",
      header: "Calls",
      accessorKey: "ce_class",
      meta: { align: "left" },
      cell: (ctx) => <ClassCell cls={ctx.row.original.ce_class} />,
    },
    {
      id: "ce_doi_shares",
      header: "ΔOI",
      accessorKey: "ce_doi_shares",
      meta: { align: "right" },
      cell: (ctx) => <SharesCell v={ctx.row.original.ce_doi_shares} />,
    },
    {
      id: "ce_cr",
      header: "Initiated Δ",
      accessorKey: "ce_cr",
      meta: { align: "right" },
      cell: (ctx) => <CrCell cr={ctx.row.original.ce_cr} max={max()} />,
    },
    {
      id: "pe_class",
      header: "Puts",
      accessorKey: "pe_class",
      meta: { align: "left" },
      cell: (ctx) => <ClassCell cls={ctx.row.original.pe_class} />,
    },
    {
      id: "pe_doi_shares",
      header: "ΔOI",
      accessorKey: "pe_doi_shares",
      meta: { align: "right" },
      cell: (ctx) => <SharesCell v={ctx.row.original.pe_doi_shares} />,
    },
    {
      id: "pe_cr",
      header: "Initiated Δ",
      accessorKey: "pe_cr",
      meta: { align: "right" },
      cell: (ctx) => <CrCell cr={ctx.row.original.pe_cr} max={max()} />,
    },
    {
      id: "net_cr",
      header: "Net initiated",
      accessorKey: "net_cr",
      meta: { align: "right" },
      cell: (ctx) => <CrCell cr={ctx.row.original.net_cr} max={max()} />,
    },
  ];

  return (
    <TanStackTable<PositioningStrikeRow>
      data={props.rows}
      columns={columns}
      bare
      dataTestId="positioning-strike-table"
      emptyMessage="No strikes to display"
      getRowTestId={(row) => `positioning-strike-row-${row.strike}`}
    />
  );
}
