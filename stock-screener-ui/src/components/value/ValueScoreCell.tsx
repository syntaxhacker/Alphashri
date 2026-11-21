import { For, createMemo } from "solid-js";
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

export function ValueScoreCell(props: ValueScoreCellProps) {
  const sub = () => props.subscores;
  const peer = () => props.peer;
  const tooltip = createMemo(() =>
    [
      `Value ${sub().value} · Quality ${sub().quality} · Growth ${sub().growth} · Health ${sub().health}`,
      `Peer ${peer().bucket}: P/E ${formatValueMedian(peer().pe_median)} · ROE ${formatValueMedian(peer().roe_median, "%")} · FCF ${formatValueMedian(peer().fcf_yield_median, "%")}`,
    ].join(" | "),
  );

  return (
    <Tooltip label={tooltip()} multiline>
      <Box
        data-testid={`value-score-${props.symbol}`}
        className="flex items-center justify-center gap-2"
      >
        <Badge size="xs" color={scoreColor(props.score)} data-testid={`value-score-chip-${props.symbol}`}>
          {Math.round(props.score)}
        </Badge>
        <Box className="flex items-center gap-[2px]" aria-hidden>
          <For each={BAR_KEYS}>
            {(k) => (
              <Box
                className="relative h-[14px] w-1 overflow-hidden rounded-[2px] bg-fin-border"
              >
                <Box
                  className="absolute bottom-0 left-0 right-0 bg-fin-primary"
                  style={{ height: `${Math.max(0, Math.min(100, sub()[k]))}%` }}
                />
              </Box>
            )}
          </For>
        </Box>
        <Text size="xs" c="dimmed" data-testid={`value-score-peer-${props.symbol}`}>
          {peer().bucket}
        </Text>
      </Box>
    </Tooltip>
  );
}
