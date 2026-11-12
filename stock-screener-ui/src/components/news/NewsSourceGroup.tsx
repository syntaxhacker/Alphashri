import { Show, For } from "solid-js";
import { Box, Group, Text, Badge, Collapse, Stack } from "@/ui";
import { IconChevronDown, IconChevronRight } from "../common/Icons";
import type { NewsItem } from "./news-types";
import { NewsItemCard } from "./NewsItemCard";

export function NewsSourceGroup(props: {
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
        align="center"
        p="xs"
        className="rounded-sm bg-fin-surface-alt"
        onClick={props.onToggle}
        data-testid={`news-source-group-${props.source}`}
      >
        <Show when={props.isExpanded} fallback={<IconChevronRight size={14} />}>
          <IconChevronDown size={14} />
        </Show>
        <Text size="sm" fw={600} tt="uppercase">
          {props.source}
        </Text>
        <Badge size="xs" variant="light" color="secondary">
          {props.items.length}
        </Badge>
      </Group>

      <Collapse in={props.isExpanded}>
        <Stack gap={4} mt="xs">
          <For each={props.items}>
            {(item) => (
              <NewsItemCard
                item={item}
                isUnread={!props.readIds.has(item.id)}
                onClick={props.onItemClick}
              />
            )}
          </For>
        </Stack>
      </Collapse>
    </Box>
  );
}
