import { createMemo } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyRegimeBlock } from "@/types/niftyReport";

/** Range-compression state derived from realised range vs its baseline. */
type CoilState = "COIL" | "NORMAL" | "EXPANDING";

/** Thresholds on range as a percentage of the baseline (see `coilRangePct`). */
export const COIL_MAX_PCT = 70;
export const EXPANDING_MIN_PCT = 125;

/** One-line read for each state. */
const COIL_COPY: Record<CoilState, string> = {
  COIL: "breakout risk",
  NORMAL: "baseline range",
  EXPANDING: "trend underway",
};

/** Status-dot / text accent per state. */
const COIL_ACCENT: Record<CoilState, string> = {
  COIL: palette.WARNING,
  NORMAL: palette.TEXT_MUTED,
  EXPANDING: palette.POSITIVE,
};

/**
 * Range as a fraction of its baseline. Prefers the raw point values (the
 * backend's `range_pct` is exactly `range_pts / range_baseline_pts * 100`),
 * then falls back to `range_pct` when the point fields are absent.
 */
export function coilRatio(regime: NiftyRegimeBlock | null | undefined): number | null {
  const pts = regime?.range_pts;
  const baseline = regime?.range_baseline_pts;
  if (
    pts != null &&
    baseline != null &&
    Number.isFinite(pts) &&
    Number.isFinite(baseline) &&
    baseline > 0
  ) {
    return pts / baseline;
  }
  const pct = regime?.range_pct;
  if (pct != null && Number.isFinite(pct)) return pct / 100;
  return null;
}

/** Range as a percentage of baseline, the unit the thresholds use. */
function coilRangePct(
  regime: NiftyRegimeBlock | null | undefined,
): number | null {
  const ratio = coilRatio(regime);
  return ratio == null ? null : ratio * 100;
}

/** COIL <= 70% < NORMAL < 125% <= EXPANDING; null when the range is unknown. */
export function coilState(
  rangePct: number | null | undefined,
): CoilState | null {
  if (rangePct == null || !Number.isFinite(rangePct)) return null;
  if (rangePct <= COIL_MAX_PCT) return "COIL";
  if (rangePct >= EXPANDING_MIN_PCT) return "EXPANDING";
  return "NORMAL";
}

/** Convenience: state straight from the report's regime block. */
export function coilStateFromRegime(
  regime: NiftyRegimeBlock | null | undefined,
): CoilState | null {
  return coilState(coilRangePct(regime));
}

/** `0.9x` — one decimal is enough to read compression vs expansion. */
function formatCoilRatio(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${ratio.toLocaleString("en-IN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}x`;
}

function fmtVol(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

interface NiftyCoilGaugeProps {
  regime: NiftyRegimeBlock | null | undefined;
  /**
   * Single-line dense layout for the decision-strip context row: state +
   * ratio + RV/IV inline at 24px row height. The range hint stays in the
   * `title` tooltip — the same numbers already sit in the regime headline
   * above, so they are not repeated as visible text.
   */
  compact?: boolean;
}

/**
 * Dense coil / squeeze cell for the session verdict row. Reads range
 * compression (COIL / NORMAL / EXPANDING) from range vs baseline and keeps
 * RV/IV underneath as the vol context. Everything is optional on the payload,
 * so a missing block renders dashes instead of NaN.
 */
export function NiftyCoilGauge(props: NiftyCoilGaugeProps) {
  const ratio = createMemo(() => coilRatio(props.regime));
  const state = createMemo(() => coilState(ratio() == null ? null : ratio() * 100));
  const accent = createMemo(() => (state() ? COIL_ACCENT[state()] : palette.TEXT_MUTED));
  const ratioText = createMemo(() => formatCoilRatio(ratio()));
  const hint = createMemo(() =>
    state()
      ? `${state().toLowerCase()}: range ${ratioText()} baseline · ${COIL_COPY[state()]}`
      : "no range baseline",
  );
  const rvIv = createMemo(() => `RV ${fmtVol(props.regime?.rv)} / IV ${fmtVol(props.regime?.iv)}`);

  if (props.compact) {
    return (
      <div
        data-testid="nifty-coil-gauge"
        title={`${state() ?? "—"} — ${hint()} · ${rvIv()}`}
        class="flex items-center gap-[6px] min-w-0 overflow-hidden px-2 py-[2px]"
      >
        <div
          aria-hidden="true"
          class="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ "background-color": accent() }}
        />
        <Text
          data-testid="nifty-coil-state"
          size="xs"
          fw={700}
          c={accent()}
          span
          truncate
          style={{
            "font-size": "11px",
            "line-height": 1.2,
            "letter-spacing": "0.04em",
            "min-width": 0,
          }}
        >
          {state() ?? "—"}
        </Text>
        <Text
          data-testid="nifty-coil-ratio"
          size="xs"
          fw={700}
          c="dimmed"
          span
          style={{
            "font-size": "11px",
            "line-height": 1.2,
            "font-variant-numeric": "tabular-nums",
            "white-space": "nowrap",
          }}
        >
          {ratioText()}
        </Text>
        <Text
          data-testid="nifty-coil-rv-iv"
          size="xs"
          c="dimmed"
          span
          truncate
          style={{
            "font-size": "9px",
            "line-height": 1.2,
            "font-variant-numeric": "tabular-nums",
            "min-width": 0,
          }}
        >
          {rvIv()}
        </Text>
      </div>
    );
  }

  return (
    <div
      data-testid="nifty-coil-gauge"
      title={`${state() ?? "—"} — ${hint()} · ${rvIv()}`}
      class="flex flex-col justify-center min-w-0 overflow-hidden px-[12px] py-[6px]"
      style={{ "border-left": `1px solid ${palette.TERM_BORDER}` }}
    >
      <div class="flex items-center gap-[6px] min-w-0">
        <div
          aria-hidden="true"
          class="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ "background-color": accent() }}
        />
        <Text
          data-testid="nifty-coil-state"
          size="xs"
          fw={700}
          c={accent()}
          span
          truncate
          style={{
            "font-size": "11px",
            "line-height": 1.3,
            "letter-spacing": "0.04em",
          }}
        >
          {state() ?? "—"}
        </Text>
        <Text
          data-testid="nifty-coil-ratio"
          size="xs"
          fw={700}
          c="dimmed"
          span
          style={{
            "font-size": "10px",
            "line-height": 1.3,
            "font-variant-numeric": "tabular-nums",
            "white-space": "nowrap",
          }}
        >
          {ratioText()}
        </Text>
      </div>
      <Text
        data-testid="nifty-coil-hint"
        size="xs"
        c="dimmed"
        span
        truncate
        style={{ "font-size": "10px", "line-height": 1.3 }}
      >
        {hint()}
      </Text>
      <Text
        data-testid="nifty-coil-rv-iv"
        size="xs"
        c="dimmed"
        span
        truncate
        style={{
          "font-size": "10px",
          "line-height": 1.3,
          "font-variant-numeric": "tabular-nums",
        }}
      >
        {rvIv()}
      </Text>
    </div>
  );
}
