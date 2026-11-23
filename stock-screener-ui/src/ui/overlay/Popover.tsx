import { Show, createContext, createEffect, createMemo, createSignal, onCleanup, splitProps, useContext } from "solid-js";
import { cn } from "../cn";
import type {
  UIPopoverProps,
  UIPopoverTargetProps,
  UIPopoverDropdownProps,
} from "../types";

type PopoverProps = UIPopoverProps;

type PopoverContextValue = {
  anchorEl: () => HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
  open: () => boolean;
  onClose?: () => void;
  onChange?: (open: boolean) => void;
  position: () => string | undefined;
  offset: () => number | undefined;
  withArrow: () => boolean | undefined;
  width: () => number | string | undefined;
  shadow: () => string | undefined;
  controlledOpen: () => boolean | undefined;
  closeOnClickOutside: () => boolean;
  trapFocus: () => boolean | undefined;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error("Popover compound components must be used within Popover");
  return ctx;
}

const SHADOW_MAP: Record<string, string> = {
  sm: "shadow-sm",
  md: "shadow-md",
  lg: "shadow-lg",
  xl: "shadow-xl",
};

function paddingSize(v: number | string): string {
  if (typeof v === "number") return `${v * 8}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return m[v] ?? String(v);
}

// Only elements in the tab sequence belong to the cycle: `tabindex="-1"`,
// disabled and hidden controls are reachable programmatically, not by Tab.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "audio[controls]",
  "video[controls]",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(root: HTMLElement | undefined): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute("tabindex") === "-1" || el.hasAttribute("disabled")) return false;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest("[inert]")) return false;
    const computed = window.getComputedStyle(el);
    return computed.display !== "none" && computed.visibility !== "hidden";
  });
}

export function Popover(props: PopoverProps) {
  const [known, rest] = splitProps(props, [
    "children",
    "opened",
    "onClose",
    "onChange",
    "position",
    "withArrow",
    "width",
    "shadow",
    "offset",
    "trapFocus",
    "closeOnClickOutside",
    "middlewares",
    "keepMounted",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  const [internalAnchorEl, setInternalAnchorEl] = createSignal<HTMLElement | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(false);

  const isControlled = createMemo(() => known.opened !== undefined);
  const open = createMemo(() => (isControlled() ? !!known.opened : uncontrolledOpen()));

  // Uncontrolled: open tracks anchorEl presence.
  createEffect(() => {
    if (!isControlled()) {
      setUncontrolledOpen(!!internalAnchorEl());
    }
  });

  const handleClose = () => {
    if (isControlled()) {
      known.onChange?.(false);
      known.onClose?.();
    } else {
      setInternalAnchorEl(null);
      setUncontrolledOpen(false);
      known.onChange?.(false);
      known.onClose?.();
    }
  };

  const setAnchorEl = (el: HTMLElement | null) => {
    setInternalAnchorEl(el);
    if (!isControlled()) {
      setUncontrolledOpen(!!el);
    }
  };

  // Controlled: when closed, clear anchorEl so the dropdown can remount cleanly.
  createEffect(() => {
    if (isControlled() && !known.opened) {
      setInternalAnchorEl(null);
    }
  });

  const ctxValue: PopoverContextValue = {
    anchorEl: internalAnchorEl,
    setAnchorEl,
    open,
    onClose: handleClose,
    onChange: known.onChange,
    position: () => known.position,
    offset: () => known.offset,
    withArrow: () => known.withArrow,
    width: () => known.width,
    shadow: () => known.shadow,
    controlledOpen: () => known.opened,
    closeOnClickOutside: () => known.closeOnClickOutside ?? true,
    trapFocus: () => known.trapFocus,
  };

  // Solid's `children` prop is a lazy getter: reading `known.children` twice
  // (e.g. `typeof` then use) creates two copies of compound children, each
  // with its own dropdown effects/listeners. Read it exactly once.
  const renderChildren = () => {
    const child = known.children;
    return typeof child === "function"
      ? child({
          ref: internalAnchorEl,
          toggle: () => setAnchorEl(internalAnchorEl()),
          close: handleClose,
          opened: open(),
        })
      : child;
  };

  return (
    <PopoverContext.Provider value={ctxValue}>
      <span
        id={known.id}
        data-testid={known["data-testid"]}
        className={cn("inline-block", known.className)}
        style={{ display: "inline-block", ...(known.style as Record<string, string | undefined>) }}
        {...(rest as Record<string, unknown>)}
      >
        {renderChildren()}
      </span>
    </PopoverContext.Provider>
  );
}

export function PopoverTarget(props: UIPopoverTargetProps) {
  const [known, rest] = splitProps(props, ["children", "className", "style", "id", "data-testid", "onClick"]);
  const { setAnchorEl, anchorEl, open, controlledOpen, onChange } = usePopoverContext();

  const handleClick = (e: MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (controlledOpen() !== undefined) {
      setAnchorEl(target);
      onChange?.(!open());
    } else if (open() && anchorEl() === target) {
      setAnchorEl(null);
    } else {
      setAnchorEl(target);
    }
    known.onClick?.(e);
  };

  return (
    <span
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn("inline-block", known.className)}
      style={{ display: "inline-block", ...(known.style as Record<string, string | undefined>) }}
      onClick={handleClick}
      {...(rest as Record<string, unknown>)}
    >
      {known.children}
    </span>
  );
}

export function PopoverDropdown(props: UIPopoverDropdownProps & { p?: number | string }) {
  const [known, rest] = splitProps(props, ["children", "className", "style", "p"]);
  const { anchorEl, open, onClose, position, offset, width, shadow, closeOnClickOutside, trapFocus } =
    usePopoverContext();
  const [placeEl, setPlaceEl] = createSignal<HTMLDivElement | undefined>(undefined);
  const [place, setPlace] = createSignal<Record<string, string | undefined>>({});

  createEffect(() => {
    const anchor = anchorEl();
    if (!open() || !anchor || !placeEl()) return;
    const rect = anchor.getBoundingClientRect();
    const off = offset() ?? 0;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    let s: Record<string, string | undefined> = { position: "fixed" };
    switch (position()) {
      case "top":
        s = { position: "fixed", bottom: `${vpH - rect.top + off}px`, left: `${rect.left + rect.width / 2}px`, transform: "translateX(-50%)" };
        break;
      case "bottom":
        s = { position: "fixed", top: `${rect.bottom + off}px`, left: `${rect.left + rect.width / 2}px`, transform: "translateX(-50%)" };
        break;
      case "top-start":
        s = { position: "fixed", bottom: `${vpH - rect.top + off}px`, left: `${rect.left}px` };
        break;
      case "top-end":
        s = { position: "fixed", bottom: `${vpH - rect.top + off}px`, right: `${vpW - rect.right}px` };
        break;
      case "bottom-start":
        s = { position: "fixed", top: `${rect.bottom + off}px`, left: `${rect.left}px` };
        break;
      case "bottom-end":
        s = { position: "fixed", top: `${rect.bottom + off}px`, right: `${vpW - rect.right}px` };
        break;
      case "left":
        s = { position: "fixed", right: `${vpW - rect.left + off}px`, top: `${rect.top + rect.height / 2}px`, transform: "translateY(-50%)" };
        break;
      case "right":
        s = { position: "fixed", left: `${rect.right + off}px`, top: `${rect.top + rect.height / 2}px`, transform: "translateX(-50%)" };
        break;
      default:
        s = { position: "fixed", top: `${rect.bottom + off}px`, left: `${rect.left + rect.width / 2}px`, transform: "translateX(-50%)" };
    }
    const w = width();
    if (w != null) {
      s.width = typeof w === "number" ? `${w}px` : w;
    }
    setPlace(s);
  });

  createEffect(() => {
    if (!open()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  createEffect(() => {
    if (!open() || closeOnClickOutside() === false) return;
    const onDoc = (e: MouseEvent) => {
      const el = placeEl();
      const anchor = anchorEl();
      if (anchor && !anchor.contains(e.target as Node) && el && !el.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", onDoc);
    onCleanup(() => document.removeEventListener("mousedown", onDoc));
  });

  createEffect(() => {
    if (!open() || !trapFocus()) return;
    const container = placeEl();
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // The target is usually a <span> wrapper: hand focus back to its trigger
    // rather than to the wrapper (which is not itself tabbable).
    const restoreTarget = (): HTMLElement | null => {
      const anchor = anchorEl();
      if (!anchor) return previouslyFocused;
      if (anchor.matches(FOCUSABLE_SELECTOR)) return anchor;
      return getFocusable(anchor)[0] ?? previouslyFocused;
    };

    (getFocusable(container)[0] ?? container).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
      const focusables = getFocusable(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (active === last && !e.shiftKey) {
        e.preventDefault();
        first.focus();
      } else if (active === first && e.shiftKey) {
        e.preventDefault();
        last.focus();
      } else if (active == null || !focusables.includes(active)) {
        // Focus is on the container or outside the dropdown entirely: pull it
        // back to the matching edge instead of letting it escape the trap.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey, true);
      restoreTarget()?.focus?.();
    });
  });

  const padStyle = known.p != null ? { padding: paddingSize(known.p) } : undefined;
  const shadowClass = SHADOW_MAP[shadow() ?? ""] ?? "";

  // No `role="dialog"`/`aria-modal` here: UIPopoverDropdownProps has no
  // `title`/`aria-label` prop, so a dialog role would be unnamed. Keep the
  // popup semantics; trapFocus only constrains the Tab cycle.
  return (
    <Show when={open()}>
      <div
        ref={(el) => setPlaceEl(el)}
        className={cn("z-50 bg-fin-surface border border-fin-border rounded-sm overflow-auto", shadowClass, known.className)}
        style={{ ...place(), ...padStyle, ...(known.style as Record<string, string | undefined>) }}
        tabIndex={trapFocus() ? -1 : undefined}
        {...(rest as Record<string, unknown>)}
      >
        {known.children}
      </div>
    </Show>
  );
}
