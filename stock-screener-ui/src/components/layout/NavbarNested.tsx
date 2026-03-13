import {
  IconRocket,
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
} from "@tabler/icons-react";
import { Group, ScrollArea, Text, UnstyledButton, AppShell, Flex } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { UserButton } from "./UserButton";
import classes from "./NavbarNested.module.css";

interface NavbarNestedProps {
  activePath: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const navItems = [
  { label: "Screener", icon: IconRocket, link: "/" },
  { label: "News", icon: IconNews, link: "/news" },
  { label: "Backtest", icon: IconChartLine, link: "/backtest" },
  { label: "Paper Trading", icon: IconChartDots, link: "/paper" },
  { label: "Sector Analysis", icon: IconBuildingFactory, link: "/sector" },
  { label: "Strategies", icon: IconChartBar, link: "/strategies" },
  { label: "Bots", icon: IconRobot, link: "/bots" },
  { label: "Options", icon: IconChartArea, link: "/options" },
  { label: "Settings", icon: IconSettings, link: "/settings" },
];

export function NavbarNested({ activePath, collapsed, onToggleCollapse }: NavbarNestedProps) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  const links = navItems.map((item) => (
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
      <AppShell.Section className={classes.header} id="navbar-header" data-testid="navbar-header">
        <Flex
          justify={collapsed ? "center" : "space-between"}
          align="center"
          direction={collapsed ? "column" : "row"}
          gap={collapsed ? "xs" : 0}
        >
          {!collapsed ? (
            <Text fw={700} size="lg" id="app-logo">
              🚀 Alphashri
            </Text>
          ) : (
            <Text fw={700} size="lg" id="app-logo-collapsed">
              🚀
            </Text>
          )}
          <Group gap="xs" id="navbar-controls">
            {!collapsed && (
              <UnstyledButton onClick={toggleColorScheme} data-testid="theme-toggle-btn">
                {colorScheme === "dark" ? <IconSun size={20} /> : <IconMoon size={20} />}
              </UnstyledButton>
            )}
            <UnstyledButton onClick={onToggleCollapse} data-testid="sidebar-collapse-toggle">
              {collapsed ? <IconChevronRight size={20} /> : <IconChevronLeft size={20} />}
            </UnstyledButton>
          </Group>
        </Flex>
      </AppShell.Section>

      <AppShell.Section grow component={ScrollArea} className={classes.links} id="navbar-links" data-testid="navbar-links">
        <div className={classes.linksInner}>{links}</div>
      </AppShell.Section>

      <AppShell.Section className={classes.footer} id="navbar-footer" data-testid="navbar-footer">
        <UserButton collapsed={collapsed} />
      </AppShell.Section>
    </nav>
  );
}
