import { createContext, createEffect, createMemo, createSignal, createUniqueId, onCleanup, Show, splitProps, untrack, useContext } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UIMenuProps, UIMenuTargetProps, UIMenuDropdownProps, UIMenuItemProps } from "../types";

type MenuContextValue = {
  anchorEl: () => HTMLElement | null;
  /** Fallback anchor when a menu is opened programmatically (no target click). */
  containerEl: () => HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
  open: () => boolean;
  onClose: () => void;
  onOpen: (el: HTMLElement) => void;
  closeOnItemClick?: boolean;
  position: () => string | undefined;
  offset: () => number | undefined;
  withArrow: () => boolean | undefined;
  shadow: () => string | undefined;
  trigger: () => string | undefined;
  /** Id of the live dropdown, shared with the target for `aria-controls`. */
  dropdownId: () => string;
  setDropdownId: (id: string) => void;
  registerDropdownEl: (el: HTMLElement | null) => void;
  unregisterDropdownEl: (el: HTMLElement | null) => void;
  /** Live, enabled menu items in DOM order — the source of truth for arrow navigation. */
  getMenuItems: () => HTMLElement[];
  loop: () => boolean;
};

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("Menu compound components must be used within Menu");
  return ctx;
}

const DEFAULT_SHADOW = palette.DIALOG_SHADOW;

const INTRINSICALLY_FOCUSABLE = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

/**
 * An interactive child already owns (or intentionally opts out of) the tab
 * stop. Enriching it avoids nesting two controls — a disabled button must stay
 * one disabled control rather than gaining a focusable button around it.
 */
function interactiveChildElement(node: unknown): HTMLElement | undefined {
  if (typeof HTMLElement === "undefined" || !(node instanceof HTMLElement)) return undefined;
  if (INTRINSICALLY_FOCUSABLE.has(node.tagName)) return node;
  if (node.tagName === "A" && node.hasAttribute("href")) return node;
  const tabIndex = node.getAttribute("tabindex");
  return tabIndex !== null && tabIndex !== "-1" ? node : undefined;
}

/** Viewport gutter the dropdown may never cross. */
const VIEWPORT_PAD = 8;
/** Narrowest sensible dropdown; also the width estimate before measurement. */
const MIN_MENU_W = 160;
/** Shell vertical padding (`py-[4px]`) plus 1px top/bottom borders. */
const SHELL_CHROME_Y = 8 + 2;

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

export type MenuRect = Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">;

export type MenuPlacement = {
  top: number;
  left: number;
  maxHeight: number;
  side: Side;
};

function parsePosition(position?: string): { side: Side; align: Align } {
  const [sidePart, alignPart] = (position ?? "bottom-start").split("-");
  const side: Side =
    sidePart === "top" || sidePart === "left" || sidePart === "right" || sidePart === "bottom"
      ? sidePart
      : "bottom";
  const align: Align = alignPart === "start" ? "start" : alignPart === "end" ? "end" : "center";
  return { side, align };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Measured, viewport-clamped placement.
 *
 * A dropdown that only ever opens downward silently leaves the screen: the
 * options dock's bottom-row menu at 1280×720 rendered all 12 items below the
 * fold, and `overflow: hidden` made the last of them unreachable rather than
 * merely scrolled out. So the side is chosen from the space actually free,
 * `max-height` is bounded to that side, and both axes are clamped to a gutter.
 */
export function computeMenuPlacement(input: {
  anchor: MenuRect;
  viewport: { width: number; height: number };
  menu: { width: number; height: number };
  position?: string;
  offset?: number;
}): MenuPlacement {
  const { anchor, viewport, menu } = input;
  const gap = input.offset ?? 0;
  const { side: preferred, align } = parsePosition(input.position);
  // 0 means "not measurable yet" (pre-layout). Treating that as a real height
  // would clamp the menu to nothing and keep it unmeasurable forever.
  const naturalH = Math.max(0, menu.height);
  const width = menu.width > 0 ? menu.width : MIN_MENU_W;
  const maxLeft = Math.max(VIEWPORT_PAD, viewport.width - VIEWPORT_PAD - width);

  if (preferred === "left" || preferred === "right") {
    // Side-anchored menus (the rail's account menu) keep their side; flipping
    // them horizontally would cover the trigger they hang off. They are only
    // bounded vertically, and both the height and the top edge must give way.
    const space = preferred === "right"
      ? viewport.width - anchor.right - VIEWPORT_PAD - gap
      : anchor.left - VIEWPORT_PAD - gap;
    const boxWidth = Math.max(0, Math.min(width, space));
    const left = preferred === "right" ? anchor.right + gap : anchor.left - gap - boxWidth;
    const maxHeight = Math.max(0, viewport.height - VIEWPORT_PAD * 2);
    const boxHeight = Math.min(naturalH > 0 ? naturalH : maxHeight, maxHeight);
    return {
      top: Math.round(clamp(verticalAlign(anchor, boxHeight, align, viewport), VIEWPORT_PAD, viewport.height - VIEWPORT_PAD - boxHeight)),
      left: Math.round(clamp(left, VIEWPORT_PAD, maxLeft)),
      maxHeight: Math.round(boxHeight),
      side: preferred,
    };
  }

  const spaceBelow = Math.max(0, viewport.height - anchor.bottom - VIEWPORT_PAD - gap);
  const spaceAbove = Math.max(0, anchor.top - VIEWPORT_PAD - gap);
  const prefersUp = preferred === "top";
  const preferredSpace = prefersUp ? spaceAbove : spaceBelow;
  const otherSpace = prefersUp ? spaceBelow : spaceAbove;
  // Flip into the other side when the preferred one cannot hold the menu and
  // the other one is genuinely roomier. In a short viewport neither side fits,
  // and staying put would clamp the list to a few unusable pixels.
  const openUp = naturalH > 0
    ? (preferredSpace < naturalH && otherSpace > preferredSpace ? !prefersUp : prefersUp)
    : spaceAbove > spaceBelow;
  const sideSpace = openUp ? spaceAbove : spaceBelow;
  // `max-height` is sized to the chosen side. Clamping `top` afterwards while
  // keeping a full height is what silently pushed the last items off the edge.
  const maxHeight = naturalH > 0 ? Math.min(naturalH, sideSpace) : sideSpace;
  const top = openUp ? anchor.top - gap - maxHeight : anchor.bottom + gap;

  return {
    top: Math.round(clamp(top, VIEWPORT_PAD, viewport.height - VIEWPORT_PAD - maxHeight)),
    left: Math.round(clamp(horizontalAlign(anchor, width, align), VIEWPORT_PAD, maxLeft)),
    maxHeight: Math.round(maxHeight),
    side: openUp ? "top" : "bottom",
  };
}

function horizontalAlign(anchor: MenuRect, width: number, align: Align): number {
  if (align === "start") return anchor.left;
  if (align === "end") return anchor.right - width;
  return anchor.left + anchor.width / 2 - width / 2;
}

function verticalAlign(anchor: MenuRect, height: number, align: Align, viewport: { height: number }): number {
  if (align === "start") return anchor.top;
  if (align === "end") return anchor.bottom - height;
  return clamp(
    anchor.top + anchor.height / 2 - height / 2,
    VIEWPORT_PAD,
    viewport.height - VIEWPORT_PAD - height,
  );
}

export function Menu(props: UIMenuProps) {
  const [known, rest] = splitProps(props as typeof props & Record<string, unknown>, [
    "trigger",
    "opened",
    "onChange",
    "position",
    "offset",
    "withArrow",
    "shadow",
    "closeOnItemClick",
    "closeOnClickOutside",
    "loop",
    "children",
    // Retained as a runtime swallow for older callers; no longer public API.
    "renderTarget",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  const [internalAnchorEl, setInternalAnchorEl] = createSignal<HTMLElement | null>(null);
  // Stable across renders so `aria-controls` resolves even before the dropdown
  // (which only exists while open) has mounted.
  const [dropdownId, setDropdownId] = createSignal(createUniqueId());
  // The dropdown node the outside-click handler must treat as "inside". It is
  // written by `MenuDropdown` only after that node has been inserted, so a
  // construction pass that never reaches the DOM cannot win the slot.
  const [dropdownElRef, setDropdownEl] = createSignal<HTMLElement | null>(null);
  let wrapperEl: HTMLDivElement | undefined;
  const containerEl = () => wrapperEl ?? null;

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

  // `children` is a props getter: every read constructs a fresh element tree and
  // runs the compound components' bodies. The old
  // `typeof children === "function" ? children(...) : children` expression read
  // the getter twice, so a second (never-inserted) dropdown tree was built and
  // its ref registered last — the outside-click handler then compared an
  // in-menu click against a detached node and closed the menu before the click
  // landed. Read it exactly once, here, inside the provider's owner so the
  // compound components still see the context and stay reactive.
  const children = () => {
    const value = known.children;
    return typeof value === "function"
      ? (value as unknown as (payload: { open: boolean; close: () => void }) => JSX.Element)({
          open: open(),
          close: onClose,
        })
      : value;
  };

  const registerDropdownEl = (el: HTMLElement | null) => {
    if (!el) return;
    setDropdownEl(el);
  };

  const unregisterDropdownEl = (el: HTMLElement | null) => {
    if (!el) return;
    setDropdownEl((current) => (current === el ? null : current));
  };

  const getMenuItems = () => {
    const dropdown = dropdownElRef();
    if (!dropdown) return [];
    return Array.from(dropdown.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
      (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true",
    );
  };

  createEffect(() => {
    // Outside-dismiss is the default: a menu that stays open until Escape or a
    // second target click reads as stuck. Callers opt out explicitly.
    if (!open() || known.closeOnClickOutside === false) return;
    const handleMousedown = (e: MouseEvent) => {
      const target = e.target as Node;
      // A programmatically opened menu has no recorded target: treat the wrapper
      // as the anchor, or the first click anywhere would dismiss it.
      const anchor = internalAnchorEl() ?? containerEl();
      const dropdown = dropdownElRef();
      if (anchor && anchor.contains(target)) return;
      if (dropdown && dropdown.contains(target)) return;
      onClose();
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
    containerEl,
    setAnchorEl,
    open,
    onClose,
    onOpen,
    closeOnItemClick: known.closeOnItemClick ?? true,
    position: () => known.position,
    offset: () => known.offset,
    withArrow: () => known.withArrow,
    shadow: () => known.shadow,
    trigger: () => known.trigger,
    dropdownId,
    setDropdownId,
    registerDropdownEl,
    unregisterDropdownEl,
    getMenuItems,
    loop: () => known.loop ?? true,
  };

  return (
    <MenuContext.Provider value={ctxValue}>
      <div
        id={known.id}
        ref={(el) => (wrapperEl = el)}
        className={cn("ui-menu", "inline-block", known.className)}
        style={known.style as Record<string, string | undefined>}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
      >
        {children()}
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
  const { setAnchorEl, anchorEl, open, onClose, trigger, dropdownId } = useMenuContext();
  const isHover = createMemo(() => trigger() === "hover" || trigger() === "click-hover");

  // `children` is a lazy getter — every read builds a fresh element tree. Read
  // it once and reuse the resulting node so enrichment lands on the live child.
  const child = known.children;
  const interactiveChild = interactiveChildElement(child);
  let wrapperEl: HTMLElement | undefined;

  const toggle = (target: HTMLElement) => {
    if (open() && anchorEl() === target) onClose();
    else setAnchorEl(target);
  };

  const handleClick = (e: MouseEvent) => {
    toggle(e.currentTarget as HTMLElement);
    known.onClick?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    // The child is usually a native button. Cancel its activation so the menu
    // toggles once instead of opening on keydown then closing on the click.
    e.preventDefault();
    toggle(e.currentTarget as HTMLElement);
  };

  const handleMouseEnter = (e: MouseEvent) => {
    if (isHover() && !open()) setAnchorEl(e.currentTarget as HTMLElement);
    known.onMouseEnter?.(e);
  };

  createEffect(() => {
    const el = interactiveChild ?? wrapperEl;
    if (!el) return;
    el.setAttribute("aria-haspopup", "menu");
    el.setAttribute("aria-expanded", String(open()));
    const id = dropdownId();
    if (id) el.setAttribute("aria-controls", id);
    else el.removeAttribute("aria-controls");
  });

  // A focusable child keeps its own tab stop and carries the disclosure ARIA;
  // otherwise the wrapper itself becomes the real, keyboard-reachable trigger.
  return interactiveChild ? (
    <span
      {...(rest as Record<string, unknown>)}
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn(known.className)}
      style={known.style as Record<string, string | undefined>}
      ref={(el) => (wrapperEl = el)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
    >
      {child}
    </span>
  ) : (
    <button
      type="button"
      {...(rest as Record<string, unknown>)}
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn(known.className)}
      style={known.style as Record<string, string | undefined>}
      ref={(el) => (wrapperEl = el)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
    >
      {child}
    </button>
  );
}

export function MenuDropdown(props: UIMenuDropdownProps) {
  const [known, rest] = splitProps(props, ["children", "className", "style", "id", "data-testid"]);
  const {
    open,
    position,
    offset,
    shadow,
    withArrow,
    anchorEl,
    containerEl,
    registerDropdownEl,
    unregisterDropdownEl,
    getMenuItems,
    loop,
    dropdownId,
    setDropdownId,
  } = useMenuContext();

  // An explicit dropdown id wins; otherwise publish the generated one so the
  // target's `aria-controls` always names the element this component renders.
  const resolvedId = createMemo(() => known.id ?? dropdownId());
  createEffect(() => setDropdownId(resolvedId()));

  // `equals: false` so a re-created element is re-registered even when the new
  // node compares equal; the previous node is unregistered by this effect's
  // cleanup when `open` flips or the element changes.
  const [dropdownEl, setDropdownEl] = createSignal<HTMLElement | null>(null, { equals: false });
  const [placement, setPlacement] = createSignal<MenuPlacement | null>(null);
  let innerEl: HTMLElement | undefined;

  const naturalMenuHeight = (shell: HTMLElement | null): number => {
    const shellHeight = shell?.getBoundingClientRect().height ?? 0;
    // The inner element is the scroll container, so its `scrollHeight` is the
    // full content height even after `max-height` has capped the shell. Using
    // the shell alone would make a capped menu report its cap as its natural
    // height, and it could never grow back when the viewport does.
    const contentHeight = innerEl ? innerEl.scrollHeight + SHELL_CHROME_Y : 0;
    return Math.max(shellHeight, contentHeight);
  };

  const place = () => {
    // A queued re-measure or a scroll listener can fire after the menu closed.
    if (!open()) return;
    // A controlled menu can open with no recorded target (no click), so anchor
    // to the menu wrapper rather than leaving the dropdown unpositioned.
    const anchor = anchorEl() ?? containerEl();
    if (!anchor) return;
    const el = dropdownEl();
    const anchorRect = anchor.getBoundingClientRect();
    const next = computeMenuPlacement({
      anchor: {
        top: anchorRect.top,
        bottom: anchorRect.bottom,
        left: anchorRect.left,
        right: anchorRect.right,
        width: anchorRect.width,
        height: anchorRect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      menu: { width: el?.getBoundingClientRect().width ?? 0, height: naturalMenuHeight(el) },
      position: position(),
      offset: offset() ?? 0,
    });
    // Placement runs twice per open (measure, then re-measure once `max-height`
    // has been applied) — skip the second write when nothing moved.
    const current = untrack(() => placement());
    if (
      current &&
      current.top === next.top &&
      current.left === next.left &&
      current.maxHeight === next.maxHeight &&
      current.side === next.side
    ) {
      return;
    }
    setPlacement(next);
  };

  createEffect(() => {
    if (!open()) {
      setPlacement(null);
      return;
    }
    // `dropdownEl` is tracked: the node does not exist on the first pass, and
    // measuring `null` would clamp the menu to a zero-height box.
    if (!dropdownEl()) return;
    place();
    // `max-height` is only written once a placement exists, so the first pass
    // measures the menu's natural size; the microtask re-measures the capped
    // box, which is what keeps `top` consistent with the height it renders at.
    queueMicrotask(place);
  });

  createEffect(() => {
    const el = dropdownEl();
    // `open` is tracked so closing unregisters: Solid never calls a ref with
    // `null`, and `Show` unmounting does not dispose this component, so without
    // this the outside-click handler keeps a detached node and treats a click
    // inside the live menu as "outside".
    if (!open() || !el) return;
    registerDropdownEl(el);
    onCleanup(() => unregisterDropdownEl(el));
  });

  const focusItem = (el: HTMLElement) => {
    for (const item of getMenuItems()) item.setAttribute("tabindex", item === el ? "0" : "-1");
    el.focus();
  };

  createEffect(() => {
    if (!open() || !dropdownEl()) return;
    // Arrow keys move a single tab stop; the first item owns it on open.
    // The dropdown is `visibility:hidden` until the placement effect measures
    // it, and focusing a hidden element is a no-op in a real browser — that
    // left focus on the trigger. Defer to a microtask so placement and the
    // visibility style write have landed before focus is applied.
    queueMicrotask(() => {
      if (!open()) return;
      const items = getMenuItems();
      if (items.length) focusItem(items[0]);
    });
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = getMenuItems();
    if (!items.length) return;
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;

    switch (e.key) {
      case "ArrowDown":
        next = activeIndex < 0
          ? items[0]
          : loop()
            ? items[(activeIndex + 1) % items.length]
            : items[Math.min(activeIndex + 1, items.length - 1)];
        break;
      case "ArrowUp":
        next = activeIndex < 0
          ? items[items.length - 1]
          : loop()
            ? items[(activeIndex - 1 + items.length) % items.length]
            : items[Math.max(activeIndex - 1, 0)];
        break;
      case "Home":
        next = items[0];
        break;
      case "End":
        next = items[items.length - 1];
        break;
      case "Enter":
      case " ":
      case "Spacebar": {
        const item = activeIndex >= 0 ? items[activeIndex] : items[0];
        if (!item) return;
        // Suppress the native button activation so this fires exactly once in
        // browsers too (Enter on keydown, Space on keyup).
        e.preventDefault();
        e.stopPropagation();
        item.click();
        return;
      }
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (next) focusItem(next);
  };

  createEffect(() => {
    if (!open()) return;
    // A scroll inside the menu itself must not move it; only an ancestor
    // scroller (the dock, the page) relocating the target does.
    const onMove = (e: Event) => {
      const el = dropdownEl();
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      place();
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    onCleanup(() => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    });
  });

  const maxHeight = () => placement()?.maxHeight;

  const dropdownStyle = createMemo<Record<string, string | undefined>>(() => {
    const p = placement();
    return {
      top: `${p?.top ?? 0}px`,
      left: `${p?.left ?? 0}px`,
      // Left unset on the measuring pass: a `max-height: 0px` shell collapses
      // the box, and every later measurement would read zero too.
      "max-height": p ? `${p.maxHeight}px` : undefined,
      // `visibility` rather than `display` so the measuring pass still lays out.
      visibility: p ? "visible" : "hidden",
      "box-shadow": shadow() ?? DEFAULT_SHADOW,
      ...(known.style as Record<string, string | undefined>),
    };
  });

  return (
    <Show when={open()}>
      <div
        id={resolvedId()}
        ref={(el) => setDropdownEl(el)}
        role="menu"
        className={cn(
          "ui-menu-dropdown",
          "fixed z-[100] min-w-[160px] bg-fin-surface border border-fin-border rounded-fin text-fin-text text-ui-label py-[4px] outline-none",
          withArrow() ? "with-arrow" : "",
          known.className,
        )}
        onKeyDown={handleKeyDown}
        style={dropdownStyle()}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
      >
        <Show when={withArrow()}>
          <div
            className={cn(
              "ui-menu-arrow absolute left-3 w-[12px] h-[12px] bg-fin-surface border-fin-border rotate-45",
              placement()?.side === "top"
                ? "-bottom-[7px] border-b border-r"
                : "-top-[7px] border-t border-l",
            )}
            aria-hidden="true"
          />
        </Show>
        <div
          ref={(el) => (innerEl = el)}
          className="ui-menu-dropdown-inner overflow-y-auto"
          style={maxHeight() === undefined ? {} : { "max-height": `${Math.max(0, maxHeight()! - SHELL_CHROME_Y)}px` }}
        >
          {known.children}
        </div>
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
    known.onClick?.(e);
    if (closeOnItemClick) onClose();
  };

  const cls = createMemo(() =>
    cn(
      "ui-menu-item",
      "flex w-full items-center gap-2 rounded-[4px] px-3 py-[6px] text-left text-ui-label border-none bg-transparent outline-none text-fin-text",
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
      tabIndex={-1}
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

function MenuDivider(props: any) {
  const [local, rest] = splitProps(props, ["className", "style", "dataTestid"]);
  return (
    <hr
      role="separator"
      className={cn("ui-menu-divider", "border-0 border-t border-fin-border mx-3 my-[4px]", local.className)}
      style={local.style}
      data-testid={local.dataTestid}
      {...rest}
    />
  );
}

function MenuLabel(props: any) {
  const [local, rest] = splitProps(props, ["children", "className", "style"]);
  return (
    <div
      className={cn("ui-menu-label", "px-3 py-[4px] text-ui-micro font-semibold uppercase text-fin-text-muted", local.className)}
      style={local.style}
      {...rest}
    >
      {local.children}
    </div>
  );
}

Menu.Target = MenuTarget;
Menu.Dropdown = MenuDropdown;
Menu.Item = MenuItem;
Menu.Divider = MenuDivider as any;
Menu.Label = MenuLabel as any;
