import {
  IconChartLine,
  IconChartDots,
  IconBuildingFactory,
  IconChartBar,
  IconRobot,
  IconChartArea,
  IconSettings,
  IconSun,
  IconMoon,
  IconNews,
  IconShield,
  IconPlayerPlay,
  IconChartCandle,
  IconAdjustments,
  IconFlask,
  IconLeaf,
  IconTrendingUp,
} from "../common/Icons";
import { For, Show, createMemo } from "solid-js";
import { Box, Group, ScrollArea, Stack, ActionIcon, Divider, useColorScheme } from "@/ui";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { UserButton } from "./UserButton";
import { useAuth } from "../auth/AuthProvider";

interface NavbarNestedProps {
  activePath: string;
  collapsed?: boolean;
  onMobileNavigate?: () => void;
}

const navItems = [
  { label: "HOME", icon: IconAdjustments, link: "/home" },
  { label: "Screener", icon: IconChartLine, link: "/screener" },
  { label: "News", icon: IconNews, link: "/news" },
  { label: "Backtest", icon: IconChartLine, link: "/backtest" },
  { label: "Experiments", icon: IconFlask, link: "/experiments" },
  { label: "Paper Trading", icon: IconChartDots, link: "/paper" },
  { label: "Replay", icon: IconPlayerPlay, link: "/replay" },
  { label: "Strategy Runner", icon: IconAdjustments, link: "/strategy-runner" },
  { label: "Sector Analysis", icon: IconBuildingFactory, link: "/sector" },
  { label: "Agri Prices", icon: IconLeaf, link: "/agri" },
  { label: "Patterns", icon: IconChartCandle, link: "/patterns" },
  { label: "Strategies", icon: IconChartBar, link: "/strategies" },
  { label: "Bots", icon: IconRobot, link: "/bots" },
  { label: "Options", icon: IconChartArea, link: "/options" },
  { label: "Index Report", icon: IconChartArea, link: "/report/index" },
  { label: "Profitability", icon: IconTrendingUp, link: "/report/profit" },
  { label: "Settings", icon: IconSettings, link: "/settings" },
  { label: "Admin", icon: IconShield, link: "/admin" },
];

export function NavbarNested(props: NavbarNestedProps) {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const auth = useAuth();

  const visibleNavItems = createMemo(() =>
    navItems.filter((item) => item.label !== "Admin" || auth.user?.is_admin),
  );

  // `/screener/<tab>` is the same rail entry: tab paths share the screener link.
  const isActive = (link: string) =>
    props.activePath === link ||
    (link === "/screener" && props.activePath.startsWith("/screener"));

  return (
    <Box data-testid="sidemenu" id="navbar-nested" className="flex flex-col flex-1 min-h-0">
      <Box className="flex-1 min-h-0 overflow-hidden" id="navbar-links" data-testid="navbar-links">
        <ScrollArea h="100%" type="scroll">
          <Stack gap={1} p={1}>
            <For each={visibleNavItems()}>
              {(item) => (
                <NavbarLinksGroup
                  icon={item.icon}
                  label={item.label}
                  link={item.link}
                  active={isActive(item.link)}
                  collapsed={props.collapsed}
                  onNavigate={props.onMobileNavigate}
                />
              )}
            </For>
          </Stack>
        </ScrollArea>
      </Box>

      <Divider />

      <Box p={1} id="navbar-footer" data-testid="navbar-footer">
        <Show
          when={props.collapsed}
          fallback={
            <Group justify="space-between" px={1}>
              <UserButton />
              <Group gap={1}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={toggleColorScheme}
                  aria-label="Toggle color scheme"
                  data-testid="theme-toggle-btn"
                >
                  <Show when={colorScheme() === "dark"} fallback={<IconMoon size={16} />}>
                    <IconSun size={16} />
                  </Show>
                </ActionIcon>
              </Group>
            </Group>
          }
        >
          {/* A 64px rail cannot hold the user row and the theme toggle side by
              side; stacking them centered keeps both inside the rail. */}
          <Stack align="center" gap={0.5}>
            <UserButton collapsed />
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={toggleColorScheme}
              aria-label="Toggle color scheme"
              data-testid="theme-toggle-btn"
            >
              <Show when={colorScheme() === "dark"} fallback={<IconMoon size={16} />}>
                <IconSun size={16} />
              </Show>
            </ActionIcon>
          </Stack>
        </Show>
      </Box>
    </Box>
  );
}
