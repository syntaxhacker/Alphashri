import { createMemo } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyRegimeBlock } from "@/types/niftyReport";

type CoilState = "COIL" | "NORMAL" | "EXPANDING";

export const COIL_MAX_PCT = 70;
export const EXPANDING_MIN_PCT = 125;

const COIL_COPY: Record<CoilState, string> = {
  COIL: "breakout risk",
  NORMAL: "baseline range",
  EXPANDING: "trend underway",
};

/** The verdict row allots one equal-width cell to four signals. The full state
 *  word ("EXPANDING") plus the RV/IV pair cannot share that cell at 11px, so
 *  the compact cell uses short words and keeps the full state in its tooltip. */
const COMPACT_STATE_LABEL: Record<CoilState, string> = {
  COIL: "COIL",
  NORMAL: "NORM",
  EXPANDING: "EXPAND",
};

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

function coilRangePct(
  regime: NiftyRegimeBlock | null | undefined,
): number | null {
  const ratio = coilRatio(regime);
  return ratio == null ? null : ratio * 100;
}

export function coilState(
  rangePct: number | null | undefined,
): CoilState | null {
  if (rangePct == null || !Number.isFinite(rangePct)) return null;
  if (rangePct <= COIL_MAX_PCT) return "COIL";
  if (rangePct >= EXPANDING_MIN_PCT) return "EXPANDING";
  return "NORMAL";
}

export function coilStateFromRegime(
  regime: NiftyRegimeBlock | null | undefined,
): CoilState | null {
  return coilState(coilRangePct(regime));
}

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
  const state = createMemo(() => {
    const r = ratio();
    return coilState(r == null ? null : r * 100);
  });
  const accent = createMemo(() => {
    const s = state();
    return s ? COIL_ACCENT[s] : palette.TEXT_MUTED;
  });
  const ratioText = createMemo(() => formatCoilRatio(ratio()));
  const hint = createMemo(() => {
    const s = state();
    return s ? `${s.toLowerCase()}: range ${ratioText()} baseline · ${COIL_COPY[s]}` : "no range baseline";
  });
  const rvIv = createMemo(() => `RV ${fmtVol(props.regime?.rv)} / IV ${fmtVol(props.regime?.iv)}`);

  if (props.compact) {
    return (
      <div
        data-testid="nifty-coil-gauge"
        title={`${state() ?? "—"} — ${hint()} · ${rvIv()}`}
        class="flex items-center gap-1 min-w-0 overflow-hidden px-1 py-[2px]"
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
          style={{
            "font-size": "12px",
            "line-height": 1.2,
            "white-space": "nowrap",
            "flex-shrink": 0,
          }}
        >
          {state() ? COMPACT_STATE_LABEL[state()!] : "—"}
        </Text>
        <Text
          data-testid="nifty-coil-ratio"
          size="xs"
          fw={700}
          c="dimmed"
          span
          style={{
            "font-size": "12px",
            "line-height": 1.2,
            "font-variant-numeric": "tabular-nums",
            "white-space": "nowrap",
            "flex-shrink": 0,
          }}
        >
          {ratioText()}
        </Text>
        <Text
          data-testid="nifty-coil-rv-iv"
          size="xs"
          c="dimmed"
          span
          style={{
            "font-size": "12px",
            "line-height": 1.2,
            "font-variant-numeric": "tabular-nums",
            "white-space": "nowrap",
            "flex-shrink": 0,
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
      <div class="flex items-center gap-1 min-w-0">
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
          style={{
            "font-size": "12px",
            "line-height": 1.3,
            "white-space": "nowrap",
            "flex-shrink": 0,
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
            "font-size": "12px",
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
        style={{
          "font-size": "12px",
          "line-height": 1.3,
          "white-space": "normal",
          "overflow-wrap": "anywhere",
        }}
      >
        {hint()}
      </Text>
      <Text
        data-testid="nifty-coil-rv-iv"
        size="xs"
        c="dimmed"
        span
        style={{
          "font-size": "12px",
          "line-height": 1.3,
          "font-variant-numeric": "tabular-nums",
          "white-space": "nowrap",
          "flex-shrink": 0,
        }}
      >
        {rvIv()}
      </Text>
    </div>
  );
}
