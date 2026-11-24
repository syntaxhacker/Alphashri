import { Box, Text, typeSize } from "@/ui";
import type { AnalyticsTone } from "./types";

const TONE_VAR: Record<AnalyticsTone, string> = {
  positive: "var(--color-fin-positive)",
  negative: "var(--color-fin-negative)",
  warning: "var(--color-fin-warning)",
  info: "var(--color-fin-info)",
  neutral: "var(--color-fin-text-muted)",
};

/** One metric: a 9px uppercase label over a 10px mono, tabular value. */
export function MetricCell(props: {
  label: string;
  value: string;
  testId: string;
  tone?: AnalyticsTone;
  bordered?: boolean;
}) {
  return (
    <Box
      className={`flex min-w-0 flex-1 flex-col justify-center px-1.5${
        props.bordered ? " border-l border-fin-border" : ""
      }`}
      data-testid={props.testId}
    >
      <Text
        size="xs"
        c="dimmed"
        className="truncate uppercase"
        style={{ "font-size": `${typeSize("micro")}px`, "letter-spacing": "0.06em", "line-height": "1.1" }}
      >
        {props.label}
      </Text>
      <Text
        size="xs"
        fw={700}
        className="truncate font-mono tabular-nums"
        style={{
          "font-size": `${typeSize("micro")}px`,
          "line-height": "1.2",
          ...(props.tone ? { color: TONE_VAR[props.tone] } : {}),
        }}
        data-testid={`${props.testId}-value`}
      >
        {props.value}
      </Text>
    </Box>
  );
}
