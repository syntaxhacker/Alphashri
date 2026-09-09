import { Tooltip } from "@/ui";
import { useNavigate } from "react-router-dom";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";

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
    <ListItemButton
      selected={active}
      onClick={() => {
        navigate(link);
        onNavigate?.();
      }}
      data-testid={testId}
      data-active={active || undefined}
      id={`nav-link-${label.toLowerCase().replace(/\s+/g, "-")}`}
      sx={{
        borderRadius: 1,
        justifyContent: collapsed ? "center" : "flex-start",
        py: 0.75,
        ...(active ? { bgcolor: "primary.light", color: "primary.dark", "& .MuiListItemIcon-root": { color: "primary.dark" } } : {}),
      }}
    >
      <ListItemIcon sx={{ minWidth: 36, justifyContent: collapsed ? "center" : "flex-start", color: active ? "primary.dark" : "text.secondary" }}>
        <Icon size={16} />
      </ListItemIcon>
      {!collapsed && <ListItemText primary={label} primaryTypographyProps={{ fontSize: "0.875rem", fontWeight: active ? 600 : 400 }} />}
    </ListItemButton>
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
