import { Card, Group, Box, Text } from "@/ui";
import type { NewsItem } from "./news-types";
import { formatTimeAgo } from "../../utils/ui-helpers";

export function NewsItemCard({
  item,
  isUnread,
  onClick,
}: {
  item: NewsItem;
  isUnread: boolean;
  onClick: (item: NewsItem) => void;
}) {
  return (
    <Card
      padding="xs"
      className={`news-item-card ${isUnread ? "unread" : ""}`}
      style={{ "border-left": isUnread ? "3px solid var(--color-fin-primary)" : undefined }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(item);
      }}
      data-testid="news-item"
    >
      <Group gap="xs" wrap="nowrap" align="center">
        {isUnread && <Box className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-fin-primary" />}
        <Text
          size="xs"
          fw={isUnread ? 500 : 400}
          lineClamp={1}
          className="news-item-headline"
          flex={1}
        >
          {item.headline}
        </Text>
        <Text size="xs" c="dimmed" className="news-item-meta">
          {formatTimeAgo(item.publishedAt)}
        </Text>
      </Group>
    </Card>
  );
}
