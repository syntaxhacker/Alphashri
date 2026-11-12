import { Show } from "solid-js";
import { Badge } from "@/ui";
import { SENTIMENT_CONFIG } from "./news-constants";

interface SentimentBadgeProps {
  sentiment?: string;
}

export function SentimentBadge(props: SentimentBadgeProps) {
  const config = () => SENTIMENT_CONFIG[props.sentiment ?? ""] ?? SENTIMENT_CONFIG.NEUTRAL;

  return (
    <Show when={props.sentiment}>
      {(sentiment) => {
        const Icon = config().icon;
        return (
          <Badge
            color={config().color}
            variant="light"
            leftSection={<Icon size={12} />}
            data-testid="sentiment-badge"
            size="lg"
          >
            {sentiment()}
          </Badge>
        );
      }}
    </Show>
  );
}
