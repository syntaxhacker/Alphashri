import { Badge } from "@/ui";
import { SENTIMENT_CONFIG } from "./news-constants";

interface SentimentBadgeProps {
  sentiment?: string;
}

export function SentimentBadge({ sentiment }: SentimentBadgeProps) {
  if (!sentiment) return null;
  const config = SENTIMENT_CONFIG[sentiment] || SENTIMENT_CONFIG.NEUTRAL;
  const Icon = config.icon;
  return (
    <Badge
      color={config.color}
      variant="light"
      leftSection={<Icon size={12} />}
      data-testid="sentiment-badge"
      size="lg"
    >
      {sentiment}
    </Badge>
  );
}
