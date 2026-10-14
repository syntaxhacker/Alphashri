import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";
import type { NiftyStrike } from "@/types/niftyReport";

/** Cap on ranked legs — one CE row + one PE row per strike compete for slots. */
export const UNUSUAL_TOP_N = 30;

export interface UnusualLegRow {
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
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(2)}K`;
  return Math.round(abs).toLocaleString("en-IN");
}

/** Share of leg volume, 1 decimal. */
export function formatUnusualShare(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return `${p.toFixed(1)}%`;
}

// Mirrors NiftyReportPanel's sentimentBadge label + per-side tone convention
// (calls rise on buying so LB/SC are bullish; puts rise on fear so SB/SC
// are bullish). Duplicated here so this panel stays decoupled from the
// report panel module (no import cycle).
export const UNUSUAL_SENTIMENT_NAMES: Record<string, string> = {
  LB: "Long Buildup",
  SB: "Short Buildup",
  SC: "Short Cover",
  LU: "Long Unwind",
};

/** Border/text tone for a positioning pill, per side. */
export function getUnusualSentimentTone(sentiment: string, side: "CE" | "PE"): string {
  const code = sentiment.trim().toUpperCase();
  if (code === "NEUTRAL" || !UNUSUAL_SENTIMENT_NAMES[code]) return palette.TEXT_MUTED;
  const bullish =
    side === "CE" ? code === "LB" || code === "SC" : code === "SB" || code === "SC";
  return bullish ? palette.POSITIVE : palette.NEGATIVE;
}

/**
 * Terminal palette — matches the reference unusual-volume screenshot:
 * pitch-black desk, CE blue / PE orange bars, plain bold positioning text.
 */
export const UNUSUAL_TERM_BG = "#000000";
export const UNUSUAL_TERM_BORDER = "#1A1A1A";
export const UNUSUAL_CE = "#5B9CF6";
export const UNUSUAL_PE = "#F2A65A";
export const UNUSUAL_CALL_VOL = "#5B9CF6";
export const UNUSUAL_PUT_VOL = "#F2A65A";

export type UnusualLegFilter = "all" | "CE" | "PE";

function legText(leg: "CE" | "PE") {
  const color = leg === "CE" ? UNUSUAL_CE : UNUSUAL_PE;
  return (
    <Box component="span" sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <Text size="xs" fw={700} span c={color}>
        {leg}
      </Text>
    </Box>
  );
}

function positioningText(sentiment: string, side: "CE" | "PE") {
  const code = sentiment.trim().toUpperCase();
  const label = UNUSUAL_SENTIMENT_NAMES[code] ?? sentiment;
  const tone = getUnusualSentimentTone(sentiment, side);
  // Terminal style: plain bold text, no pill border — Short buildup reads
  // orange, Long buildup / covers read blue, unwinds stay muted.
  const color =
    tone === palette.POSITIVE ? UNUSUAL_CE : tone === palette.NEGATIVE ? UNUSUAL_PE : tone;
  return (
    <Box
      component="span"
      sx={{
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      <Text size="xs" fw={700} c={color} span truncate>
        {label}
      </Text>
    </Box>
  );
}

/** Numeric cell with tabular figures + ellipsis. */
function unusualCell(value: string) {
  return (
    <Box
      component="span"
      sx={{
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Text size="xs" span c="default">
        {value}
      </Text>
    </Box>
  );
}

/** ITM leg for the tint: calls below spot, puts above spot. */
export function isItmLeg(strike: number, leg: "CE" | "PE", spot: number): boolean {
  if (!Number.isFinite(spot) || spot <= 0) return false;
  return leg === "CE" ? strike < spot : strike > spot;
}

/** Build an rgba() string from a palette hex token — never hardcode the channels. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
      // minWidth = visibleColumnCount x 96).
      cell: (info) => {
        const row = info.row.original as UnusualLegRow;
        const tone = row.leg === "CE" ? UNUSUAL_CE : UNUSUAL_PE;
        return (
          <Box
            component="span"
            sx={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "flex-end",
              gap: 0.5,
              overflow: "hidden",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <Text size="xs" span fw={700}>{row.strike.toLocaleString("en-IN")}</Text>
            <Text size="xs" span fw={700} c={tone}>{row.leg}</Text>
          </Box>
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Box sx={{ flex: 1, height: 5, borderRadius: 0, background: hexToRgba(base, 0.12), minWidth: 0 }}>
              <Box
                data-testid={`nifty-unusual-bar-${row.strike}-${row.leg}`}
                data-ratio={ratio.toFixed(3)}
                style={{ width: `${pct}%`, opacity: fillAlpha }}
                sx={{ height: "100%", borderRadius: 0, background: base }}
              />
            </Box>
            <Box sx={{ width: 58, flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
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
 * already-built row (no new data): `25,800 CE · VOL 90.00K · OI 1.00K ·
 * VOL÷OI 90.00x · SHARE 47.4% of CE vol · VS SPOT +50 pts · Short Cover`. */
export function formatUnusualFocus(row: UnusualLegRow, spot: number): string {
  const strike = row.strike.toLocaleString("en-IN");
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
  const code = row.sentiment.trim().toUpperCase();
  const positioning = UNUSUAL_SENTIMENT_NAMES[code] ?? row.sentiment;
  return `${strike} ${row.leg} · VOL ${vol} · OI ${oi} · VOL÷OI ${ratio} · SHARE ${share} · VS SPOT ${vs} · ${positioning}`;
}


/** IST HH:MM:SS for an epoch-ms value — host-TZ independent. */
function clock(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
}

export function NiftyUnusualVolume({
  strikes,
  spot,
  sx,
  updatedAtMs = null,
  nextUpdateAtMs = null,
}: {
  strikes: NiftyStrike[];
  spot: number;
  sx?: CSSProperties;
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
  const top = rows[0];
  const focus = top ? formatUnusualFocus(top, spot) : "";
  // Split the focus line into label/value pairs for terminal rendering while
  // keeping the exact same text (tests assert the full string).
  const focusParts = focus ? focus.split(" · ") : [];

  const pill = (active: boolean, label: string, testId: string, onClick: () => void) => (
    <Box
      component="button"
      data-testid={testId}
      onClick={onClick}
      sx={{
        border: "1px solid",
        borderColor: active ? "#2FC0AC" : "#30363D",
        background: active ? "rgba(47, 192, 172, 0.18)" : "transparent",
        color: active ? "#8AE6D4" : "#8B949E",
        borderRadius: 999,
        px: 1.25,
        py: 0.25,
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Box>
  );

  return (
    <Box
      data-testid="nifty-unusual-panel"
      sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0, background: UNUSUAL_TERM_BG, ...sx }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5, px: 0.75, pt: 0.5, pb: 0.25 }}>
        <Text size="xs" fw={700} span>Unusual volume</Text>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {pill(legFilter === "all", "C + P", "nifty-unusual-filter-all", () => setLegFilter("all"))}
          {pill(legFilter === "CE", "Calls", "nifty-unusual-filter-ce", () => setLegFilter("CE"))}
          {pill(legFilter === "PE", "Puts", "nifty-unusual-filter-pe", () => setLegFilter("PE"))}
        </Box>
      </Box>
      <Box data-testid="nifty-unusual-head" sx={{ background: UNUSUAL_TERM_BG, px: 0.75 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 1.5, rowGap: 0, fontVariantNumeric: "tabular-nums" }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Call vol</Text>
            <Text data-testid="nifty-unusual-ce-vol" size="xs" span fw={700} c={UNUSUAL_CALL_VOL}>{formatUnusualCompact(totals.ce)}</Text>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Put vol</Text>
            <Text data-testid="nifty-unusual-pe-vol" size="xs" span fw={700} c={UNUSUAL_PUT_VOL}>{formatUnusualCompact(totals.pe)}</Text>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Top share</Text>
            <Text data-testid="nifty-unusual-top-share" size="xs" span fw={700}>{top ? formatUnusualShare(top.share) : "—"}</Text>
          </Box>
        </Box>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 1 }}>
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
              sx={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
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
          sx={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontVariantNumeric: "tabular-nums",
            minWidth: 0,
            px: 0.75,
            py: 0.25,
            background: "#0A0A0A",
            borderTop: "1px solid #1A1A1A",
            borderBottom: "1px solid #1A1A1A",
          }}
        >
          <Text size="xs" span c="dimmed">
            {focusParts.join(" · ")}
          </Text>
        </Box>
      )}
      <Box
        sx={{
          display: "flex",
          minHeight: 240,
          height: "min(52vh, 520px)",
          minWidth: 0,
          background: UNUSUAL_TERM_BG,
          "& .paper-tanstack-container, & .paper-tanstack-scroll, & .paper-tanstack-table": {
            background: `${UNUSUAL_TERM_BG} !important`,
          },
          "& .paper-tanstack-cell": {
            paddingTop: "2px",
            paddingBottom: "2px",
            background: `${UNUSUAL_TERM_BG} !important`,
            borderBottom: "1px solid #1A1A1A !important",
            fontSize: 12,
          },
          "& .paper-tanstack-header-cell": {
            paddingTop: "4px",
            paddingBottom: "4px",
            background: `${UNUSUAL_TERM_BG} !important`,
            borderBottom: "1px solid #2A2A2A !important",
            color: "#8B949E",
            fontSize: 10,
            textTransform: "uppercase",
          },
        }}
      >
        <TanStackTable<UnusualLegRow>
          data={visible}
          columns={columns}
          dataTestId="nifty-unusual-table"
          emptyMessage="No chain data"
          fillContainer
          getRowStyle={(row) =>
            isItmLeg(row.strike, row.leg, spot)
              ? { background: hexToRgba(palette.WARNING, 0.08) }
              : undefined
          }
          getRowTestId={(row) => `nifty-unusual-row-${row.strike}-${row.leg}`}
        />
      </Box>
    </Box>
  );
}
