import { Show } from "solid-js";
import { Card, Group, Box, Text } from "@/ui";
import type { NewsItem } from "./news-types";
import { formatTimeAgo } from "../../utils/ui-helpers";

export function NewsItemCard(props: {
  item: NewsItem;
  isUnread: boolean;
  onClick: (item: NewsItem) => void;
}) {
  return (
    <Card
      padding="xs"
      className={`news-item-card ${props.isUnread ? "unread" : ""}`}
      style={{ "border-left": props.isUnread ? "3px solid var(--color-fin-primary)" : undefined }}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick(props.item);
      }}
      data-testid="news-item"
    >
      <Group gap="xs" wrap="nowrap" align="center">
        <Show when={props.isUnread}>
          <Box className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-fin-primary" />
        </Show>
        <Text
          size="xs"
          fw={props.isUnread ? 500 : 400}
          lineClamp={1}
          className="news-item-headline"
          flex={1}
        >
          {props.item.headline}
        </Text>
        <Text size="xs" c="dimmed" className="news-item-meta">
          {formatTimeAgo(props.item.publishedAt)}
        </Text>
      </Group>
    </Card>
  );
}
