import { useLocation } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useDisclosure } from "@/ui/hooks";
import { Box, Divider, ActionIcon } from "@/ui";
import * as palette from "@/ui/palette";
import { useMediaQuery } from "@/ui/hooks";
import { IconMenu2 } from "@tabler/icons-react";
import { NavbarNested } from "./NavbarNested";
import { SidebarHeader } from "./SidebarHeader";
import { NotificationsPanel, useSurgeAlertTotal } from "../notifications/NotificationsPanel";

interface AppLayoutProps {
  children: React.ReactNode;
}

const MD_BREAKPOINT = "(min-width: 900px)";

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [desktopCollapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  // Only one navigation tree is mounted at a time: the hidden permanent drawer
  // used to keep all 19 links (and the news poller) alive on phones.
  const isDesktop = useMediaQuery(MD_BREAKPOINT, undefined, { noSsr: true });
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifRefreshKey, setNotifRefreshKey] = useState(0);
  const surgeTotal = useSurgeAlertTotal(notifRefreshKey);
  const navWidth = desktopCollapsed ? 64 : 200;

  // The desk dock drawer is portaled to <body>, outside #app-shell; publish the
  // nav width on the root so the bottom sheet aligns with the main column.
  useEffect(() => {
    document.documentElement.style.setProperty("--app-nav-width", `${navWidth}px`);
    return () => {
      document.documentElement.style.removeProperty("--app-nav-width");
    };
  }, [navWidth]);

  const handleNotifOpen = useCallback(() => setNotifOpen(true), []);
  const handleNotifClose = useCallback(() => {
    setNotifOpen(false);
    setNotifRefreshKey((key) => key + 1);
  }, []);

  const drawerContent = (
    <NavbarNested
      activePath={location.pathname}
      collapsed={desktopCollapsed}
      onMobileNavigate={closeMobile}
    />
  );

  return (
    <Box
      className="flex h-screen overflow-hidden bg-fin-bg"
      style={{ display: "flex", height: "100vh", overflow: "hidden", "background-color": palette.BG }}
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
          display: isDesktop ? "none" : "inline-flex",
          position: "fixed",
          top: 8,
          left: 8,
          "z-index": 1299,
          width: 36,
          height: 36,
          "background-color": palette.SURFACE,
          border: `1px solid ${palette.BORDER}`,
          "box-shadow": "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        }}
      >
        <IconMenu2 size={18} />
      </ActionIcon>

      <NotificationsPanel opened={notifOpen} onClose={handleNotifClose} />

      {!isDesktop ? (
        <div
          style={{
            display: mobileOpened ? "block" : "none",
            position: "fixed",
            top: 0,
            left: 0,
            bottom: 0,
            width: 220,
            boxSizing: "border-box",
            "z-index": 1300,
          }}
        >
          <SidebarHeader
            mobile
            surgeTotal={surgeTotal}
            onToggleCollapse={toggleDesktop}
            onOpenNotifications={handleNotifOpen}
          />
          <Divider />
          {drawerContent}
        </div>
      ) : null}

      {isDesktop ? (
        <div
          id="app-navbar"
          data-testid="app-navbar"
          style={{
            display: "block",
            width: navWidth,
            "flex-shrink": 0,
            transition: "width 0.2s ease-in-out",
            overflow: "hidden",
          }}
        >
          <SidebarHeader
            rail={desktopCollapsed}
            surgeTotal={surgeTotal}
            onToggleCollapse={toggleDesktop}
            onOpenNotifications={handleNotifOpen}
          />
          <Divider />
          {drawerContent}
        </div>
      ) : null}

      <Box
        component="main"
        className="flex-1 min-w-0 min-h-0 overflow-auto bg-fin-bg flex flex-col"
        style={{
          "flex-grow": 1,
          "min-width": 0,
          "min-height": 0,
          overflow: "auto",
          "background-color": palette.BG,
          display: "flex",
          "flex-direction": "column",
        }}
        id="app-main"
        data-testid="app-main"
      >
        <Box
          className="flex-1 min-h-0 flex flex-col w-full"
          style={{
            flex: 1,
            "min-height": 0,
            display: "flex",
            "flex-direction": "column",
            width: "100%",
            padding: 0,
            margin: 0,
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
