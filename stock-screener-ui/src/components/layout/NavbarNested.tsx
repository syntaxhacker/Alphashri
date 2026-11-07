import { memo } from "react";
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
  IconLayoutGrid,
  IconChartCandle,
  IconAdjustments,
  IconFlask,
  IconReportAnalytics,
  IconLeaf,
} from "@tabler/icons-react";
import { Box, Group, ScrollArea, Stack, ActionIcon, Divider, useColorScheme } from "@/ui";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { UserButton } from "./UserButton";
import { useAuth } from "../auth/AuthProvider2";

interface NavbarNestedProps {
  activePath: string;
  collapsed?: boolean;
  onMobileNavigate?: () => void;
}

const navItems = [
  { label: "Screener", icon: IconChartLine, link: "/" },
  { label: "News", icon: IconNews, link: "/news" },
  { label: "Backtest", icon: IconChartLine, link: "/backtest" },
  { label: "Experiments", icon: IconFlask, link: "/experiments" },
  { label: "Paper Trading", icon: IconChartDots, link: "/paper" },
  { label: "Replay", icon: IconPlayerPlay, link: "/replay" },
  { label: "Strategy Runner", icon: IconAdjustments, link: "/strategy-runner" },
  { label: "Sector Analysis", icon: IconBuildingFactory, link: "/sector" },
  { label: "Agri Prices", icon: IconLeaf, link: "/agri" },
  { label: "Heatmap", icon: IconLayoutGrid, link: "/heatmap" },
  { label: "Order Flow", icon: IconChartCandle, link: "/orderflow" },
  { label: "Patterns", icon: IconChartCandle, link: "/patterns" },
  { label: "Reports", icon: IconReportAnalytics, link: "/report" },
  { label: "Strategies", icon: IconChartBar, link: "/strategies" },
  { label: "Bots", icon: IconRobot, link: "/bots" },
  { label: "Options", icon: IconChartArea, link: "/options" },
  { label: "Index Report", icon: IconChartArea, link: "/report/index" },
  { label: "US Report", icon: IconChartLine, link: "/report/us" },
  { label: "Settings", icon: IconSettings, link: "/settings" },
  { label: "Admin", icon: IconShield, link: "/admin" },
];

export const NavbarNested = memo(function NavbarNested({
  activePath,
  collapsed,
  onMobileNavigate,
}: NavbarNestedProps) {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const { user } = useAuth();

  const visibleNavItems = navItems.filter((item) => item.label !== "Admin" || user?.is_admin);

  const themeToggle = (
    <ActionIcon
      variant="subtle"
      size="sm"
      onClick={toggleColorScheme}
      aria-label="Toggle color scheme"
      data-testid="theme-toggle-btn"
    >
      {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
    </ActionIcon>
  );

  const links = visibleNavItems.map((item) => (
    <NavbarLinksGroup
      key={item.label}
      icon={item.icon}
      label={item.label}
      link={item.link}
      active={activePath === item.link}
      collapsed={collapsed}
      onNavigate={onMobileNavigate}
    />
  ));

  return (
    <Box data-testid="sidemenu" id="navbar-nested" sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "hidden" }} id="navbar-links" data-testid="navbar-links">
        <ScrollArea h="100%" type="scroll">
          <Stack gap={1} p={1}>
            {links}
          </Stack>
        </ScrollArea>
      </Box>

      <Divider />

      <Box p={1} id="navbar-footer" data-testid="navbar-footer">
        {collapsed ? (
          // A 64px rail cannot hold the user row and the theme toggle side by
          // side; stacking them centered keeps both inside the rail.
          <Stack align="center" gap={0.5}>
            <UserButton collapsed />
            {themeToggle}
          </Stack>
        ) : (
          <Group justify="space-between" px={1}>
            <UserButton />
            <Group gap={1}>{themeToggle}</Group>
          </Group>
        )}
      </Box>
    </Box>
  );
});
