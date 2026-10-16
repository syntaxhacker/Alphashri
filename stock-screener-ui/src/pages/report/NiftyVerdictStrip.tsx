import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import type {
  NiftyControlVerdict,
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
  balanced: "BALANCED",
};

const REGIME_LABELS: Record<NiftyRegimeVerdict, string> = {
  // These are VOL regimes, not direction: "buy premium" = long vol (realised >
  // implied), "sell premium" = short vol. The old "TREND · BUY FAVOURED" label
  // read as a directional uptrend and contradicted the control block.
  range_sell_premium: "SELL PREMIUM",
  trend_buy: "BUY PREMIUM · RV > IV",
  neutral: "NEUTRAL",
};

const STRENGTH_LABELS: Record<NiftyStrengthVerdict, string> = {
  strong: "STRONG",
  neutral: "NEUTRAL",
  weak: "WEAK",
};

/** Call writers capping the upside read bearish; put writers read bullish. */
export function controlAccent(
  verdict: NiftyControlVerdict | null | undefined,
): string {
  if (verdict === "call_writers") return palette.NEGATIVE;
  if (verdict === "put_writers") return palette.POSITIVE;
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
}

/** One compact cell: a small status dot + verdict line + muted detail line. */
function VerdictCell({ testId, accent, primary, secondary, primaryNode }: VerdictCellProps) {
  return (
    <Box
      data-testid={testId}
      title={`${primary} — ${secondary}`}
      sx={{
        flex: "1 1 0",
        minWidth: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 0.25,
        px: 1,
        py: 0.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
        <Box
          aria-hidden
          data-testid={`${testId}-dot`}
          sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: accent, flexShrink: 0 }}
        />
        <Text data-testid={`${testId}-primary`} size="xs" fw={700} c={accent} span truncate>
          {primaryNode ?? primary}
        </Text>
      </Box>
      <Text data-testid={`${testId}-secondary`} size="xs" c="dimmed" span truncate>
        {secondary}
      </Text>
    </Box>
  );
}

export interface NiftyVerdictStripProps {
  report: NiftyReport;
}

/**
 * Session verdict row: control / regime / VIX / strength. Renders directly
 * under the spot+Pcr stat pills. Every block is optional on the payload, so
 * each cell falls back to an em dash instead of crashing or showing NaN.
 */
export function NiftyVerdictStrip({ report }: NiftyVerdictStripProps) {
  const control = report.control;
  const regime = report.regime;
  const vix = report.vix;
  const strength = report.strength;

  const controlPrimary = control?.verdict
    ? CONTROL_LABELS[control.verdict]
    : VERDICT_DASH;
  const controlSecondary = `ΔOI C ${fmtVerdictNum(control?.ce_doi)} P ${fmtVerdictNum(
    control?.pe_doi,
  )} · skew ${fmtVerdictNum(control?.skew, 2)}`;

  const regimePrimary = regime?.verdict
    ? REGIME_LABELS[regime.verdict]
    : VERDICT_DASH;
  const regimeSecondary = `${fmtVerdictNum(
    regime?.range_pts,
  )} vs ~${fmtVerdictNum(regime?.range_baseline_pts)} pts · straddle ${fmtVerdictNum(
    regime?.straddle_pct,
    2,
  )}%${regime?.warmup ? " · warm-up" : ""}`;

  const vixPrimary = `VIX ${fmtVerdictNum(vix?.ltp, 2)} (${fmtVerdictChange(
    vix?.change_pct,
  )}%)`;
  // Same text as vixPrimary, but the two numbers flash on poll updates.
  const vixPrimaryNode = (
    <>
      VIX{" "}
      <AnimatedValue value={vix?.ltp ?? null} format={(v) => fmtVerdictNum(v, 2)} /> (
      <AnimatedValue value={vix?.change_pct ?? null} format={(v) => fmtVerdictChange(v)} />
      %)
    </>
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
      sx={{
        display: "flex",
        flexWrap: "nowrap",
        gap: 1,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        // No `overflow: hidden` here: the parent is a flex column that overflows
        // vertically, and hiding overflow drops this item's implicit
        // `min-height: auto`, letting the row collapse to ~0px. flexShrink: 0
        // keeps its natural content height instead.
        flexShrink: 0,
      }}
    >
      <VerdictCell
        testId="nifty-verdict-control"
        accent={controlAccent(control?.verdict)}
        primary={controlPrimary}
        secondary={controlSecondary}
      />
      <VerdictCell
        testId="nifty-verdict-regime"
        accent={regimeAccent(regime?.verdict)}
        primary={regimePrimary}
        secondary={regimeSecondary}
      />
      <VerdictCell
        testId="nifty-verdict-vix"
        accent={vixAccent(vix?.change_pct)}
        primary={vixPrimary}
        primaryNode={vixPrimaryNode}
        secondary={vixSecondary}
      />
      <VerdictCell
        testId="nifty-verdict-strength"
        accent={strengthAccent(strength?.verdict)}
        primary={strengthPrimary}
        secondary={strengthSecondary}
      />
    </Box>
  );
}
