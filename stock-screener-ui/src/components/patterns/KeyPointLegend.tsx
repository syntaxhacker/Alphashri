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
        className="flex flex-col gap-1 border-t border-fin-border px-3 py-2"
      >
        <Text
          size="xs"
          c="dimmed"
          fw={700}
          style={{ "font-size": "10px", "text-transform": "uppercase", "letter-spacing": "0.4px" }}
        >
          Key points
        </Text>
        <Box className="flex flex-wrap gap-x-3 gap-y-0.5">
          <For each={meanings()}>
            {(item) => (
              <Text size="xs" c="dimmed" style={{ "font-size": "11px" }}>
                {`${item.label} ${item.meaning}`}
              </Text>
            )}
          </For>
        </Box>
      </Box>
    </Show>
  );
}
