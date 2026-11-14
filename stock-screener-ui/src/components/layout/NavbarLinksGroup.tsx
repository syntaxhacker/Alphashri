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
        className="flex items-center gap-1.5 rounded-fin px-1.5 py-1 min-w-0 cursor-pointer transition-colors"
        style={{
          "justify-content": collapsed() ? "center" : "flex-start",
          ...(props.active
            ? { "background-color": palette.alpha(palette.PRIMARY, 0.14), color: palette.TEXT, "box-shadow": "inset 2px 0 0 0 " + palette.PRIMARY }
            : {}),
        }}
      >
        <Box className="flex items-center justify-center min-w-[20px]" style={{ color: props.active ? palette.PRIMARY : palette.TEXT_MUTED }}>
          <IconC size={16} />
        </Box>
        <Show when={!collapsed()}>
          <Text
            size="sm"
            style={{
              "font-size": "10.5px",
              "font-family": palette.MONO,
              "letter-spacing": "0.06em",
              "text-transform": "uppercase",
              "font-weight": props.active ? 600 : 500,
              color: props.active ? palette.PRIMARY : undefined,
            }}
          >
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
