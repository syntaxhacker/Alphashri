import { Box, Badge, Tooltip, Text } from "@/ui";
import type { ValuePeer, ValueSubscores } from "../../api/valueScan";
import { formatValueMedian } from "./valueFormat";

interface ValueScoreCellProps {
  score: number;
  subscores: ValueSubscores;
  peer: ValuePeer;
  symbol: string;
}

function scoreColor(score: number): "success" | "warning" | "error" {
  if (score >= 70) return "success";
  if (score >= 50) return "warning";
  return "error";
}

const BAR_KEYS = ["value", "quality", "growth", "health"] as const;

export function ValueScoreCell({ score, subscores, peer, symbol }: ValueScoreCellProps) {
  const tooltip = [
    `Value ${subscores.value} · Quality ${subscores.quality} · Growth ${subscores.growth} · Health ${subscores.health}`,
    `Peer ${peer.bucket}: P/E ${formatValueMedian(peer.pe_median)} · ROE ${formatValueMedian(peer.roe_median, "%")} · FCF ${formatValueMedian(peer.fcf_yield_median, "%")}`,
  ].join(" | ");
  return (
    <Tooltip label={tooltip} multiline>
      <Box
        data-testid={`value-score-${symbol}`}
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}
      >
        <Badge size="xs" color={scoreColor(score)} data-testid={`value-score-chip-${symbol}`}>
          {Math.round(score)}
        </Badge>
        <Box sx={{ display: "flex", alignItems: "center", gap: "2px" }} aria-hidden>
          {BAR_KEYS.map((k) => (
            <Box
              key={k}
              sx={{
                width: 4,
                height: 14,
                borderRadius: 1,
                bgcolor: "divider",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: `${Math.max(0, Math.min(100, subscores[k]))}%`,
                  bgcolor: "primary.main",
                }}
              />
            </Box>
          ))}
        </Box>
        <Text size="xs" c="dimmed" data-testid={`value-score-peer-${symbol}`}>
          {peer.bucket}
        </Text>
      </Box>
    </Tooltip>
  );
}
