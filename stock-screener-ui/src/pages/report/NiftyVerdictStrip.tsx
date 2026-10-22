import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { NiftyCoilGauge } from "./NiftyCoilGauge";
import type {
  NiftyControlVerdict,
  NiftyRegimeBlock,
  NiftyRegimeVerdict,
  NiftyReport,
  NiftyStrengthVerdict,
} from "@/types/niftyReport";

/** Rendered for any absent/null field so the strip never shows a blank/NaN. */
export const VERDICT_DASH = "—";

/** Locale number (Indian grouping) to fixed decimals, or dash when absent. */
export function fmtVerdictNum(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return VERDICT_DASH;
  }
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Signed change (always shows +/-) to 2 decimals, or dash when absent. */
export function fmtVerdictChange(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return VERDICT_DASH;
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

const CONTROL_LABELS: Record<NiftyControlVerdict, string> = {
  call_writers: "CALL WRITERS IN CONTROL",
  put_writers: "PUT WRITERS IN CONTROL",
  call_buyers: "CALL BUYERS IN CONTROL",
  put_buyers: "PUT BUYERS IN CONTROL",
  // Flow unavailable (old snapshot): OI build is real but WHO built it is not
  // knowable, so the label stays neutral instead of asserting writers.
  net_call_build: "CALL OI BUILDING",
  net_put_build: "PUT OI BUILDING",
  balanced: "BALANCED",
};

/** Label for a control verdict; unknown/new values render a dash, never blank. */
export function controlLabel(
  verdict: NiftyControlVerdict | null | undefined,
): string {
  if (!verdict) return VERDICT_DASH;
  return (CONTROL_LABELS as Record<string, string>)[verdict] ?? VERDICT_DASH;
}

export const REGIME_LABELS: Record<NiftyRegimeVerdict, string> = {
  // These are VOL regimes, not direction: "buy premium" = long vol (realised >
  // implied), "sell premium" = short vol. The old "TREND · BUY FAVOURED" label
  // read as a directional uptrend and contradicted the control block.
  range_sell_premium: "SELL PREMIUM",
  trend_buy: "BUY PREMIUM · RV > IV",
  // Range expansion without vol confirmation: direction-agnostic.
  trend: "TREND",
  neutral: "NEUTRAL",
};

/**
 * Trend label conditioned on the live RV/IV vote. A static "RV > IV" suffix
 * lies whenever realised prints below implied (premium-rich tape), so:
 * `rv > iv` keeps the buy-premium read, `iv > rv` reuses the existing
 * sell-premium vocabulary, and a tied/absent vote falls back to "TREND".
 * Non-trend verdicts use REGIME_LABELS unchanged.
 */
export function resolveRegimeLabel(
  verdict: NiftyRegimeVerdict | null | undefined,
  regime?: NiftyRegimeBlock | null,
): string {
  if (verdict === "trend_buy") {
    const rv = regime?.rv;
    const iv = regime?.iv;
    if (
      typeof rv === "number" &&
      typeof iv === "number" &&
      Number.isFinite(rv) &&
      Number.isFinite(iv)
    ) {
      if (rv > iv) return "BUY PREMIUM · RV > IV";
      if (iv > rv) return "SELL PREMIUM · IV > RV";
    }
    return "TREND";
  }
  if (verdict == null) return VERDICT_DASH;
  return REGIME_LABELS[verdict] ?? VERDICT_DASH;
}

/**
 * One definition of the regime detail line, shared by the verdict strip and
 * the decision strip so the same numbers never read two different ways.
 *
 * Includes the vol vote (`RV x / IV y`) and the straddle's move from the open
 * (`Δ ±n pts`) — the percent alone did not say whether the dollar/point
 * premium had expanded or bled.
 */
export function regimeDetail(regime: NiftyRegimeBlock | null | undefined): string {
  const parts = [
    `${fmtVerdictNum(regime?.range_pts)} vs ~${fmtVerdictNum(
      regime?.range_baseline_pts,
    )} pts`,
  ];
  const rv = regime?.rv;
  const iv = regime?.iv;
  if (
    typeof rv === "number" &&
    Number.isFinite(rv) &&
    typeof iv === "number" &&
    Number.isFinite(iv)
  ) {
    parts.push(`RV ${fmtVerdictNum(rv, 2)} / IV ${fmtVerdictNum(iv, 2)}`);
  }
  const open = regime?.straddle_open;
  const now = regime?.straddle_now;
  const delta =
    typeof open === "number" &&
    Number.isFinite(open) &&
    typeof now === "number" &&
    Number.isFinite(now)
      ? now - open
      : null;
  parts.push(
    `straddle ${fmtVerdictNum(regime?.straddle_pct, 2)}%${
      delta === null ? "" : ` (Δ ${fmtVerdictChange(delta)} pts)`
    }`,
  );
  return `${parts.join(" · ")}${regime?.warmup ? " · warm-up" : ""}`;
}

const STRENGTH_LABELS: Record<NiftyStrengthVerdict, string> = {
  strong: "STRONG",
  neutral: "NEUTRAL",
  weak: "WEAK",
};

/**
 * Bearish reads: call writing caps upside; put BUYING is downside demand.
 * Bullish reads: put writing is support; call BUYING is upside demand.
 * Neutral builds / balanced / absent stay muted.
 */
export function controlAccent(
  verdict: NiftyControlVerdict | null | undefined,
): string {
  if (verdict === "call_writers") return palette.NEGATIVE;
  if (verdict === "put_writers") return palette.POSITIVE;
  if (verdict === "call_buyers") return palette.POSITIVE;
  if (verdict === "put_buyers") return palette.NEGATIVE;
  return palette.TEXT_MUTED;
}

/** Range = premium-selling tape (warning); trend = buy-favoured (positive). */
export function regimeAccent(
  verdict: NiftyRegimeVerdict | null | undefined,
): string {
  if (verdict === "trend_buy") return palette.POSITIVE;
  if (verdict === "range_sell_premium") return palette.WARNING;
  return palette.TEXT_MUTED;
}

/** VIX rising reads as risk (warning); falling reads as calm (positive). */
export function vixAccent(changePct: number | null | undefined): string {
  if (changePct === null || changePct === undefined || !Number.isFinite(changePct) || changePct === 0) {
    return palette.TEXT_MUTED;
  }
  return changePct > 0 ? palette.WARNING : palette.POSITIVE;
}

export function strengthAccent(
  verdict: NiftyStrengthVerdict | null | undefined,
): string {
  if (verdict === "strong") return palette.POSITIVE;
  if (verdict === "weak") return palette.NEGATIVE;
  return palette.TEXT_MUTED;
}

interface VerdictCellProps {
  testId: string;
  accent: string;
  primary: string;
  secondary: string;
  /** Rich primary line (e.g. with AnimatedValue flashes); falls back to `primary`. */
  primaryNode?: ReactNode;
  /**
   * Single-line dense layout for the decision-strip context row: primary +
   * secondary inline at 24px row height instead of the two-line stack.
   */
  compact?: boolean;
}

/** One compact cell: a small status dot + verdict line + muted detail line. */
const VerdictCell = memo(function VerdictCell({ testId, accent, primary, secondary, primaryNode, compact }: VerdictCellProps) {
  if (compact) {
    return (
      <Box
        data-testid={testId}
        title={`${primary} — ${secondary}`}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          minWidth: 0,
          overflow: "hidden",
          px: 1,
          py: "2px",
        }}
      >
        <Box
          aria-hidden
          data-testid={`${testId}-dot`}
          sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: accent, flexShrink: 0 }}
        />
        <Text
          data-testid={`${testId}-primary`}
          size="xs"
          fw={700}
          c={accent}
          span
          truncate
          style={{ fontSize: 11, lineHeight: 1.2, letterSpacing: "0.04em", minWidth: 0 }}
        >
          {primaryNode ?? primary}
        </Text>
        <Text
          data-testid={`${testId}-secondary`}
          size="xs"
          c="dimmed"
          span
          truncate
          style={{ fontSize: 9, lineHeight: 1.2, minWidth: 0 }}
        >
          {secondary}
        </Text>
      </Box>
    );
  }
  return (
    <Box
      data-testid={testId}
      title={`${primary} — ${secondary}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "2px",
        minWidth: 0,
        overflow: "hidden",
        px: 1.5,
        py: 0.75,
        borderLeft: `1px solid ${palette.TERM_BORDER}`,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
        <Box
          aria-hidden
          data-testid={`${testId}-dot`}
          sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: accent, flexShrink: 0 }}
        />
        <Text
          data-testid={`${testId}-primary`}
          size="xs"
          fw={700}
          c={accent}
          span
          truncate
          style={{ fontSize: 11, lineHeight: 1.3, letterSpacing: "0.04em" }}
        >
          {primaryNode ?? primary}
        </Text>
      </Box>
      <Text
        data-testid={`${testId}-secondary`}
        size="xs"
        c="dimmed"
        span
        truncate
        style={{ fontSize: 10, lineHeight: 1.3 }}
      >
        {secondary}
      </Text>
    </Box>
  );
});
VerdictCell.displayName = "VerdictCell";

export interface NiftyVerdictStripProps {
  report: NiftyReport;
  /**
   * `full` (default) renders control / regime / VIX / strength. `context`
   * drops the regime cell because the decision strip already carries it as a
   * headline number — one meaning per word, no duplicate on screen.
   */
  mode?: "full" | "context";
}

/**
 * Session verdict row: control / regime / VIX / strength. Renders directly
 * under the spot+Pcr stat pills. Every block is optional on the payload, so
 * each cell falls back to an em dash instead of crashing or showing NaN.
 */
function NiftyVerdictStripInner({ report, mode = "full" }: NiftyVerdictStripProps) {
  const control = report.control;
  const regime = report.regime;
  const vix = report.vix;
  const strength = report.strength;

  const controlPrimary = controlLabel(control?.verdict);
  const controlSecondary = `ΔOI C ${fmtVerdictNum(control?.ce_doi)} P ${fmtVerdictNum(
    control?.pe_doi,
  )} · skew ${fmtVerdictNum(control?.skew, 2)}`;

  const regimePrimary = regime?.verdict
    ? resolveRegimeLabel(regime.verdict, regime)
    : VERDICT_DASH;
  const regimeSecondary = regimeDetail(regime);

  const vixPrimary = `VIX ${fmtVerdictNum(vix?.ltp, 2)} (${fmtVerdictChange(
    vix?.change_pct,
  )}%)`;
  // Same text as vixPrimary, but the two numbers flash on poll updates.
  // Memoised so the VIX cell keeps stable props when unrelated blocks change.
  const vixPrimaryNode = useMemo(
    () => (
      <>
        VIX{" "}
        <AnimatedValue value={vix?.ltp ?? null} format={(v) => fmtVerdictNum(v, 2)} /> (
        <AnimatedValue value={vix?.change_pct ?? null} format={(v) => fmtVerdictChange(v)} />
        %)
      </>
    ),
    [vix?.ltp, vix?.change_pct],
  );
  const vixSecondary = `day ${fmtVerdictNum(vix?.day_low, 2)}–${fmtVerdictNum(
    vix?.day_high,
    2,
  )}`;

  const strengthPrimary = strength?.verdict
    ? STRENGTH_LABELS[strength.verdict]
    : VERDICT_DASH;
  const strengthSecondary = `score ${fmtVerdictNum(
    strength?.score,
    1,
  )} · RSI ${fmtVerdictNum(strength?.rsi, 1)}`;

  return (
    <Box
      data-testid="nifty-verdict-strip"
      sx={
        mode === "context"
          ? {
              display: "flex",
              flexWrap: "nowrap",
              alignItems: "center",
              width: "100%",
              minWidth: 0,
              minHeight: 24,
              overflow: "hidden",
              borderTop: `1px solid ${palette.TERM_BORDER}`,
              "& > *": {
                borderLeft: `1px solid ${palette.TERM_BORDER}`,
                flex: "1 1 0",
                minWidth: 0,
              },
              "& > *:first-of-type": { borderLeft: "none" },
            }
          : { display: "contents" }
      }
    >
      <VerdictCell
        testId="nifty-verdict-control"
        accent={controlAccent(control?.verdict)}
        primary={controlPrimary}
        secondary={controlSecondary}
        compact
      />
      {mode === "full" && (
        <VerdictCell
          testId="nifty-verdict-regime"
          accent={regimeAccent(regime?.verdict)}
          primary={regimePrimary}
          secondary={regimeSecondary}
        />
      )}
      <NiftyCoilGauge regime={regime} compact />
      <VerdictCell
        testId="nifty-verdict-vix"
        accent={vixAccent(vix?.change_pct)}
        primary={vixPrimary}
        primaryNode={vixPrimaryNode}
        secondary={vixSecondary}
        compact
      />
      <VerdictCell
        testId="nifty-verdict-strength"
        accent={strengthAccent(strength?.verdict)}
        primary={strengthPrimary}
        secondary={strengthSecondary}
        compact
      />
    </Box>
  );
}

/** Memoised leaf strip — `report` keeps identity between unrelated parent renders. */
export const NiftyVerdictStrip = memo(NiftyVerdictStripInner);
NiftyVerdictStrip.displayName = "NiftyVerdictStrip";
