import { useMemo } from "react";
import { Box, Text } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { buildPatternKeyPoints, keyPointMeanings } from "./patternKeyPoints";

export function KeyPointLegend({ hit }: { hit: PatternHitDTO }) {
  const meanings = useMemo(
    () => keyPointMeanings(hit.pattern_id, buildPatternKeyPoints(hit)),
    [hit],
  );
  if (meanings.length === 0) return null;
  return (
    <Box
      data-testid="patterns-key-point-legend"
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-[2px] border-t border-fin-border pt-1"
    >
      <Text
        size="xs"
        c="dimmed"
        fw={700}
        style={{ "font-size": 10, "text-transform": "uppercase" }}
      >
        Key points
      </Text>
      {meanings.map((item, index) => (
        <Text key={item.label} size="xs" c="dimmed" style={{ "font-size": 10 }}>
          {`${item.label} ${item.meaning}${index < meanings.length - 1 ? " ·" : ""}`}
        </Text>
      ))}
    </Box>
  );
}
