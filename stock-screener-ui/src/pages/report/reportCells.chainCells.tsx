import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { hexToRgba } from "@/utils/color";
import { formatLegChange } from "./optionChainMetrics";
import {
  sentimentCode,
  sentimentLabel,
  sentimentNote,
  sentimentSign,
} from "./optionSentiment";
import { wallCode, wallSide } from "./niftyChartMath";
import type { NiftyStrike } from "@/types/niftyReport";
import { REPORT_FONT, REPORT_FONT_WEIGHT } from "./reportTokens";
import { OI_CHAIN_METRICS } from "./reportCells.chainMetrics";

export function sentimentBadge(
  sentiment: string,
  side: "ce" | "pe",
  emphasis = false,
): JSX.Element {
  const raw = String(sentiment ?? "").trim();
  const code = sentimentCode(raw);
  const label = sentimentLabel(raw);
  const sign = sentimentSign(raw, side);
  // Free-text payloads ("Bullish"/"Bearish") are outside the LB/SB/SC/LU
  // registry. Rendering them verbatim in a 72px chain cell cut "Bearish" to
  // "Beari…"; a direction word keeps the badge whole, with the reported text
  // preserved in the tooltip and the accessible name.
  const direction = code ? sign : /bull/i.test(raw) ? 1 : /bear/i.test(raw) ? -1 : 0;
  const short = code || (direction > 0 ? "BULL" : direction < 0 ? "BEAR" : "—");
  const upperSide: "CE" | "PE" = side === "ce" ? "CE" : "PE";
  const title = code
    ? `${label} (${upperSide}) — ${sentimentNote(code, upperSide)}`
    : label
      ? `${label} (${upperSide}) — reported sentiment`
      : `No sentiment reported (${upperSide})`;
  const tone =
    direction === 0 ? palette.TEXT_MUTED : direction > 0 ? palette.POSITIVE : palette.NEGATIVE;
  return (
    <span
      data-testid={`nifty-oi-signal-${side}`}
      role="img"
      aria-label={title}
      title={title}
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        gap: "3px",
        "max-width": "100%",
        overflow: "hidden",
        "padding-left": "3px",
        "padding-right": "3px",
        "padding-top": "1px",
        "padding-bottom": "1px",
        "border-radius": "3px",
        "white-space": "nowrap",
        "vertical-align": "middle",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "3px",
          height: "11px",
          "border-radius": "1px",
          "background-color": tone,
          "flex-shrink": 0,
        }}
      />
      <Text
        size="xs"
        fw={emphasis ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.bold}
        span
        style={{ color: tone, opacity: emphasis ? 1 : 0.88 }}
      >
        {short}
      </Text>
    </span>
  );
}

export function wallTag(
  strike: number,
  spot: number,
  isCall: boolean,
  color: string,
): JSX.Element {
  const side = wallSide(strike, spot);
  const code = wallCode(isCall, side, false);
  const isPrimaryCall = isCall && side === "above";
  const isPrimaryPut = !isCall && side === "below";
  const testId = isPrimaryCall
    ? "nifty-wall-cw"
    : isPrimaryPut
      ? "nifty-wall-pw"
      : isCall
        ? "nifty-wall-cw-below"
        : "nifty-wall-pw-above";
  const title = isCall
    ? side === "above"
      ? "Call wall (top CE OI)"
      : "Call wall below spot (broken resistance)"
    : side === "below"
      ? "Put wall (top PE OI)"
      : "Put wall above spot (broken support)";
  return (
    <span
      data-testid={testId}
      data-chain-wall-badge="1"
      title={title}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "2px",
        "flex-shrink": 0,
        "line-height": 1,
        "white-space": "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "4px",
          height: "4px",
          "border-radius": "50%",
          "background-color": color,
          "flex-shrink": 0,
        }}
      />
      <Text
        size="xs"
        span
        fw={700}
        style={{ "font-size": `${REPORT_FONT.micro}px`, color }}
      >
        {code}
      </Text>
    </span>
  );
}

export function oiChangeBarCell(
  value: number,
  max: number | undefined,
  legHue: string,
  barTestId: string,
): JSX.Element {
  const text = Number.isFinite(value) ? formatNumberIN(value) : "—";
  const denom = max != null && max > 0 ? max : 0;
  const pct =
    denom > 0 && Number.isFinite(value) ? Math.min(100, (Math.abs(value) / denom) * 100) : 0;
  const tone =
    value > 0 ? palette.POSITIVE : value < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
  return (
    <span
      title={`${text} ΔOI`}
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "flex-end",
        gap: "2px",
        overflow: "hidden",
        "font-family": palette.MONO,
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <Text
        size="xs"
        span
        fw={600}
        style={{ color: legHue, "font-size": `${OI_CHAIN_METRICS.valueSize}px` }}
      >
        {text}
      </Text>
      <span
        aria-hidden
        style={{
          display: "block",
          width: "100%",
          height: "3px",
          "border-radius": "1px",
          "background-color": hexToRgba(legHue, 0.18),
          overflow: "hidden",
        }}
      >
        <span
          data-testid={barTestId}
          data-pct={Math.round(pct)}
          style={{
            display: "block",
            width: `${pct}%`,
            height: "100%",
            "border-radius": "1px",
            "background-color": tone,
          }}
        />
      </span>
    </span>
  );
}

export function legChangeCell(leg: NiftyStrike["ce"], legHue: string): JSX.Element {
  const change = formatLegChange(leg);
  const tone =
    change.points < 0
      ? palette.NEGATIVE
      : change.points > 0
        ? palette.POSITIVE
        : legHue;
  const sep = change.label.lastIndexOf(" (");
  const pointsText = sep >= 0 ? change.label.slice(0, sep) : change.label;
  const pctText = sep >= 0 ? change.label.slice(sep + 1) : "";
  return (
    <span
      title={change.label}
      style={{
        display: "block",
        "white-space": "nowrap",
        "font-family": palette.MONO,
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <Text
        size="xs"
        span
        fw={600}
        style={{ color: tone, "font-size": `${OI_CHAIN_METRICS.valueSize}px` }}
      >
        {pointsText}
      </Text>
      <Show when={pctText}>
        <Text size="xs" span c="dimmed" style={{ "font-size": `${REPORT_FONT.micro}px` }}>
          {" "}
          {pctText}
        </Text>
      </Show>
    </span>
  );
}

/**
 * Two-tone column label: the side token is the header, the metric token is its
 * subheader. Kept in one compact label so the 6-character textContent (and the
 * existing header test) still holds while the eye gets a stable left anchor on
 * each side of STRIKE. The full description stays in the native tooltip.
 */
export function chainHeader(side: string, metric: string, title: string): JSX.Element {
  return (
    <span title={title}>
      <span style={{ color: palette.TEXT, "font-weight": REPORT_FONT_WEIGHT.extrabold }}>{side}</span>
      <span style={{ color: palette.TEXT_MUTED, "font-weight": REPORT_FONT_WEIGHT.medium }}>
        {" "}
        {metric}
      </span>
    </span>
  );
}
