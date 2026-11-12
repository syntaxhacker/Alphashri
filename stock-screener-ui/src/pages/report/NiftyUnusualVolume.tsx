import { formatNumberIN } from "@/utils/ui-helpers";
import { memo, useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Box } from "@/ui";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";
import type { NiftyStrike } from "@/types/niftyReport";
import { hexToRgba } from "@/utils/color";
import { formatReportClock, formatReportCompact, formatReportPct } from "./reportFormat";
import {
  SENTIMENT_NAMES,
  sentimentCode,
  sentimentLabel,
  sentimentNote,
  sentimentSign,
} from "./optionSentiment";

/** Cap on ranked legs — one CE row + one PE row per strike compete for slots. */
const UNUSUAL_TOP_N = 30;

interface UnusualLegRow {
  key: string;
  strike: number;
  leg: "CE" | "PE";
  volume: number;
  oi: number;
  /** Volume÷OI; null when OI is 0 (nothing to divide by). */
  volOi: number | null;
  /** Rank key: Vol÷OI when OI > 0, raw volume when OI = 0. */
  rankKey: number;
  /** % of this leg's total chain volume. */
  share: number;
  sentiment: string;
  rank: number;
}

/**
 * Expand the chain to one row per strike-leg, keep the top-30 legs by
 * volume (filters far-OTM noise where tiny OI inflates the ratio), then
 * rank that pool by Vol÷OI desc — the unusualness key. OI=0 legs fall
 * back to raw volume as their rank key.
 */
export function buildUnusualRows(strikes: NiftyStrike[]): UnusualLegRow[] {
  const list = strikes ?? [];
  let ceTotal = 0;
  let peTotal = 0;
  for (const s of list) {
    ceTotal += s.ce?.volume ?? 0;
    peTotal += s.pe?.volume ?? 0;
  }
  const legs: Omit<UnusualLegRow, "rank">[] = [];
  for (const s of list) {
    for (const leg of ["CE", "PE"] as const) {
      const side = leg === "CE" ? s.ce : s.pe;
      const volume = side?.volume ?? 0;
      const oi = side?.oi ?? 0;
      const total = leg === "CE" ? ceTotal : peTotal;
      legs.push({
        key: `${s.strike}-${leg}`,
        strike: s.strike,
        leg,
        volume,
        oi,
        volOi: oi > 0 ? volume / oi : null,
        rankKey: oi > 0 ? volume / oi : volume,
        share: total > 0 ? (volume / total) * 100 : 0,
        sentiment: String(side?.sentiment ?? "Neutral"),
      });
    }
  }
  // Candidate pool: highest-volume legs first, then rank by unusualness.
  const pool = [...legs]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, UNUSUAL_TOP_N);
  pool.sort((a, b) => b.rankKey - a.rankKey || b.volume - a.volume);
  return pool.map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Unsigned compact volume: 1.25M / 850.00K / 912. */
export function formatUnusualCompact(v: number): string {
  return formatReportCompact(v, { round: true });
}

/** Share of leg volume, 1 decimal. */
export function formatUnusualShare(p: number): string {
  return formatReportPct(p, { digits: 1 });
}

// Full class labels + the directional map live in `optionSentiment` so this
// panel and NiftyReportPanel's CE/PE Signal badges can never drift apart.
export const UNUSUAL_SENTIMENT_NAMES = SENTIMENT_NAMES;

/**
 * Border/text tone for a positioning cell, per side.
 *
 * This is a **direction-of-delta-exposure** badge, not a "what did the
 * participants do" badge — it uses the same map as the backend's
 * `class_sign` (put SC = writers buying back a long-delta hedge = bearish,
 * put LU = buyers selling out of short-delta pressure = bullish). The
 * contract-level reading is in the cell tooltip so the two concepts cannot be
 * confused.
 */
export function getUnusualSentimentTone(sentiment: string, side: "CE" | "PE"): string {
  const sign = sentimentSign(sentiment, side);
  if (sign === 0) return palette.TEXT_MUTED;
  return sign > 0 ? palette.POSITIVE : palette.NEGATIVE;
}

/**
 * Terminal palette — matches the reference unusual-volume screenshot:
 * pitch-black desk, CE blue / PE orange bars, plain bold positioning text.
 */
export const UNUSUAL_TERM_BG = "#000000";
export const UNUSUAL_TERM_BORDER = "#1A1A1A";
const UNUSUAL_CE = "#5B9CF6";
const UNUSUAL_PE = "#F2A65A";
const UNUSUAL_CALL_VOL = "#5B9CF6";
const UNUSUAL_PUT_VOL = "#F2A65A";

type UnusualLegFilter = "all" | "CE" | "PE";

function positioningText(sentiment: string, side: "CE" | "PE") {
  const code = sentimentCode(sentiment);
  const label = sentimentLabel(sentiment);
  const tone = getUnusualSentimentTone(sentiment, side);
  // Terminal style: plain bold text, no pill border — Short buildup reads
  // orange, Long buildup / covers read blue, unwinds stay muted.
  const color =
    tone === palette.POSITIVE ? UNUSUAL_CE : tone === palette.NEGATIVE ? UNUSUAL_PE : tone;
  return (
    <span
      title={code ? `${label} (${side}) — ${sentimentNote(code, side)}` : label}
      data-testid={`nifty-unusual-sentiment-${side}`}
      className="block overflow-hidden truncate whitespace-nowrap shrink-0"
      style={{ "max-width": "100%", "vertical-align": "middle" }}
    >
      <Text size="xs" fw={700} c={color} span truncate>
        {label}
      </Text>
    </span>
  );
}

/** Numeric cell with tabular figures + ellipsis. */
function unusualCell(value: string) {
  return (
    <span
      className="block overflow-hidden truncate tabular-nums"
      style={{
        display: "block",
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <Text size="xs" span c="default">
        {value}
      </Text>
    </span>
  );
}

/** ITM leg for the tint: calls below spot, puts above spot. */
export function isItmLeg(strike: number, leg: "CE" | "PE", spot: number): boolean {
  if (!Number.isFinite(spot) || spot <= 0) return false;
  return leg === "CE" ? strike < spot : strike > spot;
}

export function getNiftyUnusualColumns(maxVol: number): ColumnDef<UnusualLegRow>[] {
  return [
    {
      header: "#",
      accessorKey: "rank",
      accessorFn: (row) => row.rank,
      size: 30,
      meta: { align: "center" },
      cell: (info) => unusualCell(String(info.getValue())),
    },
    {
      header: "Strike",
      accessorKey: "strike",
      accessorFn: (row) => row.strike,
      size: 92,
      meta: { align: "right" },
      // Strike and leg share one cell: the leg is just a suffix, and a separate
      // column cost 46px the narrow panel cannot spare (TanStackTable forces
      // ["min-width"] = visibleColumnCount x 96).
      cell: (info) => {
        const row = info.row.original as UnusualLegRow;
        const tone = row.leg === "CE" ? UNUSUAL_CE : UNUSUAL_PE;
        return (
          <span
            className="flex items-baseline justify-end gap-[4px] overflow-hidden tabular-nums"
            style={{
              display: "flex",
              "align-items": "baseline",
              "justify-content": "flex-end",
              gap: 4,
              overflow: "hidden",
              "font-variant-numeric": "tabular-nums",
            }}
          >
            <Text size="xs" span fw={700}>{formatNumberIN(row.strike)}</Text>
            <Text size="xs" span fw={700} c={tone}>{row.leg}</Text>
          </span>
        );
      },
    },
    {
      header: "Vol",
      accessorKey: "volume",
      accessorFn: (row) => row.volume,
      size: 150,
      meta: { align: "right" },
      cell: (info) => {
        const row = (info.row.original as UnusualLegRow);
        const ratio = maxVol > 0 ? Math.min(1, row.volume / maxVol) : 0;
        const pct = ratio * 100;
        const base = row.leg === "CE" ? UNUSUAL_CE : UNUSUAL_PE;
        // Length AND strength encode size: top-volume leg is fully opaque,
        // smaller legs fade toward 0.30 alpha — "more has more background".
        const fillAlpha = 0.3 + 0.7 * ratio;
        return (
          <Box className="flex items-center gap-[8px] min-w-0">
            <Box
              className="flex-1 h-[5px] rounded-0 min-w-0"
              style={{ "background-color": hexToRgba(base, 0.12), "border-radius": 0 }}
            >
              <Box
                data-testid={`nifty-unusual-bar-${row.strike}-${row.leg}`}
                data-ratio={ratio.toFixed(3)}
                className="h-full rounded-0"
                style={{ width: `${pct}%`, opacity: fillAlpha, "background-color": base }}
              />
            </Box>
            <Box className="w-[58px] shrink-0 text-right tabular-nums">
              <Text size="xs" span fw={700}>
                {formatUnusualCompact(row.volume)}
              </Text>
            </Box>
          </Box>
        );
      },
    },
    {
      header: "OI",
      accessorKey: "oi",
      accessorFn: (row) => row.oi,
      size: 62,
      meta: { align: "right" },
      cell: (info) => unusualCell(formatUnusualCompact(Number(info.getValue()))),
    },
    {
      header: "Vol÷OI",
      accessorKey: "volOi",
      accessorFn: (row) => row.volOi ?? -1,
      size: 56,
      meta: { align: "right" },
      cell: (info) => {
        const row = (info.row.original as UnusualLegRow);
        return unusualCell(
          row.volOi !== null ? row.volOi.toFixed(2) : formatUnusualCompact(row.volume),
        );
      },
    },
    {
      header: "Position",
      accessorKey: "sentiment",
      accessorFn: (row) => row.sentiment,
      size: 94,
      meta: { align: "center" },
      cell: (info) => {
        const row = (info.row.original as UnusualLegRow);
        return positioningText(String(info.getValue() ?? ""), row.leg);
      },
    },
  ];
}

/** One-line detail strip for the #1 ranked leg, derived from the
 *  already-built row (no new data): `25,800 CE · VOL 90.00K · OI 1.00K ·
 *  VOL÷OI 90.00x · SHARE 47.4% of CE vol · VS SPOT +50 pts · Short Cover`. */
export function formatUnusualFocus(row: UnusualLegRow, spot: number): string {
  const strike = formatNumberIN(row.strike);
  const vol = formatUnusualCompact(row.volume);
  const oi = formatUnusualCompact(row.oi);
  // Mirrors the table cell: OI=0 legs show compact volume instead of a ratio.
  const ratio =
    row.volOi !== null && Number.isFinite(row.volOi)
      ? `${row.volOi.toFixed(2)}x`
      : formatUnusualCompact(row.volume);
  const share = `${formatUnusualShare(row.share)} of ${row.leg} vol`;
  const diff = row.strike - spot;
  const vs = Number.isFinite(diff)
    ? `${diff >= 0 ? "+" : "-"}${Math.abs(diff).toLocaleString("en-IN", { maximumFractionDigits: 0 })} pts`
    : "—";
  const positioning = sentimentLabel(row.sentiment);
  return `${strike} ${row.leg} · VOL ${vol} · OI ${oi} · VOL÷OI ${ratio} · SHARE ${share} · VS SPOT ${vs} · ${positioning}`;
}


/** IST HH:MM:SS for an epoch-ms value — host-TZ independent. */
function clock(ms: number): string {
  return formatReportClock(ms);
}

/** Stable row test-id getter — hoisted so the table never gets a new fn. */
function getUnusualRowTestId(row: UnusualLegRow): string {
  return `nifty-unusual-row-${row.strike}-${row.leg}`;
}

/** Memoised filter pill — replaces the per-render `pill()` closure. */
const UnusualFilterPill = memo(function UnusualFilterPill({
  active,
  label,
  testId,
  onClick,
}: {
  active: boolean;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <Box
      component="button"
      data-testid={testId}
      onClick={onClick}
      className="rounded-full px-[8px] py-[2px] text-[11px] font-bold cursor-pointer whitespace-nowrap shrink-0 border border-solid"
      style={{
        "border-color": active ? "#2FC0AC" : "#30363D",
        "background-color": active ? "rgba(47, 192, 172, 0.18)" : "transparent",
        color: active ? "#8AE6D4" : "#8B949E",
      }}
    >
      {label}
    </Box>
  );
});
UnusualFilterPill.displayName = "UnusualFilterPill";

function NiftyUnusualVolumeInner({
  strikes,
  spot,
  updatedAtMs = null,
  nextUpdateAtMs = null,
}: {
  strikes: NiftyStrike[];
  spot: number;
  /** Epoch ms of the last successful refresh, and of the next scheduled one. */
  updatedAtMs?: number | null;
  nextUpdateAtMs?: number | null;
}) {
  const [legFilter, setLegFilter] = useState<UnusualLegFilter>("all");
  const rows = useMemo(() => buildUnusualRows(strikes), [strikes]);
  const totals = useMemo(() => {
    let ce = 0;
    let pe = 0;
    for (const s of strikes ?? []) {
      ce += s.ce?.volume ?? 0;
      pe += s.pe?.volume ?? 0;
    }
    return { ce, pe };
  }, [strikes]);
  const visible = useMemo(
    () => (legFilter === "all" ? rows : rows.filter((r) => r.leg === legFilter)),
    [rows, legFilter],
  );
  const maxVol = useMemo(
    () => visible.reduce((m, r) => Math.max(m, r.volume), 0),
    [visible],
  );
  const columns = useMemo(() => getNiftyUnusualColumns(maxVol), [maxVol]);
  // Stable filter callbacks so the memoised pills keep working props.
  const selectAll = useCallback(() => setLegFilter("all"), []);
  const selectCalls = useCallback(() => setLegFilter("CE"), []);
  const selectPuts = useCallback(() => setLegFilter("PE"), []);
  // Stable row-style resolver (depends only on spot, not on every render).
  const getRowStyle = useCallback(
    (row: UnusualLegRow) =>
      isItmLeg(row.strike, row.leg, spot)
        ? { background: hexToRgba(palette.WARNING, 0.08) }
        : undefined,
    [spot],
  );
  const top = rows[0];
  const focus = top ? formatUnusualFocus(top, spot) : "";
  // Split the focus line into label/value pairs for terminal rendering while
  // keeping the exact same text (tests assert the full string).
  const focusParts = focus ? focus.split(" · ") : [];

  return (
    <Box
      data-testid="nifty-unusual-panel"
      className="flex flex-col gap-[4px] min-w-0"
      style={{ "background-color": UNUSUAL_TERM_BG }}
    >
      <Box className="flex items-center justify-between gap-[4px] px-[6px] pt-[2px]">
        <Text size="xs" fw={700} span>Unusual volume</Text>
        <Box className="flex items-center gap-[4px]">
          <UnusualFilterPill active={legFilter === "all"} label="C + P" testId="nifty-unusual-filter-all" onClick={selectAll} />
          <UnusualFilterPill active={legFilter === "CE"} label="Calls" testId="nifty-unusual-filter-ce" onClick={selectCalls} />
          <UnusualFilterPill active={legFilter === "PE"} label="Puts" testId="nifty-unusual-filter-pe" onClick={selectPuts} />
        </Box>
      </Box>
      {/* Single wrapping stat line (was two stacked rows): call/put vol +
          top share + rank caption + upd stamp all flow inline — one ~18px
          line at width instead of two blocks. Nothing removed. */}
      <Box data-testid="nifty-unusual-head" style={{ "background-color": UNUSUAL_TERM_BG, "padding-left": 6, "padding-right": 6 }}>
        <Box className="flex items-baseline flex-wrap gap-x-[10px] gap-y-0 tabular-nums">
          <Box className="flex items-baseline gap-[4px]">
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Call vol</Text>
            <Text data-testid="nifty-unusual-ce-vol" size="xs" span fw={700} c={UNUSUAL_CALL_VOL}>{formatUnusualCompact(totals.ce)}</Text>
          </Box>
          <Box className="flex items-baseline gap-[4px]">
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Put vol</Text>
            <Text data-testid="nifty-unusual-pe-vol" size="xs" span fw={700} c={UNUSUAL_PUT_VOL}>{formatUnusualCompact(totals.pe)}</Text>
          </Box>
          <Box className="flex items-baseline gap-[4px]">
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Top share</Text>
            <Text data-testid="nifty-unusual-top-share" size="xs" span fw={700}>{top ? formatUnusualShare(top.share) : "—"}</Text>
          </Box>
          <Text data-testid="nifty-unusual-caption" size="xs" c="dimmed" ta="left" span>
            ranked by Vol÷OI · {rows.length} legs
          </Text>
          {updatedAtMs !== null && (
            <Text
              data-testid="nifty-unusual-updated"
              size="xs"
              c="dimmed"
              span
              noWrap
              className="tabular-nums shrink-0"
              style={{ "flex-shrink": 0 }}
            >
              upd {clock(updatedAtMs)}
              {nextUpdateAtMs !== null ? ` · next ${clock(nextUpdateAtMs)}` : ""}
            </Text>
          )}
        </Box>
      </Box>
      {top && (
        <Box
          data-testid="nifty-unusual-focus"
          title={focus}
          className="whitespace-nowrap overflow-hidden truncate tabular-nums min-w-0 px-[6px] py-[2px] border-t border-b"
          style={{
            "background-color": "#0A0A0A",
            "border-top": "1px solid #1A1A1A",
            "border-bottom": "1px solid #1A1A1A",
          }}
        >
          <Text size="xs" span c="dimmed">
            {focusParts.join(" · ")}
          </Text>
        </Box>
      )}
      <Box
        className="flex min-h-[120px] h-[150px] min-w-0 [&_.paper-tanstack-container]:[background:var(--desk-bg)]! [&_.paper-tanstack-scroll]:[background:var(--desk-bg)]! [&_.paper-tanstack-table]:[background:var(--desk-bg)]! [&_.paper-tanstack-cell]:[padding-top:2px]! [&_.paper-tanstack-cell]:[padding-bottom:2px]! [&_.paper-tanstack-cell]:[background:var(--desk-bg)]! [&_.paper-tanstack-cell]:[border-bottom:1px_solid_var(--desk-border)]! [&_.paper-tanstack-cell]:text-[12px]! [&_.paper-tanstack-header-cell]:[padding-top:2px]! [&_.paper-tanstack-header-cell]:[padding-bottom:2px]! [&_.paper-tanstack-header-cell]:[background:var(--desk-bg)]! [&_.paper-tanstack-header-cell]:[border-bottom:1px_solid_var(--desk-grid)]! [&_.paper-tanstack-header-cell]:[color:var(--desk-muted)]! [&_.paper-tanstack-header-cell]:text-[10px]! [&_.paper-tanstack-header-cell]:uppercase!"
        style={{
          "background-color": UNUSUAL_TERM_BG,
          "--desk-bg": UNUSUAL_TERM_BG,
          "--desk-border": UNUSUAL_TERM_BORDER,
          "--desk-grid": palette.NT_GRID,
          "--desk-muted": palette.TEXT_MUTED,
        } as CSSProperties}
      >
        <TanStackTable<UnusualLegRow>
          data={visible}
          columns={columns}
          dataTestId="nifty-unusual-table"
          emptyMessage="No chain data"
          fillContainer
          getRowStyle={getRowStyle}
          getRowTestId={getUnusualRowTestId}
          dense
          style={{ "min-width": 0 }}
        />
      </Box>
    </Box>
  );
}

/** Memoised leaf panel — `strikes` keeps identity between unrelated parent renders. */
export const NiftyUnusualVolume = memo(NiftyUnusualVolumeInner);
NiftyUnusualVolume.displayName = "NiftyUnusualVolume";
