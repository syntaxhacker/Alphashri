import { Box, ToolbarRow, Select, Badge, Tooltip, ActionIcon } from "@/ui";
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
    <ToolbarRow gap={8}>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
        <Select
          size="sm"
          value={selectedSource}
          onChange={(v) => v && onSourceChange(v)}
          data={sourceData}
          style={{ width: "100%" }}
          className="news-source-select"
          data-testid="news-source-select"
        />
      </Box>

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
        <Badge size="sm" variant="light" color="primary" onClick={onMarkAllRead} data-testid="news-unread-badge">
          {unreadCount} unread
        </Badge>
      )}
    </ToolbarRow>
  );
}
