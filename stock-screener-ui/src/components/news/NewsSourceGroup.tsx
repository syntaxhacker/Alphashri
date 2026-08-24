import { Box, Group, Text, Badge, Collapse, Stack } from "@/ui";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { NewsItem } from "./news-types";
import { NewsItemCard } from "./NewsItemCard";

export function NewsSourceGroup({
  source,
  items,
  isExpanded,
  readIds,
  onToggle,
  onItemClick,
}: {
  source: string;
  items: NewsItem[];
  isExpanded: boolean;
  readIds: Set<string>;
  onToggle: () => void;
  onItemClick: (item: NewsItem) => void;
}) {
  return (
    <Box className="news-source-group">
      <Group
        gap="xs"
        p="xs"
        sx={{
          borderRadius: 1,
          bgcolor: "action.hover",
        }}
        onClick={onToggle}
        data-testid={`news-source-group-${source}`}
      >
        {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <Text size="sm" fw={600} tt="uppercase">
          {source}
        </Text>
        <Badge size="xs" variant="light" color="secondary">
          {items.length}
        </Badge>
      </Group>

      <Collapse in={isExpanded}>
        <Stack gap={4} mt="xs">
          {items.map((item) => (
            <NewsItemCard
              key={item.id}
              item={item}
              isUnread={!readIds.has(item.id)}
              onClick={onItemClick}
            />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}
