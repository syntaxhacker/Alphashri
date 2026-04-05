import { Group, Select, Badge, Tooltip, ActionIcon } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { AUTO_REFRESH_INTERVALS } from "./NewsLocalStorage";

export function NewsFilterControls({
  sourceData,
  selectedSource,
  autoRefreshMs,
  loading,
  isRefreshing,
  unreadCount,
  onSourceChange,
  onRefresh,
  onAutoRefreshChange,
  onMarkAllRead,
}: {
  sourceData: { value: string; label: string }[];
  selectedSource: string;
  autoRefreshMs: string;
  loading: boolean;
  isRefreshing: boolean;
  unreadCount: number;
  onSourceChange: (v: string) => void;
  onRefresh: () => void;
  onAutoRefreshChange: (v: string) => void;
  onMarkAllRead: () => void;
}) {
  return (
    <Group gap="xs">
      <Select
        size="sm"
        value={selectedSource}
        onChange={(v) => v && onSourceChange(v)}
        data={sourceData}
        style={{ flex: 1 }}
        className="news-source-select"
        data-testid="news-source-select"
      />

      <Tooltip label="Refresh">
        <ActionIcon
          variant="light"
          size="sm"
          onClick={onRefresh}
          loading={loading}
          disabled={loading || isRefreshing}
          className="news-refresh-btn"
          data-testid="news-refresh-btn"
        >
          <IconRefresh size={14} />
        </ActionIcon>
      </Tooltip>

      <Select
        size="sm"
        value={autoRefreshMs}
        onChange={(v) => v && onAutoRefreshChange(v)}
        data={AUTO_REFRESH_INTERVALS}
        w={60}
        data-testid="news-auto-refresh-select"
      />

      {unreadCount > 0 && (
        <Badge
          variant="light"
          color="blue"
          style={{ cursor: "pointer" }}
          onClick={onMarkAllRead}
          data-testid="news-unread-badge"
        >
          {unreadCount} unread
        </Badge>
      )}
    </Group>
  );
}
