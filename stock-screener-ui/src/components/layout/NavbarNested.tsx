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
  IconChevronLeft,
  IconChevronRight,
  IconNews,
  IconShield,
} from "@tabler/icons-react";
import { Box, Group, ScrollArea, UnstyledButton, AppShell } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { UserButton } from "./UserButton";
import { useAuth } from "../auth/AuthProvider2";
import classes from "./NavbarNested.module.css";

interface NavbarNestedProps {
  activePath: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const navItems = [
  { label: "Screener", icon: IconChartLine, link: "/" },
  { label: "News", icon: IconNews, link: "/news" },
  { label: "Backtest", icon: IconChartLine, link: "/backtest" },
  { label: "Paper Trading", icon: IconChartDots, link: "/paper" },
  { label: "Sector Analysis", icon: IconBuildingFactory, link: "/sector" },
  { label: "Strategies", icon: IconChartBar, link: "/strategies" },
  { label: "Bots", icon: IconRobot, link: "/bots" },
  { label: "Options", icon: IconChartArea, link: "/options" },
  { label: "Settings", icon: IconSettings, link: "/settings" },
  { label: "Admin", icon: IconShield, link: "/admin" },
];

export function NavbarNested({ activePath, collapsed, onToggleCollapse }: NavbarNestedProps) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { user } = useAuth();

  const visibleNavItems = navItems.filter((item) => item.label !== "Admin" || user?.is_admin);

  const links = visibleNavItems.map((item) => (
    <NavbarLinksGroup
      key={item.label}
      icon={item.icon}
      label={item.label}
      link={item.link}
      active={activePath === item.link}
      collapsed={collapsed}
      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
    />
  ));

  return (
    <nav className={classes.navbar} data-testid="sidemenu" id="navbar-nested">
      <AppShell.Section
        grow
        component={ScrollArea}
        className={classes.links}
        id="navbar-links"
        data-testid="navbar-links"
      >
        <Box className={classes.linksInner}>{links}</Box>
      </AppShell.Section>

      <AppShell.Section className={classes.footer} id="navbar-footer" data-testid="navbar-footer">
        <Group justify="center" gap="xs">
          <UnstyledButton onClick={toggleColorScheme} data-testid="theme-toggle-btn">
            {colorScheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
          </UnstyledButton>
          <UnstyledButton onClick={onToggleCollapse} data-testid="sidebar-collapse-toggle">
            {collapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
          </UnstyledButton>
        </Group>
        <UserButton collapsed={collapsed} />
      </AppShell.Section>
    </nav>
  );
}
