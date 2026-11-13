import { createMemo, For, Show } from "solid-js";
import { Box, Text } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { buildPatternKeyPoints, keyPointMeanings } from "./patternKeyPoints";

export function KeyPointLegend(props: { hit: PatternHitDTO }) {
  const meanings = createMemo(() =>
    keyPointMeanings(props.hit.pattern_id, buildPatternKeyPoints(props.hit)),
  );
  return (
    <Show when={meanings().length > 0}>
      <Box
        data-testid="patterns-key-point-legend"
        className="flex flex-wrap items-baseline gap-x-1.5 gap-y-[2px] border-t border-fin-border pt-1"
      >
        <Text
          size="xs"
          c="dimmed"
          fw={700}
          style={{ "font-size": "10px", "text-transform": "uppercase" }}
        >
          Key points
        </Text>
        <For each={meanings()}>
          {(item, index) => (
            <Text size="xs" c="dimmed" style={{ "font-size": "10px" }}>
              {`${item.label} ${item.meaning}${index() < meanings().length - 1 ? " ·" : ""}`}
            </Text>
          )}
        </For>
      </Box>
    </Show>
  );
}
