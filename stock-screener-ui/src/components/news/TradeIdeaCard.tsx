import { Show } from "solid-js";
import { Badge, Box, Text } from "@/ui";
import type { TradeIdea } from "./news-types";

interface TradeIdeaCardProps {
  idea: TradeIdea;
}

export function TradeIdeaCard(props: TradeIdeaCardProps) {
  const isLong = () => props.idea?.direction === "LONG";

  return (
    <Show when={props.idea}>
      <div role="listitem" data-testid="trade-idea" className="flex items-start gap-2 min-w-0">
        <Box className="flex items-center gap-1 min-w-0">
          <Badge
            size="xs"
            variant="filled"
            color={isLong() ? "success" : "error"}
          >
            {props.idea.direction}
          </Badge>
          <Text size="sm" fw={600} truncate className="min-w-0">
            {props.idea.symbol}
          </Text>
        </Box>
        <Show when={props.idea.reasoning}>
          <Text size="xs" c="dimmed" className="min-w-0 break-words">
            {props.idea.reasoning}
          </Text>
        </Show>
      </div>
    </Show>
  );
}
