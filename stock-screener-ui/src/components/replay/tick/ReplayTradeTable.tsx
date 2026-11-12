import { memo, useMemo } from "react";
import { Text, Chip } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../../paper-trading/TanStackTable";
import { SideBadge, ExitReasonBadge } from "@/components/common";
import { formatDuration, getPnLTextColor } from "@/utils/ui-helpers";
import { TZ_IST } from "@/config/constants";
import * as palette from "@/ui/palette";
import { IconChevronRight, IconChevronDown } from "@tabler/icons-react";
import type { ReplayTrade } from "./types";
import { Box } from "../../paper-trading/primitives";

export type RTrade = ReplayTrade;

const fmtT = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });

const fmtPts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box
      style={{
        display: "flex",
        "align-items": "center",
        gap: "3px",
        padding: "1px 0",
        borderBottom: `1px solid ${palette.BORDER}`,
      }}
    >
      <Text size="xs" style={{ "line-height": 1.1, "min-width": "72px", "flex-shrink": 0, "font-size": "11px", color: palette.TEXT_MUTED }}>
        {label}
      </Text>
      <Text size="xs" fw={600} style={{ "line-height": 1.2, "font-size": "11px", fontFamily: "monospace", color: color ?? palette.TEXT }}>
        {value}
      </Text>
    </Box>
  );
}

/** Expanded detail: same Entry/Exit context-grid language as the paper trade history. */
const ReplayTradeStats = memo(function ReplayTradeStats({ trade, clock }: { trade: ReplayTrade; clock: number }) {
  const closed = trade.exit_time <= clock;
  const risk = Math.abs(trade.entry - trade.sl);
  return (
    <Box
      style={{
        display: "grid",
        "grid-template-columns": "1fr",
        gap: "6px",
        width: "100%",
        "justify-content": "center",
        "max-width": 540,
        "margin-left": "auto",
        "margin-right": "auto",
        padding: "4px 0",
      }}
    >
      <Box
        style={{
          padding: "2px",
          border: `1px solid ${palette.BORDER}`,
          "border-radius": "4px",
          "background-color": palette.SURFACE,
          "min-width": 0,
        }}
      >
        <Text size="xs" fw={700} style={{ color: palette.TEXT_MUTED, "font-size": "10px", "letter-spacing": 0.6, display: "block", "margin-bottom": "2px", borderBottom: `1px solid ${palette.BORDER}` }}>
          ENTRY
        </Text>
        <StatRow label="Time" value={fmtT(trade.time)} />
        <StatRow label="Price" value={trade.entry.toFixed(1)} />
        <StatRow label="Stop" value={trade.sl.toFixed(1)} color={palette.NEGATIVE} />
        <StatRow label="Target" value={trade.tp != null ? trade.tp.toFixed(1) : "trail"} color={palette.POSITIVE} />
        <StatRow label="Risk" value={`${risk.toFixed(1)} pts`} color={palette.TEXT_MUTED} />
      </Box>
      <Box
        style={{
          padding: "2px",
          border: `1px solid ${palette.BORDER}`,
          "border-radius": "4px",
          "background-color": palette.SURFACE,
          "min-width": 0,
        }}
      >
        <Text size="xs" fw={700} style={{ color: palette.TEXT_MUTED, "font-size": "10px", "letter-spacing": 0.6, display: "block", "margin-bottom": "2px", borderBottom: `1px solid ${palette.BORDER}` }}>
          EXIT
        </Text>
        <StatRow label="Time" value={closed ? fmtT(trade.exit_time) : "…"} />
        <StatRow label="Price" value={closed ? trade.exit.toFixed(1) : "…"} />
        <StatRow label="Hold" value={closed ? formatDuration((trade.exit_time - trade.time) / 60) : "…"} color={palette.TEXT_MUTED} />
        <StatRow label="P&L" value={closed ? `${fmtPts(trade.pnl)} pts` : "…"} color={closed ? (trade.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE) : undefined} />
        <StatRow label="R" value={closed ? `${trade.rr >= 0 ? "+" : ""}${trade.rr.toFixed(1)}R` : "…"} color={closed ? (trade.rr >= 0 ? palette.POSITIVE : palette.NEGATIVE) : undefined} />
        <Box style={{ display: "flex", "align-items": "center", gap: "3px", padding: "1px 0" }}>
          <Text size="xs" style={{ "line-height": 1.1, "min-width": "72px", "flex-shrink": 0, "font-size": "11px", color: palette.TEXT_MUTED }}>
            Reason
          </Text>
          {closed ? <ExitReasonBadge reason={trade.result} /> : <Chip size="small" label="OPEN" color="warning" style={{ height: "18px", "font-size": "9px" }} />}
        </Box>
      </Box>
    </Box>
  );
});

export function ReplayTradeTable({ trades, clock, onSelectTime }: {
  trades: ReplayTrade[];
  clock: number;
  onSelectTime: (t: number) => void;
}) {
  const columns = useMemo<ColumnDef<ReplayTrade>[]>(
    () => [
      {
        id: "toggle",
        header: "",
        enableSorting: false,
        size: 32,
        meta: { align: "center" },
        cell: ({ row }) => (
          <Box
            role="button" aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); row.toggleExpanded(); }}
            data-testid={`replay-trade-toggle-${row.original.time}-${row.original.side}`}
            className="inline-flex cursor-pointer"
            style={{ color: palette.TEXT_MUTED }}
          >
            {row.getIsExpanded() ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </Box>
        ),
      },
      {
        id: "time",
        header: "Time",
        accessorKey: "time",
        meta: { align: "left" },
        cell: ({ row }) => (
          <Text size="xs" className="font-mono" style={{ "font-size": "11px" }}>
            {fmtT(row.original.time)}
          </Text>
        ),
      },
      {
        id: "side",
        header: "Side",
        accessorKey: "side",
        meta: { align: "center" },
        cell: ({ row }) => <SideBadge side={row.original.side} />,
      },
      {
        id: "entry",
        header: "Entry",
        accessorKey: "entry",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" className="font-mono" style={{ "font-size": "11px" }}>{row.original.entry.toFixed(1)}</Text>
        ),
      },
      {
        id: "sl",
        header: "SL",
        accessorKey: "sl",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" className="font-mono" style={{ "font-size": "11px" }}>{row.original.sl.toFixed(1)}</Text>
        ),
      },
      {
        id: "tp",
        header: "TP",
        accessorKey: "tp",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" className="font-mono" style={{ "font-size": "11px" }}>{row.original.tp != null ? row.original.tp.toFixed(1) : "trail"}</Text>
        ),
      },
      {
        id: "exit",
        header: "Exit",
        accessorKey: "exit",
        meta: { align: "right" },
        cell: ({ row }) => {
          const t = row.original;
          return t.exit_time <= clock ? (
            <Text size="xs" className="font-mono" style={{ "font-size": "11px" }}>{t.exit.toFixed(1)}</Text>
          ) : (
            <Text size="xs" className="font-mono" style={{ color: palette.TEXT_MUTED, "font-size": "11px" }}>…</Text>
          );
        },
      },
      {
        id: "hold",
        header: "Hold",
        meta: { align: "right" },
        accessorFn: (t) => (t.exit_time <= clock ? t.exit_time - t.time : -1),
        cell: ({ row }) => {
          const t = row.original;
          return (
            <Text size="xs" style={{ color: palette.TEXT_MUTED, "font-size": "11px" }}>
              {t.exit_time <= clock ? formatDuration((t.exit_time - t.time) / 60) : "…"}
            </Text>
          );
        },
      },
      {
        id: "pnl",
        header: "P&L",
        accessorKey: "pnl",
        meta: { align: "right" },
        cell: ({ row }) => {
          const t = row.original;
          if (t.exit_time > clock) return <Text size="xs" style={{ color: palette.TEXT_MUTED, "font-size": "11px" }}>…</Text>;
          return (
            <Text
              size="xs"
              data-testid={`replay-pnl-${t.time}`}
              fw={600}
              className="font-mono"
              style={{ "font-size": "11px", color: getPnLTextColor(t.pnl) === "success" ? palette.POSITIVE : palette.NEGATIVE }}
            >
              {fmtPts(t.pnl)}
            </Text>
          );
        },
      },
      {
        id: "rr",
        header: "R",
        accessorKey: "rr",
        meta: { align: "right" },
        cell: ({ row }) => {
          const t = row.original;
          if (t.exit_time > clock) return <Text size="xs" style={{ color: palette.TEXT_MUTED, "font-size": "11px" }}>…</Text>;
          return (
            <Text
              size="xs"
              fw={600}
              className="font-mono"
              style={{ "font-size": "11px", color: t.rr >= 0 ? palette.POSITIVE : palette.NEGATIVE }}
            >
              {t.rr >= 0 ? "+" : ""}{t.rr.toFixed(1)}R
            </Text>
          );
        },
      },
      {
        id: "result",
        header: "Exit",
        accessorKey: "result",
        meta: { align: "center" },
        enableSorting: false,
        cell: ({ row }) => {
          const t = row.original;
          return t.exit_time <= clock
            ? <ExitReasonBadge reason={t.result} />
            : <Chip size="small" label="OPEN" color="warning" style={{ height: "18px", "font-size": "9px" }} />;
        },
      },
    ],
    [clock],
  );

  return (
    <TanStackTable<ReplayTrade>
      className="replay-trade-table"
      data={trades}
      columns={columns}
      initialState={{ sorting: [{ id: "time", desc: false }] }}
      enableSortingRemoval={false}
      getRowCanExpand={() => true}
      renderSubComponent={(t) => <ReplayTradeStats trade={t} clock={clock} />}
      getRowTestId={(t) => `replay-trade-row-${t.time}-${t.side}`}
      onRowClick={(t) => onSelectTime(t.time)}
      stickyHeader
      dense
      emptyMessage="Press Play — entries print as ticks cross their signals."
    />
  );
}
