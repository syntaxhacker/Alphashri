import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import { buildDeltaProfile, DeltaProfileChart } from "./DeltaProfileChart";
import type {
  NiftyPositioningBlock,
  NiftyPositioningVerdict,
} from "@/types/niftyReport";
import { REPORT_DASH, formatReportNum, formatReportPoints } from "./reportFormat";

/** Rendered for any absent field so a row never shows a blank/NaN. */
export const POSITIONING_DASH = REPORT_DASH;

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
  return formatReportNum(value, { sign: "nonzero", round: true });
}

/** Unsigned magnitude (Indian grouping, 0 dp) for the split's "N Cr" prefix. */
function fmtCrMagnitude(value: number): string {
  return formatReportNum(Math.abs(value), { digits: 0 });
}

/** Integer strike with Indian grouping (`25,750`), or an em dash when absent. */
export function fmtFlipStrike(value: number | null | undefined): string {
  return formatReportNum(value);
}

/**
 * `-50 pts` / `+50 pts` / `at spot` — how far a level sits from spot. Used as
 * the delta-flip stat's trailing hint; absent inputs render a dash.
 */
export function flipDistanceLabel(
  spot: number | null | undefined,
  level: number | null | undefined,
): string {
  if (
    !Number.isFinite(spot as number) ||
    !Number.isFinite(level as number)
  ) {
    return POSITIONING_DASH;
  }
  const d = Math.round((level as number) - (spot as number));
  if (d === 0) return "at spot";
  return formatReportPoints(d);
}

/** Small tone helper for signed numbers; zero/absent stays muted. */
export function signedPositioningAccent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return palette.TEXT_MUTED;
  }
  return value > 0 ? palette.POSITIVE : palette.NEGATIVE;
}

/**
 * The gross-initiated split between the two sides.
 *
 * `bullCr` / `bearCr` are GROSS magnitudes (the backend accumulates the
 * absolute value of every bullish / bearish initiated leg), so the two add up
 * to the day's gross initiated flow and the share of each side is
 * `side / (bull + bear)`.
 *
 * The payload's `splitPct` is the **dominant side's** share (always ≥ 50) —
 * it does NOT say which side dominates. Reading it as the bull share made a
 * bear-led tape (bull 2,922 Cr / bear 62,631 Cr at 14:59) print "2,922 Cr ·
 * 96% bullish" and paint the split bar 96% green.
 */
interface PositioningSplit {
  /** Bull side's share of gross initiated (0–100, integer). */
  bullShare: number;
  /** Bear side's share — the exact complement of `bullShare` (0–100). */
  bearShare: number;
  /** Which side dominates; `none` on an exact 50/50 split. */
  dominant: "bull" | "bear" | "none";
  /** The dominant side's gross initiated magnitude (₹ crore). */
  magnitude: number | null;
  /** The dominant side's share (0–100), `null` when it cannot be known. */
  share: number | null;
}

/**
 * Resolve the split into its two shares, the dominant side, that side's
 * magnitude and its share.
 *
 * The two shares are exact complements (`bear = 100 − bull`) so rounding can
 * never produce 101% (rounding both halves independently did: 51 + 50).
 */
export function positioningSplit(
  bullCr: number | null | undefined,
  bearCr: number | null | undefined,
  splitPct?: number | null,
): PositioningSplit {
  const bull = Number.isFinite(bullCr as number) ? Math.abs(bullCr as number) : null;
  const bear = Number.isFinite(bearCr as number) ? Math.abs(bearCr as number) : null;
  const pct = Number.isFinite(splitPct as number) ? (splitPct as number) : null;

  // Only one side known: the magnitude is real, the share is not.
  if (bull === null || bear === null) {
    const only = bull ?? bear;
    return {
      bullShare: bull === null ? 0 : 100,
      bearShare: bull === null ? 100 : 0,
      dominant: "none",
      magnitude: only,
      share: null,
    };
  }

  const total = bull + bear;
  if (total <= 0) {
    return {
      bullShare: 50,
      bearShare: 50,
      dominant: "none",
      magnitude: null,
      share: null,
    };
  }

  const bullShare = Math.round((bull / total) * 100);
  const bearShare = 100 - bullShare;
  const dominant: PositioningSplit["dominant"] =
    bullShare > 50 ? "bull" : bearShare > 50 ? "bear" : "none";
  const magnitude = dominant === "bull" ? bull : dominant === "bear" ? bear : null;
  // The payload's own split_pct is the dominant side's share (1 dp) — prefer it
  // when it is consistent with the derived split, else use the derived one.
  const derived = Math.max(bullShare, bearShare);
  const share =
    pct !== null && Math.abs(pct - derived) <= 1 ? pct : derived;
  return { bullShare, bearShare, dominant, magnitude, share };
}

/**
 * `62,631 Cr · bearish 96%` — the dominant side's gross initiated magnitude
 * and its share of gross initiated. The side word is part of the label: the
 * share alone never said WHICH side dominated.
 */
export function positioningSplitLabel(
  bullCr: number | null | undefined,
  bearCr: number | null | undefined,
  splitPct: number | null | undefined,
): string {
  const split = positioningSplit(bullCr, bearCr, splitPct);
  if (split.magnitude === null && split.share === null) return POSITIONING_DASH;

  const magStr =
    split.magnitude !== null ? `${fmtCrMagnitude(split.magnitude)} Cr` : POSITIONING_DASH;
  const pctStr = split.share !== null ? `${split.share}%` : POSITIONING_DASH;
  const side =
    split.dominant === "bull"
      ? "bullish"
      : split.dominant === "bear"
        ? "bearish"
        : "balanced";
  return `${magStr} · ${side} ${pctStr}`;
}

/** Profile half-width around spot — same ±750 band as the OI chain panel. */
export const POSITIONING_WINDOW_PTS = 750;

/** Nearest 50-point NIFTY strike, or null when the spot is absent. */
export function nearestPositioningStrike(
  spot: number | null | undefined,
): number | null {
  if (!Number.isFinite(spot as number) || (spot as number) <= 0) return null;
  return Math.round((spot as number) / 50) * 50;
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

interface NiftyDeltaPositioningProps {
  positioning?: NiftyPositioningBlock;
  /** Current Nifty spot: windows the profile and marks the ATM strike. */
  spot?: number | null;
}

/**
 * Self-contained panel for the option-chain delta positioning block. Every
 * field on the payload is nullable, so an absent/partial block renders the
 * panel with em dashes and an empty chart instead of crashing.
 */
function NiftyDeltaPositioningInner({
  positioning,
  spot = null,
}: NiftyDeltaPositioningProps) {
  const verdict = positioning?.verdict ?? null;
  const accent = positioningAccent(verdict);
  const strikes = Array.isArray(positioning?.strikes) ? positioning.strikes : [];
  const profile = useMemo(
    () => buildDeltaProfile(strikes, spot, POSITIONING_WINDOW_PTS),
    [strikes, spot],
  );
  const atmStrike = nearestPositioningStrike(spot);
  const state = positioning?.state ?? null;
  const flow = positioning?.flow ?? null;
  const initiated = positioning?.initiated ?? null;
  const deltaFlip = positioning?.deltaFlip ?? null;
  const flipDistance = flipDistanceLabel(spot, deltaFlip);
  const splitInfo = useMemo(
    () =>
      positioningSplit(
        positioning?.bullCr,
        positioning?.bearCr,
        positioning?.splitPct,
      ),
    [positioning?.bullCr, positioning?.bearCr, positioning?.splitPct],
  );
  const split = positioningSplitLabel(
    positioning?.bullCr,
    positioning?.bearCr,
    positioning?.splitPct,
  );
  // The split bar is a share of GROSS initiated, not the direction of the
  // book: green = the bullish side's share, red = the bearish side's.
  const splitTone =
    splitInfo.dominant === "bull"
      ? palette.POSITIVE
      : splitInfo.dominant === "bear"
        ? palette.NEGATIVE
        : palette.TEXT_MUTED;
  const bullShare = splitInfo.bullShare;
  const bearShare = splitInfo.bearShare;

  return (
    <CompactPanel
      flush
      scrollable
      title="Delta positioning"
      testId="nifty-positioning-panel"
    >
      {/* `scrollable` gives the panel a flex column body with `overflow:
          hidden`; without it a tall body painted past the panel
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
            tone={splitTone}
            title={`Split = dominant side's gross initiated ÷ total gross initiated (bull ${
              positioning?.bullCr !== undefined && positioning?.bullCr !== null
                ? fmtCrMagnitude(positioning.bullCr)
                : "—"
            } Cr · bear ${
              positioning?.bearCr !== undefined && positioning?.bearCr !== null
                ? fmtCrMagnitude(positioning.bearCr)
                : "—"
            } Cr)`}
            trailing={
              <Box
                data-testid="nifty-positioning-split-bar"
                title={`Bullish ${bullShare}% · Bearish ${bearShare}%`}
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
          <PositioningStatRow
            testId="nifty-positioning-flip"
            label="Δ pivot"
            value={fmtFlipStrike(deltaFlip)}
            tone={deltaFlip === null ? palette.TEXT_MUTED : palette.TERM_FLIP}
            title="Delta pivot = strike where cumulative OI×delta exposure crosses zero (calls + / puts −). Below it the book is put-heavy (short delta); above it the call book dominates (long delta). Not the same thing as the GEX gamma flip."
            trailing={
              <Text size="xs" c="dimmed" span>
                {flipDistance}
              </Text>
            }
          />
        </Box>

        <Text
          data-testid="nifty-positioning-window"
          size="xs"
          span
          c="dimmed"
          title="The curve is cumulative OI×delta across the chain (what defines the Δ pivot); the columns are today's initiated delta per strike. Both are restricted to the ±750 point band around spot."
          sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {`Profile ±${POSITIONING_WINDOW_PTS} pts${atmStrike !== null ? ` · ATM ${atmStrike.toLocaleString("en-IN")}` : ""} · curve > 0 = long δ · bars = initiated δ`}
        </Text>

        {/* Fills the row: the panel stretches to the analytics row height
            (align-items: stretch), so the chart takes the remaining space. */}
        <Box sx={{ minWidth: 0, flex: 1, minHeight: 120, display: "flex" }}>
          <DeltaProfileChart
            points={profile}
            spot={spot}
            flip={deltaFlip}
            formatValue={fmtCr}
          />
        </Box>
      </Box>
    </CompactPanel>
  );
}

/** Memoised leaf panel — `positioning` keeps identity between unrelated parent renders. */
export const NiftyDeltaPositioning = memo(NiftyDeltaPositioningInner);
NiftyDeltaPositioning.displayName = "NiftyDeltaPositioning";
