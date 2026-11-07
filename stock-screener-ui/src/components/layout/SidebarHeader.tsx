import { memo } from "react";
import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import { IconBell, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Box, Stack, Text, Tooltip } from "@/ui";
import NewsPanel2 from "../news/NewsPanel2";
import { MarketStatus } from "./MarketTicker";

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
 *
 * MUI `IconButton` + `Badge` are intentional (`@/ui` wrappers do not forward a
 * ref to `Tooltip`, and the badge needs a dot anchored to its child).
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
      <IconButton
        size="small"
        onClick={onOpenNotifications}
        data-testid={testId("notif-bell")}
        aria-label={surgeTotal > 0 ? `Notifications, ${surgeTotal} surge alerts` : "Notifications"}
        sx={{ "& .MuiBadge-badge": { fontSize: 9, height: 13, minWidth: 13, px: 0.4 } }}
      >
        <Badge
          color="error"
          badgeContent={surgeTotal > 9 ? "9+" : surgeTotal}
          invisible={surgeTotal === 0}
          data-testid={testId("notif-badge")}
        >
          <IconBell size={16} stroke={1.6} />
        </Badge>
      </IconButton>
    </Tooltip>
  );

  const collapse = mobile ? null : (
    <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
      <IconButton
        size="small"
        onClick={onToggleCollapse}
        aria-label="Toggle sidebar"
        data-testid="sidebar-collapse-toggle"
      >
        {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box
      data-testid={testId("app-sidebar-header")}
      sx={{
        px: collapsed ? 0 : 1,
        pt: 0.75,
        pb: 0.5,
        display: "flex",
        flexDirection: "column",
        alignItems: collapsed ? "center" : "stretch",
        gap: 0.5,
        flexShrink: 0,
      }}
    >
      {collapsed ? (
        // 64px rail: keep only the control needed to expand it again.
        <Stack direction="row" align="center" justify="center" gap={2}>
          {collapse}
        </Stack>
      ) : (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            justifyContent: "space-between",
            minWidth: 0,
          }}
        >
          <Text
            id={testId("app-logo")}
            data-testid={testId("app-logo")}
            fw={700}
            sx={{ fontSize: 14, lineHeight: 1, letterSpacing: "-0.01em" }}
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
    </Box>
  );
});
