import { NavLink, Tooltip } from "@/ui";
import { useNavigate } from "react-router-dom";

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

  const navLink = (
    <NavLink
      label={collapsed ? "" : label}
      leftSection={<Icon size={16} />}
      active={active}
      variant="light"
      color="blue"
      onClick={() => {
        navigate(link);
        onNavigate?.();
      }}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-").replace("paper-trading", "paper").replace("sector-analysis", "sector")}`}
      data-active={active || undefined}
      id={`nav-link-${label.toLowerCase().replace(/\s+/g, "-")}`}
      style={collapsed ? { justifyContent: "center" } : undefined}
    />
  );

  if (collapsed) {
    return (
      <Tooltip label={label} position="right" transitionProps={{ duration: 0 }}>
        {navLink}
      </Tooltip>
    );
  }

  return navLink;
}
