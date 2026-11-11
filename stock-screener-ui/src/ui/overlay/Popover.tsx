import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../cn";
import type {
  UIPopoverProps,
  UIPopoverTargetProps,
  UIPopoverDropdownProps,
} from "../types";

type PopoverProps = UIPopoverProps;

type PopoverContextValue = {
  anchorEl: HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
  open: boolean;
  onClose?: () => void;
  onChange?: (open: boolean) => void;
  position?: string;
  offset?: number;
  withArrow?: boolean;
  width?: number | string;
  shadow?: string;
  controlledOpen?: boolean;
  closeOnClickOutside?: boolean;
};

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const ctx = React.useContext(PopoverContext);
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

export function Popover({
  children,
  opened,
  onClose,
  onChange,
  position,
  withArrow,
  width,
  shadow,
  offset,
  _trapFocus,
  closeOnClickOutside,
  _middlewares,
  _keepMounted,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: PopoverProps) {
  const [internalAnchorEl, setInternalAnchorEl] = React.useState<HTMLElement | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  const isControlled = opened !== undefined;
  const open = isControlled ? !!opened : uncontrolledOpen;

  // For uncontrolled mode, sync open state based on anchorEl presence.
  React.useEffect(() => {
    if (!isControlled) {
      setUncontrolledOpen(!!internalAnchorEl);
    }
  }, [internalAnchorEl, isControlled]);

  const handleClose = React.useCallback(() => {
    if (isControlled) {
      onChange?.(false);
      onClose?.();
    } else {
      setInternalAnchorEl(null);
      setUncontrolledOpen(false);
      onChange?.(false);
      onClose?.();
    }
  }, [isControlled, onClose, onChange]);

  const setAnchorEl = React.useCallback(
    (el: HTMLElement | null) => {
      setInternalAnchorEl(el);
      if (!isControlled) {
        setUncontrolledOpen(!!el);
      }
    },
    [isControlled],
  );

  // If controlled and opened is false, clear anchorEl so the dropdown can remount cleanly.
  React.useEffect(() => {
    if (isControlled && !opened) {
      setInternalAnchorEl(null);
    }
  }, [isControlled, opened]);

  const ctxValue: PopoverContextValue = {
    anchorEl: internalAnchorEl,
    setAnchorEl,
    open,
    onClose: handleClose,
    onChange,
    position,
    offset,
    withArrow,
    width,
    shadow,
    controlledOpen: opened,
    closeOnClickOutside: closeOnClickOutside ?? true,
  };

  return (
    <PopoverContext.Provider value={ctxValue}>
      <span
        id={id}
        data-testid={testId}
        className={cn("inline-block", className)}
        style={{ display: "inline-block", ...style }}
        {...(rest as Record<string, unknown>)}
      >
        {children}
      </span>
    </PopoverContext.Provider>
  );
}

export function PopoverTarget({ children, className, style }: UIPopoverTargetProps) {
  const { setAnchorEl, anchorEl, open, controlledOpen, onChange } = usePopoverContext();
  const child = React.Children.only(children as React.ReactElement<any>);
  const handleClick = (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (controlledOpen !== undefined) {
      // Controlled (Mantine-style): toggle via onChange.
      setAnchorEl(target);
      onChange?.(!open);
    } else if (open && anchorEl === target) {
      setAnchorEl(null);
    } else {
      setAnchorEl(target);
    }
    (child.props as any)?.onClick?.(e);
  };
  return React.cloneElement(child, {
    ref: (child as any).ref,
    onClick: handleClick,
    className: cn(className, (child.props as any).className),
    style: { ...style, ...(child.props as any).style },
  } as any);
}

export function PopoverDropdown({
  children,
  className,
  style,
  p,
}: UIPopoverDropdownProps & { p?: number | string }) {
  const { anchorEl, open, onClose, position, offset, width, shadow, closeOnClickOutside } =
    usePopoverContext();
  const ref = React.useRef<HTMLDivElement>(null);
  const [place, setPlace] = React.useState<React.CSSProperties>({});

  React.useEffect(() => {
    if (!open || !anchorEl || !ref.current) return;
    const rect = anchorEl.getBoundingClientRect();
    const off = offset ?? 0;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    let s: React.CSSProperties = { position: "fixed" };
    switch (position) {
      case "top":
        s = { position: "fixed", bottom: vpH - rect.top + off, left: `${rect.left + rect.width / 2}px`, transform: "translateX(-50%)" };
        break;
      case "bottom":
        s = { position: "fixed", top: rect.bottom + off, left: `${rect.left + rect.width / 2}px`, transform: "translateX(-50%)" };
        break;
      case "top-start":
        s = { position: "fixed", bottom: vpH - rect.top + off, left: `${rect.left}px` };
        break;
      case "top-end":
        s = { position: "fixed", bottom: vpH - rect.top + off, right: `${vpW - rect.right}px` };
        break;
      case "bottom-start":
        s = { position: "fixed", top: rect.bottom + off, left: `${rect.left}px` };
        break;
      case "bottom-end":
        s = { position: "fixed", top: rect.bottom + off, right: `${vpW - rect.right}px` };
        break;
      case "left":
        s = { position: "fixed", right: vpW - rect.left + off, top: `${rect.top + rect.height / 2}px`, transform: "translateY(-50%)" };
        break;
      case "right":
        s = { position: "fixed", left: rect.right + off, top: `${rect.top + rect.height / 2}px`, transform: "translateY(-50%)" };
        break;
      default:
        s = { position: "fixed", top: rect.bottom + off, left: `${rect.left + rect.width / 2}px`, transform: "translateX(-50%)" };
    }
    if (width != null) {
      s.width = typeof width === "number" ? `${width}px` : width;
    }
    setPlace(s);
  }, [open, anchorEl, position, offset, width]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Click outside closes the popover (honors closeOnClickOutside, default on).
  React.useEffect(() => {
    if (!open || closeOnClickOutside === false) return;
    const onDoc = (e: MouseEvent) => {
      const el = ref.current;
      if (anchorEl && !anchorEl.contains(e.target as Node) && el && !el.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, anchorEl, closeOnClickOutside, onClose]);

  const padStyle = p != null ? { padding: paddingSize(p) } : undefined;
  const shadowClass = SHADOW_MAP[shadow ?? ""] ?? "";
  const boxShadow = shadow && !(shadow in SHADOW_MAP) ? shadow : undefined;

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={cn(
        "z-50 bg-fin-surface border border-fin-border rounded-sm overflow-auto",
        shadowClass,
        className,
      )}
      style={{ ...place, ...padStyle, ...style, ...(boxShadow ? { boxShadow } : {}) }}
    >
      {children}
    </div>,
    document.body,
  );
}

Popover.Target = PopoverTarget;
Popover.Dropdown = PopoverDropdown;
