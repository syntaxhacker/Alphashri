import * as React from "react";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UIMenuProps, UIMenuTargetProps, UIMenuDropdownProps, UIMenuItemProps } from "../types";

type MenuContextValue = {
  anchorEl: HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
  open: boolean;
  onClose: () => void;
  onOpen: (el: HTMLElement) => void;
  closeOnItemClick?: boolean;
  closeOnClickOutside?: boolean;
  position?: string;
  offset?: number;
  withArrow?: boolean;
  shadow?: string;
  trigger?: string;
  registerDropdownEl: (el: HTMLElement | null) => void;
};

const MenuContext = React.createContext<MenuContextValue | null>(null);

function useMenuContext() {
  const ctx = React.useContext(MenuContext);
  if (!ctx) throw new Error("Menu compound components must be used within Menu");
  return ctx;
}

const DEFAULT_SHADOW = palette.DIALOG_SHADOW;

// Best-effort fixed-position placement of the dropdown relative to the anchor
// element's viewport rect. Uses `bottom:` for above-anchor positions so the
// dropdown height never needs to be measured.
function menuPosition(anchorEl: HTMLElement, position?: string, offset = 0): { top?: string; left?: string; right?: string; bottom?: string; transform?: string } {
  const rect = anchorEl.getBoundingClientRect();
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const pos = position ?? "bottom-start";
  const style: { top?: string; left?: string; right?: string; bottom?: string; transform?: string } = {};

  const centerX = `${rect.left + rect.width / 2}px`;
  const aboveBottom = `${vpH - rect.top}px`;

  switch (pos) {
    case "top":
      style.bottom = aboveBottom;
      style.left = centerX;
      style.transform = "translateX(-50%)";
      break;
    case "top-start":
      style.bottom = aboveBottom;
      style.left = `${rect.left}px`;
      break;
    case "top-end":
      style.bottom = aboveBottom;
      style.right = `${vpW - rect.right}px`;
      break;
    case "bottom-end":
      style.top = `${rect.bottom + offset}px`;
      style.right = `${vpW - rect.right}px`;
      break;
    case "left":
      style.right = `${vpW - rect.left}px`;
      style.top = `${rect.top}px`;
      break;
    case "right":
      style.left = `${rect.right + offset}px`;
      style.top = `${rect.top}px`;
      break;
    case "bottom":
    default:
      style.top = `${rect.bottom + offset}px`;
      style.left = centerX;
      style.transform = "translateX(-50%)";
      break;
  }
  return style;
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
  closeOnClickOutside = true,
  _loop,
  children,
  _renderTarget,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UIMenuProps) {
  const [internalAnchorEl, setInternalAnchorEl] = React.useState<HTMLElement | null>(null);
  const dropdownElRef = React.useRef<HTMLElement | null>(null);
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

  const registerDropdownEl = React.useCallback((el: HTMLElement | null) => {
    dropdownElRef.current = el;
  }, []);

  // Click outside closes the menu.
  React.useEffect(() => {
    if (!open || !closeOnClickOutside) return;
    const handleMousedown = (e: MouseEvent) => {
      const target = e.target as Node;
      const anchor = internalAnchorEl;
      const dropdown = dropdownElRef.current;
      if (anchor && !anchor.contains(target) && (!dropdown || !dropdown.contains(target))) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  }, [open, closeOnClickOutside, internalAnchorEl, onClose]);

  // Escape closes the menu.
  React.useEffect(() => {
    if (!open) return;
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open, onClose]);

  const ctxValue: MenuContextValue = {
    anchorEl: internalAnchorEl,
    setAnchorEl,
    open,
    onClose,
    onOpen,
    closeOnItemClick,
    closeOnClickOutside,
    position,
    offset,
    withArrow,
    shadow,
    trigger,
    registerDropdownEl,
  };

  return (
    <MenuContext.Provider value={ctxValue}>
      <div id={id} className={cn("ui-menu", "inline-block", className)} style={style} data-testid={testId} {...(rest as any)}>
        {typeof children === "function" ? (children as any)({ open, close: onClose }) : children}
      </div>
    </MenuContext.Provider>
  );
}

export function MenuTarget({ children, className, style, id }: UIMenuTargetProps) {
  const { setAnchorEl, anchorEl, open, onClose, trigger } = useMenuContext();
  const child = React.Children.only(children as React.ReactElement<any>);
  const isHover = trigger === "hover" || trigger === "click-hover";

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
    if (isHover) {
      const target = e.currentTarget as HTMLElement;
      if (!open) setAnchorEl(target);
    }
    (child.props as any)?.onMouseEnter?.(e);
  };

  return React.cloneElement(child, {
    id,
    onClick: handleClick,
    onMouseEnter: handleMouseEnter,
    className: cn(className, (child.props as any).className),
    style: { ...style, ...(child.props as any).style },
  } as any);
}

export function MenuDropdown({ children, className, style, id, "data-testid": testId, ...rest }: UIMenuDropdownProps) {
  const { anchorEl, open, position, offset, shadow, withArrow, registerDropdownEl } = useMenuContext();

  if (!open || !anchorEl) return null;

  const posStyle = menuPosition(anchorEl, position, offset ?? 0);
  const boxShadow = shadow ?? DEFAULT_SHADOW;

  return (
    <div
      id={id}
      ref={registerDropdownEl}
      role="menu"
      className={cn(
        "ui-menu-dropdown",
        "fixed z-[100] min-w-[160px] bg-fin-surface border border-fin-border rounded-fin text-fin-text text-[14px] py-[4px] outline-none",
        withArrow ? "with-arrow" : "",
        className,
      )}
      style={{ ...posStyle, boxShadow, ...(style as any) }}
      data-testid={testId}
      {...(rest as any)}
    >
      {withArrow && (
        <div
          className="ui-menu-arrow absolute -top-[7px] left-3 w-[12px] h-[12px] bg-fin-surface border-t border-fin-border border-l border-fin-border rotate-45"
          aria-hidden="true"
        />
      )}
      <div className="ui-menu-dropdown-inner">{children}</div>
    </div>
  );
}

export function MenuItem({ leftSection, rightSection, color, disabled, onClick, children, className, style, id, "data-testid": testId, ...rest }: UIMenuItemProps) {
  const { onClose, closeOnItemClick } = useMenuContext();
  const tone = (() => {
    switch (color) {
      case "success": return "fin-positive";
      case "error":
      case "danger": return "fin-negative";
      case "warning": return "fin-warning";
      case "info": return "fin-info";
      case "secondary": return "fin-text-muted";
      case "primary":
      default: return "fin-primary";
    }
  })();

  const handleClick = (_e: React.MouseEvent) => {
    if (disabled) return;
    onClick?.();
    if (closeOnItemClick) onClose();
  };

  const cls = cn(
    "ui-menu-item",
    "flex w-full items-center gap-2 rounded-[4px] px-3 py-[6px] text-left text-[14px] border-none bg-transparent outline-none text-fin-text",
    disabled ? "text-fin-text-muted opacity-60 cursor-default" : "cursor-pointer hover:bg-fin-surface-alt",
    `text-${tone}`,
    className,
  );

  return (
    <button
      type="button"
      role="menuitem"
      id={id}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={cls}
      style={style}
      data-testid={testId}
      onClick={handleClick}
      {...(rest as any)}
    >
      {leftSection ? <span className="ui-menu-item-section shrink-0">{leftSection}</span> : null}
      <span className="flex-1 min-w-0 truncate">{children}</span>
      {rightSection ? <span className="ui-menu-item-section shrink-0">{rightSection}</span> : null}
    </button>
  );
}

function MenuDivider({ className, style, "data-testid": testId, ...props }: any) {
  return (
    <hr role="separator" className={cn("ui-menu-divider", "border-0 border-t border-fin-border mx-3 my-[4px]", className)} style={style} data-testid={testId} {...props} />
  );
}

function MenuLabel({ children, className, style, ...rest }: any) {
  return (
    <div className={cn("ui-menu-label", "px-3 py-[4px] text-[11px] font-semibold uppercase text-fin-text-muted", className)} style={style} {...rest}>
      {children}
    </div>
  );
}

Menu.Target = MenuTarget;
Menu.Dropdown = MenuDropdown;
Menu.Item = MenuItem;
Menu.Divider = MenuDivider as any;
Menu.Label = MenuLabel as any;
