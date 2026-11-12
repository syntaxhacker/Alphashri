import { Show } from "solid-js";
import { IconBell, IconChevronLeft, IconChevronRight } from "../common/Icons";
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
export function SidebarHeader(props: SidebarHeaderProps) {
  const collapsed = () => (props.rail ?? false) && !(props.mobile ?? false);
  // The mobile drawer only ever shows the expanded chrome, so its nodes get a
  // suffix: both drawers stay mounted and duplicate test ids would break
  // strict-mode queries.
  const testId = (id: string) => (props.mobile ? `${id}-mobile` : id);
  const label = () => (props.surgeTotal > 0 ? `${props.surgeTotal} surge alerts` : "Notifications");

  const bell = () => (
    <Tooltip label={label()}>
      <ActionIcon
        size="sm"
        onClick={props.onOpenNotifications}
        data-testid={testId("notif-bell")}
        aria-label={props.surgeTotal > 0 ? `Notifications, ${props.surgeTotal} surge alerts` : "Notifications"}
        variant="subtle"
      >
        <Show when={props.surgeTotal > 0}>
          <Badge color="error" variant="filled" size="xs" data-testid={testId("notif-badge")}>
            {props.surgeTotal > 9 ? "9+" : props.surgeTotal}
          </Badge>
        </Show>
        <IconBell size={16} stroke={1.6} />
      </ActionIcon>
    </Tooltip>
  );

  const collapse = () => props.mobile ? null : (
    <Tooltip label={collapsed() ? "Expand sidebar" : "Collapse sidebar"}>
      <ActionIcon
        size="sm"
        onClick={props.onToggleCollapse}
        aria-label="Toggle sidebar"
        data-testid="sidebar-collapse-toggle"
        variant="subtle"
      >
        <Show when={collapsed()} fallback={<IconChevronLeft size={16} />}>
          <IconChevronRight size={16} />
        </Show>
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Box
      data-testid={testId("app-sidebar-header")}
      className="flex flex-col items-stretch gap-2 flex-shrink-0"
      style={{
        paddingLeft: collapsed() ? 0 : 8,
        paddingTop: 6,
        paddingBottom: 4,
        display: "flex",
        flexDirection: "column",
        alignItems: collapsed() ? "center" : "stretch",
        gap: 4,
        minWidth: 0,
      }}
    >
      <Show when={collapsed()} fallback={(
        <Box className="flex items-center justify-between min-w-0" style={{ gap: 4, display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
          <Text
            id={testId("app-logo")}
            data-testid={testId("app-logo")}
            fw={700}
            style={{ fontSize: 14, lineHeight: 1, letterSpacing: "-0.01em" }}
          >
            Alphashri
          </Text>
          <Stack direction="row" align="center" gap={2}>
            <NewsPanel2 />
            {bell()}
            {collapse()}
          </Stack>
        </Box>
      )}>
        {/* 64px rail: keep only the control needed to expand it again. */}
        <Stack direction="row" align="center" justify="center" gap={2}>
          {collapse()}
        </Stack>
      </Show>
      <MarketStatus compact={collapsed()} />
      <Show when={!collapsed()}>
        <MarketTicker variant="tape" />
      </Show>
    </Box>
  );
}
