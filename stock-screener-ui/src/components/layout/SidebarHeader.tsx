import { Show, onCleanup, onMount } from "solid-js";
import { IconBell, IconChevronLeft, IconChevronRight } from "../common/Icons";
import { ActionIcon, Badge, Box, Stack, Text, Tooltip, typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import { setMobileDrawerOpen } from "@/state/ui";
import NewsPanel2 from "../news/NewsPanel";
import { MarketStatus, MarketTicker } from "./MarketTicker";
import { surgeAriaLabel, surgeBadgeText, surgeTooltip } from "../notifications/surgeAlertCount";

const CONTROL_SIZE = 22;
const CONTROL_GAP = "4px";

export interface SidebarHeaderProps {
  /** Desktop rail collapsed to 64px. Ignored inside the mobile drawer. */
  rail?: boolean;
  /** Rendered inside the temporary (mobile) drawer. */
  mobile?: boolean;
  /** Unread surge alerts for today (NOT the all-time row count). */
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
  const badgeText = () => surgeBadgeText(props.surgeTotal);
  let headerEl: HTMLDivElement | undefined;

  // AppLayout owns the toggle as local state, but this header is the child it
  // shows/hides. Mirror that visibility into the shared signal so page bands
  // can yield their rects to the overlay without editing AppLayout.
  onMount(() => {
    if (!props.mobile) return;
    const sync = () => setMobileDrawerOpen((headerEl?.getClientRects().length ?? 0) > 0);
    sync();
    const parent = headerEl?.parentElement;
    const observer = parent && typeof MutationObserver !== "undefined"
      ? new MutationObserver(sync)
      : undefined;
    observer?.observe(parent!, { attributes: true, attributeFilter: ["style"] });
    onCleanup(() => {
      observer?.disconnect();
      setMobileDrawerOpen(false);
    });
  });

  const bell = () => (
    <Tooltip label={surgeTooltip(props.surgeTotal)}>
      <ActionIcon
        size={CONTROL_SIZE}
        onClick={props.onOpenNotifications}
        data-testid={testId("notif-bell")}
        aria-label={surgeAriaLabel(props.surgeTotal)}
        variant="subtle"
      >
        <Show when={badgeText()}>
          {(text) => (
            <Badge color="error" variant="filled" size="xs" data-testid={testId("notif-badge")}>
              {text()}
            </Badge>
          )}
        </Show>
        <IconBell size={16} stroke={1.6} />
      </ActionIcon>
    </Tooltip>
  );

  const collapse = () => props.mobile ? null : (
    <Tooltip label={collapsed() ? "Expand sidebar" : "Collapse sidebar"}>
      <ActionIcon
        size={CONTROL_SIZE}
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
      ref={(el: HTMLDivElement) => { headerEl = el; }}
      data-testid={testId("app-sidebar-header")}
      className="flex flex-col items-stretch gap-2 flex-shrink-0"
      style={{
        "padding-left": collapsed() ? 0 : "8px",
        "padding-top": "6px",
        "padding-bottom": "4px",
        display: "flex",
        "flex-direction": "column",
        "align-items": collapsed() ? "center" : "stretch",
        gap: "4px",
        "min-width": "0px",
        // The drawer is a fixed overlay over the page. An opaque header stops
        // the toolbar behind it bleeding through the ticker's reserved row.
        "background-color": props.mobile ? palette.BG : undefined,
      }}
    >
      <Show when={collapsed()} fallback={(
        <Box className="flex items-center justify-between min-w-0" style={{ gap: CONTROL_GAP, display: "flex", "align-items": "center", "justify-content": "space-between", "min-width": "0px" }}>
          <Text
            id={testId("app-logo")}
            data-testid={testId("app-logo")}
            fw={700}
            style={{ "font-size": `${typeSize("body")}px`, "line-height": 1, "letter-spacing": "-0.02em", "white-space": "nowrap" }}
          >
            Alphashri
          </Text>
          <Stack direction="row" align="center" gap={CONTROL_GAP}>
            <NewsPanel2 />
            {bell()}
            {collapse()}
          </Stack>
        </Box>
      )}>
        {/* Rail collapsed: keep only the control needed to expand it again. */}
        <Stack direction="row" align="center" justify="center" gap={CONTROL_GAP}>
          {collapse()}
        </Stack>
      </Show>
      <MarketStatus compact={collapsed()} />
      <Show when={!collapsed()}>
        <MarketTicker variant="tape" mobile={props.mobile} />
      </Show>
    </Box>
  );
}
