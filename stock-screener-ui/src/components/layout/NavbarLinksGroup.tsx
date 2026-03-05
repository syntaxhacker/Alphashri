import { Box, Group, ThemeIcon, UnstyledButton, Text } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import classes from "./NavbarLinksGroup.module.css";

interface NavbarLinksGroupProps {
  icon: React.FC<any>;
  label: string;
  link: string;
  active: boolean;
}

export function NavbarLinksGroup({ icon: Icon, label, link, active }: NavbarLinksGroupProps) {
  const navigate = useNavigate();

  return (
    <UnstyledButton
      onClick={() => navigate(link)}
      className={classes.control}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-").replace("paper-trading", "paper").replace("sector-analysis", "sector")}`}
      data-active={active || undefined}
      style={{
        backgroundColor: active ? "var(--mantine-color-blue-light)" : undefined,
        color: active ? "var(--mantine-color-blue-filled)" : undefined,
      }}
    >
      <Group justify="space-between" gap={0}>
        <Box style={{ display: "flex", alignItems: "center" }}>
          <ThemeIcon variant="light" size={30}>
            <Icon size={18} />
          </ThemeIcon>
          <Box ml="md">
            <Text fw={active ? 600 : 500}>{label}</Text>
          </Box>
        </Box>
      </Group>
    </UnstyledButton>
  );
}
