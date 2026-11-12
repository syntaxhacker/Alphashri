import { memo } from "react";
import { IconBell, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { ActionIcon, Badge, Box, Stack, Text, Tooltip } from "@/ui";
import NewsPanel2 from "../news/NewsPanel2";
import { MarketStatus, MarketTicker } from "./MarketTicker";

export interface SidebarHeaderProps {
  /** Desktop rail collapsed to 64px. Ignored inside the mobile drawer. */
  rail?: boolean;
  /** Rendered inside the temporary (mobile) drawer. */
  mobile?: boolean;
  surgeTotal: number;
  onToggleCollapse: () => void;
  onOpenNotifications: () => void;
}

/**
 * Sidebar chrome that replaced the removed top app bar: brand, market state,
 * news, notifications and the collapse toggle. Memoised because AppLayout
 * re-renders on notification/route changes while these props rarely move.
 */
export const SidebarHeader = memo(function SidebarHeader({
  rail = false,
  mobile = false,
  surgeTotal,
  onToggleCollapse,
  onOpenNotifications,
}: SidebarHeaderProps) {
  const collapsed = rail && !mobile;
  // The mobile drawer only ever shows the expanded chrome, so its nodes get a
  // suffix: both drawers stay mounted and duplicate test ids would break
  // strict-mode queries.
  const testId = (id: string) => (mobile ? `${id}-mobile` : id);
  const label = surgeTotal > 0 ? `${surgeTotal} surge alerts` : "Notifications";

  const bell = (
    <Tooltip label={label}>
      <ActionIcon
        size="sm"
        onClick={onOpenNotifications}
        data-testid={testId("notif-bell")}
        aria-label={surgeTotal > 0 ? `Notifications, ${surgeTotal} surge alerts` : "Notifications"}
        variant="subtle"
      >
        {surgeTotal > 0 && (
          <Badge color="error" variant="filled" size="xs" data-testid={testId("notif-badge")}>
            {surgeTotal > 9 ? "9+" : surgeTotal}
          </Badge>
        )}
        <IconBell size={16} stroke={1.6} />
      </ActionIcon>
    </Tooltip>
  );

  const collapse = mobile ? null : (
    <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
      <ActionIcon
        size="sm"
        onClick={onToggleCollapse}
        aria-label="Toggle sidebar"
        data-testid="sidebar-collapse-toggle"
        variant="subtle"
      >
        {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Box
      data-testid={testId("app-sidebar-header")}
      className="flex flex-col items-stretch gap-2 flex-shrink-0"
      style={{
        "padding-left": collapsed ? 0 : 8,
        "padding-top": 6,
        "padding-bottom": 4,
        display: "flex",
        "flex-direction": "column",
        "align-items": collapsed ? "center" : "stretch",
        gap: 4,
        "min-width": 0,
      }}
    >
      {collapsed ? (
        // 64px rail: keep only the control needed to expand it again.
        <Stack direction="row" align="center" justify="center" gap={2}>
          {collapse}
        </Stack>
      ) : (
        <Box className="flex items-center justify-between min-w-0" style={{ gap: 4, display: "flex", "align-items": "center", "justify-content": "space-between", "min-width": 0 }}>
          <Text
            id={testId("app-logo")}
            data-testid={testId("app-logo")}
            fw={700}
            style={{ "font-size": 14, "line-height": 1, "letter-spacing": "-0.01em" }}
          >
            Alphashri
          </Text>
          <Stack direction="row" align="center" gap={2}>
            <NewsPanel2 />
            {bell}
            {collapse}
          </Stack>
        </Box>
      )}
      <MarketStatus compact={collapsed} />
      {!collapsed && <MarketTicker variant="tape" />}
    </Box>
  );
});
