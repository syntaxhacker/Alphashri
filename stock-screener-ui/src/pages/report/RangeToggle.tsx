import { For } from "solid-js";
import { Box, Button } from "@/ui";
import * as palette from "@/ui/palette";
import { TAPE_RANGES, rangeLabel } from "./tapeRange";
import type { TapeRange } from "./tapeRange";

/**
 * 1m / 5m / 15m toggle for an expanded pane. The parent owns the range and
 * re-aggregates its tape rows (see `resampleTape`), so the same buttons work for
 * the heatmap, the pressure lane and the flow chart.
 */
export function RangeToggle(props: {
  value: TapeRange;
  onChange: (range: TapeRange) => void;
  testIdPrefix?: string;
}) {
  const testIdPrefix = () => props.testIdPrefix ?? "nifty-range";
  return (
    <Box
      data-testid={`${testIdPrefix()}-toggle`}
      className="flex items-center gap-[2px] shrink-0"
    >
      <For each={TAPE_RANGES}>
        {(range) => (
          <Button
            data-testid={`${testIdPrefix()}-${range}m`}
            size="sm"
            variant={props.value === range ? "filled" : "subtle"}
            aria-pressed={props.value === range}
            onClick={() => props.onChange(range)}
            style={{
              "min-width": "30px",
              "padding-left": "5px",
              "padding-right": "5px",
              "padding-top": 0,
              "padding-bottom": 0,
              "font-size": "9.5px",
              "line-height": "1.7",
              color: props.value === range ? palette.TEXT : palette.TEXT_MUTED,
            }}
          >
            {rangeLabel(range)}
          </Button>
        )}
      </For>
    </Box>
  );
}
