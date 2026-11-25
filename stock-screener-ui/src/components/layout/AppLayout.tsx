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
  const navWidth = () => (desktopCollapsed() ? 48 : 148);

  // The desk dock drawer is portaled to <body>, outside #app-shell; publish the
  // nav width on the root so the bottom sheet aligns with the main column.
  createEffect(() => {
    document.documentElement.style.setProperty("--app-nav-width", `${navWidth()}px`);
    // The mobile bar already reserves the navigation gutter in flow. Publishing
    // 0px lets standalone CompactPage headers skip their fallback inset so the
    // title still lines up with the panel below it.
    document.documentElement.style.setProperty("--app-mobile-nav-gutter", "0px");
    onCleanup(() => {
      document.documentElement.style.removeProperty("--app-nav-width");
      document.documentElement.style.removeProperty("--app-mobile-nav-gutter");
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
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        "background-color": palette.BG,
      }}
      id="app-shell"
      data-testid="app-shell"
    >
      <NotificationsPanel opened={notifOpen()} onClose={handleNotifClose} />

      <Show when={!isDesktop()}>
        <div
          style={{
            display: mobileOpened() ? "flex" : "none",
            position: "fixed",
            top: "0px",
            left: "0px",
            bottom: "0px",
            width: "168px",
            "box-sizing": "border-box",
            "flex-direction": "column",
            "min-height": "0px",
            overflow: "hidden",
            "z-index": 1300,
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
            display: "flex",
            width: `${navWidth()}px`,
            "flex-direction": "column",
            "flex-shrink": "0",
            "min-height": "0px",
            transition: "width 0.2s ease-in-out",
            overflow: "hidden",
          }}
        >
          <SidebarHeader
            rail={desktopCollapsed()}
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
        className="flex-1 min-w-0 min-h-0 overflow-hidden bg-fin-bg flex flex-col"
        style={{
          "flex-grow": 1,
          "min-width": "0px",
          "min-height": "0px",
          overflow: "hidden",
          "background-color": palette.BG,
          display: "flex",
          "flex-direction": "column",
        }}
        id="app-main"
        data-testid="app-main"
      >
        {/* Below 900px the rail is a temporary drawer. Its toggle lives in a
            real 44px-tall bar pinned to the top of this scroll column instead
            of floating over the page, so every header starts underneath it and
            no title is clipped by the control (390px used to read "ptions
            replay"). The bar is sticky, so it keeps the gutter while scrolling. */}
        <Show when={!isDesktop()}>
          <div
            data-testid="app-mobile-nav-bar"
            className="sticky top-0 z-[1299] flex h-11 shrink-0 items-center bg-fin-bg px-1"
            style={{
              position: "sticky",
              top: "0px",
              "z-index": 1299,
              display: "flex",
              "align-items": "center",
              "flex-shrink": 0,
              height: "44px",
              "box-sizing": "border-box",
              "padding-left": "4px",
              "padding-right": "4px",
              "background-color": palette.BG,
            }}
          >
            <ActionIcon
              aria-label="Toggle navigation"
              onClick={toggleMobile}
              data-testid="app-mobile-nav-toggle"
              className="rounded-fin border border-fin-border"
              style={{
                display: "inline-flex",
                width: "36px",
                height: "36px",
                "background-color": palette.SURFACE,
                border: `1px solid ${palette.BORDER}`,
              }}
            >
              <IconMenu2 size={18} />
            </ActionIcon>
          </div>
        </Show>

        <Box
          className="flex-1 min-h-0 flex flex-col w-full"
          style={{
            flex: 1,
            "min-height": "0px",
            display: "flex",
            "flex-direction": "column",
            width: "100%",
            padding: "0px",
            margin: "0px",
          }}
        >
          {props.children}
        </Box>
      </Box>
    </Box>
  );
}
