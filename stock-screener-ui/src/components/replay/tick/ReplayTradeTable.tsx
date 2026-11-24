import { createMemo, Show } from "solid-js";
import { Text, Chip, Box, typeSize } from "@/ui";
import type { TableColumnDef } from "../../paper-trading/TanStackTable";
import { TanStackTable } from "../../paper-trading/TanStackTable";
import { SideBadge, ExitReasonBadge } from "@/components/common";
import { formatDuration, getPnLTextColor } from "@/utils/ui-helpers";
import { TZ_IST } from "@/config/constants";
import * as palette from "@/ui/palette";
import { IconChevronRight, IconChevronDown } from "@/components/common/Icons";
import type { ReplayTrade } from "./types";
export type RTrade = ReplayTrade;

const fmtT = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });

const fmtPts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

function StatRow(props: { label: string; value: string; color?: string }) {
  return (
    <Box
      className="border-b border-fin-border-subtle"
      style={{
        display: "flex",
        "align-items": "center",
        gap: "3px",
        padding: "1px 0",
      }}
    >
      <Text size="xs" style={{ "line-height": 1.1, "min-width": "72px", "flex-shrink": 0, "font-size": `${typeSize("micro")}px`, color: palette.TEXT_MUTED }}>
        {props.label}
      </Text>
      <Text size="xs" fw={600} style={{ "line-height": 1.2, "font-size": `${typeSize("micro")}px`, "font-family": "monospace", color: props.color ?? palette.TEXT }}>
        {props.value}
      </Text>
    </Box>
  );
}

/** Expanded detail: same Entry/Exit context-grid language as the paper trade history. */
function ReplayTradeStats(props: { trade: ReplayTrade; clock: number }) {
  const closed = () => props.trade.exit_time <= props.clock;
  const risk = Math.abs(props.trade.entry - props.trade.sl);
  return (
    <Box
      style={{
        display: "grid",
        "grid-template-columns": "1fr",
        gap: "8px",
        width: "100%",
        "justify-content": "center",
        "max-width": "540px",
        "margin-left": "auto",
        "margin-right": "auto",
        padding: "4px 0",
      }}
    >
      <Box
        className="border border-fin-border-subtle rounded-fin"
        style={{
          padding: "8px",
          "background-color": palette.SURFACE,
          "min-width": 0,
        }}
      >
        <Text
          size="xs"
          fw={700}
          className="border-b border-fin-border-subtle"
          style={{ color: palette.TEXT_MUTED, "font-size": `${typeSize("micro")}px`, "letter-spacing": "0.6px", display: "block", "margin-bottom": "8px" }}
        >
          ENTRY
        </Text>
        <StatRow label="Time" value={fmtT(props.trade.time)} />
        <StatRow label="Price" value={props.trade.entry.toFixed(1)} />
        <StatRow label="Stop" value={props.trade.sl.toFixed(1)} color={palette.NEGATIVE} />
        <StatRow label="Target" value={props.trade.tp != null ? props.trade.tp.toFixed(1) : "trail"} color={palette.POSITIVE} />
        <StatRow label="Risk" value={`${risk.toFixed(1)} pts`} color={palette.TEXT_MUTED} />
      </Box>
      <Box
        className="border border-fin-border-subtle rounded-fin"
        style={{
          padding: "8px",
          "background-color": palette.SURFACE,
          "min-width": 0,
        }}
      >
        <Text
          size="xs"
          fw={700}
          className="border-b border-fin-border-subtle"
          style={{ color: palette.TEXT_MUTED, "font-size": `${typeSize("micro")}px`, "letter-spacing": "0.6px", display: "block", "margin-bottom": "8px" }}
        >
          EXIT
        </Text>
        <StatRow label="Time" value={closed() ? fmtT(props.trade.exit_time) : "…"} />
        <StatRow label="Price" value={closed() ? props.trade.exit.toFixed(1) : "…"} />
        <StatRow label="Hold" value={closed() ? formatDuration((props.trade.exit_time - props.trade.time) / 60) : "…"} color={palette.TEXT_MUTED} />
        <StatRow label="P&L" value={closed() ? `${fmtPts(props.trade.pnl)} pts` : "…"} color={closed() ? (props.trade.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE) : undefined} />
        <StatRow label="R" value={closed() ? `${props.trade.rr >= 0 ? "+" : ""}${props.trade.rr.toFixed(1)}R` : "…"} color={closed() ? (props.trade.rr >= 0 ? palette.POSITIVE : palette.NEGATIVE) : undefined} />
        <Box style={{ display: "flex", "align-items": "center", gap: "3px", padding: "1px 0" }}>
          <Text size="xs" style={{ "line-height": 1.1, "min-width": "72px", "flex-shrink": 0, "font-size": `${typeSize("micro")}px`, color: palette.TEXT_MUTED }}>
            Reason
          </Text>
          {closed() ? <ExitReasonBadge reason={props.trade.result} /> : <Chip size="xs" color="warning" style={{ height: "18px", "font-size": `${typeSize("micro")}px` }}>OPEN</Chip>}
        </Box>
      </Box>
    </Box>
  );
}

export function ReplayTradeTable(props: {
  trades: ReplayTrade[];
  clock: number;
  onSelectTime: (t: number) => void;
}) {
  const columns = createMemo<TableColumnDef<ReplayTrade>[]>(() => [
    {
      id: "toggle",
      header: "",
      enableSorting: false,
      size: 32,
      meta: { align: "center" },
      cell: ({ row }) => (
        <Box
          role="button" aria-label={row.isExpanded() ? "Collapse" : "Expand"}
          onClick={(e: MouseEvent) => { e.stopPropagation(); row.toggle(); }}
          data-testid={`replay-trade-toggle-${row.original.time}-${row.original.side}`}
          class="inline-flex cursor-pointer"
          style={{ color: palette.TEXT_MUTED }}
        >
          {row.isExpanded() ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </Box>
      ),
    },
    {
      id: "time",
      header: "Time",
      accessorKey: "time",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text size="xs" className="font-mono tabular-nums" style={{ "font-size": `${typeSize("micro")}px` }}>
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
        <Text size="xs" className="font-mono tabular-nums" style={{ "font-size": `${typeSize("micro")}px` }}>{row.original.entry.toFixed(1)}</Text>
      ),
    },
    {
      id: "sl",
      header: "SL",
      accessorKey: "sl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" className="font-mono tabular-nums" style={{ "font-size": `${typeSize("micro")}px` }}>{row.original.sl.toFixed(1)}</Text>
      ),
    },
    {
      id: "tp",
      header: "TP",
      accessorKey: "tp",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" className="font-mono tabular-nums" style={{ "font-size": `${typeSize("micro")}px` }}>{row.original.tp != null ? row.original.tp.toFixed(1) : "trail"}</Text>
      ),
    },
    {
      id: "exit",
      header: "Exit",
      accessorKey: "exit",
      meta: { align: "right" },
      cell: ({ row }) => {
        const t = row.original;
        return (
          <Show
            when={t.exit_time <= props.clock}
            fallback={<Text size="xs" className="font-mono tabular-nums" style={{ color: palette.TEXT_MUTED, "font-size": `${typeSize("micro")}px` }}>…</Text>}
          >
            <Text size="xs" className="font-mono tabular-nums" style={{ "font-size": `${typeSize("micro")}px` }}>{t.exit.toFixed(1)}</Text>
          </Show>
        );
      },
    },
    {
      id: "hold",
      header: "Hold",
      meta: { align: "right" },
      accessorFn: (t) => (t.exit_time <= props.clock ? t.exit_time - t.time : -1),
      cell: ({ row }) => {
        const t = row.original;
        return (
          <Text size="xs" className="font-mono tabular-nums" style={{ color: palette.TEXT_MUTED, "font-size": `${typeSize("micro")}px` }}>
            <Show when={t.exit_time <= props.clock} fallback="…">
              {formatDuration((t.exit_time - t.time) / 60)}
            </Show>
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
        return (
          <Show
            when={t.exit_time <= props.clock}
            fallback={<Text size="xs" style={{ color: palette.TEXT_MUTED, "font-size": `${typeSize("micro")}px` }}>…</Text>}
          >
            <Text
              size="xs"
              data-testid={`replay-pnl-${t.time}`}
              fw={600}
              className="font-mono tabular-nums"
              style={{ "font-size": `${typeSize("micro")}px`, color: getPnLTextColor(t.pnl) === "success" ? palette.POSITIVE : palette.NEGATIVE }}
            >
              {fmtPts(t.pnl)}
            </Text>
          </Show>
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
        return (
          <Show
            when={t.exit_time <= props.clock}
            fallback={<Text size="xs" style={{ color: palette.TEXT_MUTED, "font-size": `${typeSize("micro")}px` }}>…</Text>}
          >
            <Text
              size="xs"
              fw={600}
              className="font-mono tabular-nums"
              style={{ "font-size": `${typeSize("micro")}px`, color: t.rr >= 0 ? palette.POSITIVE : palette.NEGATIVE }}
            >
              {t.rr >= 0 ? "+" : ""}{t.rr.toFixed(1)}R
            </Text>
          </Show>
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
        return (
          <Show
            when={t.exit_time <= props.clock}
            fallback={<Chip size="xs" color="warning" style={{ height: "18px", "font-size": `${typeSize("micro")}px` }}>OPEN</Chip>}
          >
            <ExitReasonBadge reason={t.result} />
          </Show>
        );
      },
    },
  ]);

  return (
    <TanStackTable<ReplayTrade>
      className="replay-trade-table"
      data={props.trades}
      columns={columns()}
      initialState={{ sorting: [{ id: "time", desc: false }] }}
      enableSortingRemoval={false}
      getRowCanExpand={() => true}
      renderSubComponent={(t) => <ReplayTradeStats trade={t} clock={props.clock} />}
      getRowTestId={(t) => `replay-trade-row-${t.time}-${t.side}`}
      onRowClick={(t) => props.onSelectTime(t.time)}
      stickyHeader
      dense
      emptyMessage="Press Play — entries print as ticks cross their signals."
    />
  );
}
