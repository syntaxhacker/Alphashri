import { useState } from "react";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Collapse from "@mui/material/Collapse";
import type { UINavLinkProps } from "../types";

export function NavLink({
  label,
  description,
  icon,
  leftSection,
  rightSection,
  href,
  active,
  disabled,
  variant: _variant,
  defaultOpened,
  opened,
  onClick,
  children,
  autoContrast: _autoContrast,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UINavLinkProps & { sx?: unknown }) {
  const resolvedLeftSection = leftSection ?? icon;
  const hasChildren = Boolean(children);
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpened));
  const isControlled = opened !== undefined;
  const open = isControlled ? Boolean(opened) : internalOpen;

  const handleClick = () => {
    if (hasChildren && !isControlled) setInternalOpen((v) => !v);
    onClick?.();
  };

  const { sx: sxProp, ...restWithoutSx } = rest as { sx?: unknown } & Record<string, unknown>;
  return (
    <>
      <ListItemButton
        selected={Boolean(active)}
        disabled={Boolean(disabled)}
        component={href ? "a" : "div"}
        href={href as any}
        onClick={handleClick}
        className={className}
        style={style}
        data-testid={testId}
        {...(restWithoutSx as any)}
        sx={[
          {
            borderRadius: 1,
            "&.Mui-selected": {
              bgcolor: "primary.main",
              color: "primary.contrastText",
              "&:hover": { bgcolor: "primary.dark" },
            },
            "&.Mui-selected .MuiListItemText-primary": { color: "primary.contrastText" },
            "&.Mui-selected .MuiListItemText-secondary": { color: "primary.contrastText" },
          },
          sxProp as never,
        ]}
      >
        {resolvedLeftSection ? <ListItemIcon sx={{ minWidth: 36 }}>{resolvedLeftSection}</ListItemIcon> : null}
        <ListItemText primary={label} secondary={description} />
        {rightSection ?? null}
      </ListItemButton>
      {hasChildren ? (
        <Collapse in={open} timeout="auto" unmountOnExit>
          {children}
        </Collapse>
      ) : null}
    </>
  );
}
