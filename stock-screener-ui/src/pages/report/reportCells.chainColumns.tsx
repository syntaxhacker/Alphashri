import { Show } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { formatLegChange, rowFlags } from "./optionChainMetrics";
import type { ChainWalls } from "./optionChainMetrics";
import type { NiftyStrike } from "@/types/niftyReport";
import { REPORT_FONT_WEIGHT } from "./reportTokens";
import {
  chainHeader,
  legChangeCell,
  oiChangeBarCell,
  sentimentBadge,
  wallTag,
} from "./reportCells.chainCells";
import {
  OI_CE_CHG_W,
  OI_CE_OI_W,
  OI_DESK_OI_W,
  OI_DESK_SIG_W,
  OI_DESK_STRIKE_W,
  OI_CHAIN_METRICS,
  OI_SIG_W,
  OI_STRIKE_W,
} from "./reportCells.chainMetrics";

export interface NiftyOiColumnOpts {
  maxCeOiChange?: number;
  maxPeOiChange?: number;
  spot?: number;
  walls?: ChainWalls;
  showLegChange?: boolean;
}

export function getNiftyOiColumns(
  atmStrike: number | null,
  opts?: NiftyOiColumnOpts,
): TableColumnDef<NiftyStrike>[] {
  // The caller's `showLegChange: false` is the desk/core selection: fit the
  // ~420px side panel. The full seven-column chain stays roomy and scrolls.
  const compact = opts?.showLegChange === false;
  const oiW = compact ? OI_DESK_OI_W : OI_CE_OI_W;
  const sigW = compact ? OI_DESK_SIG_W : OI_SIG_W;
  const strikeW = compact ? OI_DESK_STRIKE_W : OI_STRIKE_W;
  // ATM and max-OI wall strikes are the rows worth scanning first. Carry the
  // predicate on the strike column so the table host can mark the whole row
  // without a second copy of the wall/ATM rules.
  const rowFocus = (row: NiftyStrike): boolean => {
    const strike = Number(row.strike);
    if (atmStrike !== null && strike === atmStrike) return true;
    const walls = opts?.walls ?? {};
    const flags =
      opts?.spot != null && Number.isFinite(opts.spot)
        ? rowFlags(row, opts.spot, walls)
        : null;
    return flags
      ? flags.callWall || flags.putWall
      : (walls.calls ?? []).some((w) => w.strike === strike) ||
          (walls.puts ?? []).some((w) => w.strike === strike);
  };
  const legChangeColumns: TableColumnDef<NiftyStrike>[] = [
    {
      id: "ceChg",
      header: chainHeader("CE", "Chg", "points (LTP − prev close)"),
      accessorKey: "ce.priceChange",
      accessorFn: (row) => formatLegChange(row.ce).points,
      size: OI_CE_CHG_W,
      meta: { align: "right" },
      cell: (info) => legChangeCell(info.row.original.ce, palette.TERM_CE),
    },
  ];
  const coreColumns: TableColumnDef<NiftyStrike>[] = [
    {
      id: "ceOiChange",
      header: chainHeader("CE", "ΔOI", "CE OI Chg — change in call open interest since the previous snapshot"),
      accessorKey: "ce.oiChange",
      accessorFn: (row) => row.ce.oiChange,
      size: oiW,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.row.original.ce.oiChange);
        return oiChangeBarCell(v, opts?.maxCeOiChange, palette.TERM_CE, "nifty-oi-bar-ce");
      },
    },
    {
      id: "ceSignal",
      header: chainHeader("CE", "SIG", "CE Signal — call-side position build/unwind: bullish, bearish or neutral"),
      accessorKey: "ce.sentiment",
      accessorFn: (row) => row.ce.sentiment,
      size: sigW,
      meta: { align: "center" },
      cell: (info) =>
        sentimentBadge(
          String(info.row.original.ce.sentiment ?? ""),
          "ce",
          rowFocus(info.row.original),
        ),
    },
    {
      id: "strike",
      header: <span title="Strike price (₹)">STRIKE</span>,
      accessorKey: "strike",
      size: strikeW,
      meta: { align: "right" },
      chainRowFocus: rowFocus,
      cell: (info) => {
        const strike = Number(info.row.original.strike);
        const isAtm = atmStrike !== null && strike === atmStrike;
        const walls = opts?.walls ?? {};
        const flags =
          opts?.spot != null && Number.isFinite(opts.spot)
            ? rowFlags(info.row.original, opts.spot, walls)
            : null;
        const isCW = flags
          ? flags.callWall
          : (walls.calls ?? []).some((w) => w.strike === strike);
        const isPW = flags
          ? flags.putWall
          : (walls.puts ?? []).some((w) => w.strike === strike);
        const focused = isAtm || isCW || isPW;
        const spot = opts?.spot ?? 0;
        return (
          <span
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "flex-end",
              gap: "3px",
              overflow: "hidden",
              "font-variant-numeric": "tabular-nums",
            }}
          >
            <Show when={isCW}>{wallTag(strike, spot, true, palette.TERM_CE)}</Show>
            <Show when={isPW}>{wallTag(strike, spot, false, palette.TERM_PE)}</Show>
            <Text
              size="xs"
              span
              fw={focused ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.bold}
              c={isAtm ? palette.TERM_FLIP : undefined}
              data-testid={isAtm ? "nifty-strike-atm-badge" : undefined}
              title={isAtm ? "ATM strike" : undefined}
              data-chain-focus-text={focused ? "1" : undefined}
              style={{
                "font-size": `${OI_CHAIN_METRICS.valueSize}px`,
                ...(focused ? { color: palette.TERM_FLIP } : {}),
              }}
            >
              {formatNumberIN(strike)}
            </Text>
          </span>
        );
      },
    },
    {
      id: "peSignal",
      header: chainHeader("PE", "SIG", "PE Signal — put-side position build/unwind: bullish, bearish or neutral"),
      accessorKey: "pe.sentiment",
      accessorFn: (row) => row.pe.sentiment,
      size: sigW,
      meta: { align: "center" },
      cell: (info) =>
        sentimentBadge(
          String(info.row.original.pe.sentiment ?? ""),
          "pe",
          rowFocus(info.row.original),
        ),
    },
    {
      id: "peOiChange",
      header: chainHeader("PE", "ΔOI", "PE OI Chg — change in put open interest since the previous snapshot"),
      accessorKey: "pe.oiChange",
      accessorFn: (row) => row.pe.oiChange,
      size: oiW,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.row.original.pe.oiChange);
        return oiChangeBarCell(v, opts?.maxPeOiChange, palette.TERM_PE, "nifty-oi-bar-pe");
      },
    },
  ];
  if (opts?.showLegChange === false) return coreColumns;
  const peChg: TableColumnDef<NiftyStrike> = {
    id: "peChg",
    header: chainHeader("PE", "Chg", "points (LTP − prev close)"),
    accessorKey: "pe.priceChange",
    accessorFn: (row) => formatLegChange(row.pe).points,
    size: OI_CE_CHG_W,
    meta: { align: "right" },
    cell: (info) => legChangeCell(info.row.original.pe, palette.TERM_PE),
  };
  return [...legChangeColumns, ...coreColumns, peChg];
}
