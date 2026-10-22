import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { PanelModal } from "@/components/common/PanelModal";
import { TanStackTable } from "@/components/common/TanStackTable";
import { formatSignedPnl } from "@/utils/ui-helpers";
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

const NUM = (v: number): ReactNode => (
  <Text span size="xs" fw={500} sx={{ fontFamily: palette.MONO }}>
    {v.toLocaleString("en-IN")}
  </Text>
);

const POSITION_COLUMNS: ColumnDef<PositionRow>[] = [
  {
    header: "Symbol",
    accessorKey: "symbol",
    size: 120,
    meta: { align: "left" },
    cell: (info) => (
      <Text span size="xs" fw={700} title={String(info.getValue() ?? "")} sx={{ minWidth: 0 }}>
        {String(info.getValue() ?? "—")}
      </Text>
    ),
  },
  {
    header: "Opt",
    accessorKey: "opt",
    size: 46,
    meta: { align: "center" },
    cell: (info) => {
      const opt = info.getValue() as PositionRow["opt"];
      return (
        <Text
          span
          size="xs"
          fw={700}
          sx={{ color: opt === "CE" ? palette.TERM_CE : opt === "PE" ? palette.TERM_PE : palette.TEXT_MUTED }}
        >
          {opt ?? "—"}
        </Text>
      );
    },
  },
  {
    header: "Strike",
    accessorKey: "strike",
    size: 74,
    meta: { align: "right" },
    cell: (info) => {
      const strike = info.getValue() as number | null;
      return (
        <Text span size="xs" sx={{ fontFamily: palette.MONO }}>
          {strike === null ? "—" : strike.toLocaleString("en-IN")}
        </Text>
      );
    },
  },
  {
    header: "Side",
    accessorKey: "side",
    size: 52,
    meta: { align: "center" },
    cell: (info) => {
      const side = String(info.getValue() ?? "");
      return (
        <Text
          span
          size="xs"
          fw={700}
          sx={{ color: side === "BUY" ? palette.POSITIVE : palette.NEGATIVE }}
        >
          {side || "—"}
        </Text>
      );
    },
  },
  {
    header: "Qty",
    accessorKey: "qty",
    size: 58,
    meta: { align: "right" },
    cell: (info) => NUM(Number(info.getValue()) || 0),
  },
  {
    header: "Entry",
    accessorKey: "entry",
    size: 72,
    meta: { align: "right" },
    cell: (info) => (
      <Text span size="xs" sx={{ fontFamily: palette.MONO }}>
        {formatRupees(Number(info.getValue()) || 0)}
      </Text>
    ),
  },
  {
    header: "Mark",
    accessorKey: "mark",
    size: 72,
    meta: { align: "right" },
    cell: (info) => (
      <Text span size="xs" sx={{ fontFamily: palette.MONO }}>
        {formatRupees(Number(info.getValue()) || 0)}
      </Text>
    ),
  },
  {
    header: "P&L",
    accessorKey: "pnl",
    size: 86,
    meta: { align: "right" },
    cell: (info) => {
      const pnl = Number(info.getValue()) || 0;
      return (
        <Text span size="xs" fw={700} sx={{ color: toneFor(pnl), fontFamily: palette.MONO }}>
          {signedRupees(pnl)}
        </Text>
      );
    },
  },
  {
    header: "Stop",
    accessorKey: "stop",
    size: 72,
    meta: { align: "right" },
    cell: (info) => (
      <Text span size="xs" sx={{ color: palette.NEGATIVE, fontFamily: palette.MONO }}>
        {formatRupees(Number(info.getValue()) || 0)}
      </Text>
    ),
  },
  {
    header: "Target",
    accessorKey: "target",
    size: 72,
    meta: { align: "right" },
    cell: (info) => (
      <Text span size="xs" sx={{ color: palette.POSITIVE, fontFamily: palette.MONO }}>
        {formatRupees(Number(info.getValue()) || 0)}
      </Text>
    ),
  },
];

function GreekStat({ testId, label, value }: { testId: string; label: string; value: number | null }) {
  return (
    <Box
      data-testid={testId}
      title={`${label} — Σ chain greek × signed qty (missing legs skipped)`}
      sx={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 0.5,
        px: 0.75,
        py: 0.25,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderRadius: "4px",
        bgcolor: palette.TERM_BG,
        minWidth: 0,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Box component="span" sx={{ fontSize: 9, color: palette.TEXT_MUTED, letterSpacing: "0.06em" }}>
        {label}
      </Box>
      <Box
        component="span"
        sx={{
          fontSize: 11,
          fontWeight: 700,
          color: toneFor(value),
          fontFamily: palette.MONO,
          whiteSpace: "nowrap",
        }}
      >
        {formatGreek(value, label.includes("Δ") ? 1 : 2)}
      </Box>
    </Box>
  );
}

/**
 * Toolbar POSITIONS button + drawer. The label is `POS {n} · {net P&L}` with a
 * tone dot when the book has legs. The drawer lists every open leg
 * (symbol/opt/strike/side/qty/entry/mark/P&L/stop/target) and the book greeks
 * (Δ Γ Θ V) summed from the live chain, refreshed on open and every 30s.
 */
export function NiftyPositionsDrawer({
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
          <Box
            component="span"
            data-testid="nifty-positions-dot"
            aria-hidden
            sx={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              bgcolor: pnlTone,
              mr: 0.5,
              flexShrink: 0,
            }}
          />
        )}
        <Box component="span" sx={{ whiteSpace: "nowrap" }}>
          POS {count}
          {" · "}
          <Box component="span" sx={{ color: pnlTone, fontVariantNumeric: "tabular-nums" }}>
            {formatSignedPnl(netPnl)}
          </Box>
        </Box>
      </Button>

      <PanelModal
        open={open}
        variant="drawer"
        title="Paper positions — book & greeks"
        onClose={() => setOpen(false)}
      >
        <Box
          data-testid="nifty-positions-drawer"
          sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}
        >
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
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
              <Box component="span" sx={{ color: pnlTone, fontWeight: 700 }}>
                {formatSignedPnl(netPnl)}
              </Box>
            </Text>
          </Box>

          <Box
            data-testid="nifty-book-greeks"
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 0.5,
              minWidth: 0,
            }}
          >
            <GreekStat testId="nifty-book-delta" label="Net Δ" value={greeks.delta} />
            <GreekStat testId="nifty-book-gamma" label="Net Γ" value={greeks.gamma} />
            <GreekStat testId="nifty-book-theta" label="Net Θ" value={greeks.theta} />
            <GreekStat testId="nifty-book-vega" label="Net V" value={greeks.vega} />
          </Box>
          <Text size="xs" c="dimmed" style={{ fontSize: 9 }}>
            Book greeks = Σ chain greek × signed qty · {greeks.legs} leg
            {greeks.legs === 1 ? "" : "s"} matched · missing legs skipped
          </Text>

          {rows.length === 0 ? (
            <Text data-testid="nifty-positions-empty" size="sm" c="dimmed">
              No open paper positions
            </Text>
          ) : (
            <Box
              data-testid="nifty-positions-table-wrap"
              sx={{
                minWidth: 0,
                "& .paper-tanstack-container": {
                  bgcolor: `${palette.TERM_BG} !important`,
                  border: "none !important",
                },
                "& .paper-tanstack-scroll": { bgcolor: `${palette.TERM_BG} !important` },
                "& .paper-tanstack-table": { bgcolor: `${palette.TERM_BG} !important` },
                "& .paper-tanstack-header-cell": {
                  bgcolor: `${palette.TERM_HEADER} !important`,
                  borderColor: `${palette.TERM_BORDER} !important`,
                  color: `${palette.TEXT_MUTED} !important`,
                  fontSize: "9px !important",
                  letterSpacing: "0.05em",
                },
                "& .paper-tanstack-cell": {
                  bgcolor: "transparent !important",
                  borderColor: `${palette.TERM_BORDER} !important`,
                  fontSize: "10px !important",
                  fontFamily: `${palette.MONO} !important`,
                  padding: "4px 8px !important",
                  height: "25px !important",
                  lineHeight: 1.1,
                },
              }}
            >
              <TanStackTable<PositionRow>
                data={rows}
                columns={POSITION_COLUMNS}
                dataTestId="nifty-positions-table"
                emptyMessage="No open paper positions"
                enableSorting={false}
                style={{ minWidth: 0 }}
              />
            </Box>
          )}
        </Box>
      </PanelModal>
    </>
  );
}
