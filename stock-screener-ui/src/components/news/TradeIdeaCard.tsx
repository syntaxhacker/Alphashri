import { Card, Badge, Group, Text } from "@/ui";
import type { TradeIdea } from "./news-types";

interface TradeIdeaCardProps {
  idea: TradeIdea;
}

export function TradeIdeaCard({ idea }: TradeIdeaCardProps) {
  if (!idea) return null;
  const isLong = idea.direction === "LONG";
  return (
    <Card padding="md" withBorder data-testid="trade-idea">
      <Group justify="space-between" mb="sm">
        <Badge color={isLong ? "green" : "red"} variant="filled" size="sm">
          {idea.direction}
        </Badge>
        <Text size="sm" fw={600}>
          {idea.symbol}
        </Text>
      </Group>
      <Text size="sm" c="dimmed">
        {idea.reasoning}
      </Text>
    </Card>
  );
}
