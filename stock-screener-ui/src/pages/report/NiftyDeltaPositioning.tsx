import { memo } from "react";
import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import { TanStackTable } from "@/components/common/TanStackTable";
import type {
  NiftyPositioningBlock,
  NiftyPositioningStrike,
  NiftyPositioningVerdict,
} from "@/types/niftyReport";

/** Rendered for any absent field so a row never shows a blank/NaN. */
export const POSITIONING_DASH = "—";

/**
 * Colour tone for the header verdict:
 * bullish = up/green, bearish = down/red, balanced/absent = muted.
 */
export function positioningAccent(
  verdict: NiftyPositioningVerdict | null | undefined,
): string {
  if (verdict === "bullish") return palette.POSITIVE;
  if (verdict === "bearish") return palette.NEGATIVE;
  return palette.TEXT_MUTED;
}

/** Uppercase verdict label, or an em dash when absent/unrecognised. */
export function positioningVerdictLabel(
  verdict: NiftyPositioningVerdict | null | undefined,
): string {
  if (verdict === "bullish" || verdict === "bearish" || verdict === "balanced") {
    return verdict.toUpperCase();
  }
  return POSITIONING_DASH;
}

/** Signed crore with Indian grouping, 0 decimals ("+53,185"), dash if absent. */
export function fmtCr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return POSITIONING_DASH;
  }
  // Round first so a value that rounds to zero never shows a stray "-0".
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  const sign = rounded > 0 ? "+" : "-";
  return `${sign}${Math.abs(rounded).toLocaleString("en-IN")}`;
}

/** Unsigned magnitude (Indian grouping, 0 dp) for the split's "N Cr" prefix. */
function fmtCrMagnitude(value: number): string {
  return Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** Small tone helper for signed numbers; zero/absent stays muted. */
export function signedPositioningAccent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return palette.TEXT_MUTED;
  }
  return value > 0 ? palette.POSITIVE : palette.NEGATIVE;
}

/**
 * `53,185 Cr · 83%` — the dominant side's gross initiated magnitude and its
 * share of gross initiated. Falls back to the larger magnitude when only
 * signed magnitudes are known, and to dashes when nothing is known.
 */
export function positioningSplitLabel(
  bullCr: number | null | undefined,
  bearCr: number | null | undefined,
  splitPct: number | null | undefined,
): string {
  const bull = Number.isFinite(bullCr as number) ? (bullCr as number) : null;
  const bear = Number.isFinite(bearCr as number) ? (bearCr as number) : null;
  const pct = Number.isFinite(splitPct as number) ? (splitPct as number) : null;
  if (bull === null && bear === null && pct === null) return POSITIONING_DASH;

  let mag: number | null = null;
  if (pct !== null) mag = pct < 50 ? bear : bull;
  if (mag === null) {
    if (bull !== null && bear !== null) mag = Math.abs(bull) >= Math.abs(bear) ? bull : bear;
    else mag = bull ?? bear;
  }

  const magStr = mag !== null ? `${fmtCrMagnitude(mag)} Cr` : POSITIONING_DASH;
  const pctStr = pct !== null ? `${Math.round(pct)}%` : POSITIONING_DASH;
  return `${magStr} · ${pctStr}`;
}

/** Right/left aligned numeric cell with tabular figures. */
function numCell(value: string, tone: string = "default") {
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
      <Text size="xs" span c={tone}>
        {value}
      </Text>
    </Box>
  );
}

/**
 * One strike row: Strike | Calls (ΔOI, Initiated Δ) | Puts (ΔOI, Initiated Δ) |
 * Net initiated. Strike is left; every numeric column is explicit right.
 */
export function getPositioningColumns(): ColumnDef<NiftyPositioningStrike>[] {
  const legColumns = (
    side: "ce" | "pe",
  ): ColumnDef<NiftyPositioningStrike>[] => [
    {
      id: `${side}Doi`,
      header: "ΔOI",
      accessorFn: (row) => row?.[side]?.doi ?? null,
      size: 64,
      meta: { align: "right" },
      cell: (info) => {
        const v = info.getValue() as number | null;
        return numCell(fmtCr(v), side === "ce" ? palette.TERM_CE : palette.TERM_PE);
      },
    },
    {
      id: `${side}Initiated`,
      header: "Initiated Δ",
      accessorFn: (row) => row?.[side]?.initiated ?? null,
      size: 82,
      meta: { align: "right" },
      cell: (info) => {
        const v = info.getValue() as number | null;
        return numCell(fmtCr(v), side === "ce" ? palette.TERM_CE : palette.TERM_PE);
      },
    },
  ];

  return [
    {
      id: "strike",
      header: "Strike",
      accessorFn: (row) => row?.strike ?? null,
      size: 74,
      meta: { align: "left" },
      cell: (info) => {
        const v = info.getValue() as number | null;
        return numCell(
          Number.isFinite(v as number)
            ? (v as number).toLocaleString("en-IN")
            : POSITIONING_DASH,
        );
      },
    },
    // Group headers sit centred over their two numeric columns; leaf
    // headers/values stay right-aligned (TABLE_CHECKLIST alignment map).
    {
      id: "calls",
      header: "Calls",
      size: 64 + 82,
      meta: { align: "center" },
      columns: legColumns("ce"),
    },
    {
      id: "puts",
      header: "Puts",
      size: 64 + 82,
      meta: { align: "center" },
      columns: legColumns("pe"),
    },
    {
      id: "netInitiated",
      header: "Net initiated",
      accessorFn: (row) => row?.netInitiated ?? null,
      size: 92,
      meta: { align: "right" },
      cell: (info) => {
        const v = info.getValue() as number | null;
        return numCell(fmtCr(v), signedPositioningAccent(v));
      },
    },
  ];
}

/**
 * Module-level column model — the positioning columns are fully static (no
 * closure over render state), so one shared instance replaces the per-render
 * `getPositioningColumns()` call. `getPositioningColumns` stays exported for
 * compatibility; `POSITIONING_COLUMNS` is what the panel renders.
 */
export const POSITIONING_COLUMNS: ColumnDef<NiftyPositioningStrike>[] =
  getPositioningColumns();

/** Stable row test-id getter — hoisted so the table never gets a new fn. */
function getPositioningRowTestId(
  row: NiftyPositioningStrike | null | undefined,
  index: number,
): string {
  return `nifty-positioning-row-${row?.strike ?? "na"}-${index}`;
}

const PositioningStatRow = memo(function PositioningStatRow({
  testId,
  label,
  value,
  tone,
  title,
  trailing,
}: {
  testId: string;
  label: string;
  value: string;
  tone: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <Box
      data-testid={testId}
      title={title}
      sx={{
        // Sized to content, NOT stretched: `space-between` on a full-width row
        // pinned the label far left and the value far right with ~1100px of
        // nothing between them on a wide screen.
        display: "flex",
        alignItems: "baseline",
        justifyContent: "flex-start",
        gap: "6px",
        flex: "0 1 auto",
        px: "6px",
        py: "1px",
        minWidth: 0,
        bgcolor: palette.TERM_BG,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderRadius: "4px",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Text size="xs" c="dimmed" span>
        {label}
      </Text>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Text size="sm" fw={700} c={tone} span>
          {value}
        </Text>
        {trailing}
      </Box>
    </Box>
  );
});
PositioningStatRow.displayName = "PositioningStatRow";

export interface NiftyDeltaPositioningProps {
  positioning?: NiftyPositioningBlock;
}

/**
 * Self-contained panel for the option-chain delta positioning block. Every
 * field on the payload is nullable, so an absent/partial block renders the
 * panel with em dashes and an empty table instead of crashing.
 */
export function NiftyDeltaPositioningInner({ positioning }: NiftyDeltaPositioningProps) {
  const verdict = positioning?.verdict ?? null;
  const accent = positioningAccent(verdict);
  const strikes = Array.isArray(positioning?.strikes) ? positioning.strikes : [];
  const state = positioning?.state ?? null;
  const flow = positioning?.flow ?? null;
  const initiated = positioning?.initiated ?? null;
  const split = positioningSplitLabel(
    positioning?.bullCr,
    positioning?.bearCr,
    positioning?.splitPct,
  );
  const columns = POSITIONING_COLUMNS;
  // Bullish vs bearish share of gross initiated for the split bar. The split
  // pct is the dominant side's share; below 50 the bear side dominates.
  const splitPct = positioning?.splitPct;
  const bullCr = positioning?.bullCr;
  const bearCr = positioning?.bearCr;
  let bullShare: number;
  if (Number.isFinite(splitPct as number)) {
    bullShare = splitPct as number;
  } else if (
    Number.isFinite(bullCr as number) &&
    Number.isFinite(bearCr as number) &&
    Math.abs(bullCr as number) + Math.abs(bearCr as number) > 0
  ) {
    bullShare =
      (Math.abs(bullCr as number) /
        (Math.abs(bullCr as number) + Math.abs(bearCr as number))) *
      100;
  } else {
    bullShare = 50;
  }
  bullShare = Math.min(100, Math.max(0, bullShare));
  const bearShare = 100 - bullShare;

  return (
    <CompactPanel
      flush
      scrollable
      title="Delta positioning"
      testId="nifty-positioning-panel"
    >
      {/* `scrollable` gives the panel a flex column body with `overflow:
          hidden`; without it the 2,000px-tall table painted past the panel
          and stretched the page's scroll area. `height: 100%` (not flex:1)
          because the body is an overflow container, not a flex parent. */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, height: "100%", minHeight: 0 }}>
        <Box
          data-testid="nifty-positioning-verdict"
          title="Direction of net delta positioning — positive = bullish, negative = bearish"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            px: 0.5,
            py: 0.25,
          }}
        >
          <Box
            aria-hidden
            data-testid="nifty-positioning-verdict-dot"
            sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: accent, flexShrink: 0 }}
          />
          <Text size="sm" fw={700} c={accent} span>
            {positioningVerdictLabel(verdict)}
          </Text>
          <Text size="xs" c="dimmed" span>
            delta positioning (Cr)
          </Text>
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "4px", minWidth: 0 }}>
          <PositioningStatRow
            testId="nifty-positioning-state"
            label="State"
            value={fmtCr(state)}
            tone={signedPositioningAccent(state)}
            title="State = Σ OI×|delta|, calls + / puts −"
          />
          <PositioningStatRow
            testId="nifty-positioning-flow"
            label="Flow"
            value={fmtCr(flow)}
            tone={signedPositioningAccent(flow)}
            title="Flow = Σ ΔOI×|delta|, calls + / puts −"
          />
          <PositioningStatRow
            testId="nifty-positioning-initiated"
            label="Initiated"
            value={fmtCr(initiated)}
            tone={signedPositioningAccent(initiated)}
            title="Initiated = ΔOI×|delta| signed by class (+ = bullish)"
          />
          <PositioningStatRow
            testId="nifty-positioning-split"
            label="Split"
            value={split}
            tone={accent}
            title="Split = dominant side's gross initiated ÷ total gross initiated"
            trailing={
              <Box
                data-testid="nifty-positioning-split-bar"
                title={`Bullish ${Math.round(bullShare)}% · Bearish ${Math.round(bearShare)}%`}
                sx={{
                  display: "flex",
                  width: 64,
                  height: 4,
                  borderRadius: 1,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <Box sx={{ flexGrow: bullShare, flexShrink: 1, flexBasis: 0, background: palette.POSITIVE }} />
                <Box sx={{ flexGrow: bearShare, flexShrink: 1, flexBasis: 0, background: palette.NEGATIVE }} />
              </Box>
            }
          />
        </Box>

        {/* Fills the row: the panel stretches to the analytics row height
            (align-items: stretch), so the table takes the remaining space and
            scrolls internally instead of leaving a hole under 4 rows. */}
        <Box sx={{ minWidth: 0, flex: 1, minHeight: 120 }}>
          <TanStackTable<NiftyPositioningStrike>
            data={strikes}
            columns={columns}
            dataTestId="nifty-positioning-table"
            emptyMessage="No strike breakdown"
            rowWindowSize={30}
            fillContainer
            getRowTestId={getPositioningRowTestId}
          />
        </Box>
      </Box>
    </CompactPanel>
  );
}

/** Memoised leaf panel — `positioning` keeps identity between unrelated parent renders. */
export const NiftyDeltaPositioning = memo(NiftyDeltaPositioningInner);
NiftyDeltaPositioning.displayName = "NiftyDeltaPositioning";
