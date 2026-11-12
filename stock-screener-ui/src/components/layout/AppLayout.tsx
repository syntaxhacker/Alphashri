import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { useLocation } from "@solidjs/router";
import { useDisclosure } from "@/ui/hooks";
import { Box, Divider, ActionIcon } from "@/ui";
import * as palette from "@/ui/palette";
import { useMediaQuery } from "@/ui/hooks";
import { IconMenu2 } from "../common/Icons";
import { NavbarNested } from "./NavbarNested";
import { SidebarHeader } from "./SidebarHeader";
import { NotificationsPanel, useSurgeAlertTotal } from "../notifications/NotificationsPanel";

interface AppLayoutProps {
  children?: JSX.Element;
}

const MD_BREAKPOINT = "(min-width: 900px)";

export function AppLayout(props: AppLayoutProps) {
  const location = useLocation();
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [desktopCollapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  // Only one navigation tree is mounted at a time: the hidden permanent drawer
  // used to keep all 19 links (and the news poller) alive on phones.
  const isDesktop = useMediaQuery(MD_BREAKPOINT, undefined, { noSsr: true });
  const [notifOpen, setNotifOpen] = createSignal(false);
  const [notifRefreshKey, setNotifRefreshKey] = createSignal(0);
  // Read-through accessor: the surge total refetches when the key bumps.
  const surgeTotal = useSurgeAlertTotal(notifRefreshKey);
  const navWidth = () => (desktopCollapsed() ? 64 : 200);

  // The desk dock drawer is portaled to <body>, outside #app-shell; publish the
  // nav width on the root so the bottom sheet aligns with the main column.
  createEffect(() => {
    document.documentElement.style.setProperty("--app-nav-width", `${navWidth()}px`);
    onCleanup(() => {
      document.documentElement.style.removeProperty("--app-nav-width");
    });
  });

  const handleNotifOpen = () => setNotifOpen(true);
  const handleNotifClose = () => {
    setNotifOpen(false);
    setNotifRefreshKey((key) => key + 1);
  };

  const drawerContent = () => (
    <NavbarNested
      activePath={location.pathname}
      collapsed={desktopCollapsed()}
      onMobileNavigate={closeMobile}
    />
  );

  return (
    <Box
      className="flex h-screen overflow-hidden bg-fin-bg"
      style={{ display: "flex", height: "100vh", overflow: "hidden", backgroundColor: palette.BG }}
      id="app-shell"
      data-testid="app-shell"
    >
      {/* No top app bar: on narrow viewports the rail is a temporary drawer, so
          a floating trigger replaces the header hamburger without a bar. */}
      <ActionIcon
        aria-label="Toggle navigation"
        onClick={toggleMobile}
        data-testid="app-mobile-nav-toggle"
        className="rounded-fin border border-fin-border shadow-sm"
        style={{
          display: isDesktop() ? "none" : "inline-flex",
          position: "fixed",
          top: 8,
          left: 8,
          zIndex: 1299,
          width: 36,
          height: 36,
          backgroundColor: palette.SURFACE,
          border: `1px solid ${palette.BORDER}`,
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        }}
      >
        <IconMenu2 size={18} />
      </ActionIcon>

      <NotificationsPanel opened={notifOpen()} onClose={handleNotifClose} />

      <Show when={!isDesktop()}>
        <div
          style={{
            display: mobileOpened() ? "block" : "none",
            position: "fixed",
            top: 0,
            left: 0,
            bottom: 0,
            width: 220,
            boxSizing: "border-box",
            zIndex: 1300,
          }}
        >
          <SidebarHeader
            mobile
            surgeTotal={surgeTotal()}
            onToggleCollapse={toggleDesktop}
            onOpenNotifications={handleNotifOpen}
          />
          <Divider />
          {drawerContent()}
        </div>
      </Show>

      <Show when={isDesktop()}>
        <div
          id="app-navbar"
          data-testid="app-navbar"
          style={{
            display: "block",
            width: navWidth(),
            flexShrink: 0,
            transition: "width 0.2s ease-in-out",
            overflow: "hidden",
          }}
        >
          <SidebarHeader
            rail={desktopCollapsed}
            surgeTotal={surgeTotal()}
            onToggleCollapse={toggleDesktop}
            onOpenNotifications={handleNotifOpen}
          />
          <Divider />
          {drawerContent()}
        </div>
      </Show>

      <Box
        component="main"
        className="flex-1 min-w-0 min-h-0 overflow-auto bg-fin-bg flex flex-col"
        style={{
          flexGrow: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
          backgroundColor: palette.BG,
          display: "flex",
          flexDirection: "column",
        }}
        id="app-main"
        data-testid="app-main"
      >
        <Box
          className="flex-1 min-h-0 flex flex-col w-full"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            width: "100%",
            padding: 0,
            margin: 0,
          }}
        >
          {props.children}
        </Box>
      </Box>
    </Box>
  );
}
