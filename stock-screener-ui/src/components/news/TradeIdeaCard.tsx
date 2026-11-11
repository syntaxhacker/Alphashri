import { Badge, Box, Text } from "@/ui";
import type { TradeIdea } from "./news-types";

interface TradeIdeaCardProps {
  idea: TradeIdea;
}

export function TradeIdeaCard({ idea }: TradeIdeaCardProps) {
  if (!idea) return null;
  const isLong = idea.direction === "LONG";
  return (
    <div role="listitem" data-testid="trade-idea" className="flex items-start gap-2 min-w-0">
      <Box className="flex items-center gap-1 min-w-0">
        <Badge
          size="xs"
          variant="filled"
          color={isLong ? "success" : "error"}
        >
          {idea.direction}
        </Badge>
        <Text size="sm" fw={600} truncate className="min-w-0">
          {idea.symbol}
        </Text>
      </Box>
      {idea.reasoning ? (
        <Text size="xs" c="dimmed" className="min-w-0 break-words">
          {idea.reasoning}
        </Text>
      ) : null}
    </div>
  );
}
