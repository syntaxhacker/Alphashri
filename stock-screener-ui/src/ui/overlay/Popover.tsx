import * as React from "react";
import MuiPopover from "@mui/material/Popover";
import Box from "@mui/material/Box";
import type { UIPopoverProps, UIPopoverTargetProps, UIPopoverDropdownProps } from "../types";

type PopoverContextValue = {
  anchorEl: HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
  open: boolean;
  onClose?: () => void;
  position?: string;
  offset?: number;
  withArrow?: boolean;
  width?: number | string;
  shadow?: string;
  controlledOpen?: boolean;
};

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) throw new Error("Popover compound components must be used within Popover");
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
    case "bottom":
      return { anchorOrigin: { vertical: "bottom", horizontal: "center" }, transformOrigin: { vertical: "top", horizontal: "center" } };
    case "bottom-start":
      return { anchorOrigin: { vertical: "bottom", horizontal: "left" }, transformOrigin: { vertical: "top", horizontal: "left" } };
    case "bottom-end":
      return { anchorOrigin: { vertical: "bottom", horizontal: "right" }, transformOrigin: { vertical: "top", horizontal: "right" } };
    case "left":
      return { anchorOrigin: { vertical: "center", horizontal: "left" }, transformOrigin: { vertical: "center", horizontal: "right" } };
    case "right":
      return { anchorOrigin: { vertical: "center", horizontal: "right" }, transformOrigin: { vertical: "center", horizontal: "left" } };
    default:
      return { anchorOrigin: { vertical: "bottom", horizontal: "center" }, transformOrigin: { vertical: "top", horizontal: "center" } };
  }
}

export function Popover({
  children,
  opened,
  onClose,
  position,
  withArrow,
  width,
  shadow,
  offset,
  trapFocus,
  closeOnClickOutside,
  middlewares,
  keepMounted,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UIPopoverProps) {
  const [internalAnchorEl, setInternalAnchorEl] = React.useState<HTMLElement | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  const isControlled = opened !== undefined;
  const open = isControlled ? !!opened : uncontrolledOpen;

  // For uncontrolled mode, children will set anchorEl via PopoverTarget click;
  // we sync open state based on anchorEl presence if not controlled
  React.useEffect(() => {
    if (!isControlled) {
      setUncontrolledOpen(!!internalAnchorEl);
    }
  }, [internalAnchorEl, isControlled]);

  const handleClose = React.useCallback(() => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalAnchorEl(null);
      setUncontrolledOpen(false);
      onClose?.();
    }
  }, [isControlled, onClose]);

  const setAnchorEl = React.useCallback(
    (el: HTMLElement | null) => {
      setInternalAnchorEl(el);
      if (!isControlled) {
        setUncontrolledOpen(!!el);
      }
    },
    [isControlled]
  );

  // If controlled and opened is false, clear anchorEl so popover can close
  React.useEffect(() => {
    if (isControlled && !opened) {
      // keep anchorEl for positioning reference but MUI requires anchorEl to close; we keep it but open=false
    }
  }, [isControlled, opened]);

  // Collect children: expect PopoverTarget and PopoverDropdown
  // We render them via context; actual PopoverDropdown will render MuiPopover using anchorEl
  const ctxValue: PopoverContextValue = {
    anchorEl: internalAnchorEl,
    setAnchorEl,
    open,
    onClose: handleClose,
    position,
    offset,
    withArrow,
    width,
    shadow,
    controlledOpen: opened,
  };

  return (
    <PopoverContext.Provider value={ctxValue}>
      <Box
        className={className}
        style={style}
        data-testid={testId}
        sx={{ display: "inline-block" }}
        {...(rest as any)}
      >
        {children as any}
      </Box>
    </PopoverContext.Provider>
  );
}

export function PopoverTarget({ children, className, style }: UIPopoverTargetProps) {
  const { setAnchorEl, anchorEl, open } = usePopoverContext();
  const child = React.Children.only(children as React.ReactElement<any>);
  const handleClick = (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    // toggle behavior: if already open and same anchor, close
    if (open && anchorEl === target) {
      setAnchorEl(null);
    } else {
      setAnchorEl(target);
    }
    (child.props as any)?.onClick?.(e);
  };
  return React.cloneElement(child, {
    ref: (child as any).ref,
    onClick: handleClick,
    className: [className, (child.props as any).className].filter(Boolean).join(" ") || undefined,
    style: { ...style, ...(child.props as any).style },
  } as any);
}

export function PopoverDropdown({ children, className, style }: UIPopoverDropdownProps) {
  const { anchorEl, open, onClose, position, offset, width, shadow } = usePopoverContext();
  const { anchorOrigin, transformOrigin } = positionToAnchorOrigin(position);
  return (
    <MuiPopover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        paper: {
          className,
          style: style as any,
          sx: {
            ...(width != null ? { width: typeof width === "number" ? `${width}px` : width } : {}),
            ...(shadow ? { boxShadow: shadow } : {}),
            ...(offset != null ? { mt: `${offset}px` } : {}),
            p: 1.5,
          },
        },
      }}
    >
      <Box>{children}</Box>
    </MuiPopover>
  );
}

Popover.Target = PopoverTarget;
Popover.Dropdown = PopoverDropdown;
