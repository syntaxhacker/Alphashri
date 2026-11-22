import { createEffect, createSignal, onCleanup, splitProps } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UITooltipProps } from "../types";

type TooltipProps = UITooltipProps & { transitionProps?: { duration?: number } };

type TooltipPosition = NonNullable<UITooltipProps["position"]>;

const ARROW_SIDE: Record<TooltipPosition, "t" | "r" | "b" | "l"> = {
  top: "b",
  bottom: "t",
  left: "r",
  right: "l",
  "top-start": "b",
  "top-end": "b",
  "bottom-start": "t",
  "bottom-end": "t",
  "left-start": "r",
  "left-end": "r",
  "right-start": "l",
  "right-end": "l",
};

type ArrowPos = { bottom?: string; left?: string; transform?: string; top?: string; right?: string };
const ARROW_POS: Record<TooltipPosition, ArrowPos> = {
  top: { bottom: "-10px", left: "50%", transform: "translateX(-50%)" },
  bottom: { top: "-10px", left: "50%", transform: "translateX(-50%)" },
  left: { right: "-10px", top: "50%", transform: "translateY(-50%)" },
  right: { left: "-10px", top: "50%", transform: "translateY(-50%)" },
  "top-start": { bottom: "-10px", left: "8px" },
  "top-end": { bottom: "-10px", right: "8px" },
  "bottom-start": { top: "-10px", left: "8px" },
  "bottom-end": { top: "-10px", right: "8px" },
  "left-start": { right: "-10px", top: "8px" },
  "left-end": { right: "-10px", bottom: "8px" },
  "right-start": { left: "-10px", top: "8px" },
  "right-end": { left: "-10px", bottom: "8px" },
};

/** Gap between the trigger and the floating box, in px. */
const GAP = 6;
/** Minimum distance from any viewport edge. */
const PAD = 8;

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
    "withinPortal",
    "transitionProps",
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

  /**
   * The floating box is portalled to <body> and positioned `fixed` from the
   * trigger's rect. An in-flow absolute child was clipped by any ancestor with
   * `overflow: hidden` — the market toolbar is exactly that, so its Stale/Live
   * tooltips were invisible even after flipping to "bottom".
   */
  const [pos, setPos] = createSignal<{ top: number; left: number; placement: TooltipPosition } | null>(null);
  let wrapEl: HTMLSpanElement | undefined;
  let tipEl: HTMLSpanElement | undefined;

  const place = () => {
    if (!wrapEl || !tipEl) return;
    const w = wrapEl.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    const need = t.height + GAP;

    // Flip to the side that has room; the requested side wins otherwise.
    let p = placement;
    if (p.startsWith("top") && w.top < need && window.innerHeight - w.bottom >= need) {
      p = p.replace("top", "bottom") as TooltipPosition;
    } else if (p.startsWith("bottom") && window.innerHeight - w.bottom < need && w.top >= need) {
      p = p.replace("bottom", "top") as TooltipPosition;
    }

    let top = p.startsWith("top") ? w.top - t.height - GAP : w.bottom + GAP;
    let left = p.endsWith("start")
      ? w.left
      : p.endsWith("end")
        ? w.right - t.width
        : w.left + w.width / 2 - t.width / 2;

    left = Math.max(PAD, Math.min(left, window.innerWidth - t.width - PAD));
    top = Math.max(PAD, Math.min(top, window.innerHeight - t.height - PAD));
    setPos({ top, left, placement: p });
  };

  createEffect(() => {
    if (!open()) {
      setPos(null);
      return;
    }
    // Render hidden first, then measure (visibility:hidden still lays out).
    queueMicrotask(place);
  });

  createEffect(() => {
    if (!open()) return;
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    // Capture so nested scroll containers (the table) reposition too.
    window.addEventListener("scroll", onMove, true);
    onCleanup(() => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    });
  });

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

  const activePlacement = (): TooltipPosition => pos()?.placement ?? placement;

  const arrowStyle = (): ArrowPos => {
    const p = activePlacement();
    const style: ArrowPos = { ...ARROW_POS[p] };
    const side = ARROW_SIDE[p];
    if (side && known.color) {
      const prop =
        side === "t"
          ? "borderTopColor"
          : side === "r"
            ? "borderRightColor"
            : side === "b"
              ? "borderBottomColor"
              : "borderLeftColor";
      (style as Record<string, string>)[prop] = known.color;
    }
    return style;
  };

  return (
    <span
      ref={(el) => {
        wrapEl = el;
      }}
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
        <Portal>
          <span
            ref={(el) => {
              tipEl = el;
            }}
            data-testid={known["data-testid"]}
            role="tooltip"
            className={cn(
              "fixed z-[1300]",
              "bg-fin-surface border border-fin-border text-fin-text rounded-sm text-xs px-2 py-1 shadow-md",
              known.color ? "text-white" : undefined,
              known.multiline ? "max-w-[280px] whitespace-normal" : "whitespace-nowrap",
            )}
            style={{
              top: `${pos()?.top ?? 0}px`,
              left: `${pos()?.left ?? 0}px`,
              visibility: pos() ? "visible" : "hidden",
              "background-color": known.color ?? undefined,
            }}
          >
            {known.label}
            {known.withArrow && (
              <span
                className="absolute w-0 h-0 border-[5px] border-transparent"
                style={{
                  [`border${ARROW_SIDE[activePlacement()] === "t" ? "Top" : ARROW_SIDE[activePlacement()] === "r" ? "Right" : ARROW_SIDE[activePlacement()] === "b" ? "Bottom" : "Left"}Color`]:
                    known.color ?? palette.BORDER,
                  ...arrowStyle(),
                }}
              />
            )}
          </span>
        </Portal>
      )}
    </span>
  );
}

// Preserve static members for compatibility (no-ops / wrappers)
(Tooltip as any).Group = ({ children }: { children?: any }) => <>{children}</>;
(Tooltip as any).Floating = Tooltip;
