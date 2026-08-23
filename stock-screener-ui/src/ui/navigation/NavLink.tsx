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
}: UINavLinkProps) {
  const resolvedLeftSection = leftSection ?? icon;
  const hasChildren = Boolean(children);
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpened));
  const isControlled = opened !== undefined;
  const open = isControlled ? Boolean(opened) : internalOpen;

  const handleClick = () => {
    if (hasChildren && !isControlled) setInternalOpen((v) => !v);
    onClick?.();
  };

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
        {...(rest as any)}
        sx={{ borderRadius: 1 }}
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
