import { createContext, createEffect, createMemo, Show, splitProps, useContext } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UIMenuProps, UIMenuTargetProps, UIMenuDropdownProps, UIMenuItemProps } from "../types";

type MenuContextValue = {
  anchorEl: () => HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
  open: () => boolean;
  onClose: () => void;
  onOpen: (el: HTMLElement) => void;
  closeOnItemClick?: boolean;
  closeOnClickOutside?: boolean;
  position: () => string | undefined;
  offset: () => number | undefined;
  withArrow: () => boolean | undefined;
  shadow: () => string | undefined;
  trigger: () => string | undefined;
  registerDropdownEl: (el: HTMLElement | null) => void;
};

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("Menu compound components must be used within Menu");
  return ctx;
}

const DEFAULT_SHADOW = palette.DIALOG_SHADOW;

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

export function Menu(props: UIMenuProps) {
  const [known, rest] = splitProps(props, [
    "trigger",
    "opened",
    "onChange",
    "position",
    "offset",
    "withArrow",
    "shadow",
    "closeOnItemClick",
    "closeOnClickOutside",
    "_loop",
    "children",
    "_renderTarget",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  const internalAnchorEl = createSignal<HTMLElement | null>(null);
  const [setInternalAnchorEl] = internalAnchorEl;
  const dropdownElRef = createSignal<HTMLElement | null>(null);
  const [setDropdownEl] = dropdownElRef;

  const isControlled = createMemo(() => known.opened !== undefined);
  const open = createMemo(() => (isControlled() ? !!known.opened : !!internalAnchorEl()));

  const setAnchorEl = (el: HTMLElement | null) => {
    setInternalAnchorEl(el);
    known.onChange?.(!!el);
  };

  const onClose = () => {
    setInternalAnchorEl(null);
    known.onChange?.(false);
  };

  const onOpen = (el: HTMLElement) => {
    setInternalAnchorEl(el);
    known.onChange?.(true);
  };

  createEffect(() => {
    if (isControlled() && !known.opened) setInternalAnchorEl(null);
  });

  const registerDropdownEl = (el: HTMLElement | null) => {
    setDropdownEl(el);
  };

  createEffect(() => {
    if (!open() || !known.closeOnClickOutside) return;
    const handleMousedown = (e: MouseEvent) => {
      const target = e.target as Node;
      const anchor = internalAnchorEl();
      const dropdown = dropdownElRef();
      if (anchor && !anchor.contains(target) && (!dropdown || !dropdown.contains(target))) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  });

  createEffect(() => {
    if (!open()) return;
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  });

  const ctxValue: MenuContextValue = {
    anchorEl: internalAnchorEl,
    setAnchorEl,
    open,
    onClose,
    onOpen,
    closeOnItemClick: known.closeOnItemClick,
    closeOnClickOutside: known.closeOnClickOutside,
    position: () => known.position,
    offset: () => known.offset,
    withArrow: () => known.withArrow,
    shadow: () => known.shadow,
    trigger: () => known.trigger,
    registerDropdownEl,
  };

  const children = known.children;
  return (
    <MenuContext.Provider value={ctxValue}>
      <div
        id={known.id}
        className={cn("ui-menu", "inline-block", known.className)}
        style={known.style as Record<string, string | undefined>}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
      >
        <Show when={typeof children === "function"}>
          {(children as (payload: { open: boolean; close: () => void }) => JSX.Element)({
            open: open(),
            close: onClose,
          })}
        </Show>
        <Show when={typeof children !== "function"}>{children}</Show>
      </div>
    </MenuContext.Provider>
  );
}

export function MenuTarget(props: UIMenuTargetProps) {
  const [known, rest] = splitProps(props, [
    "children",
    "className",
    "style",
    "id",
    "data-testid",
    "onClick",
    "onMouseEnter",
  ]);
  const { setAnchorEl, anchorEl, open, onClose, trigger } = useMenuContext();
  const isHover = createMemo(() => trigger() === "hover" || trigger() === "click-hover");

  const handleClick = (e: MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (open() && anchorEl() === target) {
      onClose();
    } else {
      setAnchorEl(target);
    }
    known.onClick?.(e);
  };

  const handleMouseEnter = (e: MouseEvent) => {
    if (isHover()) {
      if (!open()) setAnchorEl(e.currentTarget as HTMLElement);
    }
    known.onMouseEnter?.(e);
  };

  return (
    <span
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn(known.className)}
      style={known.style as Record<string, string | undefined>}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      {...(rest as Record<string, unknown>)}
    >
      {known.children}
    </span>
  );
}

export function MenuDropdown(props: UIMenuDropdownProps) {
  const [known, rest] = splitProps(props, ["children", "className", "style", "id", "data-testid"]);
  const { anchorEl, open, position, offset, shadow, withArrow, registerDropdownEl } = useMenuContext();
  const [placeEl, setPlaceEl] = createSignal<HTMLElement | null>(null);

  const posStyle = createMemo(() => {
    if (!anchorEl()) return {};
    return menuPosition(anchorEl(), position(), offset() ?? 0);
  });

  return (
    <Show when={open()}>
      <div
        id={known.id}
        ref={(el) => setPlaceEl(el)}
        role="menu"
        className={cn(
          "ui-menu-dropdown",
          "fixed z-[100] min-w-[160px] bg-fin-surface border border-fin-border rounded-fin text-fin-text text-[14px] py-[4px] outline-none",
          withArrow() ? "with-arrow" : "",
          known.className,
        )}
        style={{
          ...posStyle(),
          boxShadow: shadow() ?? DEFAULT_SHADOW,
          ...(known.style as Record<string, string | undefined>),
        }}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
      >
        <Show when={withArrow()}>
          <div
            className="ui-menu-arrow absolute -top-[7px] left-3 w-[12px] h-[12px] bg-fin-surface border-t border-fin-border border-l border-fin-border rotate-45"
            aria-hidden="true"
          />
        </Show>
        <div className="ui-menu-dropdown-inner">{known.children}</div>
      </div>
    </Show>
  );
}

export function MenuItem(props: UIMenuItemProps) {
  const [known, rest] = splitProps(props, [
    "leftSection",
    "rightSection",
    "color",
    "disabled",
    "onClick",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
  ]);
  const { onClose, closeOnItemClick } = useMenuContext();

  const tone = createMemo(() => {
    switch (known.color) {
      case "success": return "fin-positive";
      case "error":
      case "danger": return "fin-negative";
      case "warning": return "fin-warning";
      case "info": return "fin-info";
      case "secondary": return "fin-text-muted";
      case "primary":
      default: return "fin-primary";
    }
  });

  const handleClick = (e: MouseEvent) => {
    if (known.disabled) return;
    known.onClick?.();
    if (closeOnItemClick) onClose();
  };

  const cls = createMemo(() =>
    cn(
      "ui-menu-item",
      "flex w-full items-center gap-2 rounded-[4px] px-3 py-[6px] text-left text-[14px] border-none bg-transparent outline-none text-fin-text",
      known.disabled
        ? "text-fin-text-muted opacity-60 cursor-default"
        : "cursor-pointer hover:bg-fin-surface-alt",
      `text-${tone()}`,
      known.className,
    ),
  );

  return (
    <button
      type="button"
      role="menuitem"
      id={known.id}
      aria-disabled={known.disabled || undefined}
      disabled={known.disabled}
      className={cls()}
      style={known.style as Record<string, string | undefined>}
      data-testid={known["data-testid"]}
      onClick={handleClick}
      {...(rest as Record<string, unknown>)}
    >
      <Show when={known.leftSection}>
        <span className="ui-menu-item-section shrink-0">{known.leftSection}</span>
      </Show>
      <span className="flex-1 min-w-0 truncate">{known.children}</span>
      <Show when={known.rightSection}>
        <span className="ui-menu-item-section shrink-0">{known.rightSection}</span>
      </Show>
    </button>
  );
}

function MenuDivider({ className, style, "data-testid": testId, ...props }: any) {
  return (
    <hr
      role="separator"
      className={cn("ui-menu-divider", "border-0 border-t border-fin-border mx-3 my-[4px]", className)}
      style={style}
      data-testid={testId}
      {...props}
    />
  );
}

function MenuLabel({ children, className, style, ...rest }: any) {
  return (
    <div
      className={cn("ui-menu-label", "px-3 py-[4px] text-[11px] font-semibold uppercase text-fin-text-muted", className)}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

Menu.Target = MenuTarget;
Menu.Dropdown = MenuDropdown;
Menu.Item = MenuItem;
Menu.Divider = MenuDivider as any;
Menu.Label = MenuLabel as any;
