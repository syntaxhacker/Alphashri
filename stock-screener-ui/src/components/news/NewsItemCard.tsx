import { Card, Group, Box, Text } from "@mantine/core";
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
      style={{
        borderLeft: isUnread ? "3px solid var(--mantine-color-blue-6)" : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(item);
      }}
      data-testid="news-item"
    >
      <Group gap="xs" wrap="nowrap">
        {isUnread && <Box w={5} h={5} bg="blue" style={{ borderRadius: "50%", flexShrink: 0 }} />}
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
