import type { JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { useNiftySpotTick } from "./niftyStreamSolid";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
} from "./reportTokens";

const PANEL_TITLE_STYLE: JSX.CSSProperties = {
  "font-family": palette.MONO,
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.medium,
  "letter-spacing": REPORT_LETTER_SPACING.wide,
  "text-transform": "uppercase",
  "line-height": REPORT_LINE_HEIGHT.tight,
  color: palette.PRIMARY,
  "white-space": "nowrap",
};

export function ReportPanelTitle(props: { testId?: string; children: JSX.Element }) {
  return (
    <span data-testid={props.testId} style={PANEL_TITLE_STYLE}>
      {props.children}
    </span>
  );
}

const DECISION_CELL_CLASS =
  "flex flex-col justify-center flex-[1_1_0] gap-[1px] min-w-[92px] md:min-w-[96px] px-1 py-0.5 border-l first:border-l-0 min-[1200px]:h-[40px]";
const DECISION_CELL_STYLE: JSX.CSSProperties = {
  "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
};

const DECISION_LABEL_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.medium,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "letter-spacing": REPORT_LETTER_SPACING.wide,
  "text-transform": "uppercase",
  "text-align": "left",
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const DECISION_VALUE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.semibold,
  "line-height": REPORT_LINE_HEIGHT.tight,
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  "text-align": "right",
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const CONTEXT_CELL_CLASS =
  "flex flex-col justify-center flex-[1_1_0] gap-[1px] min-w-[64px] px-1 py-0.5 border-l min-[1200px]:h-[40px]";
const CONTEXT_CELL_STYLE: JSX.CSSProperties = {
  "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
};

const CONTEXT_LABEL_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.medium,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "letter-spacing": REPORT_LETTER_SPACING.normal,
  "text-transform": "uppercase",
  "text-align": "left",
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const CONTEXT_VALUE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.semibold,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  "text-align": "right",
};

export function DecisionCell(props: {
  testId: string;
  label: string;
  value: JSX.Element;
  hint: string;
  accent?: string;
  title?: string;
  valueSize?: number;
  minWidth?: number;
}) {
  // The dash lives on the value node, so the reason has to travel with it —
  // a cell-level tooltip alone leaves a bare "—" unexplained on hover.
  const help = () =>
    props.title ? `${props.title} — ${props.hint}` : `${props.label}: ${props.hint}`;
  return (
    <Box
      data-testid={props.testId}
      title={help()}
      className={DECISION_CELL_CLASS}
      style={{
        ...DECISION_CELL_STYLE,
        ...(props.minWidth != null ? { "min-width": `${props.minWidth}px` } : {}),
      }}
    >
      <Text span size="xs" fw={700} c="dimmed" style={DECISION_LABEL_STYLE}>
        {props.label}
      </Text>
      <Text
        span
        fw={700}
        c={props.accent}
        style={{
          ...DECISION_VALUE_STYLE,
          ...(props.valueSize != null ? { "font-size": `${props.valueSize}px` } : {}),
        }}
        data-testid={`${props.testId}-value`}
        title={help()}
      >
        {props.value}
      </Text>
    </Box>
  );
}

export function ContextCell(props: {
  testId: string;
  label: string;
  value: JSX.Element;
  title?: string;
  valueSize?: number;
  minWidth?: number;
}) {
  return (
    <Box
      data-testid={props.testId}
      title={props.title}
      className={CONTEXT_CELL_CLASS}
      style={{
        ...CONTEXT_CELL_STYLE,
        ...(props.minWidth != null ? { "min-width": `${props.minWidth}px` } : {}),
      }}
    >
      <Text span size="xs" fw={700} c="dimmed" style={CONTEXT_LABEL_STYLE}>
        {props.label}
      </Text>
      <Text
        span
        fw={700}
        data-testid={`${props.testId}-value`}
        style={{
          ...CONTEXT_VALUE_STYLE,
          ...(props.valueSize != null ? { "font-size": `${props.valueSize}px` } : {}),
        }}
      >
        {props.value}
      </Text>
    </Box>
  );
}

export function DecisionChip(props: {
  testId: string;
  label: string;
  value: string;
  onClick: () => void;
  tone?: string;
  /** Full explanation, including why a value may be an em dash. */
  help?: string;
  ariaLabel?: string;
  /** Fill a stat-group cell slot instead of keeping an intrinsic width. */
  fill?: boolean;
  minWidth?: number;
}) {
  return (
    <Button
      data-testid={props.testId}
      size="sm"
      variant="subtle"
      onClick={() => props.onClick()}
      title={props.help ?? `${props.label} — ${props.value}`}
      aria-label={props.ariaLabel ?? `${props.label}: ${props.value}`}
      className="min-w-0 h-[20px] px-1 py-0 gap-[3px] rounded-[4px] whitespace-nowrap"
      style={{
        // The strip already draws the section border; a chip border inside it
        // is a card-inside-card. A tint keeps the chip readable as a control.
        "background-color": palette.alpha(palette.TERM_BORDER, 0.18),
        // Button's px-3 wins over the class-level px-1; the label and the
        // value both need that room back at the 13px body step.
        "padding-left": "4px",
        "padding-right": "4px",
        ...(props.minWidth != null ? { "min-width": `${props.minWidth}px` } : {}),
        ...(props.fill ? { flex: "1 1 0%", height: "100%" } : {}),
      }}
    >
      <Text
        span
        size="xs"
        fw={700}
        c="dimmed"
        style={{
          "font-size": `${REPORT_FONT.body}px`,
          "letter-spacing": "0.05em",
          "text-align": "left",
        }}
      >
        {props.label}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{
          flex: 1,
          "min-width": 0,
          "font-size": `${REPORT_FONT.body}px`,
          color: props.tone ?? palette.TEXT,
          "font-variant-numeric": "tabular-nums",
          "text-align": "right",
          overflow: "hidden",
          "text-overflow": "ellipsis",
        }}
      >
        {props.value}
      </Text>
    </Button>
  );
}

export function NiftySpotValue(props: { live: boolean; fallback: number }) {
  const tick = useNiftySpotTick();
  const value = () => (props.live ? tick()?.spot : undefined) ?? props.fallback;
  return <AnimatedValue value={value()} format={formatNumberIN} />;
}
