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
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        columnGap: 0.75,
        rowGap: 0.25,
        borderTop: "1px solid",
        borderColor: "divider",
        pt: 0.5,
      }}
    >
      <Text
        size="xs"
        c="dimmed"
        fw={700}
        style={{ fontSize: 10, textTransform: "uppercase" }}
      >
        Key points
      </Text>
      {meanings.map((item, index) => (
        <Text key={item.label} size="xs" c="dimmed" style={{ fontSize: 10 }}>
          {`${item.label} ${item.meaning}${index < meanings.length - 1 ? " ·" : ""}`}
        </Text>
      ))}
    </Box>
  );
}
