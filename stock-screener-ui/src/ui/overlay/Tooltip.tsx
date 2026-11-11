import * as React from "react";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UITooltipProps } from "../types";

type TooltipProps = UITooltipProps & { transitionProps?: { duration?: number } };

type TooltipPosition = UITooltipProps["position"];

const PLACEMENT: Record<TooltipPosition, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1",
  left: "right-full top-1/2 -translate-y-1/2 mb-1",
  right: "left-full top-1/2 -translate-y-1/2 mt-1",
  "top-start": "bottom-full left-0 mb-1",
  "top-end": "bottom-full right-0 mb-1",
  "bottom-start": "top-full left-0 mt-1",
  "bottom-end": "top-full right-0 mt-1",
};

const ARROW_SIDE: Record<TooltipPosition, "t" | "r" | "b" | "l"> = {
  top: "b",
  bottom: "t",
  left: "r",
  right: "l",
  "top-start": "b",
  "top-end": "b",
  "bottom-start": "t",
  "bottom-end": "t",
};

const ARROW_POS: Record<TooltipPosition, React.CSSProperties> = {
  top: { bottom: "-10px", left: "50%", transform: "translateX(-50%)" },
  bottom: { top: "-10px", left: "50%", transform: "translateX(-50%)" },
  left: { right: "-10px", top: "50%", transform: "translateY(-50%)" },
  right: { left: "-10px", top: "50%", transform: "translateY(-50%)" },
  "top-start": { bottom: "-10px", left: "8px" },
  "top-end": { bottom: "-10px", right: "8px" },
  "bottom-start": { top: "-10px", left: "8px" },
  "bottom-end": { top: "-10px", right: "8px" },
};

export function Tooltip({
  label,
  withArrow,
  position,
  openDelay,
  closeDelay,
  disabled,
  multiline,
  color,
  _withinPortal,
  children,
  className,
  style,
  id,
  "data-testid": testId,
  _transitionProps,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const enterMs = openDelay ?? 0;
  const leaveMs = closeDelay ?? 0;
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), enterMs);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), leaveMs);
  };

  const placement: TooltipPosition = position ?? "top";

  if (disabled) return <>{children}</>;

  // A string label is the tooltip's accessible description. Surface it on the
  // wrapper so it stays queryable (and readable) without hovering — the
  // floating copy only exists while open. A child that already carries its own
  // accessible name keeps it, so the name is never announced twice.
  const childHasName =
    React.isValidElement(children) &&
    (children.props as { "aria-label"?: string; "aria-labelledby"?: string })["aria-label"] != null;
  const ariaLabel =
    typeof label === "string" && !childHasName ? label : undefined;

  const arrowStyle: React.CSSProperties = { ...ARROW_POS[placement] };
  const side = ARROW_SIDE[placement];
  if (side && color) {
    const prop =
      side === "t"
        ? "borderTopColor"
        : side === "r"
          ? "borderRightColor"
          : side === "b"
            ? "borderBottomColor"
            : "borderLeftColor";
    arrowStyle[prop as keyof React.CSSProperties] = color;
  }

  return (
    <span
      id={id}
      data-testid={testId ? `${testId}-wrapper` : undefined}
      aria-label={ariaLabel}
      className={cn("inline-flex relative", className)}
      style={style}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        show();
      }}
      onMouseLeave={(e) => {
        onMouseLeave?.(e);
        hide();
      }}
      {...(rest as Record<string, unknown>)}
    >
      {children}
      {open && label && (
        <span
          data-testid={testId}
          className={cn(
            "absolute z-50",
            PLACEMENT[placement],
            "bg-fin-surface border border-fin-border text-fin-text rounded-sm text-xs px-2 py-1",
            color ? "text-white" : undefined,
            multiline ? "max-w-[220px] whitespace-normal" : "whitespace-nowrap",
          )}
          style={{ backgroundColor: color ?? undefined }}
        >
          {label}
          {withArrow && (
            <span
              className="absolute w-0 h-0 border-[5px] border-transparent"
              style={{
                [`border${side === "t" ? "Top" : side === "r" ? "Right" : side === "b" ? "Bottom" : "Left"}Color`]:
                  color ?? palette.BORDER,
                ...ARROW_POS[placement],
              }}
            />
          )}
        </span>
      )}
    </span>
  );
}

// Preserve static members for compatibility (no-ops / wrappers)
(Tooltip as any).Group = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
(Tooltip as any).Floating = Tooltip;
