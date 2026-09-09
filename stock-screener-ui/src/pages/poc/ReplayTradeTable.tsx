import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackTable, SideBadge, ExitReasonBadge } from "@/components/common";
import { formatDuration, getPnLTextColor } from "@/utils/ui-helpers";
import { TZ_IST } from "@/config/constants";
import * as palette from "@/ui/palette";
import { IconChevronRight, IconChevronDown } from "@tabler/icons-react";

export type RTrade = {
  time: number; exit_time: number; side: "LONG" | "SHORT"; kind: string;
  entry: number; sl: number; tp: number; exit: number;
  result: "TP" | "SL" | "EOD"; pnl: number; rr: number;
};

const fmtT = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });

const fmtPts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", py: 0.35, gap: 0.35, borderBottom: "1px solid var(--mui-palette-divider)", "&:last-child": { borderBottom: 0, pb: 0 } }}>
      <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, lineHeight: 1.1, minWidth: 72, flexShrink: 0, fontSize: 11 }}>{label}</Typography>
      <Typography variant="caption" sx={{ color: color ?? palette.TEXT, fontWeight: 600, lineHeight: 1.2, fontSize: 11, fontFamily: "monospace" }}>{value}</Typography>
    </Box>
  );
}

/** Expanded detail: same Entry/Exit context-grid language as the paper trade history. */
const ReplayTradeStats = memo(function ReplayTradeStats({ trade, clock }: { trade: RTrade; clock: number }) {
  const closed = trade.exit_time <= clock;
  const risk = Math.abs(trade.entry - trade.sl);
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(220px, 260px))" }, gap: 0.75, width: "100%", justifyContent: "center", maxWidth: 540, mx: "auto", px: 1, py: 0.75 }}>
      <Box sx={{ p: 0.5, border: "1px solid var(--mui-palette-divider)", borderRadius: 1, bgcolor: "var(--mui-palette-background-paper)", minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontWeight: 700, fontSize: 10, letterSpacing: 0.6, display: "block", pb: 0.5, mb: 0.25, borderBottom: "1px solid var(--mui-palette-divider)" }}>ENTRY</Typography>
        <StatRow label="Time" value={fmtT(trade.time)} />
        <StatRow label="Price" value={trade.entry.toFixed(1)} />
        <StatRow label="Stop" value={trade.sl.toFixed(1)} color={palette.NEGATIVE} />
        <StatRow label="Target" value={trade.tp.toFixed(1)} color={palette.POSITIVE} />
        <StatRow label="Risk" value={`${risk.toFixed(1)} pts`} color={palette.TEXT_MUTED} />
      </Box>
      <Box sx={{ p: 0.5, border: "1px solid var(--mui-palette-divider)", borderRadius: 1, bgcolor: "var(--mui-palette-background-paper)", minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontWeight: 700, fontSize: 10, letterSpacing: 0.6, display: "block", pb: 0.5, mb: 0.25, borderBottom: "1px solid var(--mui-palette-divider)" }}>EXIT</Typography>
        <StatRow label="Time" value={closed ? fmtT(trade.exit_time) : "…"} />
        <StatRow label="Price" value={closed ? trade.exit.toFixed(1) : "…"} />
        <StatRow label="Hold" value={closed ? formatDuration((trade.exit_time - trade.time) / 60) : "…"} color={palette.TEXT_MUTED} />
        <StatRow label="P&L" value={closed ? `${fmtPts(trade.pnl)} pts` : "…"} color={closed ? (trade.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE) : undefined} />
        <StatRow label="R" value={closed ? `${trade.rr >= 0 ? "+" : ""}${trade.rr.toFixed(1)}R` : "…"} color={closed ? (trade.rr >= 0 ? palette.POSITIVE : palette.NEGATIVE) : undefined} />
        <Box sx={{ display: "flex", alignItems: "center", py: 0.35, gap: 0.35 }}>
          <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, lineHeight: 1.1, minWidth: 72, flexShrink: 0, fontSize: 11 }}>Reason</Typography>
          {closed ? <ExitReasonBadge reason={trade.result} /> : <Chip size="small" label="OPEN" color="warning" sx={{ height: 18, fontSize: 9 }} />}
        </Box>
      </Box>
    </Box>
  );
});

export function ReplayTradeTable({ trades, clock, onSelectTime }: {
  trades: RTrade[];
  clock: number;
  onSelectTime: (t: number) => void;
}) {
  const columns = useMemo<ColumnDef<RTrade>[]>(
    () => [
      {
        id: "toggle",
        header: "",
        enableSorting: false,
        size: 32,
        cell: ({ row }) => (
          <Box
            role="button" aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); row.toggleExpanded(); }}
            data-testid={`replay-trade-toggle-${row.original.time}-${row.original.side}`}
            sx={{ display: "inline-flex", cursor: "pointer", color: palette.TEXT_MUTED }}
          >
            {row.getIsExpanded() ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </Box>
        ),
      },
      {
        id: "time",
        header: "Time",
        accessorKey: "time",
        cell: ({ row }) => (
          <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: 11 }}>
            {fmtT(row.original.time)}
          </Typography>
        ),
      },
      {
        id: "side",
        header: "Side",
        accessorKey: "side",
        cell: ({ row }) => <SideBadge side={row.original.side} />,
      },
      {
        id: "entry",
        header: "Entry",
        accessorKey: "entry",
        cell: ({ row }) => (
          <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: 11 }}>{row.original.entry.toFixed(1)}</Typography>
        ),
      },
      {
        id: "sl",
        header: "SL",
        accessorKey: "sl",
        cell: ({ row }) => (
          <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: 11 }}>{row.original.sl.toFixed(1)}</Typography>
        ),
      },
      {
        id: "tp",
        header: "TP",
        accessorKey: "tp",
        cell: ({ row }) => (
          <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: 11 }}>{row.original.tp.toFixed(1)}</Typography>
        ),
      },
      {
        id: "exit",
        header: "Exit",
        accessorKey: "exit",
        cell: ({ row }) => {
          const t = row.original;
          return t.exit_time <= clock ? (
            <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: 11 }}>{t.exit.toFixed(1)}</Typography>
          ) : (
            <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 11 }}>…</Typography>
          );
        },
      },
      {
        id: "hold",
        header: "Hold",
        accessorFn: (t) => (t.exit_time <= clock ? t.exit_time - t.time : -1),
        cell: ({ row }) => {
          const t = row.original;
          return (
            <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 11 }}>
              {t.exit_time <= clock ? formatDuration((t.exit_time - t.time) / 60) : "…"}
            </Typography>
          );
        },
      },
      {
        id: "pnl",
        header: "P&L",
        accessorKey: "pnl",
        cell: ({ row }) => {
          const t = row.original;
          if (t.exit_time > clock) return <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 11 }}>…</Typography>;
          return (
            <Typography variant="caption" data-testid={`replay-pnl-${t.time}`} sx={{ fontWeight: 600, fontSize: 11, fontFamily: "monospace" }} color={getPnLTextColor(t.pnl) === "success" ? palette.POSITIVE : palette.NEGATIVE}>
              {fmtPts(t.pnl)}
            </Typography>
          );
        },
      },
      {
        id: "rr",
        header: "R",
        accessorKey: "rr",
        cell: ({ row }) => {
          const t = row.original;
          if (t.exit_time > clock) return <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 11 }}>…</Typography>;
          return (
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, fontFamily: "monospace" }} color={t.rr >= 0 ? palette.POSITIVE : palette.NEGATIVE}>
              {t.rr >= 0 ? "+" : ""}{t.rr.toFixed(1)}R
            </Typography>
          );
        },
      },
      {
        id: "result",
        header: "Exit",
        accessorKey: "result",
        enableSorting: false,
        cell: ({ row }) => {
          const t = row.original;
          return t.exit_time <= clock
            ? <ExitReasonBadge reason={t.result} />
            : <Chip size="small" label="OPEN" color="warning" sx={{ height: 18, fontSize: 9 }} />;
        },
      },
    ],
    [clock],
  );

  return (
    <TanStackTable<RTrade>
      className="replay-trade-table"
      data={trades}
      columns={columns}
      initialState={{ sorting: [{ id: "time", desc: false }] }}
      enableSortingRemoval={false}
      getRowCanExpand={() => true}
      renderSubComponent={(t) => <ReplayTradeStats trade={t} clock={clock} />}
      getRowTestId={(t) => `replay-trade-row-${t.time}-${t.side}`}
      onRowClick={(t) => onSelectTime(t.time)}
      emptyMessage="Press Play — entries print as ticks cross their signals."
    />
  );
}
