import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
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

function ClassCell({ cls }: { cls: string | null }) {
  return (
    <Badge color={classBadgeColor(cls)} size="xs">
      {cls ?? EM_DASH}
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

function CrCell({ cr, max }: { cr: number | null; max: number }) {
  if (cr === null || cr === undefined) {
    return (
      <Text size="sm" c="dimmed">
        {EM_DASH}
      </Text>
    );
  }
  const bg = heatBg(cr, max);
  return (
    <Box
      sx={{
        display: "inline-block",
        bgcolor: bg,
        borderRadius: 1,
        px: 1,
        py: 0.5,
        fontVariantNumeric: "tabular-nums",
        color: cr < 0 ? NEGATIVE : POSITIVE,
      }}
    >
      {formatCr(cr)}
    </Box>
  );
}

function SharesCell({ v }: { v: number | null }) {
  if (v === null || v === undefined) {
    return (
      <Text size="sm" c="dimmed">
        {EM_DASH}
      </Text>
    );
  }
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatShares(v)}</span>;
}

export function PositioningStrikeTable({ rows, maxAbsCr }: PositioningStrikeTableProps) {
  const max = useMemo(() => {
    if (maxAbsCr !== undefined && maxAbsCr > 0) return maxAbsCr;
    let m = 0;
    for (const r of rows) {
      for (const v of [r.ce_cr, r.pe_cr, r.net_cr]) {
        if (v !== null && v !== undefined) m = Math.max(m, Math.abs(v));
      }
    }
    return m;
  }, [rows, maxAbsCr]);

  const columns: ColumnDef<PositioningStrikeRow>[] = useMemo(
    () => [
      {
        header: "Strike",
        accessorKey: "strike",
        meta: { align: "center" },
        cell: ({ getValue }) => (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {(getValue<number>()).toLocaleString("en-IN")}
          </span>
        ),
      },
      {
        header: "Calls",
        accessorKey: "ce_class",
        meta: { align: "left" },
        cell: ({ getValue }) => <ClassCell cls={getValue<string | null>()} />,
      },
      {
        header: "ΔOI",
        accessorKey: "ce_doi_shares",
        meta: { align: "right" },
        cell: ({ getValue }) => <SharesCell v={getValue<number | null>()} />,
      },
      {
        header: "Initiated Δ",
        accessorKey: "ce_cr",
        meta: { align: "right" },
        cell: ({ getValue }) => <CrCell cr={getValue<number | null>()} max={max} />,
      },
      {
        header: "Puts",
        accessorKey: "pe_class",
        meta: { align: "left" },
        cell: ({ getValue }) => <ClassCell cls={getValue<string | null>()} />,
      },
      {
        header: "ΔOI",
        accessorKey: "pe_doi_shares",
        meta: { align: "right" },
        cell: ({ getValue }) => <SharesCell v={getValue<number | null>()} />,
      },
      {
        header: "Initiated Δ",
        accessorKey: "pe_cr",
        meta: { align: "right" },
        cell: ({ getValue }) => <CrCell cr={getValue<number | null>()} max={max} />,
      },
      {
        header: "Net initiated",
        accessorKey: "net_cr",
        meta: { align: "right" },
        cell: ({ getValue }) => <CrCell cr={getValue<number | null>()} max={max} />,
      },
    ],
    [max],
  );

  return (
    <TanStackTable<PositioningStrikeRow>
      data={rows}
      columns={columns}
      bare
      dataTestId="positioning-strike-table"
      emptyMessage="No strikes to display"
      getRowTestId={(row) => `positioning-strike-row-${row.strike}`}
    />
  );
}
