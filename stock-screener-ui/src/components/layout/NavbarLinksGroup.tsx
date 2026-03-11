import { Box, Group, ThemeIcon, UnstyledButton, Text, Tooltip } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import classes from "./NavbarLinksGroup.module.css";

interface NavbarLinksGroupProps {
  icon: React.FC<any>;
  label: string;
  link: string;
  active: boolean;
  collapsed?: boolean;
}

export function NavbarLinksGroup({
  icon: Icon,
  label,
  link,
  active,
  collapsed,
}: NavbarLinksGroupProps) {
  const navigate = useNavigate();

  const content = (
    <UnstyledButton
      onClick={() => navigate(link)}
      className={classes.control}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-").replace("paper-trading", "paper").replace("sector-analysis", "sector")}`}
      data-active={active || undefined}
      style={{
        backgroundColor: active ? "var(--mantine-color-blue-light)" : undefined,
        color: active ? "var(--mantine-color-blue-filled)" : undefined,
        justifyContent: collapsed ? "center" : "flex-start",
        padding: collapsed
          ? "var(--mantine-spacing-xs)"
          : "var(--mantine-spacing-xs) var(--mantine-spacing-md)",
      }}
    >
      <Group justify={collapsed ? "center" : "space-between"} gap={0}>
        <Box style={{ display: "flex", alignItems: "center" }}>
          <ThemeIcon variant="light" size={30}>
            <Icon size={18} />
          </ThemeIcon>
          {!collapsed && (
            <Box ml="md">
              <Text fw={active ? 600 : 500}>{label}</Text>
            </Box>
          )}
        </Box>
      </Group>
    </UnstyledButton>
  );

  if (collapsed) {
    return (
      <Tooltip label={label} position="right" transitionProps={{ duration: 0 }}>
        {content}
      </Tooltip>
    );
  }

  return content;
}
