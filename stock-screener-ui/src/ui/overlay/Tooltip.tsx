import { createSignal, onCleanup, splitProps } from "solid-js";
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
  topStart: "bottom-full left-0 mb-1",
  topEnd: "bottom-full right-0 mb-1",
  bottomStart: "top-full left-0 mt-1",
  bottomEnd: "top-full right-0 mt-1",
};

const ARROW_SIDE: Record<TooltipPosition, "t" | "r" | "b" | "l"> = {
  top: "b",
  bottom: "t",
  left: "r",
  right: "l",
  topStart: "b",
  topEnd: "b",
  bottomStart: "t",
  bottomEnd: "t",
};

type ArrowPos = { bottom?: string; left?: string; transform?: string; top?: string; right?: string };
const ARROW_POS: Record<TooltipPosition, ArrowPos> = {
  top: { bottom: "-10px", left: "50%", transform: "translateX(-50%)" },
  bottom: { top: "-10px", left: "50%", transform: "translateX(-50%)" },
  left: { right: "-10px", top: "50%", transform: "translateY(-50%)" },
  right: { left: "-10px", top: "50%", transform: "translateY(-50%)" },
  topStart: { bottom: "-10px", left: "8px" },
  topEnd: { bottom: "-10px", right: "8px" },
  bottomStart: { top: "-10px", left: "8px" },
  bottomEnd: { top: "-10px", right: "8px" },
};

export function Tooltip(props: TooltipProps) {
  const [known, rest] = splitProps(props, [
    "label",
    "withArrow",
    "position",
    "openDelay",
    "closeDelay",
    "disabled",
    "multiline",
    "color",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
    "onMouseEnter",
    "onMouseLeave",
    "_withinPortal",
    "_transitionProps",
  ]);

  const [open, setOpen] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const enterMs = known.openDelay ?? 0;
  const leaveMs = known.closeDelay ?? 0;
  const show = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setOpen(true), enterMs);
  };
  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setOpen(false), leaveMs);
  };

  const placement: TooltipPosition = known.position ?? "top";

  if (known.disabled) return <>{known.children}</>;

  // A string label is the tooltip's accessible description. Surface it on the
  // wrapper so it stays queryable without hovering — the floating copy only
  // exists while open. A child that already carries its own accessible name
  // keeps it, so the name is never announced twice.
  const childEl = known.children as any;
  const childHasName =
    childEl != null &&
    typeof childEl === "object" &&
    "props" in childEl &&
    (childEl.props as { "aria-label"?: string; "aria-labelledby"?: string })["aria-label"] != null;
  const ariaLabel =
    typeof known.label === "string" && !childHasName ? known.label : undefined;

  const arrowStyle: ArrowPos = { ...ARROW_POS[placement] };
  const side = ARROW_SIDE[placement];
  if (side && known.color) {
    const prop =
      side === "t"
        ? "borderTopColor"
        : side === "r"
          ? "borderRightColor"
          : side === "b"
            ? "borderBottomColor"
            : "borderLeftColor";
    (arrowStyle as Record<string, string>)[prop] = known.color;
  }

  return (
    <span
      id={known.id}
      data-testid={known["data-testid"] ? `${known["data-testid"]}-wrapper` : undefined}
      aria-label={ariaLabel}
      className={cn("inline-flex relative", known.className)}
      style={known.style}
      onMouseEnter={(e) => {
        known.onMouseEnter?.(e);
        show();
      }}
      onMouseLeave={(e) => {
        known.onMouseLeave?.(e);
        hide();
      }}
      {...(rest as Record<string, unknown>)}
    >
      {known.children}
      {open() && known.label && (
        <span
          data-testid={known["data-testid"]}
          className={cn(
            "absolute z-50",
            PLACEMENT[placement],
            "bg-fin-surface border border-fin-border text-fin-text rounded-sm text-xs px-2 py-1",
            known.color ? "text-white" : undefined,
            known.multiline ? "max-w-[220px] whitespace-normal" : "whitespace-nowrap",
          )}
          style={{ "background-color": known.color ?? undefined }}
        >
          {known.label}
          {known.withArrow && (
            <span
              className="absolute w-0 h-0 border-[5px] border-transparent"
              style={{
                [`border${side === "t" ? "Top" : side === "r" ? "Right" : side === "b" ? "Bottom" : "Left"}Color`]:
                  known.color ?? palette.BORDER,
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
(Tooltip as any).Group = ({ children }: { children?: any }) => <>{children}</>;
(Tooltip as any).Floating = Tooltip;
