import { Show } from "solid-js";
import * as palette from "@/ui/palette";
import { REPORT_FONT } from "./reportTokens";

interface ChartFirstTimeTickProps {
  shown: boolean;
  left: number;
  time: string;
}

export function ChartFirstTimeTick(props: ChartFirstTimeTickProps) {
  return (
    // On a phone the engine's UTC-anchored tick grid starts at 09:30,
    // so the session-open label is never emitted even after the first
    // bar is inset. Print the real first-bar time at its plot position
    // instead of leaving the left edge unlabelled.
    <Show when={props.shown}>
      <span
        data-testid="nifty-chart-first-time-tick"
        class="pointer-events-none absolute whitespace-nowrap text-ui-micro tabular-nums"
        style={{
          bottom: "0px",
          left: `${props.left}px`,
          color: palette.TEXT_MUTED,
          "font-family": palette.MONO,
          "font-size": `${REPORT_FONT.micro}px`,
          "line-height": "16px",
        }}
        title="First candle of the session"
      >
        {props.time}
      </span>
    </Show>
  );
}
