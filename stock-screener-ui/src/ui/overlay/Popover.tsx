import { Show, createContext, createEffect, createMemo, createSignal, splitProps, useContext } from "solid-js";
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
    "_trapFocus",
    "closeOnClickOutside",
    "_middlewares",
    "_keepMounted",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  void known._trapFocus;
  void known._middlewares;
  void known._keepMounted;

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
        {known.children}
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
  const { anchorEl, open, onClose, position, offset, width, shadow, closeOnClickOutside } =
    usePopoverContext();
  const [placeEl, setPlaceEl] = createSignal<HTMLDivElement | undefined>(undefined);
  const place = createSignal<Record<string, string | undefined>>({});

  createEffect(() => {
    if (!open() || !anchorEl() || !placeEl()) return;
    const rect = anchorEl().getBoundingClientRect();
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
      case topStart:
        s = { position: "fixed", bottom: `${vpH - rect.top + off}px`, left: `${rect.left}px` };
        break;
      case topEnd:
        s = { position: "fixed", bottom: `${vpH - rect.top + off}px`, right: `${vpW - rect.right}px` };
        break;
      case bottomStart:
        s = { position: "fixed", top: `${rect.bottom + off}px`, left: `${rect.left}px` };
        break;
      case bottomEnd:
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
    if (width() != null) {
      s.width = typeof width() === "number" ? `${width()}px` : width();
    }
    place.set(s);
  });

  createEffect(() => {
    if (!open()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
    return () => document.removeEventListener("mousedown", onDoc);
  });

  const padStyle = known.p != null ? { padding: paddingSize(known.p) } : undefined;
  const shadowClass = SHADOW_MAP[shadow() ?? ""] ?? "";

  return (
    <Show when={open()}>
      <div
        ref={(el) => setPlaceEl(el)}
        className={cn("z-50 bg-fin-surface border border-fin-border rounded-sm overflow-auto", shadowClass, known.className)}
        style={{ ...place(), ...padStyle, ...(known.style as Record<string, string | undefined>), ...(boxShadow ? { boxShadow } : {}) }}
        {...(rest as Record<string, unknown>)}
      >
        {known.children}
      </div>
    </Show>
  );
}
