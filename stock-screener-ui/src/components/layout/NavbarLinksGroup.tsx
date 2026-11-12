import { Box, Text, Tooltip } from "@/ui";
import { useNavigate } from "react-router-dom";
import * as palette from "@/ui/palette";

interface NavbarLinksGroupProps {
  icon: React.FC<any>;
  label: string;
  link: string;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function NavbarLinksGroup({
  icon: Icon,
  label,
  link,
  active,
  collapsed,
  onNavigate,
}: NavbarLinksGroupProps) {
  const navigate = useNavigate();

  const testId = `nav-${label.toLowerCase().replace(/\s+/g, "-").replace("paper-trading", "paper").replace("sector-analysis", "sector")}`;
  const navLink = (
    <Box
      role="button"
      onClick={() => {
        navigate(link);
        onNavigate?.();
      }}
      data-testid={testId}
      data-active={active || undefined}
      id={`nav-link-${label.toLowerCase().replace(/\s+/g, "-")}`}
      aria-label={label}
      title={label}
      className="flex items-center gap-2 rounded-fin px-3 py-3 min-w-0 cursor-pointer transition-colors"
      style={{
        "justify-content": collapsed ? "center" : "flex-start",
        ...(active
          ? { "background-color": "#80B5FF", color: "#1A5CD6" }
          : {}),
      }}
    >
      <Box className="flex items-center justify-center min-w-[36px]" style={{ color: active ? "#1A5CD6" : palette.TEXT_MUTED }}>
        <Icon size={16} />
      </Box>
      {!collapsed && (
        <Text size="sm" style={{ "font-size": "0.875rem", "font-weight": active ? 600 : 400 }}>
          {label}
        </Text>
      )}
    </Box>
  );

  if (collapsed) {
    return (
      <Tooltip label={label} position="right">
        {navLink}
      </Tooltip>
    );
  }

  return navLink;
}
