import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Button, Text } from "@/ui";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import * as palette from "@/ui/palette";
import { LocalPanelModal } from "./LocalPanelModal";
import { TanStackTable } from "@/components/common/TanStackTable";
import { formatSignedPnl, formatNumberIN } from "@/utils/ui-helpers";
import type { PaperPosition } from "@/types/paperTrading";
import type { NiftyStrike } from "@/types/niftyReport";
import {
  buildPositionRows,
  formatGreek,
  formatRupees,
  netPositionPnl,
  sumBookGreeks,
} from "./niftyPositions";
import type { PositionRow } from "./niftyPositions";

/** Open positions refresh while the drawer is up (STOP/TP can fire mid-read). */
const POSITIONS_REFRESH_MS = 30_000;

interface NiftyPositionsDrawerProps {
  /** Open paper book; `null` before the first fetch (renders the empty state). */
  positions: PaperPosition[] | null;
  /** Live option chain — the source for the book greeks. */
  strikes?: NiftyStrike[];
  /** Reload the open book; called on open and every 30s while open. */
  onRefresh?: () => void | Promise<void>;
  /** Poll interval override (tests). */
  refreshMs?: number;
}

function signedRupees(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return formatRupees(0);
  return `${rounded > 0 ? "+" : "-"}${formatRupees(Math.abs(rounded))}`;
}

function toneFor(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value === 0) return palette.TEXT_MUTED;
  return value > 0 ? palette.POSITIVE : palette.NEGATIVE;
}

const NUM = (v: number): JSX.Element => (
  <Text span size="xs" fw={500} style={{ "font-family": palette.MONO }}>
    {formatNumberIN(v)}
  </Text>
);

const POSITION_COLUMNS: TableColumnDef<PositionRow>[] = [
  {
    id: "symbol",
    header: "Symbol",
    accessorKey: "symbol",
    size: 120,
    meta: { align: "left" },
    cell: (info) => (
      <Text span size="xs" fw={700} title={String(rowCell(info.row.original, "symbol") ?? "")} style={{ "min-width": "0" }}>
        {String(rowCell(info.row.original, "symbol") ?? "—")}
      </Text>
    ),
  },
  {
    id: "opt",
    header: "Opt",
    accessorKey: "opt",
    size: 46,
    meta: { align: "center" },
    cell: (info) => {
      const opt = rowCell(info.row.original, "opt") as PositionRow["opt"];
      return (
        <Text
          span
          size="xs"
          fw={700}
          style={{ color: opt === "CE" ? palette.TERM_CE : opt === "PE" ? palette.TERM_PE : palette.TEXT_MUTED }}
        >
          {opt ?? "—"}
        </Text>
      );
    },
  },
  {
    id: "strike",
    header: "Strike",
    accessorKey: "strike",
    size: 74,
    meta: { align: "right" },
    cell: (info) => {
      const strike = rowCell(info.row.original, "strike") as number | null;
      return (
        <Text span size="xs" style={{ fontFamily: palette.MONO }}>
          {strike === null ? "—" : formatNumberIN(strike)}
        </Text>
      );
    },
  },
  {
    id: "side",
    header: "Side",
    accessorKey: "side",
    size: 52,
    meta: { align: "center" },
    cell: (info) => {
      const side = String(rowCell(info.row.original, "side") ?? "");
      return (
        <Text
          span
          size="xs"
          fw={700}
          style={{ color: side === "BUY" ? palette.POSITIVE : palette.NEGATIVE }}
        >
          {side || "—"}
        </Text>
      );
    },
  },
  {
    id: "qty",
    header: "Qty",
    accessorKey: "qty",
    size: 58,
    meta: { align: "right" },
    cell: (info) => NUM(Number(rowCell(info.row.original, "qty")) || 0),
  },
  {
    id: "entry",
    header: "Entry",
    accessorKey: "entry",
    size: 72,
    meta: { align: "right" },
    cell: (info) => (
      <Text span size="xs" style={{ fontFamily: palette.MONO }}>
        {formatRupees(Number(rowCell(info.row.original, "entry")) || 0)}
      </Text>
    ),
  },
  {
    id: "mark",
    header: "Mark",
    accessorKey: "mark",
    size: 72,
    meta: { align: "right" },
    cell: (info) => (
      <Text span size="xs" style={{ fontFamily: palette.MONO }}>
        {formatRupees(Number(info.getValue()) || 0)}
      </Text>
    ),
  },
  {
    id: "pnl",
    header: "P&L",
    accessorKey: "pnl",
    size: 86,
    meta: { align: "right" },
    cell: (info) => {
      const pnl = Number(info.getValue()) || 0;
      return (
        <Text span size="xs" fw={700} style={{ color: toneFor(pnl), fontFamily: palette.MONO }}>
          {signedRupees(pnl)}
        </Text>
      );
    },
  },
  {
    id: "stop",
    header: "Stop",
    accessorKey: "stop",
    size: 72,
    meta: { align: "right" },
    cell: (info) => (
      <Text span size="xs" style={{ color: palette.NEGATIVE, fontFamily: palette.MONO }}>
        {formatRupees(Number(info.getValue()) || 0)}
      </Text>
    ),
  },
  {
    id: "target",
    header: "Target",
    accessorKey: "target",
    size: 72,
    meta: { align: "right" },
    cell: (info) => (
      <Text span size="xs" style={{ color: palette.POSITIVE, fontFamily: palette.MONO }}>
        {formatRupees(Number(info.getValue()) || 0)}
      </Text>
    ),
  },
];

function GreekStat({ testId, label, value }: { testId: string; label: string; value: number | null }) {
  return (
    <div
      data-testid={testId}
      title={`${label} — Σ chain greek × signed qty (missing legs skipped)`}
      className="flex items-baseline justify-between gap-1 px-2 py-[2px] border border-fin-border rounded-[4px] bg-fin-bg min-w-0 font-mono tabular-nums"
      style={{
        borderColor: palette.TERM_BORDER,
        backgroundColor: palette.TERM_BG,
      }}
    >
      <span className="text-[9px] text-fin-text-muted tracking-[0.06em]">{label}</span>
      <span
        className="text-[11px] font-bold font-mono whitespace-nowrap"
        style={{ color: toneFor(value) }}
      >
        {formatGreek(value, label.includes("Δ") ? 1 : 2)}
      </span>
    </div>
  );
}

/**
 * Toolbar POSITIONS button + drawer. The label is `POS {n} · {net P&L}` with a
 * tone dot when the book has legs. The drawer lists every open leg
 * (symbol/opt/strike/side/qty/entry/mark/P&L/stop/target) and the book greeks
 * (Δ Γ Θ V) summed from the live chain, refreshed on open and every 30s.
 */
export function NiftyPositionsDrawerInner({
  positions,
  strikes,
  onRefresh,
  refreshMs = POSITIONS_REFRESH_MS,
}: NiftyPositionsDrawerProps) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => buildPositionRows(positions), [positions]);
  const netPnl = useMemo(() => netPositionPnl(positions), [positions]);
  const greeks = useMemo(() => sumBookGreeks(positions, strikes), [positions, strikes]);
  const count = rows.length;
  const pnlTone = toneFor(netPnl);

  // Refresh on open + while open. The panel owns the fetch; a refresh simply
  // re-renders this component with the new book.
  useEffect(() => {
    if (!open || !onRefresh) return;
    void onRefresh();
    const id = window.setInterval(() => void onRefresh(), refreshMs);
    return () => window.clearInterval(id);
  }, [open, onRefresh, refreshMs]);

  const openDrawer = useCallback(() => setOpen(true), []);

  return (
    <>
      <Button
        data-testid="nifty-positions-button"
        size="xs"
        variant="subtle"
        title={
          count > 0
            ? `${count} open paper position${count === 1 ? "" : "s"} · net ${formatSignedPnl(netPnl)} — click for the book and greeks`
            : "No open paper positions — click for the paper book"
        }
        onClick={openDrawer}
      >
        {count > 0 && (
          <span
            data-testid="nifty-positions-dot"
            aria-hidden
            className="shrink-0"
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              backgroundColor: pnlTone,
              marginRight: 4,
            }}
          />
        )}
        <span className="whitespace-nowrap">
          POS {count}
          {" · "}
          <span className="font-mono tabular-nums" style={{ color: pnlTone }}>
            {formatSignedPnl(netPnl)}
          </span>
        </span>
      </Button>

      <PanelModal
        open={open}
        variant="drawer"
        title="Paper positions — book & greeks"
        onClose={() => setOpen(false)}
      >
        <div data-testid="nifty-positions-drawer" className="flex flex-col gap-1 min-w-0">
          <div className="flex items-baseline gap-1 min-w-0">
            <Text
              data-testid="nifty-positions-drawer-label"
              span
              size="xs"
              fw={700}
              style={{ fontSize: 10, letterSpacing: "0.08em", color: palette.TEXT_MUTED }}
            >
              PAPER POSITIONS
            </Text>
            <Text span size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
              {count} open · net{" "}
              <span className="font-bold" style={{ color: pnlTone }}>
                {formatSignedPnl(netPnl)}
              </span>
            </Text>
          </div>

          <div
            data-testid="nifty-book-greeks"
            className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-1 min-w-0"
          >
            <GreekStat testId="nifty-book-delta" label="Net Δ" value={greeks.delta} />
            <GreekStat testId="nifty-book-gamma" label="Net Γ" value={greeks.gamma} />
            <GreekStat testId="nifty-book-theta" label="Net Θ" value={greeks.theta} />
            <GreekStat testId="nifty-book-vega" label="Net V" value={greeks.vega} />
          </div>
          <Text size="xs" c="dimmed" style={{ fontSize: 9 }}>
            Book greeks = Σ chain greek × signed qty · {greeks.legs} leg
            {greeks.legs === 1 ? "" : "s"} matched · missing legs skipped
          </Text>

          {rows.length === 0 ? (
            <Text data-testid="nifty-positions-empty" size="sm" c="dimmed">
              No open paper positions
            </Text>
          ) : (
            // The TanStackTable shared component renders its own bordered paper
            // container; theme it to the desk surface via descendant selectors.
            <Box
              data-testid="nifty-positions-table-wrap"
              className="min-w-0 [&_.paper-tanstack-container]:[background:var(--desk-bg)]! [&_.paper-tanstack-container]:[border:none]! [&_.paper-tanstack-scroll]:[background:var(--desk-bg)]! [&_.paper-tanstack-table]:[background:var(--desk-bg)]! [&_.paper-tanstack-header-cell]:[background:var(--desk-header)]! [&_.paper-tanstack-header-cell]:[border-color:var(--desk-border)]! [&_.paper-tanstack-header-cell]:[color:var(--desk-muted)]! [&_.paper-tanstack-header-cell]:text-[9px]! [&_.paper-tanstack-header-cell]:tracking-[0.05em]! [&_.paper-tanstack-cell]:bg-transparent! [&_.paper-tanstack-cell]:[border-color:var(--desk-border)]! [&_.paper-tanstack-cell]:text-[10px]! [&_.paper-tanstack-cell]:[font-family:var(--desk-mono)]! [&_.paper-tanstack-cell]:[padding:2px_8px]! [&_.paper-tanstack-cell]:h-[22px]! [&_.paper-tanstack-cell]:leading-[1.1]!"
              style={{
                "--desk-bg": palette.TERM_BG,
                "--desk-header": palette.TERM_HEADER,
                "--desk-border": palette.TERM_BORDER,
                "--desk-muted": palette.TEXT_MUTED,
                "--desk-mono": palette.MONO,
              } as CSSProperties}
            >
              <TanStackTable<PositionRow>
                data={rows}
                columns={POSITION_COLUMNS}
                dataTestId="nifty-positions-table"
                emptyMessage="No open paper positions"
                enableSorting={false}
                stickyHeader
                dense
                style={{ minWidth: 0 }}
              />
            </Box>
          )}
        </div>
      </PanelModal>
    </>
  );
}

/** Memoised: the parent repaints on the ~1 s spot tick; the book (`positions`)
 *  only changes on its own refresh. */
export const NiftyPositionsDrawer = memo(NiftyPositionsDrawerInner);
NiftyPositionsDrawer.displayName = "NiftyPositionsDrawer";
