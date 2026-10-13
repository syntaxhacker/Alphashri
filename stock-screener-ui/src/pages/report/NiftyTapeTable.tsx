import { useMemo } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";
import type { NiftyTape, NiftyTapeRow } from "@/types/niftyReport";

/** Null/undefined/NaN renders as an em dash. */
export const TAPE_NA = "—";

/** Signed compact OI delta: +170.16M / +5.53M / +850 / -12. */
export function formatTapeCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return TAPE_NA;
  const sign = v < 0 ? "-" : "+";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  return `${sign}${abs.toLocaleString("en-IN")}`;
}

/** Spot / strike-style price with Indian grouping. */
export function formatTapePrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return TAPE_NA;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Signed points, e.g. +12 / -8. */
export function formatTapeSigned(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return TAPE_NA;
  const sign = v < 0 ? "-" : "+";
  return `${sign}${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Signed percent with 2 decimals. */
export function formatTapePct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return TAPE_NA;
  const sign = v < 0 ? "-" : "+";
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

/** Plain ratio with 2 decimals (PCR vol/OI). */
export function formatTapeRatio(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return TAPE_NA;
  return v.toFixed(2);
}

/** ISO timestamp → HH:MM:SS; bare HH:MM labels pass through. */
export function formatTapeTime(t: string): string {
  if (t.includes("T")) {
    const time = t.split("T")[1] ?? "";
    return time.slice(0, 8) || t;
  }
  return t;
}

/**
 * Terminal palette — matches the reference tape screenshot (pitch-black
 * desk, blue call/put deltas, brown Net, blue/brown Spot-flip).
 * Scoped to this table only; the global app palette stays untouched.
 */
export const TAPE_TERM_BG = "#000000";
export const TAPE_SPOT = "#F2CC60";
export const TAPE_CALL_DOI = "#80B5FF";
export const TAPE_PUT_DOI = "#8AA4C2";
export const TAPE_NET_HUE = "#7A4D16";
export const TAPE_NET_TEXT = "#FFDDB3";
export const TAPE_POS_HUE = "#1F7FFF";
export const TAPE_FLIP_POS_TEXT = "#B3D1FF";
export const TAPE_NEG_HUE = "#DB6D28";
export const TAPE_FLIP_NEG_TEXT = "#FFC680";
export const TAPE_TICK_POS = palette.POSITIVE;
export const TAPE_TICK_NEG = palette.NEGATIVE;

/** Build an rgba() string from a hex token — never hardcode channels inline. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Per-column max |value| across the rendered rows — the heat scale. */
export interface TapeScale {
  call_doi: number;
  put_doi: number;
  net: number;
  net_pct: number;
  call_tick: number;
  put_tick: number;
  pcr_doi: number;
  spot_flip: number;
}

/** Largest |value| per heat column. Empty rows → all zeros (no tint). */
export function computeTapeScale(rows: NiftyTapeRow[]): TapeScale {
  const maxAbs = (pick: (r: NiftyTapeRow) => number | null | undefined): number =>
    rows.reduce((m, r) => {
      const v = pick(r);
      return v === null || v === undefined || !Number.isFinite(v) ? m : Math.max(m, Math.abs(v));
    }, 0);
  return {
    call_doi: maxAbs((r) => r.call_doi),
    put_doi: maxAbs((r) => r.put_doi),
    net: maxAbs((r) => r.net),
    net_pct: maxAbs((r) => r.net_pct),
    call_tick: maxAbs((r) => r.call_tick),
    put_tick: maxAbs((r) => r.put_tick),
    pcr_doi: maxAbs((r) => r.pcr_doi),
    spot_flip: maxAbs((r) => r.spot_flip),
  };
}

/**
 * Magnitude heat: background alpha scales with |value| ÷ column max, so a
 * big print glows and a quiet one barely registers — "more has more
 * background, less has lesser opacity". `floor` keeps the hue legible even
 * at the minimum, `ceil` caps the strongest fill.
 */
export function tapeHeat(
  v: number,
  max: number,
  hue: string,
  floor = 0.05,
  ceil = 0.7,
): string | undefined {
  if (!Number.isFinite(v) || v === 0 || max <= 0) return undefined;
  const r = Math.min(1, Math.abs(v) / max);
  return hexToRgba(hue, floor + (ceil - floor) * r);
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
) {
  return (
    <Box
      component="span"
      data-testid={testId}
      data-alpha={tint ? String(tint) : undefined}
      style={tint ? { background: tint } : undefined}
      sx={{
        display: "block",
        margin: tint ? "-4px -8px" : undefined,
        padding: tint ? "4px 8px" : undefined,
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Text size="xs" span c={color ?? tone ?? "default"} fw={bold || tone ? 700 : 400}>
        {value}
      </Text>
    </Box>
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
function tapeHeader(title: string, sub?: string) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.15 }}>
      <Box component="span" sx={{ fontSize: 11, fontWeight: 600 }}>{title}</Box>
      {sub ? (
        <Box component="span" sx={{ fontSize: 9, fontWeight: 400, opacity: 0.65, whiteSpace: "nowrap" }}>
          {sub}
        </Box>
      ) : null}
    </Box>
  );
}

export function getNiftyTapeColumns(
  baseline?: string,
  scale?: TapeScale,
): ColumnDef<NiftyTapeRow>[] {
  const since = baseline ? `since ${baseline}` : "since open";
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
      header: "IST",
      accessorKey: "t",
      accessorFn: (row) => row.t,
      size: 64,
      meta: { align: "left" },
      cell: (info) => tapeCell(formatTapeTime(String(info.getValue() ?? "")), undefined, undefined, "nifty-tape-time"),
    },
    {
      header: () => tapeHeader("Spot"),
      accessorKey: "spot",
      accessorFn: (row) => row.spot,
      size: 88,
      meta: { align: "right" },
      cell: (info) => tapeCell(formatTapePrice(Number(info.getValue())), undefined, undefined, undefined, TAPE_SPOT, true),
    },
    {
      header: () => tapeHeader("Call ΔOI", since),
      accessorKey: "call_doi",
      accessorFn: (row) => row.call_doi,
      size: 96,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.getValue());
        // Column identity hue (blue) + magnitude heat so big call prints pop.
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          tapeHeat(v, s.call_doi, TAPE_CALL_DOI, 0.06, 0.55),
          undefined,
          TAPE_CALL_DOI,
          true,
        );
      },
    },
    {
      header: () => tapeHeader("Put ΔOI", since),
      accessorKey: "put_doi",
      accessorFn: (row) => row.put_doi,
      size: 96,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.getValue());
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          tapeHeat(v, s.put_doi, TAPE_PUT_DOI, 0.06, 0.55),
          undefined,
          TAPE_PUT_DOI,
          true,
        );
      },
    },
    {
      header: () => tapeHeader("Net", "plus→call"),
      accessorKey: "net",
      accessorFn: (row) => row.net,
      size: 96,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.getValue());
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
        );
      },
    },
    {
      header: () => tapeHeader("Net %", "of [call]+[put]"),
      accessorKey: "net_pct",
      accessorFn: (row) => row.net_pct,
      size: 72,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.getValue());
        return tapeCell(formatTapePct(v), undefined, signedHeat(v, s.net_pct, 0.06, 0.4));
      },
    },
    {
      header: () => tapeHeader("Call·tick"),
      accessorKey: "call_tick",
      accessorFn: (row) => row.call_tick,
      size: 84,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.getValue());
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          signedHeat(v, s.call_tick, 0.05, 0.35),
          undefined,
          v > 0 ? TAPE_TICK_POS : v < 0 ? TAPE_TICK_NEG : undefined,
          true,
        );
      },
    },
    {
      header: () => tapeHeader("Put·tick"),
      accessorKey: "put_tick",
      accessorFn: (row) => row.put_tick,
      size: 84,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.getValue());
        return tapeCell(
          formatTapeCompact(v),
          undefined,
          signedHeat(v, s.put_tick, 0.05, 0.35),
          undefined,
          v > 0 ? TAPE_TICK_POS : v < 0 ? TAPE_TICK_NEG : undefined,
          true,
        );
      },
    },
    {
      header: "PCR vol",
      accessorKey: "pcr_vol",
      accessorFn: (row) => row.pcr_vol,
      size: 68,
      meta: { align: "right" },
      cell: (info) => tapeCell(formatTapeRatio(Number(info.getValue()))),
    },
    {
      header: "PCR OI",
      accessorKey: "pcr_oi",
      accessorFn: (row) => row.pcr_oi,
      size: 68,
      meta: { align: "right" },
      cell: (info) => tapeCell(formatTapeRatio(Number(info.getValue()))),
    },
    {
      header: () => tapeHeader("PCR ΔOI", since),
      accessorKey: "pcr_doi",
      accessorFn: (row) => row.pcr_doi,
      size: 72,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.getValue());
        return tapeCell(formatTapeRatio(v), undefined, signedHeat(v, s.pcr_doi, 0.06, 0.5));
      },
    },
    {
      header: () => tapeHeader("Spot−flip", "pts"),
      accessorKey: "spot_flip",
      accessorFn: (row) => row.spot_flip,
      size: 78,
      meta: { align: "right" },
      cell: (info) => {
        const raw = info.getValue() as number | null;
        const v = typeof raw === "number" ? raw : null;
        return tapeCell(
          formatTapeSigned(v),
          undefined,
          spotFlipTint(v, s.spot_flip),
          undefined,
          spotFlipColor(v) ?? undefined,
          true,
        );
      },
    },
  ];
}

/** ISO timestamp (or bare HH:MM) → HH:MM baseline label; "" when unknown. */
export function formatTapeBaseline(t: string | null | undefined): string {
  if (!t) return "";
  return formatTapeTime(t).slice(0, 5);
}

/** Earliest chronological row's HH:MM — explicit `tape.baseline_t` wins,
 * otherwise the first row's `t`; null when there is nothing to anchor to. */
export function getTapeBaseline(tape?: NiftyTape, rows?: NiftyTapeRow[]): string | null {
  const explicit =
    tape?.baseline_t && tape.baseline_t.length > 0
      ? formatTapeBaseline(tape.baseline_t)
      : "";
  if (explicit) return explicit;
  if (rows && rows.length > 0) {
    const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const hhmm = formatTapeBaseline(asc[0]?.t);
    if (hhmm) return hhmm;
  }
  return null;
}

/** Honest ΔOI label: deltas are measured vs the baseline, not the open. */
export function tapeDoiLabel(tape?: NiftyTape, rows?: NiftyTapeRow[]): string {
  const baseline = getTapeBaseline(tape, rows);
  return baseline ? `PCR ΔOI since ${baseline}` : "PCR ΔOI since open";
}

/** Header-strip stats: last chronological row wins; nonzero session-summary
 * fields fill in when the row carries zeros. */
export function buildTapeHead(rows: NiftyTapeRow[], tape?: NiftyTape): {
  pcrOi: number;
  pcrDoiDelta: number;
  maxPain: number;
  flipDeltaPts: number;
  flip: number;
  wallCall: number;
  wallPut: number;
  spot: number;
} {
  const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const first = asc[0];
  const last = asc[asc.length - 1];
  const pick = (rowVal: number, sumVal?: number): number =>
    rowVal !== 0 ? rowVal : (sumVal ?? 0);
  const flip = pick(last.flip, tape?.flip);
  return {
    pcrOi: pick(last.pcr_oi, tape?.pcr_oi),
    pcrDoiDelta: last.pcr_doi - first.pcr_doi,
    maxPain: pick(last.max_pain, tape?.max_pain),
    flipDeltaPts: flip === 0 ? 0 : flip - last.spot,
    flip,
    wallCall: pick(last.walls.call, tape?.walls?.call),
    wallPut: pick(last.walls.put, tape?.walls?.put),
    spot: last.spot,
  };
}

export function NiftyTapeTable({ rows, tape }: { rows: NiftyTapeRow[]; tape?: NiftyTape }) {
  const baseline = useMemo(() => getTapeBaseline(tape, rows), [rows, tape]);
  /** Latest minute first — copy, never mutate the prop. */
  const ordered = useMemo(
    () => [...rows].sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0)),
    [rows],
  );
  const scale = useMemo(() => computeTapeScale(ordered), [ordered]);
  const columns = useMemo(
    () => getNiftyTapeColumns(baseline ?? undefined, scale),
    [baseline, scale],
  );
  const head = useMemo(() => buildTapeHead(rows, tape), [rows, tape]);
  const doiLabel = useMemo(() => tapeDoiLabel(tape, rows), [rows, tape]);
  const flipSigned = `${head.flipDeltaPts >= 0 ? "+" : ""}${head.flipDeltaPts.toLocaleString("en-IN", { maximumFractionDigits: 0 })} pts`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, background: TAPE_TERM_BG }}>
      <Box data-testid="nifty-tape-head" sx={{ background: TAPE_TERM_BG, px: 1, pt: 0.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            columnGap: 2,
            rowGap: 0.5,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Box data-testid="nifty-tape-pcr" sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>PCR OI</Text>
            <Text data-testid="nifty-tape-head-pcr-oi" size="sm" span fw={700}>{formatTapeRatio(head.pcrOi)}</Text>
            <Text size="xs" span c="dimmed">snapshot</Text>
          </Box>
          <Box data-testid="nifty-tape-head-pcr-doi" sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>{doiLabel}</Text>
            <Text size="sm" span fw={700} c={TAPE_CALL_DOI}>{formatTapeSigned(head.pcrDoiDelta)}</Text>
          </Box>
          <Box data-testid="nifty-tape-max-pain" sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Max pain</Text>
            <Text data-testid="nifty-tape-head-max-pain" size="sm" span fw={700}>{formatTapePrice(head.maxPain)}</Text>
          </Box>
          <Box data-testid="nifty-tape-flip" sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Flip</Text>
            <Text data-testid="nifty-tape-head-flip" size="sm" span fw={700}>
              {formatTapePrice(head.flip)}{" "}
              <Text size="xs" span c={head.flipDeltaPts >= 0 ? TAPE_FLIP_POS_TEXT : TAPE_FLIP_NEG_TEXT} fw={700}>
                {flipSigned}
              </Text>
            </Text>
          </Box>
          <Box data-testid="nifty-tape-walls" sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Walls</Text>
            <Text data-testid="nifty-tape-head-walls" size="sm" span fw={700}>
              {formatTapePrice(head.wallCall)} / {formatTapePrice(head.wallPut)}
            </Text>
            <Text size="xs" span c="dimmed">call / put</Text>
          </Box>
        </Box>
        <Text size="xs" c="dimmed" ta="left">
          TICKS {rows.length} · one per minute
        </Text>
      </Box>
      <Box
        data-testid="nifty-tape-table-wrap"
        sx={{
          display: "flex",
          minHeight: 240,
          height: "min(52vh, 520px)",
          minWidth: 0,
          background: TAPE_TERM_BG,
          // Terminal density: pitch-black surfaces, muted grid lines,
          // monospaced tabular numerals. Scoped descendant overrides only.
          "& .paper-tanstack-container, & .paper-tanstack-scroll, & .paper-tanstack-table": {
            background: `${TAPE_TERM_BG} !important`,
          },
          "& .paper-tanstack-cell": {
            paddingTop: "3px",
            paddingBottom: "3px",
            background: `${TAPE_TERM_BG} !important`,
            borderBottom: "1px solid #141414 !important",
            fontSize: 12,
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          },
          "& .paper-tanstack-header-cell": {
            paddingTop: "3px",
            paddingBottom: "4px",
            background: `${TAPE_TERM_BG} !important`,
            borderBottom: "1px solid #2A2A2A !important",
            color: "#8B949E",
            fontSize: 10,
            textTransform: "uppercase",
            verticalAlign: "bottom",
          },
          // Row hover: lift the whole tape line so the eye can track across.
          "& tbody tr[data-row='stock']:hover .paper-tanstack-cell": {
            background: "#101418 !important",
          },
          // Newest minute pinned with a blue left accent.
          "& tbody tr.tape-latest .paper-tanstack-cell:first-of-type": {
            boxShadow: `inset 2px 0 0 0 ${TAPE_CALL_DOI}`,
          },
          "& tbody tr.tape-latest .paper-tanstack-cell": {
            background: "#0A0F16 !important",
          },
          // IST column stays put while the numeric block scrolls sideways.
          "& th:first-of-type, & td:first-of-type": {
            position: "sticky",
            left: 0,
            zIndex: 2,
            background: `${TAPE_TERM_BG} !important`,
            boxShadow: "1px 0 0 0 #1F1F1F",
          },
          "& th:first-of-type": { zIndex: 3 },
        }}
      >
        <TanStackTable<NiftyTapeRow>
          data={ordered}
          columns={columns}
          dataTestId="nifty-tape-table"
          emptyMessage="No tape rows yet"
          fillContainer
          enableSorting={false}
          getRowTestId={() => "nifty-tape-row"}
          getRowClassName={(row) => (row === ordered[0] ? "tape-latest" : undefined)}
        />
      </Box>
    </Box>
  );
}
