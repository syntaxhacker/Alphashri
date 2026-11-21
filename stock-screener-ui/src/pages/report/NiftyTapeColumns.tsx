/**
 * The tape table's column model.
 *
 * Split out of `NiftyTapeTable.tsx` so the table component only carries the
 * component itself. The columns are pure functions of the scale, the spot
 * deltas and the live flash map — no state, no hooks — which is what lets the
 * table memoise them on a cheap content signature.
 */

import { Text } from "@/ui";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import type { NiftyTapeRow } from "@/types/niftyReport";
import {
  TAPE_CALL_DOI,
  TAPE_FLIP_NEG_TEXT,
  TAPE_FLIP_POS_TEXT,
  TAPE_NEG_HUE,
  TAPE_NET_HUE,
  TAPE_NET_TEXT,
  TAPE_POS_HUE,
  TAPE_PUT_DOI,
  TAPE_SPOT,
  TAPE_TICK_NEG,
  TAPE_TICK_POS,
  type TapeScale,
  formatTapeCompact,
  formatTapePct,
  formatTapePrice,
  formatTapeRatio,
  formatTapeSigned,
  formatTapeTime,
  tapeHeat,
} from "./tapeFormat";
import { hexToRgba } from "@/utils/color";
import {
  REPORT_FONT,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_PAD,
} from "./reportTokens";

/** Row access by accessorKey; `Number()` coercion happens at call sites. */
function rawCellValue(row: NiftyTapeRow, key: keyof NiftyTapeRow | string | undefined): unknown {
  return key ? (row as unknown as Record<string, unknown>)[key as string] ?? NaN : NaN;
}

/** Numeric cell with tabular figures + ellipsis; optional full-bleed tint. */
function tapeCell(
  value: string,
  tone?: "success" | "error",
  tint?: string,
  testId?: string,
  /** Direct text color override for terminal styling (wins over tone). */
  color?: string,
  /** Bold terminal values (spot, net, flip). */
  bold?: boolean,
  /** Live change-flash: pulse the cell when its value just moved. */
  flash?: boolean,
) {
  return (
    <span
      data-testid={testId}
      data-alpha={tint ? String(tint) : undefined}
      class={flash ? "tape-cell-flash" : undefined}
      style={{
        display: "block",
        ...(tint
          ? {
              margin: `-${REPORT_PAD.xs}px -${REPORT_PAD.sm}px`,
              padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`,
            }
          : {}),
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "font-variant-numeric": "tabular-nums",
        ...(tint ? { background: tint } : {}),
      }}
    >
      <Text span c={color ?? tone ?? "default"} fw={bold || tone ? REPORT_FONT_WEIGHT.bold : REPORT_FONT_WEIGHT.normal} style={{ "font-size": `${REPORT_FONT.xs}px` }}>
        {value}
      </Text>
    </span>
  );
}

/** Signed hue for a heat column: positive → blue, negative → orange. */
function signedHeat(v: number, max: number, floor = 0.05, ceil = 0.7): string | undefined {
  if (v === 0) return undefined;
  return tapeHeat(v, max, v > 0 ? TAPE_POS_HUE : TAPE_NEG_HUE, floor, ceil);
}

function spotFlipTint(v: number | null, max: number): string | undefined {
  if (v === null) return undefined;
  return signedHeat(v, max, 0.28, 0.75);
}

function spotFlipColor(v: number | null): string | undefined {
  if (v === null) return undefined;
  if (v > 0) return TAPE_FLIP_POS_TEXT;
  if (v < 0) return TAPE_FLIP_NEG_TEXT;
  return undefined;
}

/** Two-line terminal header: title + muted sub-label (baseline / hint). */
function tapeHeader(title: string, sub?: string, tip?: string) {
  return (
    <div
      title={tip ? `${title} — ${tip}` : undefined}
      class="flex flex-col items-end"
      style={{ "line-height": REPORT_LINE_HEIGHT.tight }}
    >
      <span style={{ "font-size": `${REPORT_FONT.xs}px`, "font-weight": REPORT_FONT_WEIGHT.semibold }}>{title}</span>
      {sub ? (
        <span style={{ "font-size": `${REPORT_FONT.micro}px`, "font-weight": REPORT_FONT_WEIGHT.normal, opacity: 0.65, "white-space": "nowrap" }}>
          {sub}
        </span>
      ) : null}
    </div>
  );
}

export function getNiftyTapeColumns(
  baseline?: string,
  scale?: TapeScale,
  spotDelta?: Map<string, number>,
  changed?: Map<string, Set<string>>,
  /**
   * Spot-relative gamma flip (from `gexFlipAtSpot`). When present it replaces
   * the row's recorded flip, so the tape cannot show a stale crossing that
   * contradicts the gamma strip.
   */
  flipAtSpot?: number | null,
): TableColumnDef<NiftyTapeRow>[] {
  const since = baseline ? `since ${baseline}` : "since open";
  /** Live change-flash lookup: did this minute's field just move? */
  const fl = (t: string, col: string): boolean => changed?.get(t)?.has(col) ?? false;
  const s: TapeScale = scale ?? {
    call_doi: 0,
    put_doi: 0,
    net: 0,
    net_pct: 0,
    call_tick: 0,
    put_tick: 0,
    pcr_doi: 0,
    spot_flip: 0,
  };
  return [
    {
      id: "t",
      header: "IST",
      accessorKey: "t",
      accessorFn: (row) => row.t,
      size: 64,
      meta: { align: "left" },
      cell: (info) => tapeCell(formatTapeTime(String((info.row.original as NiftyTapeRow).t ?? "")), undefined, undefined, "nifty-tape-time"),
    },
    {
      id: "spot",
      header: () => tapeHeader("Spot", "Δ prev", "Nifty spot, arrow = tick vs previous minute"),
      accessorKey: "spot",
      accessorFn: (row) => row.spot,
      size: 96,
      meta: { align: "right" },
      cell: (info) => {
        const row = info.row.original as NiftyTapeRow;
        const d = spotDelta?.get(row.t);
        const arrow = d === undefined || d === 0 ? "" : d > 0 ? "▲" : "▼";
        const arrowColor = d === undefined || d === 0 ? undefined : d > 0 ? TAPE_TICK_POS : TAPE_TICK_NEG;
        return (
          <span
            class={fl(row.t, "spot") ? "tape-cell-flash" : undefined}
            style={{
              display: "flex",
              "align-items": "baseline",
              "justify-content": "flex-end",
              gap: "4px",
              overflow: "hidden",
              "font-variant-numeric": "tabular-nums",
            }}
          >
            <Text span fw={REPORT_FONT_WEIGHT.bold} c={TAPE_SPOT} style={{ "font-size": `${REPORT_FONT.sm}px` }}>
              {formatTapePrice(row.spot)}
            </Text>
            {arrow ? (
              <Text span fw={REPORT_FONT_WEIGHT.bold} c={arrowColor} style={{ "font-size": `${REPORT_FONT.xs}px` }}>
                {arrow}
              </Text>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "call_doi",
      header: () => tapeHeader("Call ΔOI", since, "Change in total call open interest"),
      accessorKey: "call_doi",
      accessorFn: (row) => row.call_doi,
      size: 96,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(rawCellValue(info.row.original, info.column.accessorKey));
        // Column identity hue (blue) + magnitude heat so big call prints pop.
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          tapeHeat(v, s.call_doi, TAPE_CALL_DOI, 0.06, 0.55),
          undefined,
          TAPE_CALL_DOI,
          true,
          fl((info.row.original as NiftyTapeRow).t, "call_doi"),
        );
      },
    },
    {
      id: "put_doi",
      header: () => tapeHeader("Put ΔOI", since, "Change in total put open interest"),
      accessorKey: "put_doi",
      accessorFn: (row) => row.put_doi,
      size: 96,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(rawCellValue(info.row.original, info.column.accessorKey));
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          tapeHeat(v, s.put_doi, TAPE_PUT_DOI, 0.06, 0.55),
          undefined,
          TAPE_PUT_DOI,
          true,
          fl((info.row.original as NiftyTapeRow).t, "put_doi"),
        );
      },
    },
    {
      header: () =>
        tapeHeader(
          "Net",
          "put−call",
          "Put ΔOI minus Call ΔOI; positive = put-side OI building faster than the call side (bearish)",
        ),
      id: "net",
      accessorKey: "net",
      accessorFn: (row) => row.net,
      size: 96,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(rawCellValue(info.row.original, info.column.accessorKey));
        // Always-on brown wash; intensity tracks |net| ÷ max — quiet rows
        // fade, dominant rows glow.
        const ratio = s.net > 0 ? Math.min(1, Math.abs(v) / s.net) : 0;
        const tint = v === 0 ? undefined : hexToRgba(TAPE_NET_HUE, 0.3 + 0.5 * ratio);
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          tint,
          undefined,
          TAPE_NET_TEXT,
          true,
          fl((info.row.original as NiftyTapeRow).t, "net"),
        );
      },
    },
    {
      header: () =>
        tapeHeader(
          "Net %",
          "of |ΔOI|",
          "Put ΔOI minus Call ΔOI as a share of the total |ΔOI| (call + put)",
        ),
      id: "net_pct",
      accessorKey: "net_pct",
      accessorFn: (row) => row.net_pct,
      size: 72,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(rawCellValue(info.row.original, info.column.accessorKey));
        return tapeCell(
          formatTapePct(v),
          undefined,
          signedHeat(v, s.net_pct, 0.06, 0.4),
          undefined,
          undefined,
          false,
          fl((info.row.original as NiftyTapeRow).t, "net_pct"),
        );
      },
    },
    {
      id: "call_tick",
      header: () => tapeHeader("Call·tick", "ticks", "Call OI ticks this minute"),
      accessorKey: "call_tick",
      accessorFn: (row) => row.call_tick,
      size: 84,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(rawCellValue(info.row.original, info.column.accessorKey));
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          signedHeat(v, s.call_tick, 0.05, 0.35),
          undefined,
          v > 0 ? TAPE_TICK_POS : v < 0 ? TAPE_TICK_NEG : undefined,
          true,
          fl((info.row.original as NiftyTapeRow).t, "call_tick"),
        );
      },
    },
    {
      id: "put_tick",
      header: () => tapeHeader("Put·tick", "ticks", "Put OI ticks this minute"),
      accessorKey: "put_tick",
      accessorFn: (row) => row.put_tick,
      size: 84,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(rawCellValue(info.row.original, info.column.accessorKey));
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          signedHeat(v, s.put_tick, 0.05, 0.35),
          undefined,
          v > 0 ? TAPE_TICK_POS : v < 0 ? TAPE_TICK_NEG : undefined,
          true,
          fl((info.row.original as NiftyTapeRow).t, "put_tick"),
        );
      },
    },
    {
      id: "pcr_vol",
      header: "PCR vol",
      accessorKey: "pcr_vol",
      accessorFn: (row) => row.pcr_vol,
      size: 68,
      meta: { align: "right" },
      cell: (info) => tapeCell(formatTapeRatio(Number(rawCellValue(info.row.original, info.column.accessorKey)))),
    },
    {
      id: "pcr_oi",
      header: "PCR OI",
      accessorKey: "pcr_oi",
      accessorFn: (row) => row.pcr_oi,
      size: 68,
      meta: { align: "right" },
      cell: (info) => tapeCell(formatTapeRatio(Number(rawCellValue(info.row.original, info.column.accessorKey)))),
    },
    {
      id: "pcr_doi",
      header: () => tapeHeader("PCR ΔOI", since, "Change in put/call OI ratio"),
      accessorKey: "pcr_doi",
      accessorFn: (row) => row.pcr_doi,
      size: 72,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(rawCellValue(info.row.original, info.column.accessorKey));
        return tapeCell(
          formatTapeRatio(v),
          undefined,
          signedHeat(v, s.pcr_doi, 0.06, 0.5),
          undefined,
          undefined,
          false,
          fl((info.row.original as NiftyTapeRow).t, "pcr_doi"),
        );
      },
    },
    {
      header: () =>
        tapeHeader(
          "Spot−flip",
          "pts",
          "Spot distance from the gamma flip (spot − flip); positive = spot above the flip",
        ),
      id: "spot_flip",
      accessorKey: "spot_flip",
      accessorFn: (row) => row.spot_flip,
      size: 78,
      meta: { align: "right" },
      cell: (info) => {
        const row = info.row.original as NiftyTapeRow;
        const raw = rawCellValue(info.row.original, info.column.accessorKey) as number | null;
        // With a spot-relative flip the column is re-derived from the row's
        // own spot, so every minute is measured against the same level.
        const v =
          flipAtSpot !== null && flipAtSpot !== undefined && Number.isFinite(row.spot)
            ? row.spot - flipAtSpot
            : typeof raw === "number"
              ? raw
              : null;
        return tapeCell(
          formatTapeSigned(v),
          undefined,
          spotFlipTint(v, s.spot_flip),
          undefined,
          spotFlipColor(v) ?? undefined,
          true,
          fl(row.t, "spot_flip"),
        );
      },
    },
  ];
}