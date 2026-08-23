import * as React from "react";
import MuiMenu from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import type { UIMenuProps, UIMenuTargetProps, UIMenuDropdownProps, UIMenuItemProps } from "../types";

type MenuContextValue = {
  anchorEl: HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
  open: boolean;
  onClose: () => void;
  onOpen: (el: HTMLElement) => void;
  closeOnItemClick?: boolean;
  position?: string;
  offset?: number;
  withArrow?: boolean;
  shadow?: string;
};

const MenuContext = React.createContext<MenuContextValue | null>(null);

function useMenuContext() {
  const ctx = React.useContext(MenuContext);
  if (!ctx) throw new Error("Menu compound components must be used within Menu");
  return ctx;
}

function positionToAnchorOrigin(pos?: string): { anchorOrigin: any; transformOrigin: any } {
  switch (pos) {
    case "top":
      return { anchorOrigin: { vertical: "top", horizontal: "center" }, transformOrigin: { vertical: "bottom", horizontal: "center" } };
    case "top-start":
      return { anchorOrigin: { vertical: "top", horizontal: "left" }, transformOrigin: { vertical: "bottom", horizontal: "left" } };
    case "top-end":
      return { anchorOrigin: { vertical: "top", horizontal: "right" }, transformOrigin: { vertical: "bottom", horizontal: "right" } };
    case "bottom-start":
      return { anchorOrigin: { vertical: "bottom", horizontal: "left" }, transformOrigin: { vertical: "top", horizontal: "left" } };
    case "bottom-end":
      return { anchorOrigin: { vertical: "bottom", horizontal: "right" }, transformOrigin: { vertical: "top", horizontal: "right" } };
    case "left":
      return { anchorOrigin: { vertical: "center", horizontal: "left" }, transformOrigin: { vertical: "center", horizontal: "right" } };
    case "right":
      return { anchorOrigin: { vertical: "center", horizontal: "right" }, transformOrigin: { vertical: "center", horizontal: "left" } };
    default:
      return { anchorOrigin: { vertical: "bottom", horizontal: "left" }, transformOrigin: { vertical: "top", horizontal: "left" } };
  }
}

export function Menu({
  trigger,
  opened,
  onChange,
  position,
  offset,
  withArrow,
  shadow,
  closeOnItemClick = true,
  closeOnClickOutside,
  loop,
  children,
  renderTarget,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UIMenuProps) {
  const [internalAnchorEl, setInternalAnchorEl] = React.useState<HTMLElement | null>(null);
  const isControlled = opened !== undefined;
  const open = isControlled ? !!opened : !!internalAnchorEl;

  const setAnchorEl = React.useCallback(
    (el: HTMLElement | null) => {
      setInternalAnchorEl(el);
      onChange?.(!!el);
    },
    [onChange]
  );

  const onClose = React.useCallback(() => {
    setInternalAnchorEl(null);
    onChange?.(false);
  }, [onChange]);

  const onOpen = React.useCallback(
    (el: HTMLElement) => {
      setInternalAnchorEl(el);
      onChange?.(true);
    },
    [onChange]
  );

  React.useEffect(() => {
    if (isControlled && !opened) setInternalAnchorEl(null);
  }, [isControlled, opened]);

  const ctxValue: MenuContextValue = {
    anchorEl: internalAnchorEl,
    setAnchorEl,
    open,
    onClose,
    onOpen,
    closeOnItemClick,
    position,
    offset,
    withArrow,
    shadow,
  };

  // trigger handling: hover vs click is delegated to MenuTarget; but if hover trigger, we need onMouseEnter logic
  const isHover = trigger === "hover" || trigger === "click-hover";

  return (
    <MenuContext.Provider value={ctxValue}>
      <Box
        className={className}
        style={style}
        data-testid={testId}
        sx={{ display: "inline-block" }}
        {...(rest as any)}
        {...(isHover
          ? {
              onMouseEnter: (e: React.MouseEvent) => {
                // set anchor on hover if not already open
              },
            }
          : {})}
      >
        {typeof children === "function" ? (children as any)({ open, close: onClose }) : children}
      </Box>
    </MenuContext.Provider>
  );
}

export function MenuTarget({ children, className, style, "data-testid": testId, ...rest }: UIMenuTargetProps) {
  const { setAnchorEl, anchorEl, open, onClose } = useMenuContext();
  const child = React.Children.only(children as React.ReactElement<any>);
  const handleClick = (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (open && anchorEl === target) {
      onClose();
    } else {
      setAnchorEl(target);
    }
    (child.props as any)?.onClick?.(e);
  };
  const handleMouseEnter = (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (!open) setAnchorEl(target);
    (child.props as any)?.onMouseEnter?.(e);
  };
  // Detect if parent Menu has hover trigger by checking if child wants hover - we always provide both
  return React.cloneElement(child, {
    onClick: handleClick,
    onMouseEnter: handleMouseEnter,
    className: [className, (child.props as any).className].filter(Boolean).join(" ") || undefined,
    style: { ...style, ...(child.props as any).style },
  } as any);
}

export function MenuDropdown({ children, className, style, "data-testid": testId, ...rest }: UIMenuDropdownProps) {
  const { anchorEl, open, onClose, position, offset, shadow } = useMenuContext();
  const { anchorOrigin, transformOrigin } = positionToAnchorOrigin(position);
  return (
    <MuiMenu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        paper: {
          className,
          style: style as any,
          sx: {
            ...(shadow ? { boxShadow: shadow } : {}),
            ...(offset != null ? { mt: `${offset / 8}px` } : {}),
            minWidth: 160,
          },
        },
      }}
      data-testid={testId}
      {...(rest as any)}
    >
      <Box sx={{ py: 0.5 }}>{children}</Box>
    </MuiMenu>
  );
}

export function MenuItem({ leftSection, rightSection, color, disabled, onClick, children, className, style, "data-testid": testId, ...rest }: UIMenuItemProps) {
  const { onClose, closeOnItemClick } = useMenuContext();
  const handleClick = (e: React.MouseEvent) => {
    onClick?.();
    if (closeOnItemClick) onClose();
  };
  return (
    <MuiMenuItem
      disabled={!!disabled}
      onClick={handleClick as any}
      className={className}
      style={style}
      data-testid={testId}
      sx={{
        fontSize: 14,
        gap: 1,
        ...(color ? { color: color as string } : {}),
      }}
      {...(rest as any)}
    >
      {leftSection ? <Box component="span" sx={{ display: "inline-flex", mr: 0.5 }}>{leftSection}</Box> : null}
      <Box component="span" sx={{ flex: 1 }}>{children}</Box>
      {rightSection ? <Box component="span" sx={{ display: "inline-flex", ml: 0.5 }}>{rightSection}</Box> : null}
    </MuiMenuItem>
  );
}

function MenuDivider(props: any) {
  return <Divider {...props} />;
}
function MenuLabel({ children, ...rest }: any) {
  return (
    <Box component="div" sx={{ px: 2, py: 0.5, fontSize: 11, fontWeight: 600, color: "text.secondary", textTransform: "uppercase" }} {...rest}>
      {children}
    </Box>
  );
}

Menu.Target = MenuTarget;
Menu.Dropdown = MenuDropdown;
Menu.Item = MenuItem;
Menu.Divider = MenuDivider as any;
Menu.Label = MenuLabel as any;
