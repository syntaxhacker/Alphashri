import { Box, Text, Tooltip } from "@/ui";
import { Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as palette from "@/ui/palette";

interface NavbarLinksGroupProps {
  icon: Component<Record<string, any>>;
  label: string;
  link: string;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function NavbarLinksGroup(props: NavbarLinksGroupProps) {
  const navigate = useNavigate();
  const collapsed = () => props.collapsed ?? false;

  const testId = () => `nav-${props.label.toLowerCase().replace(/\s+/g, "-").replace("paper-trading", "paper").replace("sector-analysis", "sector")}`;
  const navLink = () => {
    const IconC = props.icon;
    return (
    <Box
      role="button"
      onClick={() => {
          navigate(props.link);
        props.onNavigate?.();
      }}
      data-testid={testId()}
      data-active={props.active || undefined}
      id={`nav-link-${props.label.toLowerCase().replace(/\s+/g, "-")}`}
      aria-label={props.label}
      title={props.label}
      className="flex items-center gap-2 rounded-fin px-3 py-3 min-w-0 cursor-pointer transition-colors"
      style={{
        justifyContent: collapsed() ? "center" : "flex-start",
        ...(props.active
          ? { backgroundColor: "#80B5FF", color: "#1A5CD6" }
          : {}),
      }}
    >
      <Box className="flex items-center justify-center min-w-[36px]" style={{ color: props.active ? "#1A5CD6" : palette.TEXT_MUTED }}>
        <IconC size={16} />
      </Box>
      <Show when={!collapsed()}>
        <Text size="sm" style={{ fontSize: "0.875rem", fontWeight: props.active ? 600 : 400 }}>
          {props.label}
        </Text>
      </Show>
    </Box>
    );
  };

  return (
    <Show when={collapsed()} fallback={navLink()}>
      <Tooltip label={props.label} position="right">
        {navLink()}
      </Tooltip>
    </Show>
  );
}
